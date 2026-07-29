// Source do handler serverless — bundled por script/build-api.mjs em api/index.js
// (Este arquivo NÃO é o handler que o Vercel executa: o Vercel roda o api/index.js
// já bundleado. Isto aqui é a fonte pra rebuildar quando mudarmos as rotas.)
import express from "express";
import { registerRoutes } from "../server/routes";

const app = express();
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: false }));

// CORS aberto (endpoint público sem auth)
app.use((_req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
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
      console.error("express error:", err);
      const status = err.status || err.statusCode || 500;
      res
        .status(status)
        .json({ message: err.message || "Internal Server Error" });
    },
  );
  ready = true;
})();

export default async function handler(req: any, res: any) {
  try {
    if (!ready) await readyPromise;
    return (app as any)(req, res);
  } catch (e: any) {
    console.error("handler error:", e);
    res.status(500).json({ error: e.message || String(e) });
  }
}
