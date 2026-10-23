import type {Express} from 'express';
import type {Pool} from 'pg';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {periodoSemanal,formatarRelatorio,type ItemRelatorio} from '../shared/relatorios';
import {consultarFonte,compararFonte} from './relatorios-datajud';
import {dataValida} from '../shared/calendario';
const uuid=z.string().uuid();
const grupoInput=z.object({nome:z.string().trim().min(3).max(120),numeros:z.array(z.string().transform(n=>n.replace(/\D/g,'')).pipe(z.string().length(20))).min(1).max(100)}).strict();
const periodoInput=z.object({inicio:z.string().refine(dataValida),fim:z.string().refine(dataValida)}).strict().refine(v=>v.inicio<=v.fim&&Date.parse(v.fim)-Date.parse(v.inicio)<=30*86400000&&v.fim<=periodoSemanal().fim,'Período inválido; use até 31 dias e não inclua datas futuras.');
const selectReport=`SELECT r.*,to_char(r.inicio,'YYYY-MM-DD') AS inicio,to_char(r.fim,'YYYY-MM-DD') AS fim FROM public.painel_rel_relatorios r`;
export async function criarRelatorio(pool:Pool,grupo:string,periodo:z.infer<typeof periodoInput>) {
 const db=await pool.connect();try{
  await db.query('BEGIN');
  const g=(await db.query('SELECT nome FROM public.painel_rel_grupos WHERE id=$1 FOR UPDATE',[grupo])).rows[0];if(!g)throw Error('Escritório não encontrado.');
  const membros=(await db.query(`SELECT p.id,regexp_replace(p.numero,'[^0-9]','','g') AS numero,p.apelido,p.tribunal FROM public.painel_rel_selecao s JOIN public.processos p ON p.id=s.processo_id WHERE s.grupo_id=$1 ORDER BY p.numero`,[grupo])).rows;
  if(!membros.length)throw Error('Selecione ao menos um processo para este escritório.');
  const r=(await db.query(`INSERT INTO public.painel_rel_relatorios(grupo_id,nome_escritorio,inicio,fim) VALUES($1,$2,$3,$4) RETURNING id,criado_em`,[grupo,g.nome,periodo.inicio,periodo.fim])).rows[0];
  for(const p of membros){
   const ant=(await db.query(`SELECT i.id,i.resultado FROM public.painel_rel_itens i JOIN public.painel_rel_relatorios r ON r.id=i.relatorio_id WHERE r.grupo_id=$1 AND i.numero=$2 AND r.estado='conferido' AND r.conferido_em<=$3 AND i.estado='ok' ORDER BY r.conferido_em DESC LIMIT 1`,[grupo,p.numero,r.criado_em])).rows[0];
   await db.query(`INSERT INTO public.painel_rel_itens(relatorio_id,processo_id,numero,apelido,tribunal,referencia_id,referencia) VALUES($1,$2,$3,$4,$5,$6,$7)`,[r.id,p.id,p.numero,p.apelido,p.tribunal,ant?.id??null,ant?.resultado??null]);
  }
  await db.query('COMMIT');return {id:r.id,total:membros.length};
 }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
}
export async function coletarRelatorio(pool:Pool,id:string,consultar=consultarFonte) {
 const db=await pool.connect();let report:any,itens:any[]=[];
 try{
  await db.query('BEGIN');report=(await db.query(`${selectReport} WHERE r.id=$1 FOR UPDATE`,[id])).rows[0];
  if(!report||report.estado!=='coletando')throw Error('Este relatório não está em coleta. Atualize a tela.');
  const tentativa=randomUUID();
  itens=(await db.query(`WITH proximos AS (SELECT id FROM public.painel_rel_itens WHERE relatorio_id=$1 AND (estado='pendente' OR (estado='consultando' AND consulta_iniciada<now()-interval '90 seconds')) ORDER BY numero LIMIT 3 FOR UPDATE SKIP LOCKED)
   UPDATE public.painel_rel_itens SET estado='consultando',tentativa=$2,consulta_iniciada=now() WHERE id IN(SELECT id FROM proximos) RETURNING *`,[id,tentativa])).rows;
  await db.query('COMMIT');
 }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
 await Promise.all(itens.map(async item=>{
  try{
   const fonte=await consultar(item.numero,item.tribunal);
   const resultado=compararFonte(fonte,item.referencia,report.inicio,report.fim);
   await pool.query(`UPDATE public.painel_rel_itens i SET estado='ok',resultado=$3,snapshot=$4,consultado_em=now(),erro=NULL
    WHERE i.id=$1 AND i.tentativa=$2 AND i.estado='consultando' AND EXISTS(SELECT 1 FROM public.painel_rel_relatorios r WHERE r.id=i.relatorio_id AND r.estado='coletando')`,[item.id,item.tentativa,resultado,fonte.raw]);
  }catch(e){
   const msg=e instanceof Error&&/^(A fonte|Processo |Consulta |Resposta |Histórico |Mais de |Tribunal )/.test(e.message)?e.message:'Não foi possível concluir a consulta ao DataJud. Conferir diretamente no tribunal.';
   await pool.query(`UPDATE public.painel_rel_itens i SET estado='inconclusivo',consultado_em=now(),erro=$3 WHERE i.id=$1 AND i.tentativa=$2 AND i.estado='consultando' AND EXISTS(SELECT 1 FROM public.painel_rel_relatorios r WHERE r.id=i.relatorio_id AND r.estado='coletando')`,[item.id,item.tentativa,msg.slice(0,500)]);
  }
 }));
 await pool.query(`UPDATE public.painel_rel_relatorios r SET estado='rascunho' WHERE r.id=$1 AND r.estado='coletando' AND NOT EXISTS(SELECT 1 FROM public.painel_rel_itens i WHERE i.relatorio_id=r.id AND i.estado IN('pendente','consultando'))`,[id]);
 const progresso=(await pool.query(`SELECT count(*)::integer AS total,count(*) FILTER(WHERE estado IN('ok','inconclusivo'))::integer AS concluidos FROM public.painel_rel_itens WHERE relatorio_id=$1`,[id])).rows[0];
 return {...progresso,finalizado:progresso.total===progresso.concluidos,aguardando:itens.length===0&&progresso.total!==progresso.concluidos};
}
async function itensRelatorio(pool:Pool,id:string):Promise<ItemRelatorio[]> {
 return (await pool.query(`SELECT id,numero,apelido,tribunal,estado,consultado_em,erro,resultado FROM public.painel_rel_itens WHERE relatorio_id=$1 ORDER BY numero`,[id])).rows;
}
function gerarTexto(r:any,itens:ItemRelatorio[]) {
 const texto=formatarRelatorio(r.nome_escritorio,r.inicio,r.fim,itens);
 if(texto.length>200000)throw Error('O relatório excedeu o limite de texto. Divida a carteira em grupos menores para revisar.');
 return texto;
}
export function registrarRelatorios(app:Express,pool:Pool) {
 const fail=(res:any,e:any)=>res.status(e?.code==='23505'?409:e instanceof z.ZodError?400:e?.code?503:400).json({error:e?.code==='23505'?'Já existe um escritório com este nome ou um rascunho em aberto. Confira a lista antes de criar outro.':e instanceof z.ZodError?'Confira os campos informados e o período.':e?.code?'Não foi possível concluir a operação no banco. Tente novamente.':e instanceof Error?e.message:'Operação indisponível.'});
 app.get('/api/relatorios/grupos',async(_req,res)=>{try{const r=await pool.query(`SELECT g.*,COALESCE((SELECT json_agg(regexp_replace(p.numero,'[^0-9]','','g') ORDER BY p.numero) FROM public.painel_rel_selecao s JOIN public.processos p ON p.id=s.processo_id WHERE s.grupo_id=g.id),'[]') AS numeros FROM public.painel_rel_grupos g ORDER BY g.nome`);res.json(r.rows);}catch(e){fail(res,e);}});
 async function salvarGrupo(req:any,res:any,novo:boolean){
  const db=await pool.connect();try{
   const input=grupoInput.parse(req.body);const numeros=Array.from(new Set(input.numeros));
   await db.query('BEGIN');
   const membros=(await db.query(`SELECT id,regexp_replace(numero,'[^0-9]','','g') AS numero FROM public.processos WHERE regexp_replace(numero,'[^0-9]','','g')=ANY($1::text[])`,[numeros])).rows;
   const faltam=numeros.filter(n=>!membros.some(p=>p.numero===n));if(faltam.length)throw Error(`Cadastre primeiro em Meus processos: ${faltam.join(', ')}.`);
   if(membros.length!==numeros.length)throw Error('Há cadastros duplicados para um dos números. Confira Meus processos antes de selecionar.');
   const id=novo?(await db.query('INSERT INTO public.painel_rel_grupos(nome) VALUES($1) RETURNING id',[input.nome.replace(/\s+/g,' ')])).rows[0].id:uuid.parse(req.params.id);
   if(!novo){const updated=await db.query('UPDATE public.painel_rel_grupos SET nome=$2 WHERE id=$1 RETURNING id',[id,input.nome.replace(/\s+/g,' ')]);if(!updated.rowCount)throw Error('Escritório não encontrado.');}
   await db.query('DELETE FROM public.painel_rel_selecao WHERE grupo_id=$1',[id]);
   for(const p of membros)await db.query('INSERT INTO public.painel_rel_selecao(grupo_id,processo_id) VALUES($1,$2)',[id,p.id]);
   await db.query('COMMIT');res.json({id});
  }catch(e){await db.query('ROLLBACK');fail(res,e);}finally{db.release();}
 }
 app.post('/api/relatorios/grupos',(req,res)=>{salvarGrupo(req,res,true).catch(e=>fail(res,e));});
 app.put('/api/relatorios/grupos/:id',(req,res)=>{salvarGrupo(req,res,false).catch(e=>fail(res,e));});
 app.get('/api/relatorios',async(req,res)=>{try{
  const grupo=uuid.parse(req.query.grupo),pagina=z.coerce.number().int().min(1).max(100000).parse(req.query.pagina??1);
  const r=await pool.query(`SELECT id,nome_escritorio,to_char(inicio,'YYYY-MM-DD') AS inicio,to_char(fim,'YYYY-MM-DD') AS fim,estado,criado_em,conferido_em,copiado_em FROM public.painel_rel_relatorios WHERE grupo_id=$1 ORDER BY criado_em DESC LIMIT 20 OFFSET $2`,[grupo,(pagina-1)*20]);
  const total=(await pool.query('SELECT count(*)::integer AS n FROM public.painel_rel_relatorios WHERE grupo_id=$1',[grupo])).rows[0].n;res.json({items:r.rows,total});
 }catch(e){fail(res,e);}});
 app.post('/api/relatorios/grupos/:id/gerar',async(req,res)=>{try{const id=uuid.parse(req.params.id),periodo=periodoInput.parse(req.body);res.json(await criarRelatorio(pool,id,periodo));}catch(e){fail(res,e);}});
 app.post('/api/relatorios/:id/coletar',async(req,res)=>{try{res.json(await coletarRelatorio(pool,uuid.parse(req.params.id)));}catch(e){fail(res,e);}});
 app.get('/api/relatorios/:id',async(req,res)=>{try{
  const id=uuid.parse(req.params.id),r=(await pool.query(`${selectReport} WHERE r.id=$1`,[id])).rows[0];if(!r){res.sendStatus(404);return;}
  const itens=await itensRelatorio(pool,id);const texto=r.estado==='conferido'?r.texto_final:r.texto_editado??(r.estado==='rascunho'?gerarTexto(r,itens):'');
  res.json({...r,texto,itens:itens.map(i=>({...i,resultado:i.resultado?{inicial:i.resultado.inicial,ultimo:i.resultado.ultimo,totalMovimentos:i.resultado.totalMovimentos,avisos:i.resultado.avisos,atualizacaoFonte:i.resultado.atualizacaoFonte,novos:i.resultado.inicial?i.resultado.noPeriodo.length:i.resultado.novos.length}:null}))});
 }catch(e){fail(res,e);}});
 app.patch('/api/relatorios/:id/texto',async(req,res)=>{try{
  const id=uuid.parse(req.params.id),v=z.object({texto:z.string().trim().min(20).max(200000),versao:z.number().int().nonnegative()}).strict().parse(req.body);
  const r=await pool.query(`UPDATE public.painel_rel_relatorios SET texto_editado=$2,versao=versao+1 WHERE id=$1 AND estado='rascunho' AND versao=$3 RETURNING versao`,[id,v.texto,v.versao]);
  if(!r.rowCount){res.status(409).json({error:'Este relatório foi alterado ou já conferido. Recarregue antes de editar.'});return;}res.json(r.rows[0]);
 }catch(e){fail(res,e);}});
 app.post('/api/relatorios/:id/conferir',async(req,res)=>{
  const db=await pool.connect();try{
   const id=uuid.parse(req.params.id),v=z.object({versao:z.number().int().nonnegative(),conferido:z.literal(true),inconclusivosReconhecidos:z.boolean()}).strict().parse(req.body);
   await db.query('BEGIN');const r=(await db.query(`${selectReport} WHERE r.id=$1 FOR UPDATE`,[id])).rows[0];
   if(!r||r.estado!=='rascunho'||r.versao!==v.versao)throw Error('Relatório alterado ou já conferido. Recarregue a prévia.');
   const itens=(await db.query('SELECT * FROM public.painel_rel_itens WHERE relatorio_id=$1 ORDER BY numero',[id])).rows;
   if(itens.some(i=>['pendente','consultando'].includes(i.estado)))throw Error('Conclua a coleta antes da conferência.');
   if(itens.some(i=>i.estado==='inconclusivo')&&!v.inconclusivosReconhecidos)throw Error('Reconheça expressamente as consultas inconclusivas antes de confirmar.');
   let texto=r.texto_editado??gerarTexto(r,itens);
   const fonte='Fonte: Conselho Nacional de Justiça (CNJ) — Base Nacional de Dados do Poder Judiciário (DataJud), API Pública.';
   if(!texto.includes(fonte))texto+='\n\n'+fonte;
   if(itens.some(i=>i.estado==='inconclusivo'))texto+='\n\nAtenção: este relatório contém consultas inconclusivas. Elas não permitem afirmar ausência de novos andamentos.';
   await db.query(`UPDATE public.painel_rel_relatorios SET estado='conferido',texto_final=$2,conferido_em=now(),conferido_por=$3,versao=versao+1 WHERE id=$1`,[id,texto,process.env.AUTH_ADMIN_ID||'administrador']);
   await db.query('COMMIT');res.json({ok:true});
  }catch(e){await db.query('ROLLBACK');fail(res,e);}finally{db.release();}
 });
 app.post('/api/relatorios/:id/copiado',async(req,res)=>{try{const id=uuid.parse(req.params.id);const r=await pool.query("UPDATE public.painel_rel_relatorios SET copiado_em=now() WHERE id=$1 AND estado='conferido' RETURNING id",[id]);if(!r.rowCount)throw Error('Confira o relatório antes de copiar.');res.json({ok:true});}catch(e){fail(res,e);}});
 app.post('/api/relatorios/:id/cancelar',async(req,res)=>{try{const id=uuid.parse(req.params.id);const r=await pool.query("UPDATE public.painel_rel_relatorios SET estado='cancelado',versao=versao+1 WHERE id=$1 AND estado IN('coletando','rascunho') RETURNING id",[id]);if(!r.rowCount)throw Error('Este relatório não pode mais ser descartado.');res.json({ok:true});}catch(e){fail(res,e);}});
}
