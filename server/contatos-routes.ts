import type {Express,Response} from 'express';
import type {Pool} from 'pg';
import {z} from 'zod';
import {contatoInput} from '../shared/contatos';
const uuid=z.string().uuid(),pid=z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
function falha(res:Response,e:any){
 if(e instanceof z.ZodError){res.status(400).json({error:e.issues[0]?.message||'Confira os dados do contato.'});return;}
 if(e?.code==='23505'){res.status(409).json({error:'Este WhatsApp já está cadastrado. Selecione o contato existente.'});return;}
 if(e?.code==='23503'){res.status(404).json({error:'Processo ou contato não encontrado. Atualize a lista.'});return;}
 res.status(503).json({error:'Não foi possível acessar os contatos. Tente novamente.'});
}
export function registrarContatos(app:Express,db:Pick<Pool,'query'>){
 app.get('/api/contatos',async(_req,res)=>{try{
  const r=await db.query(`SELECT c.id,c.nome,c.telefone,c.versao,COALESCE(array_agg(v.processo_id ORDER BY v.processo_id) FILTER(WHERE v.processo_id IS NOT NULL),'{}'::bigint[]) AS processos FROM public.painel_contatos c LEFT JOIN public.painel_processo_contatos v ON v.contato_id=c.id GROUP BY c.id ORDER BY lower(c.nome),c.id LIMIT 5001`);
  if(r.rows.length>5000){res.status(422).json({error:'O cadastro excede 5.000 contatos. Solicite paginação antes de continuar.'});return;}
  res.json(r.rows.map(c=>({...c,processos:c.processos.map(Number)})));
 }catch(e){falha(res,e);}});
 app.post('/api/contatos',async(req,res)=>{try{
  const v=contatoInput.parse(req.body),r=await db.query('INSERT INTO public.painel_contatos(nome,telefone) VALUES($1,$2) RETURNING id,nome,telefone,versao',[v.nome,v.telefone]);res.status(201).json(r.rows[0]);
 }catch(e){falha(res,e);}});
 app.patch('/api/contatos/:id',async(req,res)=>{try{
  const id=uuid.parse(req.params.id),v=contatoInput.extend({versao:z.number().int().nonnegative()}).parse(req.body);
  const r=await db.query('UPDATE public.painel_contatos SET nome=$2,telefone=$3,versao=versao+1,atualizado_em=now() WHERE id=$1 AND versao=$4 RETURNING id,nome,telefone,versao',[id,v.nome,v.telefone,v.versao]);
  if(!r.rowCount){res.status(409).json({error:'Contato alterado ou removido. Reabra o cadastro antes de editar.'});return;}res.json(r.rows[0]);
 }catch(e){falha(res,e);}});
 app.delete('/api/contatos/:id',async(req,res)=>{try{
  const id=uuid.parse(req.params.id),v=z.object({versao:z.number().int().nonnegative()}).strict().parse(req.body);
  const r=await db.query('DELETE FROM public.painel_contatos WHERE id=$1 AND versao=$2',[id,v.versao]);if(!r.rowCount){res.status(409).json({error:'Contato alterado ou removido. Atualize a lista.'});return;}res.sendStatus(204);
 }catch(e){falha(res,e);}});
 app.get('/api/processos/:id/contatos',async(req,res)=>{try{
  const id=pid.parse(req.params.id),r=await db.query('SELECT c.id,c.nome,c.telefone,c.versao FROM public.painel_contatos c JOIN public.painel_processo_contatos v ON v.contato_id=c.id WHERE v.processo_id=$1 ORDER BY lower(c.nome),c.id',[id]);res.json(r.rows);
 }catch(e){falha(res,e);}});
 app.put('/api/processos/:id/contatos/:contatoId',async(req,res)=>{try{
  const id=pid.parse(req.params.id),contato=uuid.parse(req.params.contatoId);
  await db.query('INSERT INTO public.painel_processo_contatos(processo_id,contato_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[id,contato]);res.sendStatus(204);
 }catch(e){falha(res,e);}});
 app.delete('/api/processos/:id/contatos/:contatoId',async(req,res)=>{try{
  const id=pid.parse(req.params.id),contato=uuid.parse(req.params.contatoId);await db.query('DELETE FROM public.painel_processo_contatos WHERE processo_id=$1 AND contato_id=$2',[id,contato]);res.sendStatus(204);
 }catch(e){falha(res,e);}});
}
