import { Pool } from "pg";
import type {
  Processo,
  InsertProcesso,
  Snapshot,
  ProcessoComSnapshot,
  DatajudSource,
  Publicacao,
  PublicacaoComProcesso,
  DjenItem,
} from "@shared/schema";

// ============================================================
// Pool Postgres (conecta direto no banco, ignora RLS)
// ============================================================
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error(
    "DATABASE_URL é obrigatória (Session Pooler do Supabase). Configure em .env local ou Vercel."
  );
}

// Serverless-friendly: pool pequeno, timeouts curtos, ssl relaxado
// (Supabase pooler exige SSL mas com CA gerenciado pelo provedor).
export const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 3,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 10_000,
});

pool.on("error", (err) => {
  // Não derruba o processo — só loga. O próximo checkout tentará reconectar.
  console.error("[pg pool] erro idle:", err.message);
});

// ============================================================
// Tipos crus (rowset do Postgres) e mapeamento pro schema camelCase
// ============================================================
interface ProcessoRow {
  id: number;
  numero: string;
  tribunal: string;
  apelido: string | null;
  observacoes: string | null;
  visto_ate: string | null;
  visto_clicado_em: string | null;
}

interface SnapshotRow {
  id: number;
  processo_id: number;
  consultado_em: string;
  status: string;
  erro: string | null;
  dados_json: unknown; // jsonb
}

function mapProcesso(r: ProcessoRow): Processo {
  return {
    id: r.id,
    numero: r.numero,
    tribunal: r.tribunal,
    apelido: r.apelido,
    observacoes: r.observacoes,
    vistoAte: r.visto_ate ?? null,
    vistoClicadoEm: r.visto_clicado_em ?? null,
  };
}

function mapSnapshot(r: SnapshotRow): Snapshot {
  return {
    id: r.id,
    processoId: r.processo_id,
    consultadoEm: r.consultado_em,
    status: r.status,
    erro: r.erro,
    // Mantém compat com o tipo antigo (era string do SQLite)
    dadosJson: r.dados_json == null ? null : JSON.stringify(r.dados_json),
  };
}

// Row type e mapper para publicações (Fase 2)
interface PublicacaoRow {
  id: number;
  processo_id: number;
  hash: string;
  data_disponibilizacao: string;
  tipo_comunicacao: string | null;
  tipo_documento: string | null;
  nome_orgao: string | null;
  nome_classe: string | null;
  texto: string | null;
  link: string | null;
  numero_comunicacao: number | null;
  criado_em: string;
  lido_em: string | null;
  informado_em: string | null;
  anotacao: string | null;
}

interface PublicacaoComProcessoRow extends PublicacaoRow {
  processo_apelido: string | null;
  processo_numero: string;
}

function mapPublicacao(r: PublicacaoRow): Publicacao {
  return {
    id: r.id,
    processoId: r.processo_id,
    hash: r.hash,
    dataDisponibilizacao: r.data_disponibilizacao,
    tipoComunicacao: r.tipo_comunicacao,
    tipoDocumento: r.tipo_documento,
    nomeOrgao: r.nome_orgao,
    nomeClasse: r.nome_classe,
    texto: r.texto,
    link: r.link,
    numeroComunicacao: r.numero_comunicacao,
    criadoEm: r.criado_em,
    lidoEm: r.lido_em,
    informadoEm: r.informado_em,
    anotacao: r.anotacao,
  };
}

function mapPublicacaoComProcesso(r: PublicacaoComProcessoRow): PublicacaoComProcesso {
  return {
    ...mapPublicacao(r),
    processoApelido: r.processo_apelido,
    processoNumero: r.processo_numero,
  };
}

function parseDados(s: SnapshotRow | null | undefined): DatajudSource | null {
  if (!s || s.dados_json == null) return null;
  if (typeof s.dados_json === "string") {
    try {
      return JSON.parse(s.dados_json) as DatajudSource;
    } catch {
      return null;
    }
  }
  return s.dados_json as DatajudSource;
}

// ============================================================
// Interface (mesma de antes — usada pelas routes)
// ============================================================
export interface IStorage {
  listProcessos(): Promise<ProcessoComSnapshot[]>;
  getProcesso(id: number): Promise<Processo | undefined>;
  createProcesso(p: InsertProcesso): Promise<Processo>;
  updateProcesso(
    id: number,
    p: Partial<InsertProcesso>
  ): Promise<Processo | undefined>;
  deleteProcesso(id: number): Promise<boolean>;
  getLatestSnapshot(processoId: number): Promise<Snapshot | undefined>;
  upsertSnapshot(
    processoId: number,
    data: { status: string; erro?: string | null; dados?: DatajudSource | null }
  ): Promise<Snapshot>;
  setVistoAte(
    id: number,
    vistoAte: string | null,
    vistoClicadoEm?: string | null
  ): Promise<Processo | undefined>;

