import assert from 'node:assert/strict';
import {once} from 'node:events';
import express from 'express';
import {getExpectedTwilioSignature} from 'twilio/lib/webhooks/webhooks';
import {twilioConfig,twilioReady,enviarTwilio,registrarEnviosTwilio,registrarWebhookTwilio,callbackTwilio} from '../server/whatsapp-twilio';
const c=twilioConfig({TWILIO_ACCOUNT_SID:'AC'+'a'.repeat(32),TWILIO_AUTH_TOKEN:'test-token',TWILIO_WHATSAPP_FROM:'+14155238886',TWILIO_CONTENT_SID:'HX'+'b'.repeat(32),AUTH_ORIGIN:'https://painel.test'});
const sid='SM'+'c'.repeat(32),id='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
assert.ok(twilioReady(c));assert.ok(!twilioReady({...c,authToken:''}));assert.ok(!twilioReady(twilioConfig({AUTH_ORIGIN:'http://unsafe.test'})));assert.ok(!twilioReady({...c,from:'+14155238886'}));
const input={nome:'Destinatário teste',telefone:'+55 (21) 99999-9999',resumo:'Despacho de teste.',curadoria:'Conferir os autos.',consentimento:true};
let calls=0;
const response=()=>Response.json({sid,account_sid:c.accountSid,to:'whatsapp:+5521999999999',from:c.from,status:'queued'},{status:201});
const transport:typeof fetch=async(url,init)=>{
 calls++;assert.equal(url,`https://api.twilio.com/2010-04-01/Accounts/${c.accountSid}/Messages.json`);
 assert.equal((init?.headers as any).Authorization,`Basic ${Buffer.from(`${c.accountSid}:${c.authToken}`).toString('base64')}`);
 const b=new URLSearchParams(String(init?.body));assert.equal(b.get('From'),c.from);assert.equal(b.get('To'),'whatsapp:+5521999999999');assert.equal(b.get('ContentSid'),c.contentSid);assert.equal(b.get('StatusCallback'),callbackTwilio(c,id));assert.equal(b.has('Body'),false);
 assert.deepEqual(JSON.parse(b.get('ContentVariables')!),{'1':'00000000000000000000','2':input.resumo,'3':input.curadoria});return response();
};
const values=['00000000000000000000',input.resumo,input.curadoria];
assert.equal((await enviarTwilio(c,id,'5521999999999',values,transport)).status,'aceita');
assert.equal((await enviarTwilio(c,id,'5521999999999',values,async()=>{throw Error('timeout');})).status,'incerto');
assert.equal((await enviarTwilio(c,id,'5521999999999',values,async()=>Response.json({code:63016},{status:400}))).codigo,'63016');
assert.equal((await enviarTwilio(c,id,'5521999999999',values,async()=>Response.json({},{status:500}))).status,'incerto');
assert.equal((await enviarTwilio(c,id,'5521999999999',values,async()=>Response.json({sid}))).status,'incerto');
const queries:{sql:string;params:any[]}[]=[];let reserved=false,rank=0,delivered=false,failWrite=false;
const db={async query(sql:string,params:any[]=[]){queries.push({sql,params});
 if(sql.startsWith('INSERT')){if(reserved)return{rows:[]};reserved=true;assert.ok(sql.includes("'twilio'"));assert.equal(params[6],c.accountSid);return{rows:[{id}]};}
 if(sql.startsWith('WITH')){assert.ok(sql.includes("provedor='twilio'"));assert.ok(sql.includes('status_ordem<$2'));assert.ok(sql.includes('twilio_id IS NULL OR twilio_id=$3'));if(params[1]>rank&&params[6]==='5521999999999'){rank=params[1];if(rank>=4)delivered=true;}return{rows:[]};}
 if(sql.startsWith('UPDATE')){if(failWrite)throw Error('db failure');assert.ok(sql.includes('status_ordem=0'));assert.ok(!sql.includes('informado_em'));if(rank===0)rank=1;}
 return{rows:[]};}};
const app=express();app.use(express.json());app.use(express.urlencoded({extended:false}));registrarWebhookTwilio(app,db,()=>c);
app.use((req,res,next)=>{if(req.get('authorization')!=='test-session'){res.sendStatus(401);return;}next();});
let callbackBeforeAck=false;
registrarEnviosTwilio(app,db,async()=>({processoNumero:values[0]}),()=>c,async(...args)=>{if(callbackBeforeAck)assert.equal((await event('delivered')).status,204);return transport(...args);});
const server=app.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${(server.address() as any).port}`;
async function post(body:any=input,auth=true){return fetch(base+'/api/publicacoes/7/whatsapp',{method:'POST',headers:{'Content-Type':'application/json',...(auth?{authorization:'test-session'}:{})},body:JSON.stringify(body)});}
async function event(status:string,options:{badSignature?:boolean;changes?:Record<string,string>;tamper?:boolean;query?:boolean}={}){
 const p={AccountSid:c.accountSid,MessageSid:sid,MessageStatus:status,From:c.from,To:'whatsapp:+5521999999999',ExtraFutureParameter:'supported',...options.changes};
 const signature=getExpectedTwilioSignature(c.authToken,callbackTwilio(c,id),p);if(options.tamper)p.To='whatsapp:+5521888888888';
 return fetch(base+`/api/whatsapp/twilio/status/${id}${options.query?'?unexpected=true':''}`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','x-twilio-signature':options.badSignature?'invalid':signature},body:new URLSearchParams(p).toString()});
}
try{
 assert.equal((await post(input,false)).status,401);assert.equal((await post({...input,consentimento:false})).status,400);
 const config=await(await fetch(base+'/api/whatsapp/config',{headers:{authorization:'test-session'}})).text();assert.ok(config.includes('twilio'));assert.ok(!config.includes(c.authToken));assert.ok(!config.includes(c.accountSid));
 const before=calls;const results=await Promise.all([post(),post()]);assert.deepEqual(results.map(r=>r.status).sort(),[202,409]);assert.equal(calls,before+1);assert.equal(rank,1);assert.equal(delivered,false);
 const n=queries.length;assert.equal((await event('delivered',{badSignature:true})).status,401);assert.equal((await event('delivered',{tamper:true})).status,401);assert.equal((await event('delivered',{query:true})).status,401);assert.equal((await event('delivered',{changes:{AccountSid:'AC'+'0'.repeat(32)}})).status,400);assert.equal(queries.length,n);
 assert.equal((await event('sent')).status,204);assert.equal(rank,2);assert.equal(delivered,false);
 assert.equal((await event('delivered')).status,204);assert.equal(rank,4);assert.ok(delivered);
 await event('sent');await event('undelivered');assert.equal(rank,4);await event('read');assert.equal(rank,5);await event('delivered');assert.equal(rank,5);
 // A callback can arrive before the create response, and acknowledgement must not downgrade it.
 reserved=false;rank=0;delivered=false;callbackBeforeAck=true;assert.equal((await post()).status,202);assert.equal(rank,4);assert.ok(delivered);callbackBeforeAck=false;
 // A storage failure after sending leaves the reservation blocked against a second send.
 reserved=false;rank=0;failWrite=true;assert.equal((await post()).status,503);const previous=calls;assert.equal((await post()).status,409);assert.equal(calls,previous);
 console.log('PASS: Twilio form/template payload, configuration/secret isolation, ambiguous failures, duplicates, SDK signature validation including extra parameters, account/channel binding, callback ordering, early callbacks and storage failure after send.');
}finally{server.close();server.closeAllConnections();}
