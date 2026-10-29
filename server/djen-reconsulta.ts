import type {Express} from 'express';
import type {Pool} from 'pg';
import {z} from 'zod';
import type {DjenItem} from '../shared/schema';
import {dataValida} from '../shared/calendario';
import {DjenResponseError,lerRespostaDjen} from './djen-response';
const idSchema=z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const inputSchema=z.object({processoId:idSchema,rodada:z.string().uuid()}).strict();
class ReconsultaErro extends Error {constructor(message:string,public status:number){super(message);}}
// One process per request: two bounded remote attempts fit the serverless budget.
export async function consultarDjenNovamente(numero:string,inicio:string,fim:string,fetcher:typeof fetch=fetch,sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms))){
 const params=new URLSearchParams({numeroProcesso:numero,itensPorPagina:'50',dataDisponibilizacaoInicio:inicio,dataDisponibilizacaoFim:fim});
 const url=`https://comunicaapi.pje.jus.br/api/v1/comunicacao?${params}`;
 let rateLimits=0;
 try { for(let tentativa=0;tentativa<2;tentativa++){
  let response:Response;
  try{response=await fetcher(url,{headers:{Accept:'application/json','User-Agent':'PainelAndamentos/1.0 (reconsulta)'},signal:AbortSignal.timeout(12000)});}
  catch{if(tentativa===0){await sleep(1500);continue;}throw new DjenResponseError('DJEN_CONEXAO_OU_TIMEOUT');}
  if(response.status===429)rateLimits++;
  if(tentativa===0&&(response.status===429||response.status>=500)){
   await response.body?.cancel();await sleep(response.status===429?5000:1500);continue;
  }
  if(response.status!==200){await response.body?.cancel();throw new DjenResponseError(`DJEN_HTTP_${response.status}`);}
  const items=await lerRespostaDjen(response,true);
  return{items,rateLimits};
 }
 throw new DjenResponseError('DJEN_CONSULTA_INCONCLUSIVA');
 }catch(e){throw Object.assign(e instanceof Error?e:new Error('Consulta inconclusiva'),{rateLimits});}
}
export async function reconsultarFalha(pool:Pool,logId:number,input:z.infer<typeof inputSchema>,inserir:(id:number,items:DjenItem[])=>Promise<{inseridas:number}>,consultar=consultarDjenNovamente){
 const v=inputSchema.parse(input),db=await pool.connect();let log:any,novoId:string,processo:any;
 try{
  await db.query('BEGIN');
  log=(await db.query(`SELECT *,to_char(janela_inicio,'YYYY-MM-DD') AS inicio,to_char(janela_fim,'YYYY-MM-DD') AS fim FROM public.painel_djen_logs WHERE id=$1 FOR UPDATE`,[logId])).rows[0];
  if(!log||!log.finalizado_em||!log.falhas?.some((f:any)=>String(f.processoId)===String(v.processoId)))throw new ReconsultaErro('Selecione uma falha concluída com processo identificado no histórico.',400);
  if(!dataValida(log.inicio)||!dataValida(log.fim)||log.inicio>log.fim)throw new ReconsultaErro('O registro não possui um período válido para reconsulta.',400);
  const origem=log.reconsulta_de??log.id;
  const recuperado=(await db.query("SELECT id FROM public.painel_djen_logs WHERE reconsulta_de=$1 AND reconsulta_processo_id=$2 AND status='sem_erros' LIMIT 1",[origem,v.processoId])).rows[0];
  if(recuperado){await db.query('COMMIT');return{processados:0,novasPublicacoes:0,erros:0,recuperado:true};}
  processo=(await db.query('SELECT id,numero FROM public.processos WHERE id=$1',[v.processoId])).rows[0];
  if(!processo)throw new ReconsultaErro('O processo foi removido do cadastro. Confira a falha original.',404);
  // An interrupted worker must remain visible but must not lock recovery forever.
  await db.query(`UPDATE public.painel_djen_logs SET status='falha',erros=1,processos=1,finalizado_em=now(),falhas=jsonb_build_array(jsonb_build_object('processoId',reconsulta_processo_id,'codigo','DJEN_RECONSULTA_INTERROMPIDA')) WHERE reconsulta_de=$1 AND reconsulta_processo_id=$2 AND status='em_andamento' AND iniciado_em<now()-interval '10 minutes'`,[origem,v.processoId]);
  const r=await db.query(`INSERT INTO public.painel_djen_logs(iniciado_em,status,lote_offset,janela_inicio,janela_fim,rodada_id,reconsulta_de,reconsulta_processo_id) VALUES(now(),'em_andamento',0,$1,$2,$3,$4,$5) RETURNING id`,[log.inicio,log.fim,v.rodada,origem,v.processoId]);novoId=r.rows[0].id;
  await db.query('COMMIT');
 }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
 let novidades=0,erro:string|null=null,rateLimits=0;
 try{
  const numero=String(processo.numero).replace(/\D/g,'');if(numero.length!==20)throw new DjenResponseError('NUMERO_INVALIDO');
  const r=await consultar(numero,log.inicio,log.fim);rateLimits=r.rateLimits;
  novidades=(await inserir(v.processoId,r.items)).inseridas;
 }catch(e){erro=e instanceof DjenResponseError?e.codigo:'DJEN_CONSULTA_OU_GRAVACAO_FALHOU';rateLimits=Number.isInteger((e as any)?.rateLimits)?(e as any).rateLimits:rateLimits;}
 // Never mark success until both response validation and publication storage finished.
 await pool.query(`UPDATE public.painel_djen_logs SET finalizado_em=now(),status=$2,processos=1,novidades=$3,erros=$4,rate_limits=$5,respostas_invalidas=$6,falhas=$7::jsonb WHERE id=$1 AND status='em_andamento'`,[novoId,erro?'falha':'sem_erros',novidades,erro?1:0,rateLimits,erro&&/INVALID|INCONSISTENTE|ENVELOPE/.test(erro)?1:0,JSON.stringify(erro?[{processoId:v.processoId,codigo:erro}]:[])]);
 return{logId:novoId,processados:1,novasPublicacoes:novidades,erros:erro?1:0,recuperado:!erro};
}
export function registrarReconsultaDjen(app:Express,pool:Pool,inserir:(id:number,items:DjenItem[])=>Promise<{inseridas:number}>){
 app.post('/api/monitoramento/logs/:id/reconsultar',async(req,res)=>{try{
  res.json(await reconsultarFalha(pool,idSchema.parse(req.params.id),inputSchema.parse(req.body),inserir));
 }catch(e){res.status(e instanceof ReconsultaErro?e.status:e instanceof z.ZodError?400:(e as any)?.code==='23505'?409:503).json({error:e instanceof ReconsultaErro?e.message:e instanceof z.ZodError?'Selecione um processo com falha e uma identificação válida da consulta.':(e as any)?.code==='23505'?'Este processo já está sendo reconsultado. Aguarde e atualize o histórico.':'Reconsulta inconclusiva. Atualize o histórico antes de tentar novamente.'});}});
}
