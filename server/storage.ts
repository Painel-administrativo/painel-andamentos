import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import type {
  Processo,
  InsertProcesso,
  Snapshot,
  ProcessoComSnapshot,
  DatajudSource,
} from "@shared/schema";

// ============================================================
// Cliente Supabase (Postgres gerenciado)
// ============================================================
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    "SUPABASE_URL e SUPABASE_ANON_KEY são obrigatórios (defina em .env local ou via credentials no publish)."
  );
}

// O supabase-js v2 sempre instancia um RealtimeClient (mesmo sem usar).
// Em Node <22 sem WebSocket global, precisa passar o transport manualmente.
// Cast por causa da tipagem restrita do supabase-js.
export const supabase: SupabaseClient = createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket as unknown as never },
  }
);

// ============================================================
// Helpers
// ============================================================

// Linha crua vinda do Postgres. As colunas usam snake_case; convertemos para
// o formato Processo/Snapshot (camelCase parcial) que o frontend já espera.
interface ProcessoRow {
  id: number;
  numero: string;
  tribunal: string;
  apelido: string | null;
  observacoes: string | null;
}

interface SnapshotRow {
  id: number;
  processo_id: number;
  consultado_em: string;
  status: string;
  erro: string | null;
  dados_json: unknown; // jsonb — vem já parseado pelo supabase-js
}

function mapProcesso(r: ProcessoRow): Processo {
  return {
    id: r.id,
    numero: r.numero,
    tribunal: r.tribunal,
    apelido: r.apelido,
    observacoes: r.observacoes,
  };
}

function mapSnapshot(r: SnapshotRow): Snapshot {
  return {
    id: r.id,
    processoId: r.processo_id,
    consultadoEm: r.consultado_em,
    status: r.status,
    erro: r.erro,
    // O tipo Snapshot originalmente esperava string (JSON serializado no SQLite).
    // No Postgres/jsonb já vem como objeto; serializamos para manter compat com o tipo.
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
// Interface
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
}

// ============================================================
// Implementação Supabase
// ============================================================
export class SupabaseStorage implements IStorage {
  async listProcessos(): Promise<ProcessoComSnapshot[]> {
    // Uma única query com join implícito via múltiplos selects — mais barato
    // que N+1. Aqui usamos duas queries (processos + todos os snapshots) e
    // combinamos em memória, o que é suficiente para dezenas/centenas de processos.
    const [procRes, snapRes] = await Promise.all([
      supabase.from("processos").select("*").order("id", { ascending: true }),
      supabase.from("snapshots").select("*"),
    ]);
    if (procRes.error) throw new Error(procRes.error.message);
    if (snapRes.error) throw new Error(snapRes.error.message);

    const snapsByProc = new Map<number, SnapshotRow>();
    for (const s of (snapRes.data ?? []) as SnapshotRow[]) {
      // Mantém o mais recente por processo (deve haver só um por unique constraint)
      const existing = snapsByProc.get(s.processo_id);
      if (
        !existing ||
        new Date(s.consultado_em) > new Date(existing.consultado_em)
      ) {
        snapsByProc.set(s.processo_id, s);
      }
    }

    return ((procRes.data ?? []) as ProcessoRow[]).map((row) => {
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
    const { data, error } = await supabase
      .from("processos")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? mapProcesso(data as ProcessoRow) : undefined;
  }

  async createProcesso(p: InsertProcesso): Promise<Processo> {
    const { data, error } = await supabase
      .from("processos")
      .insert({
        numero: p.numero,
        tribunal: p.tribunal,
        apelido: p.apelido ?? null,
        observacoes: p.observacoes ?? null,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return mapProcesso(data as ProcessoRow);
  }

  async updateProcesso(
    id: number,
    p: Partial<InsertProcesso>
  ): Promise<Processo | undefined> {
    if (Object.keys(p).length === 0) return this.getProcesso(id);
    const patch: Record<string, unknown> = {};
    if (p.numero !== undefined) patch.numero = p.numero;
    if (p.tribunal !== undefined) patch.tribunal = p.tribunal;
    if (p.apelido !== undefined) patch.apelido = p.apelido;
    if (p.observacoes !== undefined) patch.observacoes = p.observacoes;

    const { data, error } = await supabase
      .from("processos")
      .update(patch)
      .eq("id", id)
      .select()
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? mapProcesso(data as ProcessoRow) : undefined;
  }

  async deleteProcesso(id: number): Promise<boolean> {
    // Snapshots são apagados em cascata (FK on delete cascade)
    const { error, count } = await supabase
      .from("processos")
      .delete({ count: "exact" })
      .eq("id", id);
    if (error) throw new Error(error.message);
    return (count ?? 0) > 0;
  }

  async getLatestSnapshot(processoId: number): Promise<Snapshot | undefined> {
    const { data, error } = await supabase
      .from("snapshots")
      .select("*")
      .eq("processo_id", processoId)
      .order("consultado_em", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? mapSnapshot(data as SnapshotRow) : undefined;
  }

  async upsertSnapshot(
    processoId: number,
    data: { status: string; erro?: string | null; dados?: DatajudSource | null }
  ): Promise<Snapshot> {
    const payload = {
      processo_id: processoId,
      consultado_em: new Date().toISOString(),
      status: data.status,
      erro: data.erro ?? null,
      dados_json: data.dados ?? null,
    };
    // Tabela tem unique(processo_id) — usa upsert por essa coluna
    const { data: row, error } = await supabase
      .from("snapshots")
      .upsert(payload, { onConflict: "processo_id" })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return mapSnapshot(row as SnapshotRow);
  }
}

export const storage: IStorage = new SupabaseStorage();
