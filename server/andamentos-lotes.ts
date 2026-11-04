import type {Express} from 'express';
import {z} from 'zod';
import type {DatajudSource} from '../shared/schema';
import {TAMANHO_LOTE_ANDAMENTOS,type ResultadoAndamento} from '../shared/andamentos-lotes';
export type ConsultaAndamento={status:'ok'|'nao_encontrado'|'erro';dados?:DatajudSource;erro?:string};
const endpoints:Record<string,string>={TJRJ:'api_publica_tjrj',TRF2:'api_publica_trf2',TRT1:'api_publica_trt1',TJSP:'api_publica_tjsp',TJRS:'api_publica_tjrs'};
export async function consultarFonteAndamentos(numero:string,tribunal:string,key:string,transport:typeof fetch=fetch,timeout=12000):Promise<ConsultaAndamento>{
 const n=numero.replace(/\D/g,'');if(n.length!==20)return{status:'erro',erro:'Número processual inválido.'};
 const endpoint=endpoints[tribunal];if(!endpoint)return{status:'erro',erro:'Tribunal não suportado.'};
 try{
  const r=await transport(`https://api-publica.datajud.cnj.jus.br/${endpoint}/_search`,{method:'POST',signal:AbortSignal.timeout(timeout),headers:{Authorization:key,'Content-Type':'application/json'},body:JSON.stringify({query:{match:{numeroProcesso:n}}})});
  if(!r.ok){await r.body?.cancel();return{status:'erro',erro:`DataJud HTTP ${r.status}. Consulta inconclusiva.`};}
  const j=await r.json();const total=typeof j?.hits?.total==='number'?j.hits.total:j?.hits?.total?.value;
  if(!Number.isSafeInteger(total)||total<0||!Array.isArray(j?.hits?.hits)||total<j.hits.hits.length||total>0&&j.hits.hits.length===0)return{status:'erro',erro:'Resposta inválida do DataJud. Consulta inconclusiva.'};
  if(total===0)return{status:'nao_encontrado'};
  const source=j.hits.hits[0]?._source;
  if(!source||typeof source!=='object'||String(source.numeroProcesso||'').replace(/\D/g,'')!==n)return{status:'erro',erro:'Resposta incompatível com o processo consultado.'};
  return{status:'ok',dados:source};
 }catch{return{status:'erro',erro:'DataJud não respondeu no tempo previsto ou houve falha de conexão. Tente novamente mais tarde.'};}
}
type Db={query:(sql:string,values?:any[])=>Promise<any>};
type Salvar=(id:number,data:{status:string;erro:string|null;dados:DatajudSource|null})=>Promise<any>;
const idsInput=z.object({ids:z.array(z.number().int().positive().safe()).min(1).max(TAMANHO_LOTE_ANDAMENTOS).refine(v=>new Set(v).size===v.length)}).strict();
export async function processarLoteAndamentos(ids:number[],db:Db,consultar:(numero:string,tribunal:string)=>Promise<ConsultaAndamento>,salvar:Salvar){
 idsInput.parse({ids});
 const rows=(await db.query('SELECT id,numero,tribunal FROM public.processos WHERE id=ANY($1::bigint[]) ORDER BY id',[ids])).rows;
 const processos=new Map<number,any>(rows.map((p:any)=>[Number(p.id),p]));
 const resultados:ResultadoAndamento[]=await Promise.all(ids.map(async id=>{
  const p=processos.get(id);if(!p)return{id,status:'removido' as const};
  try{
   const r=await consultar(p.numero,p.tribunal);
   const status=r.status==='nao_encontrado'&&['TJRJ','TRF2'].includes(p.tribunal)&&String(p.numero).replace(/\D/g,'').endsWith('0000')?'2o_grau' as const:r.status;
   await salvar(id,{status,erro:r.erro??null,dados:r.dados??null});
   return{id,status,erro:r.erro??null};
  }catch{return{id,status:'erro' as const,erro:'Não foi possível concluir e gravar a consulta deste processo.'};}
 }));
 return{resultados,processados:resultados.length,ok:resultados.filter(r=>r.status==='ok').length,naoEncontrado:resultados.filter(r=>r.status==='nao_encontrado').length,segundoGrau:resultados.filter(r=>r.status==='2o_grau').length,erro:resultados.filter(r=>r.status==='erro').length,removidos:resultados.filter(r=>r.status==='removido').length,atualizadoEm:new Date().toISOString()};
}
export function registrarLotesAndamentos(app:Express,db:Db,consultar:(numero:string,tribunal:string)=>Promise<ConsultaAndamento>,salvar:Salvar){
 for(const [path,modo]of [['/api/processos/atualizar','todos'],['/api/processos/atualizar-pendentes','pendentes'],['/api/processos/atualizar-2ograu','2ograu']] as const){
  app.post(path,async(req,res)=>{try{
   if(req.body?.ids!==undefined){const {ids}=idsInput.parse(req.body);res.json({...await processarLoteAndamentos(ids,db,consultar,salvar),concluido:true});return;}
   if(req.query.limite===undefined&&req.body?.limite===undefined){res.status(400).json({erro:'Atualize a página para usar a atualização em lotes. A consulta completa em uma única chamada foi desativada.'});return;}
   const limite=z.coerce.number().int().min(1).max(TAMANHO_LOTE_ANDAMENTOS).parse(req.query.limite??req.body?.limite);
   const offset=z.coerce.number().int().min(0).max(1000000).parse(req.query.offset??req.body?.offset??0);
   const filtro=modo==='pendentes'?"WHERE s.id IS NULL OR s.status IN ('erro','nao_encontrado')":modo==='2ograu'?"WHERE s.status='2o_grau'":'';
   const rows=(await db.query(`SELECT p.id FROM public.processos p LEFT JOIN public.snapshots s ON s.processo_id=p.id ${filtro} ORDER BY p.id LIMIT $1 OFFSET $2`,[limite+1,offset])).rows;
   const ids=rows.slice(0,limite).map((p:any)=>Number(p.id));const concluido=rows.length<=limite;
   const r=ids.length?await processarLoteAndamentos(ids,db,consultar,salvar):{resultados:[],processados:0,ok:0,naoEncontrado:0,segundoGrau:0,erro:0,removidos:0,atualizadoEm:new Date().toISOString()};
   res.json({...r,offset,limite,proximoOffset:concluido?null:offset+ids.length,concluido});
  }catch(e){res.status(e instanceof z.ZodError?400:503).json({erro:e instanceof z.ZodError?'Informe até três processos válidos por lote.':'Lote inconclusivo. Os resultados já gravados foram preservados; retome a atualização.'});}});
 }
}
