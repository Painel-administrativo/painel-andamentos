import { processos, snapshots } from "@shared/schema";
import type {
  Processo,
  InsertProcesso,
  Snapshot,
  ProcessoComSnapshot,
  DatajudSource,
} from "@shared/schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";

const sqlite = new Database("data.db");
sqlite.pragma("journal_mode = WAL");

// Cria as tabelas se ainda não existirem (evita depender de migrations no deploy)
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS processos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    numero TEXT NOT NULL,
    tribunal TEXT NOT NULL,
    apelido TEXT,
    observacoes TEXT
  );
  CREATE TABLE IF NOT EXISTS snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    processo_id INTEGER NOT NULL,
    consultado_em TEXT NOT NULL,
    status TEXT NOT NULL,
    erro TEXT,
    dados_json TEXT
  );
`);

export const db = drizzle(sqlite);

function parseDados(s: Snapshot | undefined): DatajudSource | null {
  if (!s || !s.dadosJson) return null;
  try {
    return JSON.parse(s.dadosJson) as DatajudSource;
  } catch {
    return null;
  }
}

export interface IStorage {
  listProcessos(): Promise<ProcessoComSnapshot[]>;
  getProcesso(id: number): Promise<Processo | undefined>;
  createProcesso(p: InsertProcesso): Promise<Processo>;
  updateProcesso(id: number, p: Partial<InsertProcesso>): Promise<Processo | undefined>;
  deleteProcesso(id: number): Promise<boolean>;
  getLatestSnapshot(processoId: number): Promise<Snapshot | undefined>;
  upsertSnapshot(
    processoId: number,
    data: { status: string; erro?: string | null; dados?: DatajudSource | null }
  ): Promise<Snapshot>;
}

export class DatabaseStorage implements IStorage {
  async listProcessos(): Promise<ProcessoComSnapshot[]> {
    const procs = db.select().from(processos).all();
    return procs.map((p) => {
      const snap = db
        .select()
        .from(snapshots)
        .where(eq(snapshots.processoId, p.id))
        .get();
      return { ...p, snapshot: snap ?? null, dados: parseDados(snap) };
    });
  }

  async getProcesso(id: number): Promise<Processo | undefined> {
    return db.select().from(processos).where(eq(processos.id, id)).get();
  }

  async createProcesso(p: InsertProcesso): Promise<Processo> {
    return db.insert(processos).values(p).returning().get();
  }

  async updateProcesso(
    id: number,
    p: Partial<InsertProcesso>
  ): Promise<Processo | undefined> {
    if (Object.keys(p).length === 0) return this.getProcesso(id);
    return db
      .update(processos)
      .set(p)
      .where(eq(processos.id, id))
      .returning()
      .get();
  }

  async deleteProcesso(id: number): Promise<boolean> {
    db.delete(snapshots).where(eq(snapshots.processoId, id)).run();
    const r = db.delete(processos).where(eq(processos.id, id)).run();
    return r.changes > 0;
  }

  async getLatestSnapshot(processoId: number): Promise<Snapshot | undefined> {
    return db
      .select()
      .from(snapshots)
      .where(eq(snapshots.processoId, processoId))
      .get();
  }

  async upsertSnapshot(
    processoId: number,
    data: { status: string; erro?: string | null; dados?: DatajudSource | null }
  ): Promise<Snapshot> {
    const existing = await this.getLatestSnapshot(processoId);
    const payload = {
      processoId,
      consultadoEm: new Date().toISOString(),
      status: data.status,
      erro: data.erro ?? null,
      dadosJson: data.dados ? JSON.stringify(data.dados) : null,
    };
    if (existing) {
      return db
        .update(snapshots)
        .set(payload)
        .where(eq(snapshots.id, existing.id))
        .returning()
        .get();
    }
    return db.insert(snapshots).values(payload).returning().get();
  }
}

export const storage = new DatabaseStorage();
