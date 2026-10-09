import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { createProductionAuth, cookieCodec, type HostedConfig, SESSION_DURATION_MS } from "../server/auth";

async function main() {
  const config: HostedConfig = {
    url: "https://test.supabase.co", key: "test-anon-key",
    secret: randomBytes(32).toString("hex"), origin: "https://painel.test",
    adminEmail: "admin@example.com", adminId: "admin-id",
    automationKey: randomBytes(32).toString("base64url"),
  };
  const rows = new Map<string, number>();
  let loginAllowed = true;
  const repository = {
    async create(hash: string, expiry: number) { rows.set(hash, expiry); },
    async active(hash: string) { return (rows.get(hash) || 0) > Date.now(); },
    async remove(hash: string) { rows.delete(hash); },
    async allowLogin(_kind: string) { return loginAllowed; },
  };
  let unavailable = false;
  let refreshes = 0;
  let refuseRefresh = false;
  const app = createProductionAuth(config, repository, async token => {
    if (unavailable) throw new Error("offline");
    return {
      id: token.startsWith("other") ? "other-id" : "admin-id",
      email: config.adminEmail, email_confirmed_at: new Date().toISOString(),
    } as any;
  }, async () => {
    refreshes++;
    if (refuseRefresh) return null;
    return { access_token: "renewed".repeat(12), refresh_token: "rotated-refresh",
      expires_at: Math.floor(Date.now()/1000)+3600,
      user: { id: config.adminId, email: config.adminEmail, email_confirmed_at: new Date().toISOString() } } as any;
  });
  app.get("/api/processos", (_req, res) => res.json({ ok: true }));
  app.post("/api/processos/atualizar", (_req, res) => res.json({ ok: true }));
  app.delete("/api/processos/1", (_req, res) => res.json({ ok: true }));
  app.get("/api/publicacoes/1/publica", (_req, res) => res.json({ ok: true }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  let tests = 0;
  async function request(path: string, expected: number, options: RequestInit = {}) {
    const res = await fetch(base + path, options);
    assert.equal(res.status, expected, `${path} ${options.method || "GET"}`);
    tests++;
    return res;
  }
  async function cookie(token = "valid".repeat(12), expiry = Date.now() + 60_000, extra = {}) {
    const sid = randomBytes(32).toString("base64url");
    await repository.create(createHash("sha256").update(sid).digest("hex"), expiry);
    return "__Host-painel-session=" + cookieCodec(config.secret!).seal({
      token, uid: config.adminId, sid, expiresAt: expiry, ...extra,
    }, "__Host-painel-session");
  }
  try {
    await request("/api/processos", 401);
    await request("/api/publicacoes/1/publica?token=old", 401);
    await request("/api/processos", 401, { headers: { "x-api-key": "old-key" } });
    await request("/api/processos", 401, { headers: { cookie: "__Host-painel-session=garbage" } });
    await request("/api/processos", 401, { headers: { cookie: await cookie("valid".repeat(12), Date.now() - 1000) } });
    await request("/api/processos", 401, { headers: { cookie: await cookie("other".repeat(12)) } });
    assert.equal(SESSION_DURATION_MS, 28_800_000);
    const expires = Date.now() + SESSION_DURATION_MS;
    const refreshCookie = await cookie("valid".repeat(12), expires,
      { refreshToken: "test-refresh", tokenExpiresAt: Date.now() - 1000 });
    const refreshed = await request("/api/processos", 200, { headers: { cookie: refreshCookie } });
    const sealed = refreshed.headers.get("set-cookie")!.split(";")[0].split("=")[1];
    const payload = cookieCodec(config.secret!).open(sealed, "__Host-painel-session") as any;
    assert.equal(payload.expiresAt, expires);
    assert.equal(payload.refreshToken, "rotated-refresh");
    assert.equal(refreshes, 1);
    refuseRefresh = true;
    await request("/api/processos", 401, { headers: { cookie: refreshCookie } });
    refuseRefresh = false;
    const session = await cookie();
    await request("/api/processos", 200, { headers: { cookie: session } });
    await request("/api/processos/atualizar", 403, { method: "POST", headers: { cookie: session, Origin: "https://evil.example", "Content-Type": "application/json" }, body: "{}" });
    await request("/api/processos/atualizar", 200, { method: "POST", headers: { cookie: session, Origin: config.origin!, "Content-Type": "application/json" }, body: "{}" });
    await request("/api/auth/admin-signup", 403, { method: "POST", headers: { Origin: config.origin!, "Content-Type": "application/json" }, body: "{}" });
    await request("/api/processos", 401, { headers: { "x-automation-token": "wrong" } });
    await request("/api/processos", 200, { headers: { "x-automation-token": config.automationKey! } });
    await request("/api/processos/atualizar", 200, { method: "POST", headers: { "x-automation-token": config.automationKey!, "Content-Type": "application/json" }, body: "{}" });
    await request("/api/processos/1", 401, { method: "DELETE", headers: { "x-automation-token": config.automationKey! } });
    await request("/api/publicacoes/1/publica", 401, { headers: { "x-automation-token": config.automationKey! } });
    unavailable = true;
    await request("/api/processos", 503, { headers: { cookie: session } });
    unavailable = false;
    await request("/api/auth/logout", 200, { method: "POST", headers: { cookie: session, Origin: config.origin!, "Content-Type": "application/json" }, body: "{}" });
    await request("/api/processos", 401, { headers: { cookie: session } });
    loginAllowed = false;
    const loginHeaders = { Origin: config.origin!, "Content-Type": "application/json" };
    await request("/api/auth/password", 429, { method: "POST", headers: loginHeaders, body: "{}" });
    await request("/api/auth/google", 429, { method: "POST", headers: loginHeaders, body: "{}" });
    console.log(`PASS: ${tests} production authentication checks`);
  } finally { server.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
