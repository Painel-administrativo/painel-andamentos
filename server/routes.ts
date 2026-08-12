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

// Detecta processos com "cara" de 2º grau (código de órgão julgador "0000",
// últimos 4 dígitos do CNJ). NOTA: alguns desses processos TÊM cobertura no
// Datajud (agravos, ações rescisórias, apelações em TJRJ/TRF2). Por isso a
// consulta é sempre tentada; só se der "nao_encontrado" que caimos no fallback
// de acompanhamento manual (status "2o_grau").
function tem2oGrauFallback(numero20: string, tribunal: string): boolean {
  if (numero20.length !== 20) return false;
  const orgao = numero20.substring(16, 20);
  return orgao === "0000" && (tribunal === "TJRJ" || tribunal === "TRF2");
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
      try {
        const p = await storage.createProcesso({
          numero: numero20,
          tribunal: parsed.data.tribunal,
          apelido: parsed.data.apelido || null,
          observacoes: parsed.data.observacoes || null,
        });
        criados.push(p);
      } catch (e: any) {
        const msg = String(e?.message || e || "");
        // Duplicidade: código 23505 do Postgres ou palavra-chave
        if (msg.includes("23505") || msg.toLowerCase().includes("duplicate") || msg.toLowerCase().includes("unique")) {
          erros.push({
            entrada: item,
            erro: `Processo ${parsed.data.numero} já está cadastrado`,
          });
        } else {
          erros.push({ entrada: item, erro: msg || "Erro ao criar processo" });
        }
      }
    }

    if (Array.isArray(body)) {
      return res.status(201).json({ criados, erros });
    }
    if (criados.length === 0) {
      // Erro único no cadastro individual — usa 409 se for duplicidade, 400 se validação
      const primeiro = erros[0]?.erro || "Erro ao criar processo";
      const isDupli = primeiro.toLowerCase().includes("já está cadastrado");
      return res.status(isDupli ? 409 : 400).json({ erro: primeiro, erros });
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

  // Marca um processo como lido (visto_ate = data da última movimentação atual).
  // Se o body trouxer { vistoAte: null }, limpa a marcação (volta a não lido).
  app.patch("/api/processos/:id/visto", async (req, res) => {
    const id = Number(req.params.id);
    const p = await storage.getProcesso(id);
    if (!p) return res.status(404).json({ erro: "Processo não encontrado" });

    let vistoAte: string | null;
    let vistoClicadoEm: string | null | undefined = undefined;
    if (req.body && req.body.vistoAte === null) {
      // Volta a não lido — limpa ambos
      vistoAte = null;
      vistoClicadoEm = null;
    } else if (req.body && typeof req.body.vistoAte === "string") {
      // Cliente enviou data específica (raro) — só mexe em visto_ate
      vistoAte = req.body.vistoAte;
    } else {
      // Default (clique 'Marcar como visto'):
      //   visto_ate         = data da última movimentação (usado pra decidir 'não lido')
      //   visto_clicado_em  = agora (usado pra mostrar 'Visto em ...')
      const snap = await storage.getLatestSnapshot(id);
      let ultima: string | null = null;
      if (snap && snap.dadosJson) {
        try {
          const dados = JSON.parse(snap.dadosJson) as DatajudSource;
          const movs = dados.movimentos ?? [];
          for (const m of movs) {
            if (!ultima || new Date(m.dataHora) > new Date(ultima)) {
              ultima = m.dataHora;
            }
          }
        } catch {
          // ignore
        }
      }
      const agora = new Date().toISOString();
      vistoAte = ultima ?? agora;
      vistoClicadoEm = agora;
    }

    const updated = await storage.setVistoAte(id, vistoAte, vistoClicadoEm);
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

  // Atualiza um processo específico (com retry — o Datajud às vezes falha)
  app.post("/api/processos/:id/atualizar", async (req, res) => {
    const id = Number(req.params.id);
    const p = await storage.getProcesso(id);
    if (!p) return res.status(404).json({ erro: "Processo não encontrado" });

    let r: Awaited<ReturnType<typeof consultarDatajud>> | null = null;
    // até 3 tentativas se der erro ou nao_encontrado
    for (let tentativa = 0; tentativa < 3; tentativa++) {
      r = await consultarDatajud(p.numero, p.tribunal);
      if (r.status === "ok") break;
      // aguarda antes de tentar de novo (backoff simples)
      if (tentativa < 2) await new Promise((r) => setTimeout(r, 1500));
    }

    if (!r) r = { status: "erro", erro: "Sem resposta" };

    // Fallback: se nao_encontrado E tem cara de 2º grau, marca como "2o_grau"
    // para preservar o rótulo/link do portal (acompanhamento manual).
    if (r.status === "nao_encontrado" && tem2oGrauFallback(p.numero, p.tribunal)) {
      r = { status: "2o_grau" as any, dados: undefined, erro: undefined };
    }

    await storage.upsertSnapshot(p.id, {
      status: r.status,
      erro: r.erro ?? null,
      dados: r.dados ?? null,
    });

    // Retorna o processo com o snapshot atualizado
    const atualizado = (await storage.listProcessos()).find((x) => x.id === id);
    res.json({
      processo: atualizado,
      resultado: {
        status: r.status,
        erro: r.erro ?? null,
        atualizadoEm: new Date().toISOString(),
      },
    });
  });

  // Atualiza andamentos: consulta Datajud para os processos.
  // Para processos com cara de 2º grau que não forem achados, marca como
  // "2o_grau" (fallback → acompanhamento manual pelo portal).
  //
  // PAGINAÇÃO (?limite=N&offset=M): o limite de 60s da função serverless no
  // Vercel fazia a varredura completa morrer com FUNCTION_INVOCATION_TIMEOUT no
  // meio da lista — sempre nos mesmos processos do fim da fila, que ficavam dias
  // sem atualizar. Com `limite`, o chamador processa a lista em blocos e usa o
  // `proximoOffset` retornado até `concluido: true`.
  //
  // Sem `limite`, o comportamento antigo (tudo de uma vez) é preservado para não
  // quebrar o botão "Atualizar todos" do frontend.
  //
  // A ordenação de listProcessos é por id ascendente, então o fatiamento por
  // offset é estável entre chamadas.
  app.post("/api/processos/atualizar", async (req, res) => {
    const iniciadoEm = Date.now();
    const lista = await storage.listProcessos();
    const total = lista.length;

    const limiteRaw = req.query.limite ?? req.body?.limite;
    const offsetRaw = req.query.offset ?? req.body?.offset;
    const paginado =
      limiteRaw !== undefined && limiteRaw !== null && String(limiteRaw) !== "";

    const limite = paginado
      ? Math.max(1, Math.min(Number(limiteRaw) || 10, 100))
      : total;
    const offset = Math.max(0, Number(offsetRaw) || 0);
    const fatia = paginado ? lista.slice(offset, offset + limite) : lista;

    let ok = 0;
    let naoEncontrado = 0;
    let erro = 0;
    let segundoGrau = 0;

    await mapConcurrent(fatia, 5, async (p) => {
      let r = await consultarDatajud(p.numero, p.tribunal);

      // Fallback: se não achou E o processo tem cara de 2º grau, marca como 2o_grau
      if (
        r.status === "nao_encontrado" &&
        tem2oGrauFallback(p.numero, p.tribunal)
      ) {
        r = { status: "2o_grau" as any, dados: undefined, erro: undefined };
      }

      await storage.upsertSnapshot(p.id, {
        status: r.status,
        erro: r.erro ?? null,
        dados: r.dados ?? null,
      });
      if (r.status === "ok") ok++;
      else if (r.status === "nao_encontrado") naoEncontrado++;
      else if ((r.status as any) === "2o_grau") segundoGrau++;
      else erro++;
    });

    const proximoOffset = offset + fatia.length;
    const concluido = !paginado || proximoOffset >= total;

    res.json({
      total,
      processados: fatia.length,
      offset,
      limite: paginado ? limite : null,
      proximoOffset: concluido ? null : proximoOffset,
      concluido,
      ok,
      naoEncontrado,
      erro,
      segundoGrau,
      duracaoMs: Date.now() - iniciadoEm,
      atualizadoEm: new Date().toISOString(),
    });
  });

  // Atualiza andamentos: consulta Datajud APENAS para processos pendentes
  // (último snapshot com status = erro OU nao_encontrado, ou sem snapshot algum).
  // Não mexe em processos com status "ok" nem "2o_grau".
  app.post("/api/processos/atualizar-pendentes", async (_req, res) => {
    const lista = await storage.listProcessos();

    // Filtra pendentes: status erro/nao_encontrado ou sem snapshot
    const pendentes = lista.filter((p) => {
      const status = p.snapshot?.status;
      return !status || status === "erro" || status === "nao_encontrado";
    });

    let ok = 0;
    let naoEncontrado = 0;
    let erro = 0;
    let segundoGrau = 0;

    await mapConcurrent(pendentes, 5, async (p) => {
      let r = await consultarDatajud(p.numero, p.tribunal);

      // Fallback: se não achou E tem cara de 2º grau, marca como 2o_grau
      if (
        r.status === "nao_encontrado" &&
        tem2oGrauFallback(p.numero, p.tribunal)
      ) {
        r = { status: "2o_grau" as any, dados: undefined, erro: undefined };
      }

      await storage.upsertSnapshot(p.id, {
        status: r.status,
        erro: r.erro ?? null,
        dados: r.dados ?? null,
      });
      if (r.status === "ok") ok++;
      else if (r.status === "nao_encontrado") naoEncontrado++;
      else if ((r.status as any) === "2o_grau") segundoGrau++;
      else erro++;
    });

    res.json({
      totalPendentes: pendentes.length,
      totalGeral: lista.length,
      ok,
      naoEncontrado,
      erro,
      segundoGrau,
      atualizadoEm: new Date().toISOString(),
    });
  });

  // Atualiza andamentos: consulta Datajud APENAS para processos com status
  // atual "2o_grau". Útil para reverificar periodicamente se algum agravo/
  // ação rescisória passou a ter cobertura no Datajud (ou perdeu, virando
  // fallback de novo).
  app.post("/api/processos/atualizar-2ograu", async (_req, res) => {
    const lista = await storage.listProcessos();
    const segundoGrauLista = lista.filter(
      (p) => p.snapshot?.status === "2o_grau",
    );

    let ok = 0;
    let naoEncontrado = 0;
    let erro = 0;
    let segundoGrau = 0;

    await mapConcurrent(segundoGrauLista, 5, async (p) => {
      let r = await consultarDatajud(p.numero, p.tribunal);

      // Mesmo fallback das outras rotas
      if (
        r.status === "nao_encontrado" &&
        tem2oGrauFallback(p.numero, p.tribunal)
      ) {
        r = { status: "2o_grau" as any, dados: undefined, erro: undefined };
      }

      await storage.upsertSnapshot(p.id, {
        status: r.status,
        erro: r.erro ?? null,
        dados: r.dados ?? null,
      });
      if (r.status === "ok") ok++;
      else if (r.status === "nao_encontrado") naoEncontrado++;
      else if ((r.status as any) === "2o_grau") segundoGrau++;
      else erro++;
    });

    res.json({
      total2oGrau: segundoGrauLista.length,
      totalGeral: lista.length,
      ok,
      naoEncontrado,
      erro,
      segundoGrau,
      atualizadoEm: new Date().toISOString(),
    });
  });

  // === FASE 1: Endpoint de teste do DJEN (Diário de Justiça Eletrônico Nacional) ===
  // Consulta publicações/intimações de um processo na API pública do CNJ.
  // Fonte muito mais fresca que o Datajud (diária, a partir das 00h).
  // A API só aceita conexões do Brasil — Vercel sa-east-1 tem acesso.
  // Doc: https://comunicaapi.pje.jus.br/api/v1
  app.post("/api/publicacoes/testar", async (req, res) => {
    try {
      const schema = z.object({
        numero: z.string().min(15),
        dataDisponibilizacaoInicio: z.string().optional(), // YYYY-MM-DD
        dataDisponibilizacaoFim: z.string().optional(),    // YYYY-MM-DD
      });
      const { numero, dataDisponibilizacaoInicio, dataDisponibilizacaoFim } = schema.parse(req.body);
      const numero20 = normalizarNumero(numero);
      if (numero20.length !== 20) {
        return res.status(400).json({ erro: "Número do processo deve ter 20 dígitos após normalizar" });
      }

      const params = new URLSearchParams({
        numeroProcesso: numero20,
        itensPorPagina: "50",
      });
      if (dataDisponibilizacaoInicio) params.set("dataDisponibilizacaoInicio", dataDisponibilizacaoInicio);
      if (dataDisponibilizacaoFim) params.set("dataDisponibilizacaoFim", dataDisponibilizacaoFim);

      const url = `https://comunicaapi.pje.jus.br/api/v1/comunicacao?${params.toString()}`;
      const t0 = Date.now();
      const resp = await fetch(url, {
        method: "GET",
        headers: {
          "Accept": "application/json",
          "User-Agent": "PainelAndamentos/1.0 (test)",
        },
      });
      const elapsedMs = Date.now() - t0;
      const contentType = resp.headers.get("content-type") || "";
      const bodyText = await resp.text();
      let bodyJson: any = null;
      try {
        bodyJson = JSON.parse(bodyText);
      } catch {
        // resposta não-JSON (provavelmente HTML de erro do CloudFront)
      }

      // Resumo enxuto pra facilitar a leitura
      let resumo: any = null;
      if (bodyJson && Array.isArray(bodyJson.items)) {
        resumo = {
          totalRetornado: bodyJson.count ?? bodyJson.items.length,
          publicacoes: bodyJson.items.slice(0, 10).map((it: any) => ({
            data_disponibilizacao: it.data_disponibilizacao ?? it.datadisponibilizacao,
            siglaTribunal: it.siglaTribunal,
            tipoComunicacao: it.tipoComunicacao,
            tipoDocumento: it.tipoDocumento,
            nomeOrgao: it.nomeOrgao,
            nomeClasse: it.nomeClasse,
            numeroComunicacao: it.numeroComunicacao,
            hash: it.hash,
            textoPreview: typeof it.texto === "string" ? it.texto.slice(0, 300) : null,
          })),
        };
      }

      res.json({
        request: {
          numero20,
          url,
        },
        response: {
          status: resp.status,
          contentType,
          elapsedMs,
          isJson: bodyJson !== null,
          bodyPreview: bodyJson === null ? bodyText.slice(0, 500) : null,
          bodyRaw: bodyJson,
          resumo,
        },
      });
    } catch (e: any) {
      if (e instanceof z.ZodError) {
        return res.status(400).json({ erro: "Payload inválido", detalhes: e.issues });
      }
      console.error("publicacoes/testar erro:", e);
      res.status(500).json({ erro: e?.message || String(e) });
    }
  });

  return httpServer;
}
