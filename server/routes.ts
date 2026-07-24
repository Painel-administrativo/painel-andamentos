import type { Express } from "express";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { storage } from "./storage";
import { insertProcessoInputSchema, type DatajudSource, TRIBUNAIS } from "@shared/schema";
import { z } from "zod";

const DATAJUD_APIKEY =
  "APIKey cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==";

function endpointFor(tribunal: string): string | null {
  const map: Record<string, string> = {
    TJRJ: "api_publica_tjrj",
    TRF2: "api_publica_trf2",
  };
  const idx = map[tribunal];
  if (!idx) return null;
  return `https://api-publica.datajud.cnj.jus.br/${idx}/_search`;
}

function normalizarNumero(numero: string): string {
  return (numero || "").replace(/[^\d]/g, "");
}

// Infere tribunal pelo segmento J.TR do CNJ (posições após validador)
// Formato: NNNNNNN DD AAAA J TR OOOO  -> 7,2,4,1,2,4 = 20 dígitos
function inferirTribunal(numero20: string): string | null {
  if (numero20.length !== 20) return null;
  const j = numero20.substring(13, 14); // dígito J (1)
  const tr = numero20.substring(14, 16); // TR (2)
  if (j === "8" && tr === "19") return "TJRJ";
  if (j === "4" && tr === "02") return "TRF2";
  return null;
}

async function consultarDatajud(
  numero20: string,
  tribunal: string
): Promise<{ status: "ok" | "nao_encontrado" | "erro"; dados?: DatajudSource; erro?: string }> {
  const url = endpointFor(tribunal);
  if (!url) return { status: "erro", erro: `Tribunal não suportado: ${tribunal}` };
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: DATAJUD_APIKEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: { match: { numeroProcesso: numero20 } } }),
    });
    if (!resp.ok) {
      return { status: "erro", erro: `HTTP ${resp.status}` };
    }
    const json: any = await resp.json();
    const total = json?.hits?.total?.value ?? 0;
    if (total === 0 || !json?.hits?.hits?.length) {
      return { status: "nao_encontrado" };
    }
    const source = json.hits.hits[0]._source as DatajudSource;
    return { status: "ok", dados: source };
  } catch (e: any) {
    return { status: "erro", erro: e?.message || "Falha na requisição" };
  }
}

// Executor com limite de concorrência
async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (idx < items.length) {
      const cur = idx++;
      results[cur] = await fn(items[cur]);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Lista processos + último snapshot
  app.get("/api/processos", async (_req, res) => {
    const lista = await storage.listProcessos();
    res.json(lista);
  });

  // Movimentos do último snapshot de um processo
  app.get("/api/processos/:id/movimentos", async (req, res) => {
    const id = Number(req.params.id);
    const snap = await storage.getLatestSnapshot(id);
    if (!snap || !snap.dadosJson) {
      return res.json({ movimentos: [] });
    }
    try {
      const dados = JSON.parse(snap.dadosJson) as DatajudSource;
      res.json({ movimentos: dados.movimentos ?? [] });
    } catch {
      res.json({ movimentos: [] });
    }
  });

  // Cria processo(s) — aceita objeto único ou array (lote)
  app.post("/api/processos", async (req, res) => {
    const body = req.body;
    const arr = Array.isArray(body) ? body : [body];
    const criados: any[] = [];
    const erros: { entrada: any; erro: string }[] = [];

    for (const item of arr) {
      const parsed = insertProcessoInputSchema.safeParse(item);
      if (!parsed.success) {
        erros.push({ entrada: item, erro: parsed.error.errors[0]?.message || "Inválido" });
        continue;
      }
      const numero20 = normalizarNumero(parsed.data.numero);
      if (numero20.length !== 20) {
        erros.push({
          entrada: item,
          erro: `Número deve ter 20 dígitos (obteve ${numero20.length})`,
        });
        continue;
      }
      const p = await storage.createProcesso({
        numero: numero20,
        tribunal: parsed.data.tribunal,
        apelido: parsed.data.apelido || null,
        observacoes: parsed.data.observacoes || null,
      });
      criados.push(p);
    }

    if (Array.isArray(body)) {
      return res.status(201).json({ criados, erros });
    }
    if (criados.length === 0) {
      return res.status(400).json({ erros });
    }
    res.status(201).json(criados[0]);
  });

  // Atualiza um processo
  app.patch("/api/processos/:id", async (req, res) => {
    const id = Number(req.params.id);
    const schema = insertProcessoInputSchema.partial();
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erro: parsed.error.errors[0]?.message });
    }
    const patch: any = {};
    if (parsed.data.numero !== undefined) {
      const numero20 = normalizarNumero(parsed.data.numero);
      if (numero20.length !== 20) {
        return res.status(400).json({ erro: "Número deve ter 20 dígitos" });
      }
      patch.numero = numero20;
    }
    if (parsed.data.tribunal !== undefined) patch.tribunal = parsed.data.tribunal;
    if (parsed.data.apelido !== undefined) patch.apelido = parsed.data.apelido || null;
    if (parsed.data.observacoes !== undefined)
      patch.observacoes = parsed.data.observacoes || null;

    const updated = await storage.updateProcesso(id, patch);
    if (!updated) return res.status(404).json({ erro: "Processo não encontrado" });
    res.json(updated);
  });

  // Deleta um processo
  app.delete("/api/processos/:id", async (req, res) => {
    const id = Number(req.params.id);
    const ok = await storage.deleteProcesso(id);
    if (!ok) return res.status(404).json({ erro: "Processo não encontrado" });
    res.status(204).end();
  });

  // Infere tribunal pelo número (utilitário para o front no bulk-add)
  app.post("/api/inferir-tribunal", async (req, res) => {
    const numero20 = normalizarNumero(String(req.body?.numero || ""));
    res.json({ tribunal: inferirTribunal(numero20), numeroNormalizado: numero20 });
  });

  // Atualiza andamentos: consulta Datajud para TODOS os processos
  app.post("/api/processos/atualizar", async (_req, res) => {
    const lista = await storage.listProcessos();
    let ok = 0;
    let naoEncontrado = 0;
    let erro = 0;

    await mapConcurrent(lista, 5, async (p) => {
      const r = await consultarDatajud(p.numero, p.tribunal);
      await storage.upsertSnapshot(p.id, {
        status: r.status,
        erro: r.erro ?? null,
        dados: r.dados ?? null,
      });
      if (r.status === "ok") ok++;
      else if (r.status === "nao_encontrado") naoEncontrado++;
      else erro++;
    });

    res.json({
      total: lista.length,
      ok,
      naoEncontrado,
      erro,
      atualizadoEm: new Date().toISOString(),
    });
  });

  return httpServer;
}
