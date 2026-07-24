import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Tribunais suportados (por enquanto)
export const TRIBUNAIS = ["TJRJ", "TRF2"] as const;
export type Tribunal = (typeof TRIBUNAIS)[number];

export const processos = sqliteTable("processos", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  numero: text("numero").notNull(), // 20 dígitos, sem formatação
  tribunal: text("tribunal").notNull(), // "TJRJ" | "TRF2"
  apelido: text("apelido"),
  observacoes: text("observacoes"),
});

export const snapshots = sqliteTable("snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  processoId: integer("processo_id").notNull(),
  consultadoEm: text("consultado_em").notNull(), // ISO 8601
  status: text("status").notNull(), // "ok" | "nao_encontrado" | "erro"
  erro: text("erro"),
  // _source inteiro do Datajud (JSON string) — pode ser null se não encontrado
  dadosJson: text("dados_json"),
});

export const insertProcessoSchema = createInsertSchema(processos).omit({
  id: true,
});

export const insertProcessoInputSchema = z.object({
  numero: z.string().min(1, "Número obrigatório"),
  tribunal: z.enum(TRIBUNAIS),
  apelido: z.string().optional().nullable(),
  observacoes: z.string().optional().nullable(),
});

export type InsertProcesso = z.infer<typeof insertProcessoSchema>;
export type Processo = typeof processos.$inferSelect;
export type Snapshot = typeof snapshots.$inferSelect;

// Tipo do _source relevante do Datajud
export interface DatajudMovimento {
  codigo: number;
  dataHora: string;
  nome: string;
  complementosTabelados?: { codigo?: number; descricao?: string; valor?: number; nome?: string }[];
  orgaoJulgador?: { codigo?: string | number; nome?: string };
}

export interface DatajudSource {
  numeroProcesso: string;
  tribunal: string;
  grau?: string;
  dataAjuizamento?: string;
  classe?: { codigo?: number; nome?: string };
  orgaoJulgador?: { codigo?: number; nome?: string };
  formato?: { codigo?: number; nome?: string };
  dataHoraUltimaAtualizacao?: string;
  movimentos?: DatajudMovimento[];
}

// Processo + último snapshot (payload da API GET /api/processos)
export interface ProcessoComSnapshot extends Processo {
  snapshot: Snapshot | null;
  dados: DatajudSource | null;
}
