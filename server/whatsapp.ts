import { createHmac, timingSafeEqual } from "node:crypto";
import type { Express } from "express";
import { z } from "zod";

export const envioSchema = z.object({
  nome: z.string().trim().min(2).max(100),
  telefone: z.string().transform(v => v.replace(/[\s()+.-]/g, "")).pipe(z.string().regex(/^[1-9]\d{7,14}$/, "Informe país, DDD e número.")),
  resumo: z.string().trim().min(1).max(500).refine(v => !/[\r\n\t]/.test(v), "Use uma única linha."),
  curadoria: z.string().trim().min(1).max(350).refine(v => !/[\r\n\t]/.test(v), "Use uma única linha."),
  consentimento: z.literal(true),
}).strict();
export type EnvioInput = z.infer<typeof envioSchema>;
export type MetaConfig = ReturnType<typeof metaConfig>;
export function metaConfig(env: NodeJS.ProcessEnv = process.env) {
  return { token: env.META_WHATSAPP_TOKEN || "", phone: env.META_WHATSAPP_PHONE_NUMBER_ID || "",
    version: env.META_GRAPH_VERSION || "", template: env.META_WHATSAPP_TEMPLATE || "",
    language: env.META_WHATSAPP_LANGUAGE || "pt_BR", appSecret: env.META_APP_SECRET || "",
    verifyToken: env.META_WEBHOOK_VERIFY_TOKEN || "" };
}
export function metaReady(c: MetaConfig) {
  return Boolean(c.token && /^\d+$/.test(c.phone) && /^v\d+\.0$/.test(c.version) &&
    /^[a-z0-9_]+$/.test(c.template) && /^[a-z]{2}_[A-Z]{2}$/.test(c.language) && c.appSecret && c.verifyToken);
}
export function assinaturaValida(body: Buffer, signature: string, secret: string) {
  if (!secret || !/^sha256=[a-f0-9]{64}$/.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(body).digest();
  return timingSafeEqual(expected, Buffer.from(signature.slice(7), "hex"));
}
export function parametrosTemplate(numero: string, input: EnvioInput) {
  const values = [numero.replace(/[\r\n\t]/g, " "), input.resumo, input.curadoria];
  const texto = `Atualização do processo ${values[0]}.\nPublicação: ${values[1]}\nCuradoria: ${values[2]}`;
  if (texto.length > 1024) throw new Error("O aviso excede 1.024 caracteres. Reduza o resumo ou a curadoria.");
  return { values, texto };
}
// Network errors / timeouts are ambiguous: never resend automatically.
export async function enviarMeta(c: MetaConfig, id: string, telefone: string, values: string[], transport: typeof fetch = fetch) {
  try {
    const r = await transport(`https://graph.facebook.com/${c.version}/${c.phone}/messages`, {
      method: "POST", signal: AbortSignal.timeout(20_000), headers: {
        Authorization: `Bearer ${c.token}`, "Content-Type": "application/json",
      }, body: JSON.stringify({ messaging_product: "whatsapp", to: telefone, type: "template",
        biz_opaque_callback_data: id,
        template: { name: c.template, language: { code: c.language }, components: [{ type: "body",
          parameters: values.map(text => ({ type: "text", text })) }] } }),
    });
    const data = await r.json().catch(() => null);
    if (!r.ok) return { status: r.status >= 500 ? "incerto" : "falha", metaId: null,
      codigo: typeof data?.error?.code === "number" ? String(data.error.code) : `HTTP_${r.status}` };
    const metaId = data?.messages?.[0]?.id;
    if (typeof metaId !== "string" || !metaId.startsWith("wamid.")) return { status: "incerto", metaId: null, codigo: "RESPOSTA_INVALIDA" };
    return { status: "aceita", metaId, codigo: null };
  } catch { return { status: "incerto", metaId: null, codigo: "CONEXAO_INCONCLUSIVA" }; }
}

type Db = { query: (sql: string, values?: any[]) => Promise<any> };
export function registrarWebhookMeta(app: Express, db: Db, config = metaConfig) {
  app.get("/api/whatsapp/webhook", (req, res) => {
    const c = config();
    const provided = String(req.query["hub.verify_token"] || "");
    const valid = c.verifyToken && Buffer.byteLength(provided) === Buffer.byteLength(c.verifyToken) &&
      timingSafeEqual(Buffer.from(provided), Buffer.from(c.verifyToken));
    if (req.query["hub.mode"] !== "subscribe" || !valid || typeof req.query["hub.challenge"] !== "string") {
      res.sendStatus(403); return;
    }
    res.type("text/plain").send(req.query["hub.challenge"]);
  });
  app.post("/api/whatsapp/webhook", async (req, res) => {
    const c = config();
    const raw = (req as any).rawBody;
    if (!Buffer.isBuffer(raw) || !assinaturaValida(raw, req.get("x-hub-signature-256") || "", c.appSecret)) {
      res.sendStatus(401); return;
    }
    if (req.body?.object !== "whatsapp_business_account") { res.sendStatus(400); return; }
    try {
      for (const entry of req.body.entry || []) for (const change of entry.changes || []) {
        if (change.field !== "messages" || change.value?.metadata?.phone_number_id !== c.phone) continue;
        for (const event of change.value.statuses || []) {
          const rank: Record<string, number> = { sent: 2, failed: 3, delivered: 4, read: 5 };
          const names: Record<string, string> = { sent: "enviada", failed: "falha", delivered: "entregue", read: "lida" };
          if (!rank[event.status] || typeof event.id !== "string" || !/^\d+$/.test(event.recipient_id || "")) continue;
          const callback = typeof event.biz_opaque_callback_data === "string" && /^[a-f0-9-]{36}$/.test(event.biz_opaque_callback_data)
            ? event.biz_opaque_callback_data : null;
          const code = typeof event.errors?.[0]?.code === "number" ? String(event.errors[0].code) : null;
          await db.query(`WITH changed AS (
            UPDATE public.painel_whatsapp_envios SET status=$1, status_ordem=$2, meta_id=COALESCE(meta_id,$3),
              erro_codigo=$4, atualizado_em=now()
            WHERE (meta_id=$3 OR (id::text=$5 AND meta_id IS NULL)) AND telefone=$6 AND phone_number_id=$7 AND status_ordem<$2
            RETURNING publicacao_id
          ) UPDATE public.publicacoes SET informado_em=COALESCE(informado_em,now())
            WHERE id IN (SELECT publicacao_id FROM changed) AND $2>=4`,
            [names[event.status], rank[event.status], event.id, code, callback, event.recipient_id, c.phone]);
        }
      }
      res.sendStatus(200);
    } catch { res.sendStatus(503); }
  });
}
export function registrarEnviosMeta(app: Express, db: Db, getPublicacao: (id: number) => Promise<any>, config = metaConfig, transport: typeof fetch = fetch) {
  app.get("/api/whatsapp/config", (_req, res) => {
    const c = config(); res.json({ configurado: metaReady(c), template: c.template || null });
  });
  app.get("/api/publicacoes/:id/whatsapp", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) { res.sendStatus(400); return; }
    try {
      const r = await db.query(`SELECT id,nome,telefone,status,erro_codigo,criado_em,atualizado_em FROM public.painel_whatsapp_envios
        WHERE publicacao_id=$1 ORDER BY criado_em DESC LIMIT 20`, [id]);
      res.json(r.rows);
    } catch { res.status(503).json({ error: "Não foi possível consultar os envios." }); }
  });
  app.post("/api/publicacoes/:id/whatsapp", async (req, res) => {
    const c = config();
    if (!metaReady(c)) { res.status(503).json({ error: "Configure a integração Meta no servidor antes de enviar." }); return; }
    const id = Number(req.params.id), input = envioSchema.safeParse(req.body);
    if (!Number.isSafeInteger(id) || id <= 0 || !input.success) { res.status(400).json({ error: "Confira destinatário, país/DDD, resumo, curadoria e autorização de recebimento." }); return; }
    let row: any;
    try {
      const pub = await getPublicacao(id);
      if (!pub) { res.sendStatus(404); return; }
      const { values, texto } = parametrosTemplate(pub.processoNumero, input.data);
      const r = await db.query(`INSERT INTO public.painel_whatsapp_envios
        (publicacao_id,nome,telefone,texto,template,phone_number_id,consentimento_em)
        VALUES ($1,$2,$3,$4,$5,$6,now()) ON CONFLICT (publicacao_id,telefone) DO NOTHING RETURNING id`,
        [id,input.data.nome,input.data.telefone,texto,c.template,c.phone]);
      row = r.rows[0];
      if (!row) { res.status(409).json({ error: "Já existe uma tentativa para esta publicação e número. Confira o histórico antes de reenviar." }); return; }
      const outcome = await enviarMeta(c,row.id,input.data.telefone,values,transport);
      await db.query(`UPDATE public.painel_whatsapp_envios SET status=$2,meta_id=COALESCE(meta_id,$3),erro_codigo=$4,
        status_ordem=1,atualizado_em=now() WHERE id=$1 AND status_ordem=0`,
        [row.id,outcome.status,outcome.metaId,outcome.codigo]);
      res.status(202).json({ id: row.id, status: outcome.status });
    } catch (error) {
      // A reserved row remains blocked if persistence fails after the external call.
      res.status(503).json({ error: row ? "Resultado inconclusivo. Consulte o histórico; não repita o envio." :
        error instanceof Error && error.message.startsWith("O aviso excede") ? error.message : "Não foi possível preparar o envio." });
    }
  });
}
