import type { Express } from "express";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { storage, pool } from "./storage";
import { insertProcessoInputSchema, type DatajudSource, TRIBUNAIS } from "@shared/schema";
import { z } from "zod";

const DATAJUD_APIKEY =
  "APIKey cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==";

function endpointFor(tribunal: string): string | null {
  const map: Record<string, string> = {
    TJRJ: "api_publica_tjrj",
    TRF2: "api_publica_trf2",
    TRT1: "api_publica_trt1",
    TJSP: "api_publica_tjsp",
    TJRS: "api_publica_tjrs",
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

  // === FASE 2: Atualização em lote de publicações DJEN ===
  // Consulta a API DJEN pra cada processo em um lote e insere
  // as publicações novas na tabela `publicacoes`. Idempotente
  // via UNIQUE (hash) — rodar 2x não duplica.
  //
  // Query params:
  //   limite  = tamanho do lote (default 20, max 50)
  //   offset  = a partir de qual processo (paginado por ID)
  //   dias    = janela de dias pra trás (default 3)
  //
  // Retorno:
  //   { processados, novasPublicacoes, processosComNovas, concluido, proximoOffset }
  app.post("/api/publicacoes/atualizar", async (req, res) => {
    try {
      const limite = Math.min(50, Math.max(1, parseInt(String(req.query.limite ?? "20"), 10) || 20));
      const offset = Math.max(0, parseInt(String(req.query.offset ?? "0"), 10) || 0);
      const dias = Math.min(30, Math.max(1, parseInt(String(req.query.dias ?? "3"), 10) || 3));

      // Janela de datas (D-N a D-0). Formato YYYY-MM-DD.
      const hoje = new Date();
      const fim = hoje.toISOString().slice(0, 10);
      const inicioDate = new Date(hoje.getTime() - dias * 24 * 60 * 60 * 1000);
      const inicio = inicioDate.toISOString().slice(0, 10);

      // Lista processos pelo ID ascendente (paginado). Query direta ao
      // pool pra evitar carregar snapshots (que não precisamos aqui).
      const { rows: procs } = await pool.query<{ id: number; numero: string; apelido: string | null }>(
        `SELECT id, numero, apelido FROM processos
         ORDER BY id ASC
         OFFSET $1 LIMIT $2`,
        [offset, limite]
      );

      const processosComNovas: Array<{ id: number; apelido: string | null; numero: string; novas: number }> = [];
      let totalNovas = 0;
      let erros = 0;
      let erros429 = 0;

      // Delay entre chamadas ao DJEN (rate-limit protection).
      // Sem isso, o DJEN começa a devolver 429 depois de ~20 requests rápidos.
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

      for (let i = 0; i < procs.length; i++) {
        const p = procs[i];
        // Delay entre chamadas (não antes da primeira).
        // 2500ms: em 8 procs = 17.5s de espera + ~6s de fetch = ~24s por lote,
        // com folga dentro dos 60s do Vercel.
        // Aumentado após observar 429s cumulativos com 1000ms (IP do Vercel gru1
        // parece ter quota mais rígida no DJEN do que uma janela curta).
        if (i > 0) await sleep(2500);
        try {
          const numero20 = normalizarNumero(p.numero);
          if (numero20.length !== 20) {
            erros++;
            continue;
          }
          const params = new URLSearchParams({
            numeroProcesso: numero20,
            itensPorPagina: "50",
            dataDisponibilizacaoInicio: inicio,
            dataDisponibilizacaoFim: fim,
          });
          const url = `https://comunicaapi.pje.jus.br/api/v1/comunicacao?${params.toString()}`;
          const resp = await fetch(url, {
            method: "GET",
            headers: {
              "Accept": "application/json",
              "User-Agent": "PainelAndamentos/1.0 (cron)",
            },
          });
          if (resp.status === 429) {
            // Rate limit — espera mais e refaz
            erros429++;
            await sleep(15000);
            const resp2 = await fetch(url, {
              method: "GET",
              headers: {
                "Accept": "application/json",
                "User-Agent": "PainelAndamentos/1.0 (cron)",
              },
            });
            if (resp2.status !== 200) {
              erros++;
              continue;
            }
            const body2 = await resp2.json().catch(() => null) as any;
            if (!body2 || !Array.isArray(body2.items) || body2.items.length === 0) {
              continue;
            }
            const { inseridas: ins2 } = await storage.inserirPublicacoes(p.id, body2.items);
            if (ins2 > 0) {
              processosComNovas.push({
                id: p.id,
                apelido: p.apelido,
                numero: p.numero,
                novas: ins2,
              });
              totalNovas += ins2;
            }
            continue;
          }
          if (resp.status !== 200) {
            erros++;
            continue;
          }
          const body = await resp.json().catch(() => null) as any;
          if (!body || !Array.isArray(body.items) || body.items.length === 0) {
            continue;
          }
          const { inseridas } = await storage.inserirPublicacoes(p.id, body.items);
          if (inseridas > 0) {
            processosComNovas.push({
              id: p.id,
              apelido: p.apelido,
              numero: p.numero,
              novas: inseridas,
            });
            totalNovas += inseridas;
          }
        } catch (e) {
          erros++;
          console.error(`publicacoes/atualizar erro no processo ${p.id}:`, (e as Error).message);
        }
      }

      const concluido = procs.length < limite;
      const proximoOffset = offset + procs.length;

      res.json({
        janela: { inicio, fim, dias },
        processados: procs.length,
        novasPublicacoes: totalNovas,
        processosComNovas,
        erros,
        erros429,
        offset,
        proximoOffset,
        concluido,
      });
    } catch (e: any) {
      console.error("publicacoes/atualizar erro geral:", e);
      res.status(500).json({ erro: e?.message || String(e) });
    }
  });

  // === Listar publicações de um processo (usado pelo frontend futuro) ===
  app.get("/api/publicacoes/processo/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(400).json({ erro: "ID inválido" });
      }
      const publicacoes = await storage.listarPublicacoesPorProcesso(id);
      res.json(publicacoes);
    } catch (e: any) {
      console.error("publicacoes/processo/:id erro:", e);
      res.status(500).json({ erro: e?.message || String(e) });
    }
  });

  // === Listar publicações criadas desde X (usado pelo cron pra formatar notificação) ===
  app.get("/api/publicacoes/recentes", async (req, res) => {
    try {
      const desde = String(req.query.desde ?? "");
      if (!desde || Number.isNaN(Date.parse(desde))) {
        return res.status(400).json({ erro: "Parâmetro `desde` (ISO 8601) obrigatório" });
      }
      const publicacoes = await storage.listarPublicacoesRecentes(desde);
      res.json(publicacoes);
    } catch (e: any) {
      console.error("publicacoes/recentes erro:", e);
      res.status(500).json({ erro: e?.message || String(e) });
    }
  });

  // ============================================================
  // Fase 3B — Card de publicações (scroll infinito + marcação de lida)
  // ============================================================

  // === Listar publicações (com JOIN em processos) para o card do dashboard ===
  // Paginado por cursor: `antesDe` = criadoEm da última linha da página anterior.
  // ?limite=50&antesDe=<iso>&naoLidas=true
  app.get("/api/publicacoes", async (req, res) => {
    try {
      const limite = Math.min(Math.max(parseInt(String(req.query.limite ?? "50"), 10) || 50, 1), 200);
      const antesDe = req.query.antesDe ? String(req.query.antesDe) : null;
      const naoLidas = String(req.query.naoLidas ?? "").toLowerCase() === "true";

      if (antesDe && Number.isNaN(Date.parse(antesDe))) {
        return res.status(400).json({ erro: "Parâmetro `antesDe` deve ser ISO 8601" });
      }

      const publicacoes = await storage.listarPublicacoes({
        limite,
        antesDe,
        apenasNaoLidas: naoLidas,
      });
      res.json({
        items: publicacoes,
        proximoCursor: publicacoes.length === limite ? publicacoes[publicacoes.length - 1].criadoEm : null,
      });
    } catch (e: any) {
      console.error("publicacoes (listar) erro:", e);
      res.status(500).json({ erro: e?.message || String(e) });
    }
  });

  // === Contador de não lidas (badge do card) ===
  app.get("/api/publicacoes/nao-lidas-count", async (_req, res) => {
    try {
      const n = await storage.contarNaoLidas();
      res.json({ naoLidas: n });
    } catch (e: any) {
      console.error("publicacoes/nao-lidas-count erro:", e);
      res.status(500).json({ erro: e?.message || String(e) });
    }
  });

  // === Marcar todas como lidas ===
  // ATENÇÃO: precisa vir ANTES de /:id/marcar-lida
  //           senão o Express casa `:id = 'marcar-todas-lidas'`.
  app.post("/api/publicacoes/marcar-todas-lidas", async (_req, res) => {
    try {
      const marcadas = await storage.marcarTodasLidas();
      res.json({ marcadas });
    } catch (e: any) {
      console.error("publicacoes/marcar-todas-lidas erro:", e);
      res.status(500).json({ erro: e?.message || String(e) });
    }
  });

  // === Marcar uma publicação como lida ===
  app.post("/api/publicacoes/:id/marcar-lida", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!id || Number.isNaN(id)) {
        return res.status(400).json({ erro: "ID inválido" });
      }
      const marcada = await storage.marcarPublicacaoLida(id);
      res.json({ marcada });
    } catch (e: any) {
      console.error("publicacoes/marcar-lida erro:", e);
      res.status(500).json({ erro: e?.message || String(e) });
    }
  });

  // Toggle informado: sem body — se estiver NULL, seta now(); senão, limpa.
  app.post("/api/publicacoes/:id/alternar-informada", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!id || Number.isNaN(id)) {
        return res.status(400).json({ erro: "ID inválido" });
      }
      const resultado = await storage.alternarPublicacaoInformada(id);
      if (resultado === null) {
        return res.status(404).json({ erro: "Publicação não encontrada" });
      }
      res.json(resultado);
    } catch (e: any) {
      console.error("publicacoes/alternar-informada erro:", e);
      res.status(500).json({ erro: e?.message || String(e) });
    }
  });

  // Atualiza a anotação livre da publicação.
  // Body: { anotacao: string | null }. String vazia limpa.
  app.patch("/api/publicacoes/:id/anotacao", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!id || Number.isNaN(id)) {
        return res.status(400).json({ erro: "ID inválido" });
      }
      const anotacao = typeof req.body?.anotacao === "string" ? req.body.anotacao : null;
      const resultado = await storage.atualizarAnotacao(id, anotacao);
      if (resultado === null) {
        return res.status(404).json({ erro: "Publicação não encontrada" });
      }
      res.json(resultado);
    } catch (e: any) {
      console.error("publicacoes/anotacao erro:", e);
      res.status(500).json({ erro: e?.message || String(e) });
    }
  });

  return httpServer;
}
