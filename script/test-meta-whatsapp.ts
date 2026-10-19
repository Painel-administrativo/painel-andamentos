import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { once } from "node:events";
import express from "express";
import { envioSchema, metaConfig, metaReady, parametrosTemplate, assinaturaValida, enviarMeta, registrarEnviosMeta, registrarWebhookMeta } from "../server/whatsapp";

const c = metaConfig({ META_WHATSAPP_TOKEN: "test-secret-token", META_WHATSAPP_PHONE_NUMBER_ID: "12345", META_GRAPH_VERSION: "v26.0",
  META_WHATSAPP_TEMPLATE: "prazzo_aviso", META_APP_SECRET: "test-secret", META_WEBHOOK_VERIFY_TOKEN: "verification" });
assert.ok(metaReady(c)); assert.equal(metaReady({...c, token: ""}), false);
const input = { nome: "Advogado de teste", telefone: "+55 (21) 99999-9999", resumo: "Despacho de teste", curadoria: "Conferir os autos.", consentimento: true };
const parsed = envioSchema.parse(input);
assert.equal(parsed.telefone, "5521999999999");
assert.equal(envioSchema.safeParse({...input, consentimento: false}).success, false);
assert.equal(envioSchema.safeParse({...input, telefone: "abc5521999999999"}).success, false);
assert.equal(envioSchema.safeParse({...input, resumo: "linha\noutra"}).success, false);
const {values,texto} = parametrosTemplate("00000000000000000000",parsed);
assert.ok(texto.includes("Conferir os autos."));
let calls = 0;
const transport: typeof fetch = async (url, init) => {
  calls++;
  assert.equal(url, "https://graph.facebook.com/v26.0/12345/messages");
  assert.equal((init?.headers as any).Authorization, "Bearer test-secret-token");
  const body = JSON.parse(String(init?.body));
  assert.equal(body.messaging_product, "whatsapp");
  assert.equal(body.type, "template"); assert.equal(body.to, parsed.telefone);
  assert.equal(body.template.name, "prazzo_aviso");
  assert.deepEqual(body.template.components[0].parameters.map((p: any) => p.text), values);
  assert.ok(body.biz_opaque_callback_data);
  return Response.json({messages:[{id:"wamid.test"}]});
};
assert.equal((await enviarMeta(c,"id",parsed.telefone,values,transport)).status, "aceita");
assert.equal((await enviarMeta(c,"id",parsed.telefone,values,async () => { throw Error("timeout"); })).status,"incerto");
assert.equal((await enviarMeta(c,"id",parsed.telefone,values,async () => Response.json({error:{code:190,message:"private"}},{status:401}))).codigo,"190");
assert.equal((await enviarMeta(c,"id",parsed.telefone,values,async () => Response.json({},{status:500}))).status,"incerto");
assert.equal((await enviarMeta(c,"id",parsed.telefone,values,async () => Response.json({}))).status,"incerto");

const queries: {sql:string;params:any[]}[] = [];
let reserved = false;
const db = { async query(sql:string, params:any[] = []) {
  queries.push({sql,params});
  if (sql.startsWith("INSERT")) {
    if (reserved) return {rows:[]}; reserved = true;
    return {rows:[{id:"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"}]};
  }
  return {rows:[]};
}};
const app = express();
app.use(express.json({verify(req,_res,buf) {(req as any).rawBody = Buffer.from(buf);}}));
registrarWebhookMeta(app,db,()=>c);
app.use((req,res,next)=> { if (req.get("authorization") !== "test-session") {res.sendStatus(401);return;} next(); });
registrarEnviosMeta(app,db,async id => id === 7 ? {processoNumero:"00000000000000000000"} : undefined,()=>c,transport);
const server=app.listen(0,"127.0.0.1"); await once(server,"listening");
const origin=`http://127.0.0.1:${(server.address() as any).port}`;
async function post(body:any, auth=true) {
  return fetch(origin+"/api/publicacoes/7/whatsapp",{method:"POST",headers:{"Content-Type":"application/json",...(auth?{authorization:"test-session"}:{})},body:JSON.stringify(body)});
}
try {
  assert.equal((await post(input,false)).status,401);
  assert.equal((await post({...input,consentimento:false})).status,400);
  const cfg = await (await fetch(origin+"/api/whatsapp/config",{headers:{authorization:"test-session"}})).text();
  assert.ok(!cfg.includes(c.token)); assert.ok(!cfg.includes(c.appSecret));
  const before=calls;
  const results=await Promise.all([post(input),post(input)]);
  assert.deepEqual(results.map(r=>r.status).sort(),[202,409]); assert.equal(calls,before+1);
  const updates=queries.filter(q=>q.sql.startsWith("UPDATE"));
  assert.ok(updates[0].sql.includes("status_ordem=0"),"An HTTP acknowledgement cannot overwrite a delivery callback");
  assert.ok(!updates[0].sql.includes("informado_em"),"Accepted is not delivered");
  assert.equal((await fetch(origin+"/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=verification&hub.challenge=123")).status,200);
  assert.equal((await fetch(origin+"/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=123")).status,403);
  const payload={object:"whatsapp_business_account",entry:[{changes:[{field:"messages",value:{metadata:{phone_number_id:c.phone},statuses:[{id:"wamid.test",recipient_id:parsed.telefone,status:"delivered",biz_opaque_callback_data:"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"}]}}]}]};
  const body=JSON.stringify(payload); const signature="sha256="+createHmac("sha256",c.appSecret).update(body).digest("hex");
  assert.ok(assinaturaValida(Buffer.from(body),signature,c.appSecret));
  assert.equal(assinaturaValida(Buffer.from(body+" "),signature,c.appSecret),false);
  const beforeWebhook=queries.length;
  assert.equal((await fetch(origin+"/api/whatsapp/webhook",{method:"POST",headers:{"Content-Type":"application/json","x-hub-signature-256":"sha256="+"0".repeat(64)},body})).status,401);
  assert.equal(queries.length,beforeWebhook);
  assert.equal((await fetch(origin+"/api/whatsapp/webhook",{method:"POST",headers:{"Content-Type":"application/json","x-hub-signature-256":signature},body})).status,200);
  const q=queries.at(-1)!; assert.equal(q.params[0],"entregue");assert.equal(q.params[1],4);
  assert.ok(q.sql.includes("status_ordem<$2"));assert.ok(q.sql.includes("informado_em"));
  assert.equal(q.params[5],parsed.telefone); assert.equal(q.params[6],c.phone);
  console.log("PASS: Meta template payload, validation, secret isolation, rejection/timeout/malformed response, session gate, concurrent duplicates, webhook verification/signature, delivery ordering and informed status.");
} finally { server.close(); server.closeAllConnections(); }
