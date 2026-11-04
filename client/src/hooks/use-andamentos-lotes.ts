import {useEffect,useRef,useState} from 'react';
import {novoPlanoAndamentos,planoAndamentosSchema,type PlanoAndamentos} from '@shared/andamentos-lotes';
import {executarLotesAndamentos} from '@/lib/andamentos-lotes';
import {apiRequest} from '@/lib/queryClient';
const KEY='painel-andamentos:lotes:v1';
function ler(){try{const s=localStorage.getItem(KEY);if(!s)return null;const r=planoAndamentosSchema.safeParse(JSON.parse(s));return r.success?r.data:null;}catch{return null;}}
function salvar(p:PlanoAndamentos){try{localStorage.setItem(KEY,JSON.stringify(p));}catch{throw Error('Não foi possível salvar o progresso neste navegador. A atualização foi pausada.');}}
export function resumoLotes(p:PlanoAndamentos){return `${p.cursor}/${p.ids.length} consultados · ${p.ok} ok · ${p.naoEncontrado} não encontrados · ${p.segundoGrau} de 2º grau · ${p.erro} erros${p.removidos?` · ${p.removidos} removidos`:''}`;}
export function useAndamentosLotes(aoParar:()=>void){
 const[plano,setPlano]=useState<PlanoAndamentos|null>(ler),[executando,setExecutando]=useState(false),[erro,setErro]=useState<string|null>(null);
 const busy=useRef(false),stop=useRef(false),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;const changed=(e:StorageEvent)=>{if(e.key===KEY&&!busy.current)setPlano(ler());};window.addEventListener('storage',changed);return()=>{mounted.current=false;stop.current=true;window.removeEventListener('storage',changed);};},[]);
 async function executar(ids?:number[],modo:PlanoAndamentos['modo']='todos'){
  if(busy.current)return;
  busy.current=true;stop.current=false;setErro(null);setExecutando(true);
  async function run(){
   const salvo=ler();const p=ids?novoPlanoAndamentos(ids,modo,crypto.randomUUID()):salvo;
   if(!p)throw Error('Não há atualização salva para retomar.');
   await executarLotesAndamentos(p,{salvar,progresso:p=>{if(mounted.current)setPlano(p);},parar:()=>stop.current,
    consultar:async ids=>{const r=await apiRequest('POST','/api/processos/atualizar',{ids},AbortSignal.timeout(45000));return r.json();},
    esperar:()=>new Promise(r=>setTimeout(r,300))});
  }
  try{
   if(navigator.locks){await navigator.locks.request('painel-andamentos:lotes',{ifAvailable:true},async lock=>{if(!lock)throw Error('Outra aba está atualizando os andamentos. Aguarde ou pause naquela aba.');await run();});}
   else await run();
  }catch(e){if(mounted.current)setErro(e instanceof Error&&e.name==='TimeoutError'?'O lote demorou além do previsto. Retome para repetir somente o lote não confirmado.':e instanceof Error?e.message:'Lote inconclusivo. Retome a atualização.');}
  finally{busy.current=false;if(mounted.current){setExecutando(false);aoParar();}}
 }
 async function encerrar(){if(busy.current)return;const clear=()=>{localStorage.removeItem(KEY);setPlano(null);setErro(null);};try{if(navigator.locks)await navigator.locks.request('painel-andamentos:lotes',{ifAvailable:true},lock=>{if(!lock)throw Error('Outra aba está atualizando os andamentos. Pause naquela aba antes de encerrar.');clear();});else clear();}catch(e){setErro(e instanceof Error?e.message:'Não foi possível remover o acompanhamento salvo.');}}
 return{plano,executando,erro,executar,pausar:()=>{stop.current=true;},encerrar,pendente:!!plano&&plano.cursor<plano.ids.length};
}
