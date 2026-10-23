import type {Express} from 'express';
import type {Pool} from 'pg';
import {z} from 'zod';
import {dataValida,resumoPrazo,type RegraCalendario} from '../shared/calendario';
import {SUSPENSOES_CONFIRMADAS} from '../client/src/lib/calendario-forense';
export const ajustePrazoSchema=z.object({
 data:z.string().refine(dataValida).nullable(),
 justificativa:z.string().trim().min(10).max(1500),
 versao:z.number().int().nonnegative(),
 retificacaoReconhecida:z.boolean(),
}).strict();
class AjusteErro extends Error {constructor(message:string,public status:number){super(message);}}
export async function ajustarPrazo(pool:Pool,id:number,input:z.infer<typeof ajustePrazoSchema>,autor:string){
 const v=ajustePrazoSchema.parse(input),db=await pool.connect();
 try{
  await db.query('BEGIN');
  const p=(await db.query(`SELECT p.*,to_char(p.prazo_manual,'YYYY-MM-DD') AS prazo_manual,to_char(p.data_disponibilizacao,'YYYY-MM-DD') AS disponibilizacao,pr.numero,p.raw_json->>'siglaTribunal' AS sigla FROM public.publicacoes p JOIN public.processos pr ON pr.id=p.processo_id WHERE p.id=$1 FOR UPDATE OF p`,[id])).rows[0];
  if(!p)throw new AjusteErro('Publicação não encontrada.',404);
  if(p.prazo_manual_versao!==v.versao)throw new AjusteErro('O prazo foi ajustado em outra revisão. Atualize a publicação antes de salvar.',409);
  if((p.prazo_manual??null)===v.data)throw new AjusteErro('Informe uma data diferente da atual.',400);
  if(p.informado_em&&!v.retificacaoReconhecida)throw new AjusteErro('Confirme que será necessário comunicar a retificação ao destinatário.',400);
  const base=new Set<string>((await db.query("SELECT to_char(data,'YYYY-MM-DD') AS data FROM public.feriados")).rows.map(r=>r.data));
  const aprovadas=(await db.query("SELECT regra FROM public.painel_cal_propostas WHERE status='aprovada' ORDER BY revisado_em")).rows.map(r=>r.regra);
  const fixas:RegraCalendario[]=SUSPENSOES_CONFIRMADAS.map(r=>({ato:r.ato,motivo:r.ato,inicio:r.data,fim:r.data,alcance:'tribunal',origem:null,local:'TJRJ',efeito:'dia_nao_util'}));
  const calculo=p.prazo_dias>0&&['uteis','corridos'].includes(p.prazo_tipo)?resumoPrazo({...p,dias:p.prazo_dias,tipo:p.prazo_tipo},base,[...fixas,...aprovadas]):null;
  await db.query(`INSERT INTO public.painel_prazo_ajustes(publicacao_id,versao,anterior,nova,justificativa,calculo_automatico,autor,ja_informada) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[id,v.versao+1,p.prazo_manual,v.data,v.justificativa,{...calculo,dias:p.prazo_dias,tipo:p.prazo_tipo},autor,!!p.informado_em]);
  await db.query('UPDATE public.publicacoes SET prazo_manual=$2,prazo_manual_versao=prazo_manual_versao+1 WHERE id=$1',[id,v.data]);
  await db.query('COMMIT');return {prazoManual:v.data,prazoManualVersao:v.versao+1};
 }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
}
export function registrarAjustePrazo(app:Express,pool:Pool){
 const idSchema=z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
 app.get('/api/publicacoes/:id/prazo-manual/historico',async(req,res)=>{try{
  const id=idSchema.parse(req.params.id);
  const r=await pool.query(`SELECT id,versao,to_char(anterior,'YYYY-MM-DD') AS anterior,to_char(nova,'YYYY-MM-DD') AS nova,justificativa,calculo_automatico,autor,ja_informada,criado_em FROM public.painel_prazo_ajustes WHERE publicacao_id=$1 ORDER BY versao DESC LIMIT 100`,[id]);res.json({items:r.rows});
 }catch{res.status(503).json({error:'Histórico indisponível. Tente novamente.'});}});
 app.patch('/api/publicacoes/:id/prazo-manual',async(req,res)=>{try{
  res.json(await ajustarPrazo(pool,idSchema.parse(req.params.id),ajustePrazoSchema.parse(req.body),process.env.AUTH_ADMIN_ID||'administrador'));
 }catch(e){res.status(e instanceof AjusteErro?e.status:e instanceof z.ZodError?400:503).json({error:e instanceof AjusteErro?e.message:e instanceof z.ZodError?'Informe uma data válida e justificativa de 10 a 1500 caracteres.':'Não foi possível salvar o ajuste. Tente novamente.'});}});
}
