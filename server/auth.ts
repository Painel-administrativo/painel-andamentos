import express, { type Request, type Response } from "express";
import { createCipheriv, createDecipheriv, randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { createClient, type Session, type User } from "@supabase/supabase-js";
import { z } from "zod";
import { loginInput } from "../shared/auth-schema";

export type HostedConfig = {
  url?: string; key?: string; secret?: string; origin?: string;
  adminEmail: string; adminId?: string; automationKey?: string;
};
export interface SessionRepository {
  create(hash: string, expiresAt: number): Promise<void>;
  active(hash: string): Promise<boolean>;
  remove(hash: string): Promise<void>;
  allowLogin(kind: string): Promise<boolean>;
}
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const sessionSchema = z.object({
  token: z.string().min(30).max(4096), uid: z.string().min(1),
  sid: z.string().length(43),
  expiresAt: z.number().finite(),
  refreshToken: z.string().min(1).max(4096).optional(),
  tokenExpiresAt: z.number().finite().optional(),
});
export const SESSION_DURATION_MS = 8 * 60 * 60_000;
const oauthSchema = z.object({
  values: z.array(z.tuple([z.string(), z.string()])),
  expiresAt: z.number().finite(),
});
const SESSION = "__Host-painel-session";
const OAUTH = "__Host-painel-oauth";
export function allowedVercelUser(user: User | null, config: HostedConfig) {
  return Boolean(user?.id && user.email_confirmed_at &&
    user.email?.toLowerCase() === config.adminEmail.toLowerCase() &&
    (!config.adminId || user.id === config.adminId));
}

// Encrypt and authenticate all cookie content. Domain is intentionally absent.
export function cookieCodec(secret: string) {
  const key = Buffer.from(secret, "hex");
  if (key.length !== 32) throw new Error("Invalid session key");
  return {
    seal(value: unknown, purpose: string) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(Buffer.from(purpose));
      const payload = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), payload]).toString("base64url");
    },
    open(value: string, purpose: string): unknown {
      if (!/^[A-Za-z0-9_-]{40,6000}$/.test(value)) throw new Error("Invalid cookie");
      const raw = Buffer.from(value, "base64url");
      const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
      decipher.setAAD(Buffer.from(purpose));
      decipher.setAuthTag(raw.subarray(12, 28));
      return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8"));
    },
  };
}

