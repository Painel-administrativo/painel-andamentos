import type {Express} from 'express';
import {z} from 'zod';
import {validateRequest} from 'twilio/lib/webhooks/webhooks';
import {envioAvisoSchema,prepararAviso,confirmarAviso} from './whatsapp-previa';

type Db={query:(sql:string,values?:any[])=>Promise<any>};
export function twilioConfig(env:NodeJS.ProcessEnv=process.env){
 let origin='';try{const u=new URL(env.TWILIO_WEBHOOK_ORIGIN||env.AUTH_ORIGIN||'');if(u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname==='/')origin=u.origin;}catch{}
 const raw=(env.TWILIO_WHATSAPP_FROM||'').trim();
 return{accountSid:(env.TWILIO_ACCOUNT_SID||'').trim(),authToken:(env.TWILIO_AUTH_TOKEN||'').trim(),from:raw.startsWith('whatsapp:')?raw:`whatsapp:${raw}`,contentSid:(env.TWILIO_CONTENT_SID||'').trim(),origin};
}
export type TwilioConfig=ReturnType<typeof twilioConfig>;
export function pendenciasTwilio(c:TwilioConfig){
 return [!/^AC[a-fA-F0-9]{32}$/.test(c.accountSid)&&'Conta Twilio',!c.authToken&&'Credencial da conta',!/^whatsapp:\+[1-9]\d{7,14}$/.test(c.from)&&'Remetente WhatsApp',!/^HX[a-fA-F0-9]{32}$/.test(c.contentSid)&&'Modelo de mensagem',!c.origin&&'Endereço público do aplicativo'].filter(Boolean) as string[];
}
export const twilioReady=(c:TwilioConfig)=>pendenciasTwilio(c).length===0;
// Read-only authentication check. Never return the Account API payload: it can
// include auth_token and other private account details.
export async function testarConexaoTwilio(c:TwilioConfig,transport:typeof fetch=fetch){
 const contaFinal=/^AC[a-fA-F0-9]{32}$/.test(c.accountSid)?c.accountSid.slice(-6):null;
 if(!contaFinal||!c.authToken)return{autenticado:false,contaFinal,codigo:'CONFIGURACAO_INCOMPLETA',statusConta:null};
 try{
  const r=await transport(`https://api.twilio.com/2010-04-01/Accounts/${c.accountSid}.json`,{method:'GET',redirect:'error',signal:AbortSignal.timeout(10000),headers:{Authorization:`Basic ${Buffer.from(`${c.accountSid}:${c.authToken}`).toString('base64')}`,Accept:'application/json'}});
  const data=await r.json().catch(()=>null);
  if(!r.ok)return{autenticado:false,contaFinal,codigo:typeof data?.code==='number'?String(data.code):`HTTP_${r.status}`,statusConta:null};
  if(data?.sid!==c.accountSid||!['active','suspended','closed'].includes(data?.status))return{autenticado:false,contaFinal,codigo:'RESPOSTA_INVALIDA',statusConta:null};
  return{autenticado:true,contaFinal,codigo:null,statusConta:data.status as string};
 }catch{return{autenticado:false,contaFinal,codigo:'CONEXAO_INCONCLUSIVA',statusConta:null};}
}
export const callbackTwilio=(c:TwilioConfig,id:string)=>`${c.origin}/api/whatsapp/twilio/status/${id}`;
export function motivoFalhaTwilio(message:unknown,c:TwilioConfig,telefone:string){
 if(typeof message!=='string')return null;
 let texto=message;
 for(const segredo of [c.authToken,c.accountSid,c.contentSid,c.from,telefone,Buffer.from(`${c.accountSid}:${c.authToken}`).toString('base64')])if(segredo.length>=6)texto=texto.split(segredo).join('[oculto]');
 return texto.replace(/(?:AC|HX|SM|MM)[a-f0-9]{32}/gi,'[SID oculto]').replace(/\+?\d{8,15}/g,'[número oculto]').replace(/\s+/g,' ').trim().slice(0,600)||null;
}
export async function enviarTwilio(c:TwilioConfig,id:string,telefone:string,values:string[],transport:typeof fetch=fetch){
 try{
  const body=new URLSearchParams({To:`whatsapp:+${telefone}`,From:c.from,ContentSid:c.contentSid,ContentVariables:JSON.stringify(Object.fromEntries(values.map((v,i)=>[String(i+1),v]))),StatusCallback:callbackTwilio(c,id)});
  const r=await transport(`https://api.twilio.com/2010-04-01/Accounts/${c.accountSid}/Messages.json`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),headers:{Authorization:`Basic ${Buffer.from(`${c.accountSid}:${c.authToken}`).toString('base64')}`,'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},body:body.toString()});
  const data=await r.json().catch(()=>null);
  if(!r.ok)return{status:r.status>=500||r.status===408?'incerto':'falha',twilioId:null,codigo:typeof data?.code==='number'?String(data.code):`HTTP_${r.status}`,motivo:motivoFalhaTwilio(data?.message,c,telefone),statusHttp:r.status};
  if(typeof data?.sid!=='string'||!/^(SM|MM)[a-fA-F0-9]{32}$/.test(data.sid)||data.account_sid!==c.accountSid||data.to!==`whatsapp:+${telefone}`||data.from!==c.from)return{status:'incerto',twilioId:null,codigo:'RESPOSTA_INVALIDA'};
  return{status:'aceita',twilioId:data.sid,codigo:null};
 }catch{return{status:'incerto',twilioId:null,codigo:'CONEXAO_INCONCLUSIVA'};}
}
export function registrarWebhookTwilio(app:Express,db:Db,config=twilioConfig){
 app.post('/api/whatsapp/twilio/status/:id',async(req,res)=>{
  const c=config(),id=z.string().uuid().safeParse(req.params.id);
  // Sign the configured public URL; never trust Host / forwarded headers.
  if(!id.success||!c.origin||!c.authToken||!req.is('application/x-www-form-urlencoded')||req.originalUrl!==`/api/whatsapp/twilio/status/${id.data}`||!req.body||Object.values(req.body).some(v=>typeof v!=='string')){res.sendStatus(401);return;}
  let valid=false;try{valid=validateRequest(c.authToken,req.get('x-twilio-signature')||'',callbackTwilio(c,id.data),req.body);}catch{}
  if(!valid){res.sendStatus(401);return;}
  const p=req.body;
  const ranks:Record<string,number>={accepted:1,queued:1,sending:1,sent:2,failed:3,undelivered:3,canceled:3,delivered:4,read:5};
  const names:Record<string,string>={accepted:'aceita',queued:'aceita',sending:'aceita',sent:'enviada',failed:'falha',undelivered:'falha',canceled:'falha',delivered:'entregue',read:'lida'};
  if(!/^(SM|MM)[a-fA-F0-9]{32}$/.test(p.MessageSid||'')||p.AccountSid!==c.accountSid||!/^whatsapp:\+[1-9]\d{7,14}$/.test(p.To||'')||p.From!==c.from){res.sendStatus(400);return;}
  if(!ranks[p.MessageStatus]){res.sendStatus(204);return;}
  const code=/^\d{1,10}$/.test(p.ErrorCode||'')?p.ErrorCode:null;
  try{
   await db.query(`WITH changed AS (
    UPDATE public.painel_whatsapp_envios SET status=$1,status_ordem=$2,twilio_id=COALESCE(twilio_id,$3),erro_codigo=$4,atualizado_em=now()
    WHERE id=$5 AND provedor='twilio' AND provider_account_sid=$6 AND telefone=$7 AND phone_number_id=$8
      AND (twilio_id IS NULL OR twilio_id=$3) AND status_ordem<$2 RETURNING publicacao_id
   ) UPDATE public.publicacoes SET informado_em=COALESCE(informado_em,now()) WHERE id IN(SELECT publicacao_id FROM changed) AND $2>=4`,[names[p.MessageStatus],ranks[p.MessageStatus],p.MessageSid,code,id.data,c.accountSid,p.To.slice('whatsapp:+'.length),p.From]);
   res.sendStatus(204);
  }catch{res.sendStatus(503);}
 });
}
export function registrarEnviosTwilio(app:Express,db:Db,getPublicacao:(id:number)=>Promise<any>,config=twilioConfig,transport:typeof fetch=fetch){
 app.post('/api/whatsapp/testar-conexao',async(_req,res)=>{
  const ambiente=['production','preview','development'].includes(process.env.VERCEL_ENV||'')?process.env.VERCEL_ENV:'não informado';
  const versao=/^[a-f0-9]{40}$/i.test(process.env.VERCEL_GIT_COMMIT_SHA||'')?process.env.VERCEL_GIT_COMMIT_SHA!.slice(0,7):null;
  res.json({...await testarConexaoTwilio(config(),transport),ambiente,versao});
 });
 app.get('/api/whatsapp/config',(_req,res)=>{const c=config();res.json({provedor:'twilio',configurado:twilioReady(c),pendencias:pendenciasTwilio(c),versaoModelo:'aviso10',variaveis:10});});
 app.get('/api/publicacoes/:id/whatsapp/previa',async(req,res)=>{
  const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<=0){res.sendStatus(400);return;}
  try{const pub=await getPublicacao(id);if(!pub){res.sendStatus(404);return;}res.json(await prepararAviso(db,pub));}catch{res.status(503).json({error:'Não foi possível preparar as datas e o conteúdo do aviso. Confira a publicação e o calendário.'});}
 });
 app.get('/api/publicacoes/:id/whatsapp',async(req,res)=>{
  const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<=0){res.sendStatus(400);return;}
  try{res.json((await db.query('SELECT id,nome,telefone,status,erro_codigo,provedor,twilio_id,criado_em,atualizado_em FROM public.painel_whatsapp_envios WHERE publicacao_id=$1 ORDER BY criado_em DESC LIMIT 20',[id])).rows);}catch{res.status(503).json({error:'Não foi possível consultar os envios.'});}
 });
 app.post('/api/publicacoes/:id/whatsapp',async(req,res)=>{
  const c=config();if(!twilioReady(c)){res.status(503).json({error:'Configure a integração Twilio no servidor antes de enviar.'});return;}
  const id=Number(req.params.id),input=envioAvisoSchema.safeParse(req.body);
  if(!Number.isSafeInteger(id)||id<=0||!input.success){res.status(400).json({error:'Confira destinatário, país/DDD, texto, ação, curadoria, conferência e autorização de recebimento.'});return;}
  let row:any;
  try{
   const pub=await getPublicacao(id);if(!pub){res.sendStatus(404);return;}
   const previa=await prepararAviso(db,pub,input.data.geradaEm);
   let aviso;try{aviso=confirmarAviso(previa,input.data);}catch(e){res.status(409).json({error:e instanceof Error?e.message:'Atualize a prévia.'});return;}
   const{values,texto}=aviso;
   const r=await db.query(`INSERT INTO public.painel_whatsapp_envios(publicacao_id,nome,telefone,texto,template,phone_number_id,consentimento_em,provedor,provider_account_sid)
    VALUES($1,$2,$3,$4,$5,$6,now(),'twilio',$7) ON CONFLICT DO NOTHING RETURNING id`,[id,input.data.nome,input.data.telefone,texto,c.contentSid,c.from,c.accountSid]);
   row=r.rows[0];if(!row){res.status(409).json({error:'Já existe uma tentativa para esta publicação e número. Confira o histórico antes de reenviar.'});return;}
   const result=await enviarTwilio(c,row.id,input.data.telefone,values,transport);
   await db.query(`UPDATE public.painel_whatsapp_envios SET status=$2,twilio_id=COALESCE(twilio_id,$3),erro_codigo=$4,status_ordem=1,atualizado_em=now() WHERE id=$1 AND provedor='twilio' AND status_ordem=0`,[row.id,result.status,result.twilioId,result.codigo]);
   res.status(202).json({id:row.id,status:result.status,provedor:'twilio',codigo:result.codigo,...('motivo' in result?{motivo:result.motivo,statusHttp:result.statusHttp}:{})});
  }catch(e){res.status(503).json({error:row?'Resultado inconclusivo. Consulte o histórico; não repita o envio.':e instanceof Error&&e.message.startsWith('O aviso excede')?e.message:'Não foi possível preparar o envio.'});}
 });
}