  // Fase 2 — Publicações DJEN
  inserirPublicacoes(
    processoId: number,
    items: DjenItem[]
  ): Promise<{ inseridas: number; ignoradas: number }>;
  listarPublicacoesPorProcesso(processoId: number): Promise<Publicacao[]>;
  listarPublicacoesRecentes(desdeIso: string): Promise<Publicacao[]>;

  // Fase 3B — Card de publicações com scroll infinito e marcação de lida
  listarPublicacoes(opts: {
    limite: number;
    antesDe?: string | null; // cursor: criadoEm da última linha da página anterior
    apenasNaoLidas?: boolean;
  }): Promise<PublicacaoComProcesso[]>;
  contarNaoLidas(): Promise<number>;
  marcarPublicacaoLida(id: number): Promise<boolean>;
  marcarTodasLidas(): Promise<number>;
  alternarPublicacaoInformada(id: number): Promise<{ informadoEm: string | null } | null>;
  atualizarAnotacao(id: number, anotacao: string | null): Promise<{ anotacao: string | null } | null>;
}

// ============================================================
// Implementação com pg (Postgres direto, ignora RLS)
// ============================================================
export class PgStorage implements IStorage {
  async listProcessos(): Promise<ProcessoComSnapshot[]> {
    // Duas queries paralelas (mais barato que N+1) + merge em memória.
    // Só selecionamos colunas que usamos — cliente_id/ultima_mov_* ficam fora
    // (colunas do painel do Arilson).
    const [procs, snaps] = await Promise.all([
      pool.query<ProcessoRow>(
        `SELECT id, numero, tribunal, apelido, observacoes, visto_ate, visto_clicado_em
         FROM processos ORDER BY id ASC`
      ),
      pool.query<SnapshotRow>(
        `SELECT id, processo_id, consultado_em, status, erro, dados_json
         FROM snapshots`
      ),
    ]);

    const snapsByProc = new Map<number, SnapshotRow>();
    for (const s of snaps.rows) {
      const existing = snapsByProc.get(s.processo_id);
      if (
        !existing ||
        new Date(s.consultado_em) > new Date(existing.consultado_em)
      ) {
        snapsByProc.set(s.processo_id, s);
      }
    }

    return procs.rows.map((row) => {
      const proc = mapProcesso(row);
      const snapRow = snapsByProc.get(row.id) ?? null;
      return {
        ...proc,
        snapshot: snapRow ? mapSnapshot(snapRow) : null,
        dados: parseDados(snapRow),
      };
    });
  }

  async getProcesso(id: number): Promise<Processo | undefined> {
    const { rows } = await pool.query<ProcessoRow>(
      `SELECT id, numero, tribunal, apelido, observacoes, visto_ate, visto_clicado_em
       FROM processos WHERE id = $1`,
      [id]
    );
    return rows[0] ? mapProcesso(rows[0]) : undefined;
  }

  async createProcesso(p: InsertProcesso): Promise<Processo> {
    const { rows } = await pool.query<ProcessoRow>(
      `INSERT INTO processos (numero, tribunal, apelido, observacoes)
       VALUES ($1, $2, $3, $4)
       RETURNING id, numero, tribunal, apelido, observacoes, visto_ate, visto_clicado_em`,
      [p.numero, p.tribunal, p.apelido ?? null, p.observacoes ?? null]
    );
    return mapProcesso(rows[0]);
  }

  async updateProcesso(
    id: number,
    p: Partial<InsertProcesso>
  ): Promise<Processo | undefined> {
    if (Object.keys(p).length === 0) return this.getProcesso(id);
    // SET dinâmico — só campos providos
    const sets: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    if (p.numero !== undefined) { sets.push(`numero = $${i++}`); vals.push(p.numero); }
    if (p.tribunal !== undefined) { sets.push(`tribunal = $${i++}`); vals.push(p.tribunal); }
    if (p.apelido !== undefined) { sets.push(`apelido = $${i++}`); vals.push(p.apelido); }
    if (p.observacoes !== undefined) { sets.push(`observacoes = $${i++}`); vals.push(p.observacoes); }
    vals.push(id);

    const { rows } = await pool.query<ProcessoRow>(
      `UPDATE processos SET ${sets.join(", ")}
       WHERE id = $${i}
       RETURNING id, numero, tribunal, apelido, observacoes, visto_ate, visto_clicado_em`,
      vals
    );
    return rows[0] ? mapProcesso(rows[0]) : undefined;
  }