export function createProductionAuth(
  config: HostedConfig,
  sessions: SessionRepository,
  injectedVerifier?: (token: string) => Promise<User | null>,
  injectedRefresh?: (refreshToken: string) => Promise<Session | null>,
) {
  const app = express();
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.set({
      "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY",
    }); next();
  });
  app.use(express.json({ limit: "5mb" }));
  const origin = config.origin?.replace(/\/$/, "");
  const configured = Boolean(config.url && config.key && config.adminEmail && config.adminId && origin &&
    /^https:\/\//.test(origin!) && /^[a-f0-9]{64}$/i.test(config.secret || ""));
  const codec = configured ? cookieCodec(config.secret!) : null;
  const client = (initial: Array<[string, string]> = []) => {
    const values = new Map(initial);
    const auth = createClient(config.url!, config.key!, {
      auth: {
        flowType: "pkce", autoRefreshToken: false, persistSession: true, detectSessionInUrl: false,
        storage: {
          getItem: k => values.get(k) ?? null,
          setItem: (k, v) => { values.set(k, v); },
          removeItem: k => { values.delete(k); },
        },
      },
    });
    return { auth, values };
  };
  const verifier = injectedVerifier || (async (token: string) => {
    const r = await fetch(`${config.url}/auth/v1/user`, {
      headers: { apikey: config.key!, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (r.status >= 500 || r.status === 429) throw new Error("Provider unavailable");
    if (!r.ok) return null;
    return await r.json() as User;
  });
  const opts = { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/" };
  function clear(res: Response, name: string) { res.clearCookie(name, opts); }
  function readCookie(req: Request, name: string) {
    const values = (req.get("cookie") || "").split(";").map(s => s.trim());
    const matches = values.filter(s => s.startsWith(name + "="));
    if (matches.length !== 1) throw new Error("Missing cookie");
    return codec!.open(matches[0].slice(name.length + 1), name);
  }
  async function establish(res: Response, session: Session, user: User) {
    const expiresAt = Date.now() + SESSION_DURATION_MS;
    if (!session.refresh_token || (session.expires_at || 0) * 1000 <= Date.now()) throw new Error("Expired provider session");
    if (expiresAt <= Date.now()) throw new Error("Expired session");
    const sid = randomBytes(32).toString("base64url");
    const value = codec!.seal({ token: session.access_token, refreshToken: session.refresh_token, tokenExpiresAt: (session.expires_at || 0) * 1000, uid: user.id, expiresAt, sid }, SESSION);
    if (value.length > 3800) throw new Error("Session too large");
    await sessions.create(digest(sid), expiresAt);
    res.cookie(SESSION, value, { ...opts, maxAge: expiresAt - Date.now() });
    return { ticket: "", expiresAt };
  }
  const refresh = injectedRefresh || (async (refreshToken: string) => {
    const { data, error } = await client().auth.auth.refreshSession({ refresh_token: refreshToken });
    if (error) {
      if (!error.status || error.status >= 500 || error.status === 429) throw new Error("Provider unavailable");
      return null;
    }
    return data.session;
  });
  async function authenticate(req: Request, res: Response) {
    let session: z.infer<typeof sessionSchema>;
    try {
      session = sessionSchema.parse(readCookie(req, SESSION));
      if (session.expiresAt <= Date.now()) return null;
    } catch { return null; }
    if (!await sessions.active(digest(session.sid))) return null;
    if (session.tokenExpiresAt !== undefined && session.tokenExpiresAt <= Date.now() + 60_000) {
      if (!session.refreshToken) return null;
      const renewed = await refresh(session.refreshToken);
      if (!renewed || renewed.user.id !== session.uid || !allowedVercelUser(renewed.user, config) ||
          !renewed.refresh_token || (renewed.expires_at || 0) * 1000 <= Date.now()) return null;
      session = { ...session, token: renewed.access_token, refreshToken: renewed.refresh_token,
        tokenExpiresAt: renewed.expires_at! * 1000 };
      const value = codec!.seal(session, SESSION);
      if (value.length > 3800) throw new Error("Session too large");
      res.cookie(SESSION, value, { ...opts, maxAge: session.expiresAt - Date.now() });
    }
    const user = await verifier(session.token);
    return allowedVercelUser(user, config) && user!.id === session.uid ? session : null;
  }
  app.get("/api/auth/status", (_req, res) => res.json({
    configured, googleConfigured: configured, environment: "production", transport: "cookie",
  }));
  app.use("/api", (req, res, next) => {
    if (!configured) { res.status(503).json({ error: "Configuração incompleta. Acesso bloqueado." }); return; }
    const automation = req.get("x-automation-token");
    if (automation) {
      const key = config.automationKey || "";
      const providedBytes = Buffer.from(automation);
      const keyBytes = Buffer.from(key);
      const valid = key.length >= 43 && providedBytes.length === keyBytes.length &&
        timingSafeEqual(providedBytes, keyBytes);
      const permitted = new Set([
        "GET /api/processos", "GET /api/publicacoes/recentes",
        "POST /api/processos/atualizar", "POST /api/publicacoes/atualizar",
        "GET /api/auth/automation-health",
      ]);
      const route = req.originalUrl.split("?")[0];
      if (!valid || !permitted.has(`${req.method} ${route}`)) {
        res.status(401).json({ error: "Automação não autorizada para esta operação." }); return;
      }
      res.locals.automation = true; return next();
    }
    // A fixed origin, not Host / X-Forwarded-Host from the caller.
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method) &&
        (req.get("origin") !== origin || !req.is("application/json"))) {
      res.status(403).json({ error: "Solicitação de origem não autorizada." }); return;
    }
    next();
  });
  app.get("/api/auth/automation-health", (_req, res) => {
    if (!res.locals.automation) { res.status(401).json({ error: "Não autorizado" }); return; }
    res.json({ ok: true, scope: "daily-monitoring" });
  });
  app.get("/api/auth/session", async (req, res) => {
    try {
      const session = await authenticate(req, res);
      if (!session) { clear(res, SESSION); res.json({ authenticated: false }); return; }
      res.json({ authenticated: true, ticket: "", expiresAt: session.expiresAt });
    } catch { res.status(503).json({ error: "Validação temporariamente indisponível." }); }
  });
  app.post("/api/auth/password", async (req, res) => {
    try {
      if (!await sessions.allowLogin("password")) {
        res.set("Retry-After", "60").status(429).json({ error: "Muitas tentativas. Aguarde um minuto." }); return;
      }
    } catch { res.status(503).json({ error: "Validação indisponível. Acesso bloqueado." }); return; }
    const input = loginInput.safeParse(req.body);
    if (!input.success) { res.status(400).json({ error: "Confira e-mail e senha." }); return; }
    if (input.data.email.toLowerCase() !== config.adminEmail.toLowerCase()) {
      res.status(403).json({ error: "Credenciais inválidas ou conta sem autorização." }); return;
    }
    try {
      const { data, error } = await client().auth.auth.signInWithPassword(input.data);
      if (error || !data.session || !allowedVercelUser(data.user, config)) {
        res.status(403).json({ error: "Credenciais inválidas ou conta sem autorização." }); return;
      }
      res.json(await establish(res, data.session, data.user));
    } catch { res.status(503).json({ error: "Não foi possível validar o acesso." }); }
  });
  app.post("/api/auth/admin-signup", (_req, res) => res.status(403).json({ error: "Cadastro público desativado. Use a conta administradora." }));
  app.post("/api/auth/google", async (_req, res) => {
    try {
      if (!await sessions.allowLogin("google")) {
        res.set("Retry-After", "60").status(429).json({ error: "Muitas tentativas. Aguarde um minuto." }); return;
      }
      const { auth, values } = client();
      const { data, error } = await auth.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${origin}/api/auth/callback`, skipBrowserRedirect: true,
          queryParams: { prompt: "select_account" } },
      });
      if (error || !data.url || values.size === 0) throw new Error("OAuth unavailable");
      const payload = codec!.seal({ values: Array.from(values.entries()), expiresAt: Date.now() + 300_000 }, OAUTH);
      res.cookie(OAUTH, payload, { ...opts, maxAge: 300_000 });
      res.json({ url: data.url });
    } catch { res.status(503).json({ error: "Não foi possível iniciar o login Google." }); }
  });
  app.get("/api/auth/callback", async (req, res) => {
    clear(res, OAUTH);
    try {
      const saved = oauthSchema.parse(readCookie(req, OAUTH));
      if (saved.expiresAt <= Date.now() || req.query.error || typeof req.query.code !== "string") throw new Error("Expired");
      const { data, error } = await client(saved.values).auth.auth.exchangeCodeForSession(req.query.code);
      if (error || !data.session || !allowedVercelUser(data.user, config)) throw new Error("Denied");
      await establish(res, data.session, data.user!);
      res.redirect(303, `${origin}/?login=success`);
    } catch {
      clear(res, SESSION);
      res.redirect(303, `${origin}/?login=failed`);
    }
  });
  // Logout must also clear a cookie when its upstream token has expired.
  app.post("/api/auth/logout", async (req, res) => {
    let parsed: z.infer<typeof sessionSchema> | null = null;
    try { parsed = sessionSchema.parse(readCookie(req, SESSION)); } catch { /* no session */ }
    try {
      if (parsed) await sessions.remove(digest(parsed.sid));
      clear(res, SESSION); clear(res, OAUTH); res.json({ ok: true });
    } catch { res.status(503).json({ error: "Não foi possível revogar a sessão. Tente sair novamente." }); }
  });
  app.use("/api", async (req, res, next) => {
    if (res.locals.automation) return next();
    try {
      if (!await authenticate(req, res)) {
        clear(res, SESSION); res.status(401).json({ error: "Entre novamente para acessar o painel." }); return;
      }
      next();
    } catch { res.status(503).json({ error: "Validação indisponível. Acesso bloqueado." }); }
  });
  app.use((_err: unknown, _req: Request, res: Response, _next: express.NextFunction) => {
    res.status(400).json({ error: "Solicitação inválida." });
  });
  return app;
}
