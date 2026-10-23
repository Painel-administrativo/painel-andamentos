import type {Express} from "express";
import type {Pool,PoolClient} from "pg";
import {z} from "zod";
import {regraSchema,resumoPrazo,type RegraCalendario} from "../shared/calendario";
import {baixarDocumento,lerPdf,hash,urlOficial,linkCaderno} from "./calendario-importacao";
import {SUSPENSOES_CONFIRMADAS} from "../client/src/lib/calendario-forense";
const uuid=z.string().uuid();
const importarSchema=z.object({fonte:z.string().max(2000),titulo:z.string().trim().min(3).max(200),pdfBase64:z.string().max(4_000_000).optional()}).strict();
const revisaoSchema=z.object({acao:z.enum(["aprovar","rejeitar","revogar"]),justificativa:z.string().trim().min(10).max(1500),regra:regraSchema.optional(),conferido:z.literal(true)}).strict();
async function regras(db:Pool|PoolClient):Promise<RegraCalendario[]> {
 const r=await db.query(`SELECT p.id,p.regra,d.fonte FROM public.painel_cal_propostas p JOIN public.painel_cal_documentos d ON d.id=p.documento_id WHERE p.status='aprovada' ORDER BY p.revisado_em`);
 return r.rows.map(r=>({...r.regra,id:r.id,fonte:r.fonte}));
}
export async function importarDocumento(pool:Pool,input:z.infer<typeof importarSchema>) {
 const fonte=urlOficial(input.fonte);
 let bytes:Buffer,final=fonte;
 if(input.pdfBase64!==undefined) {
  if(!/^[A-Za-z0-9+/]+={0,2}$/.test(input.pdfBase64)) throw Error("Arquivo codificado inválido.");
  bytes=Buffer.from(input.pdfBase64,"base64");if(bytes.length>3_000_000) throw Error("Upload limitado a 3 MB. Para PDFs maiores, use a URL oficial.");
 } else {const r=await baixarDocumento(fonte);bytes=r.bytes;final=r.url;}
 const sha=hash(bytes);
 const old=await pool.query("SELECT id FROM public.painel_cal_documentos WHERE sha256=$1",[sha]);
 if(old.rows[0]) {
  await pool.query("UPDATE public.painel_cal_documentos SET ultima_consulta=now() WHERE id=$1",[old.rows[0].id]);
  return {id:old.rows[0].id,repetido:true,propostas:0};
 }
 const parsed=await lerPdf(bytes);
 const db=await pool.connect();
 try {
  await db.query("BEGIN");
  const inserted=await db.query(`INSERT INTO public.painel_cal_documentos(sha256,fonte,titulo,mime,original,paginas,texto,metodo)
   VALUES($1,$2,$3,'application/pdf',$4,$5,$6,$7) ON CONFLICT(sha256) DO UPDATE SET ultima_consulta=now() RETURNING id`,[sha,fonte,input.titulo,bytes,parsed.paginas,parsed.texto,input.pdfBase64===undefined?"url":"arquivo"]);
  const id=inserted.rows[0].id;
  for(const p of parsed.propostas) await db.query(`INSERT INTO public.painel_cal_propostas(documento_id,chave,pagina,trecho,sugestao) VALUES($1,$2,$3,$4,$5) ON CONFLICT(documento_id,chave) DO NOTHING`,[id,p.chave,p.pagina,p.trecho,p.sugestao]);
  await db.query("COMMIT");return {id,repetido:false,propostas:parsed.propostas.length};
 } catch(e){await db.query("ROLLBACK");throw e;} finally {db.release();}
}
export async function revisar(pool:Pool,id:string,input:z.infer<typeof revisaoSchema>,autor:string) {
 const db=await pool.connect();
 try {
  await db.query("BEGIN");
  // Serialize calendar revisions so both the snapshot and impact history remain consistent.
  await db.query("SELECT pg_advisory_xact_lock(83174201)");
  const p=(await db.query("SELECT status,regra FROM public.painel_cal_propostas WHERE id=$1 FOR UPDATE",[id])).rows[0];
  if(!p || (input.acao==="revogar"?p.status!=="aprovada":p.status!=="pendente")) throw Error("Proposta não encontrada ou já revisada. Atualize a tela.");
  if(input.acao==="aprovar" && !input.regra) throw Error("Preencha a regra e confirme o alcance antes de aprovar.");
  const antes=await regras(db);
  await db.query(`UPDATE public.painel_cal_propostas SET status=$2,regra=COALESCE($3,regra),revisado_em=now(),revisado_por=$4,justificativa=$5 WHERE id=$1`,[id,{aprovar:"aprovada",rejeitar:"rejeitada",revogar:"revogada"}[input.acao],input.regra??null,autor,input.justificativa]);
  const revisao=(await db.query(`INSERT INTO public.painel_cal_revisoes(proposta_id,acao,regra,justificativa,autor) VALUES($1,$2,$3,$4,$5) RETURNING id`,[id,input.acao,input.regra??p.regra??null,input.justificativa,autor])).rows[0].id;
  const depois=await regras(db);
  let impactos=0;
  if(input.acao!=="rejeitar") {
   const baseRows=await db.query("SELECT to_char(data,'YYYY-MM-DD') AS data FROM public.feriados");
   const base=new Set<string>(baseRows.rows.map(r=>r.data));
   // Existing verified exception remains part of the baseline until deliberately migrated.
   const fixas:RegraCalendario[]=SUSPENSOES_CONFIRMADAS.map(r=>({ato:r.ato,motivo:r.ato,inicio:r.data,fim:r.data,alcance:"tribunal",origem:null,local:"TJRJ",efeito:"dia_nao_util"}));
   const pubs=await db.query(`SELECT p.id,pr.numero,p.raw_json->>'siglaTribunal' AS sigla,to_char(p.data_disponibilizacao,'YYYY-MM-DD') AS disponibilizacao,
     p.prazo_dias AS dias,p.prazo_tipo AS tipo,p.informado_em IS NOT NULL AS ja_informada FROM public.publicacoes p JOIN public.processos pr ON pr.id=p.processo_id WHERE p.prazo_manual IS NULL AND p.prazo_dias>0 AND p.prazo_tipo IN('uteis','corridos')`);
   for(const pub of pubs.rows) {
    const a=resumoPrazo(pub,base,[...fixas,...antes]),b=resumoPrazo(pub,base,[...fixas,...depois]);
    if(a && b && JSON.stringify(a)!==JSON.stringify(b)) {
     await db.query(`INSERT INTO public.painel_cal_impactos(revisao_id,publicacao_id,antes,depois,ja_informada) VALUES($1,$2,$3,$4,$5)`,[revisao,pub.id,a,b,pub.ja_informada]);impactos++;
    }
   }
  }
  await db.query("COMMIT");return {impactos};
 }catch(e){await db.query("ROLLBACK");throw e;}finally{db.release();}
}
export function registrarCalendario(app:Express,pool:Pool) {
 const erro=(res:any,e:any)=>res.status(e?.code==="23505"?409:400).json({error:e?.code==="23505"?"Já há regra ativa com este ato e alcance. Revise/revogue o registro anterior antes de aprovar outro.":e instanceof z.ZodError?"Confira os campos, as datas e a confirmação da revisão.":e?.code?"Banco indisponível para esta operação.":e instanceof Error&&!e.message.includes("password")?e.message:"Não foi possível concluir a operação."});
 app.get("/api/calendario/regras",async(_req,res)=>{try{res.json({items:await regras(pool)});}catch{res.status(503).json({error:"Calendário de suspensões indisponível."});}});
 app.get("/api/calendario",async(req,res)=>{
  try {
   const status=z.enum(["pendente","aprovada","rejeitada","revogada","todas"]).parse(req.query.status??"pendente");
   const pagina=z.coerce.number().int().min(1).max(100000).parse(req.query.pagina??1);
   const documentos=await pool.query("SELECT id,sha256,fonte,titulo,metodo,paginas,criado_em,ultima_consulta FROM public.painel_cal_documentos ORDER BY criado_em DESC LIMIT 30");
   const propostas=await pool.query(`SELECT p.*,d.titulo,d.fonte,d.metodo FROM public.painel_cal_propostas p JOIN public.painel_cal_documentos d ON d.id=p.documento_id WHERE ($1='todas' OR p.status=$1) ORDER BY p.criado_em DESC,p.id DESC LIMIT 50 OFFSET $2`,[status,(pagina-1)*50]);
   const total=(await pool.query("SELECT count(*)::integer AS total FROM public.painel_cal_propostas WHERE ($1='todas' OR status=$1)",[status])).rows[0].total;
   const consultas=await pool.query("SELECT * FROM public.painel_cal_consultas ORDER BY criado_em DESC LIMIT 20");
   const impactos=await pool.query(`SELECT i.*,pr.numero,pr.apelido FROM public.painel_cal_impactos i JOIN public.publicacoes p ON p.id=i.publicacao_id JOIN public.processos pr ON pr.id=p.processo_id ORDER BY i.criado_em DESC LIMIT 100`);
   res.json({documentos:documentos.rows,propostas:propostas.rows,consultas:consultas.rows,impactos:impactos.rows,total,pagina});
  }catch{res.status(503).json({error:"Não foi possível carregar o calendário assistido."});}
 });
 app.get("/api/calendario/documentos/:id/pdf",async(req,res)=>{
  const id=uuid.safeParse(req.params.id);if(!id.success){res.sendStatus(400);return;}
  try{const r=await pool.query("SELECT original FROM public.painel_cal_documentos WHERE id=$1",[id.data]);if(!r.rows[0]){res.sendStatus(404);return;}
   res.set({"Content-Type":"application/pdf","Content-Disposition":'attachment; filename="documento-tjrj.pdf"',"Cache-Control":"no-store"}).send(r.rows[0].original);
  }catch{res.sendStatus(503);}
 });
 async function importar(req:any,res:any,automatico=false) {
  let fonte="";
  try {
   const input=automatico?(()=>{const d=z.object({data:z.string()}).strict().parse(req.body);return importarSchema.parse({fonte:linkCaderno(d.data),titulo:`DJERJ Administrativo — ${d.data}`});})():importarSchema.parse(req.body);
   fonte=urlOficial(input.fonte);
   const r=await importarDocumento(pool,input);
   await pool.query("INSERT INTO public.painel_cal_consultas(fonte,status,mensagem,documento_id) VALUES($1,'sucesso',$2,$3)",[fonte,r.repetido?"Documento já arquivado; conteúdo idêntico.":`PDF arquivado; ${r.propostas} trechos candidatos. Extração não equivale a conferência.`,r.id]);
   res.json(r);
  }catch(e){
   if(fonte) await pool.query("INSERT INTO public.painel_cal_consultas(fonte,status,mensagem) VALUES($1,'falha',$2)",[fonte,"Não foi possível baixar ou extrair o documento. Confira a fonte ou importe o PDF."]).catch(()=>{});
   erro(res,e);
  }
 }
 app.post("/api/calendario/importar",(req,res)=>void importar(req,res));
 app.post("/api/calendario/coletar",(req,res)=>void importar(req,res,true));
 app.post("/api/calendario/propostas/:id/revisar",async(req,res)=>{
  try{const id=uuid.parse(req.params.id);const input=revisaoSchema.parse(req.body);res.json(await revisar(pool,id,input,process.env.AUTH_ADMIN_ID||"administrador"));}catch(e){erro(res,e);}
 });
 app.post("/api/calendario/documentos/:id/propostas",async(req,res)=>{
  try{
   const id=uuid.parse(req.params.id),v=z.object({pagina:z.number().int().positive(),trecho:z.string().trim().min(30).max(12000)}).strict().parse(req.body);
   const d=(await pool.query("SELECT paginas,texto FROM public.painel_cal_documentos WHERE id=$1",[id])).rows[0];
   if(!d || v.pagina>d.paginas || !(d.texto.split("\f")[v.pagina-1]||"").includes(v.trecho)) throw Error("Selecione um trecho existente no texto extraído do documento.");
   await pool.query("INSERT INTO public.painel_cal_propostas(documento_id,chave,pagina,trecho,sugestao) VALUES($1,$2,$3,$4,'{}') ON CONFLICT(documento_id,chave) DO NOTHING",[id,hash(`manual:${v.pagina}:${v.trecho}`),v.pagina,v.trecho]);res.json({ok:true});
  }catch(e){erro(res,e);}
 });
 app.get("/api/calendario/documentos/:id/texto",async(req,res)=>{
  try{const id=uuid.parse(req.params.id);const r=await pool.query("SELECT texto FROM public.painel_cal_documentos WHERE id=$1",[id]);if(!r.rows[0]){res.sendStatus(404);return;}res.json(r.rows[0]);}catch(e){erro(res,e);}
 });
}
