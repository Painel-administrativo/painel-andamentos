import {createHash} from 'node:crypto';
import type {MovimentoRelatorio,ResultadoRelatorio} from '../shared/relatorios';
const ENDPOINTS:Record<string,string>={TJRJ:'api_publica_tjrj',TRF2:'api_publica_trf2',TRT1:'api_publica_trt1',TJSP:'api_publica_tjsp',TJRS:'api_publica_tjrs'};
// Public CNJ API key, identical to the existing DataJud integration; optional override on the server.
const PUBLIC_KEY='APIKey cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==';
function estavel(v:any):string {if(Array.isArray(v))return '['+v.map(estavel).join(',')+']';if(v&&typeof v==='object')return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+estavel(v[k])).join(',')+'}';return JSON.stringify(v);}
const hash=(v:any)=>createHash('sha256').update(estavel(v)).digest('hex');
const texto=(v:any)=>typeof v==='string'?v.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim():'';
function diaFonte(v:any) {
 if(typeof v!=='string')throw Error('A fonte trouxe movimento sem data legível.');
 const s=/^\d{14}$/.test(v)?`${v.slice(0,4)}-${v.slice(4,6)}-${v.slice(6,8)}`:v.slice(0,10);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||isNaN(Date.parse(s))||new Date(s).toISOString().slice(0,10)!==s)throw Error('A fonte trouxe movimento com data inválida.');
 return s;
}
export function normalizarFonte(json:any,numero:string) {
 const hits=json?.hits?.hits,total=json?.hits?.total;
 const qtd=typeof total==='number'?total:total?.value;
 if(!Array.isArray(hits)||!Number.isSafeInteger(qtd)||qtd<0||total?.relation==='gte'||qtd>100||qtd!==hits.length)throw Error('Resposta incompleta ou inválida do DataJud.');
 if(!qtd)throw Error('Processo não localizado no DataJud nesta consulta.');
 const movimentos=new Map<string,MovimentoRelatorio>();const atualizacoes:string[]=[];
 for(const hit of hits){
  const s=hit?._source;
  if(!s||String(s.numeroProcesso).replace(/\D/g,'')!==numero||!Array.isArray(s.movimentos))throw Error('A fonte não retornou o histórico esperado para este processo.');
  // Class/court metadata can change on redistribution; that must not re-key the entire history.
  const escopo=[s.tribunal??'',s.grau??''];
  if(typeof s.dataHoraUltimaAtualizacao==='string'){try{atualizacoes.push(diaFonte(s.dataHoraUltimaAtualizacao));}catch{/* unavailable source timestamp is disclosed below */}}
  for(const m of s.movimentos){
   if(!m||!texto(m.nome))throw Error('A fonte trouxe movimento sem descrição.');
   const dia=diaFonte(m.dataHora);
   const complementos=Array.isArray(m.complementosTabelados)?m.complementosTabelados.map((c:any)=>({codigo:c.codigo??null,descricao:texto(c.descricao),valor:c.valor??null})).sort((a:any,b:any)=>estavel(a).localeCompare(estavel(b))):[];
   const id=hash({escopo,data:m.dataHora,codigo:m.codigo??null,nome:texto(m.nome),complementos,orgao:m.orgaoJulgador??null});
   const extra=complementos.map((c:any)=>[c.descricao,c.valor].filter(v=>v!==null&&v!=='').join(': ')).filter(Boolean).join('; ');
   const descricao=texto(m.nome)+(extra?' — '+extra:'');
   if(descricao.length>4000)throw Error('A fonte trouxe uma descrição extensa demais para o relatório assistido. Conferir o movimento individualmente.');
   movimentos.set(id,{id,data:m.dataHora,dia,descricao,grau:texto(s.grau),orgao:texto(m.orgaoJulgador?.nome)});
   if(movimentos.size>5000)throw Error('Histórico acima do limite de consulta assistida. Conferir diretamente no tribunal.');
  }
 }
 return {movimentos:Array.from(movimentos.values()).sort((a,b)=>a.dia.localeCompare(b.dia)||a.data.localeCompare(b.data)||a.id.localeCompare(b.id)),atualizacaoFonte:atualizacoes.sort().at(-1)??null};
}
export function compararFonte(atual:ReturnType<typeof normalizarFonte>,anterior:ResultadoRelatorio|null,inicio:string,fim:string):ResultadoRelatorio {
 const vistosAntes=new Set(anterior?.vistos??[]);
 if(anterior && atual.movimentos.length<anterior.totalMovimentos)throw Error('A fonte retornou menos movimentos que a referência anterior. Conferir a integridade no tribunal.');
 const novos=atual.movimentos.filter(m=>!vistosAntes.has(m.id));
 // Future-dated rows stay out of the new baseline so they cannot disappear from a later report.
 const conhecidos=atual.movimentos.filter(m=>m.dia<=fim).map(m=>m.id);
 const vistos=Array.from(new Set([...(anterior?.vistos??[]),...conhecidos]));
 if((anterior?novos:atual.movimentos.filter(m=>m.dia>=inicio&&m.dia<=fim)).length>200)throw Error('Mais de 200 movimentos a revisar neste processo. É necessária conferência individual antes do relatório.');
 const avisos:string[]=[];
 if(!atual.atualizacaoFonte)avisos.push('A fonte não informou sua última atualização.');
 if(atual.movimentos.some(m=>m.dia>fim))avisos.push('Há registros com data posterior ao período solicitado. Conferir as datas na fonte.');
 if(anterior && anterior.vistos.some(id=>!atual.movimentos.some(m=>m.id===id)))avisos.push('Há registros anteriores ausentes ou modificados nesta resposta da fonte.');
 return {inicial:!anterior,novos:anterior?novos:[],noPeriodo:atual.movimentos.filter(m=>m.dia>=inicio&&m.dia<=fim),anteriores:anterior?novos.filter(m=>m.dia<inicio):[],ultimo:atual.movimentos.at(-1)??null,totalMovimentos:atual.movimentos.length,avisos,atualizacaoFonte:atual.atualizacaoFonte,vistos};
}
export async function consultarFonte(numero:string,tribunal:string,transport:typeof fetch=fetch) {
 const alias=ENDPOINTS[tribunal];if(!alias)throw Error('Tribunal ainda não suportado nesta consulta de andamentos.');
 const r=await transport(`https://api-publica.datajud.cnj.jus.br/${alias}/_search`,{method:'POST',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json',Authorization:process.env.DATAJUD_APIKEY||PUBLIC_KEY},body:JSON.stringify({size:100,track_total_hits:true,query:{match:{numeroProcesso:numero}}})});
 if(!r.ok){await r.body?.cancel();throw Error(`Consulta DataJud indisponível (HTTP ${r.status}).`);}
 const reader=r.body?.getReader();if(!reader)throw Error('A fonte retornou resposta vazia.');let size=0;const partes:Uint8Array[]=[];
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>4_000_000)throw Error('Resposta do DataJud excedeu o limite de consulta.');partes.push(value);}}finally{await reader.cancel().catch(()=>{});}
 const raw=JSON.parse(Buffer.concat(partes).toString('utf8'));
 const normalizada=normalizarFonte(raw,numero);return {raw,...normalizada};
}
