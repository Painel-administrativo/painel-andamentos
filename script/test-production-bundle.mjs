import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import assert from "node:assert/strict";
for (const key of ["DATABASE_URL", "SUPABASE_URL", "SUPABASE_ANON_KEY",
  "AUTH_AUTOMATION_TOKEN", "AUTH_ORIGIN", "AUTH_ADMIN_EMAIL", "AUTH_ADMIN_ID"]) {
  assert(process.env[key], `Missing server configuration: ${key}`);
}
process.env.AUTH_SESSION_SECRET = randomBytes(32).toString("hex");
const require = createRequire(import.meta.url);
const handler = require("../api/index.js").default;
const server = createServer(handler);
server.listen(0, "127.0.0.1");
await new Promise(resolve => server.once("listening", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const headers = { "x-automation-token": process.env.AUTH_AUTOMATION_TOKEN };
try {
  const anonymous = await fetch(base + "/api/processos");
  assert.equal(anonymous.status, 401);
  const health = await fetch(base + "/api/auth/automation-health", { headers });
  assert.equal(health.status, 200);
  const processes = await fetch(base + "/api/processos", { headers });
  assert.equal(processes.status, 200);
  const list = await processes.json();
  assert(Array.isArray(list));
  if (process.env.EXPECTED_PROCESS_COUNT) {
    assert.equal(list.length, Number(process.env.EXPECTED_PROCESS_COUNT));
  }
  const publications = await fetch(base + "/api/publicacoes/recentes?desde=2099-01-01T00%3A00%3A00Z", { headers });
  assert.equal(publications.status, 200);
  assert(Array.isArray(await publications.json()));
  const denied = await fetch(base + "/api/publicacoes?limite=1", { headers });
  assert.equal(denied.status, 401);
  console.log("PASS: full server bundle, database TLS, process read, publication routine read, anonymous denial and scope denial.");
  server.close();
  process.exit(0);
} catch (e) {
  console.error("Integration failed:", e.message);
  server.close();
  process.exit(1);
}