  async deleteProcesso(id: number): Promise<boolean> {
    // Snapshots caem em cascata (FK on delete cascade)
    const { rowCount } = await pool.query(
      `DELETE FROM processos WHERE id = $1`,
      [id]
    );
    return (rowCount ?? 0) > 0;
  }

  async getLatestSnapshot(processoId: number): Promise<Snapshot | undefined> {
    const { rows } = await pool.query<SnapshotRow>(
      `SELECT id, processo_id, consultado_em, status, erro, dados_json
       FROM snapshots
       WHERE processo_id = $1
       ORDER BY consultado_em DESC
       LIMIT 1`,
      [processoId]
    );
    return rows[0] ? mapSnapshot(rows[0]) : undefined;
  }

  async setVistoAte(
    id: number,
    vistoAte: string | null,
    vistoClicadoEm?: string | null
  ): Promise<Processo | undefined> {
    // Se vistoClicadoEm veio undefined, mantém o valor existente.
    // Se veio null, limpa (usado ao voltar pra 'não lido').
    // Se veio string, atualiza.
    let query: string;
    let vals: unknown[];
    if (vistoClicadoEm === undefined) {
      query = `UPDATE processos SET visto_ate = $1
               WHERE id = $2
               RETURNING id, numero, tribunal, apelido, observacoes, visto_ate, visto_clicado_em`;
      vals = [vistoAte, id];
    } else {
      query = `UPDATE processos SET visto_ate = $1, visto_clicado_em = $2
               WHERE id = $3
               RETURNING id, numero, tribunal, apelido, observacoes, visto_ate, visto_clicado_em`;
      vals = [vistoAte, vistoClicadoEm, id];
    }
    const { rows } = await pool.query<ProcessoRow>(query, vals);
    return rows[0] ? mapProcesso(rows[0]) : undefined;
  }

  // ============================================================
  // Fase 2 — Métodos de Publicações DJEN
  // ============================================================
  async inserirPublicacoes(
    processoId: number,
    items: DjenItem[]
  ): Promise<{ inseridas: number; ignoradas: number }> {
    let inseridas = 0;
    let ignoradas = 0;
    for (const it of items) {
      if (!it.hash) {
        ignoradas++;
        continue;
      }
      const data = it.data_disponibilizacao;
      if (!data || !/^\d{4}-\d{2}-\d{2}$/.test(data)) {
        ignoradas++;
        continue;
      }
      const { rowCount } = await pool.query(
        `INSERT INTO publicacoes (
           processo_id, hash, data_disponibilizacao,
           tipo_comunicacao, tipo_documento, nome_orgao, nome_classe,
           texto, link, numero_comunicacao, raw_json
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (hash) DO NOTHING`,
        [
          processoId,
          it.hash,
          data,
          it.tipoComunicacao ?? null,
          it.tipoDocumento ?? null,
          it.nomeOrgao ?? null,
          it.nomeClasse ?? null,
          it.texto ?? null,
          it.link ?? null,
          typeof it.numeroComunicacao === "number" ? it.numeroComunicacao : null,
          JSON.stringify(it),
        ]
      );
      if (rowCount && rowCount > 0) inseridas++;
      else ignoradas++;
    }
    return { inseridas, ignoradas };
  }

  async listarPublicacoesPorProcesso(processoId: number): Promise<Publicacao[]> {
    const { rows } = await pool.query<PublicacaoRow>(
      `SELECT id, processo_id, hash, data_disponibilizacao,
              tipo_comunicacao, tipo_documento, nome_orgao, nome_classe,
              texto, link, numero_comunicacao, criado_em, lido_em, informado_em, anotacao
       FROM publicacoes
       WHERE processo_id = $1
       ORDER BY data_disponibilizacao DESC, id DESC`,
      [processoId]
    );
    return rows.map(mapPublicacao);
  }

  async listarPublicacoesRecentes(desdeIso: string): Promise<Publicacao[]> {
    const { rows } = await pool.query<PublicacaoRow>(
      `SELECT id, processo_id, hash, data_disponibilizacao,
              tipo_comunicacao, tipo_documento, nome_orgao, nome_classe,
              texto, link, numero_comunicacao, criado_em, lido_em, informado_em, anotacao
       FROM publicacoes
       WHERE criado_em >= $1
       ORDER BY criado_em DESC, id DESC`,
      [desdeIso]
    );
    return rows.map(mapPublicacao);
  }

