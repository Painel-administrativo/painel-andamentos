// Smoke-test the same generated handler that Vercel runs, without real credentials or DB calls.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createRequire } from "node:module";
import { createServer } from "node:http";
Object.assign(process.env, {
  DATABASE_URL:"postgresql://test:test@localhost:5432/test", SUPABASE_URL:"https://test.supabase.co",
  SUPABASE_ANON_KEY:"test", AUTH_ORIGIN:"https://test.example", AUTH_ADMIN_EMAIL:"test@example.com",
  AUTH_ADMIN_ID:"test-admin", AUTH_SESSION_SECRET:"1".repeat(64), AUTH_AUTOMATION_TOKEN:"2".repeat(43),
  META_APP_SECRET:"bundle-test-secret", META_WEBHOOK_VERIFY_TOKEN:"bundle-verification", META_WHATSAPP_PHONE_NUMBER_ID:"12345",
});
const require=createRequire(import.meta.url);
const handler=require("../api/index.js").default;
const server=createServer(handler);
server.listen(0,"127.0.0.1");await new Promise(resolve=>server.once("listening",resolve));
const base=`http://127.0.0.1:${server.address().port}`;
try {
  const challenge=await fetch(base+"/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=bundle-verification&hub.challenge=987");
  assert.equal(challenge.status,200);assert.equal(await challenge.text(),"987");
  const body=JSON.stringify({object:"whatsapp_business_account",entry:[]});
  const signature="sha256="+createHmac("sha256",process.env.META_APP_SECRET).update(body).digest("hex");
  const headers={"Content-Type":"application/json","x-hub-signature-256":signature};
  assert.equal((await fetch(base+"/api/whatsapp/webhook",{method:"POST",headers,body})).status,200);
  assert.equal((await fetch(base+"/api/whatsapp/webhook",{method:"POST",headers,body:body+" "})).status,401);
  assert.equal((await fetch(base+"/api/whatsapp/config")).status,401);
  assert.equal((await fetch(base+"/api/publicacoes/7/whatsapp",{method:"POST",headers:{"Content-Type":"application/json",Origin:process.env.AUTH_ORIGIN},body:"{}"})).status,401);
  assert.equal((await fetch(base+"/api/publicacoes/7/whatsapp",{method:"POST",headers:{"Content-Type":"application/json","x-automation-token":process.env.AUTH_AUTOMATION_TOKEN},body:"{}"})).status,401);
  console.log("PASS: Vercel bundle preserves raw webhook body, verifies signature before session auth, and blocks anonymous and automation sends.");
} finally {server.close();server.closeAllConnections();}
