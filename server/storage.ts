import { Pool } from "pg";
import type {
  Processo,
  InsertProcesso,
  Snapshot,
  ProcessoComSnapshot,
  DatajudSource,
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
  setVistoAte(id: number, vistoAte: string | null): Promise<Processo | undefined>;
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
        `SELECT id, numero, tribunal, apelido, observacoes, visto_ate
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
      `SELECT id, numero, tribunal, apelido, observacoes, visto_ate
       FROM processos WHERE id = $1`,
      [id]
    );
    return rows[0] ? mapProcesso(rows[0]) : undefined;
  }

  async createProcesso(p: InsertProcesso): Promise<Processo> {
    const { rows } = await pool.query<ProcessoRow>(
      `INSERT INTO processos (numero, tribunal, apelido, observacoes)
       VALUES ($1, $2, $3, $4)
       RETURNING id, numero, tribunal, apelido, observacoes, visto_ate`,
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
       RETURNING id, numero, tribunal, apelido, observacoes, visto_ate`,
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
    vistoAte: string | null
  ): Promise<Processo | undefined> {
    const { rows } = await pool.query<ProcessoRow>(
      `UPDATE processos SET visto_ate = $1
       WHERE id = $2
       RETURNING id, numero, tribunal, apelido, observacoes, visto_ate`,
      [vistoAte, id]
    );
    return rows[0] ? mapProcesso(rows[0]) : undefined;
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