  // ---------- Fase 3B ----------

  async listarPublicacoes(opts: {
    limite: number;
    antesDe?: string | null;
    apenasNaoLidas?: boolean;
  }): Promise<PublicacaoComProcesso[]> {
    const filtros: string[] = [];
    const args: any[] = [];
    let idx = 1;

    if (opts.apenasNaoLidas) {
      filtros.push(`pub.lido_em IS NULL`);
    }
    if (opts.antesDe) {
      filtros.push(`pub.criado_em < $${idx++}`);
      args.push(opts.antesDe);
    }
    args.push(opts.limite);
    const limIdx = idx;

    const where = filtros.length > 0 ? `WHERE ${filtros.join(" AND ")}` : "";

    const { rows } = await pool.query<PublicacaoComProcessoRow>(
      `SELECT pub.id, pub.processo_id, pub.hash, pub.data_disponibilizacao,
              pub.tipo_comunicacao, pub.tipo_documento, pub.nome_orgao, pub.nome_classe,
              pub.texto, pub.link, pub.numero_comunicacao, pub.criado_em, pub.lido_em, pub.informado_em, pub.anotacao,
              pr.apelido AS processo_apelido, pr.numero AS processo_numero
       FROM publicacoes pub
       JOIN processos pr ON pr.id = pub.processo_id
       ${where}
       ORDER BY pub.criado_em DESC, pub.id DESC
       LIMIT $${limIdx}`,
      args
    );
    return rows.map(mapPublicacaoComProcesso);
  }

  async contarNaoLidas(): Promise<number> {
    const { rows } = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM publicacoes WHERE lido_em IS NULL`
    );
    return parseInt(rows[0]?.n ?? "0", 10);
  }

  async marcarPublicacaoLida(id: number): Promise<boolean> {
    const { rowCount } = await pool.query(
      `UPDATE publicacoes SET lido_em = now() WHERE id = $1 AND lido_em IS NULL`,
      [id]
    );
    return (rowCount ?? 0) > 0;
  }

  async marcarTodasLidas(): Promise<number> {
    const { rowCount } = await pool.query(
      `UPDATE publicacoes SET lido_em = now() WHERE lido_em IS NULL`
    );
    return rowCount ?? 0;
  }

  // Toggle: se informado_em está NULL, seta pra now(); se preenchido, volta pra NULL.
  // Retorna null se o ID não existir.
  async alternarPublicacaoInformada(
    id: number
  ): Promise<{ informadoEm: string | null } | null> {
    const { rows } = await pool.query<{ informado_em: string | null }>(
      `UPDATE publicacoes
         SET informado_em = CASE WHEN informado_em IS NULL THEN now() ELSE NULL END
       WHERE id = $1
       RETURNING informado_em`,
      [id]
    );
    if (rows.length === 0) return null;
    return { informadoEm: rows[0].informado_em };
  }

  // Atualiza a anotação livre da publicação.
  // Passe string vazia ou null para limpar. Retorna null se o ID não existir.
  async atualizarAnotacao(
    id: number,
    anotacao: string | null
  ): Promise<{ anotacao: string | null } | null> {
    const valor = anotacao && anotacao.trim().length > 0 ? anotacao : null;
    const { rows } = await pool.query<{ anotacao: string | null }>(
      `UPDATE publicacoes SET anotacao = $2 WHERE id = $1 RETURNING anotacao`,
      [id, valor]
    );
    if (rows.length === 0) return null;
    return { anotacao: rows[0].anotacao };
  }

  async upsertSnapshot(
    processoId: number,
    data: { status: string; erro?: string | null; dados?: DatajudSource | null }
  ): Promise<Snapshot> {
    // ON CONFLICT em processo_id (unique) — atualiza o snapshot existente.
    const { rows } = await pool.query<SnapshotRow>(
      `INSERT INTO snapshots (processo_id, consultado_em, status, erro, dados_json)
       VALUES ($1, now(), $2, $3, $4)
       ON CONFLICT (processo_id) DO UPDATE SET
         consultado_em = EXCLUDED.consultado_em,
         status = EXCLUDED.status,
         erro = EXCLUDED.erro,
         dados_json = EXCLUDED.dados_json
       RETURNING id, processo_id, consultado_em, status, erro, dados_json`,
      [
        processoId,
        data.status,
        data.erro ?? null,
        data.dados == null ? null : JSON.stringify(data.dados),
      ]
    );
    return mapSnapshot(rows[0]);
  }
}

export const storage: IStorage = new PgStorage();
