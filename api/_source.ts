// Source do handler serverless — bundled por script/build-api.mjs em api/index.js
// (Este arquivo NÃO é o handler que o Vercel executa: o Vercel roda o api/index.js
// já bundleado. Isto aqui é a fonte pra rebuildar quando mudarmos as rotas.)
import express from "express";
import { registerRoutes } from "../server/routes";

const app = express();
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: false }));

// Browser UI and API share the production origin. No wildcard CORS.
app.use((_req, res, next) => {
  res.header("Cache-Control", "no-store");
  res.header("X-Content-Type-Options", "nosniff");
  if (_req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
});

let ready = false;
const readyPromise = (async () => {
  await registerRoutes({} as any, app);
  app.use(
    (
      err: any,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (res.headersSent) return;
      console.error("express error:", err?.name || "Error");
      const status = err.status || err.statusCode || 500;
      res
        .status(status)
        .json({ message: status >= 500 ? "Falha temporária no servidor." : "Solicitação inválida." });
    },
  );
  ready = true;
})();

export default async function handler(req: any, res: any) {
  try {
    if (!ready) await readyPromise;
    return (app as any)(req, res);
  } catch (e: any) {
    console.error("handler error:", e?.name || "Error");
    res.status(500).json({ error: "Falha temporária no servidor." });
  }
}
