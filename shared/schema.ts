import { z } from "zod";

// Tribunais suportados (por enquanto)
export const TRIBUNAIS = ["TJRJ", "TRF2", "TRT1", "TJSP", "TJRS"] as const;
export type Tribunal = (typeof TRIBUNAIS)[number];

// Antes o Drizzle+SQLite gerava esses tipos automaticamente.
// Com Supabase/Postgres via supabase-js, definimos os tipos manualmente
// para casar com o schema criado no banco.

export interface Processo {
  id: number;
  numero: string;
  tribunal: string;
  apelido: string | null;
  observacoes: string | null;
  // ISO timestamp da última movimentação que o usuário marcou como lida.
  // Se a última movimentação do snapshot for mais recente que este valor,
  // o processo é exibido como "não lido". null = nunca marcado como lido.
  vistoAte: string | null;
  // Momento em que o usuário efetivamente clicou 'Marcar como visto'.
  // Diferente de vistoAte (que refere-se à movimentação "vista até").
  vistoClicadoEm: string | null;
}

export interface Snapshot {
  id: number;
  processoId: number;
  consultadoEm: string; // ISO 8601
  status: string; // "ok" | "nao_encontrado" | "erro"
  erro: string | null;
  // Serialização do payload Datajud. No SQLite era TEXT; no Postgres é jsonb
  // mas o storage serializa para string para manter o mesmo contrato de tipo.
  dadosJson: string | null;
}

// Validação de entrada para criação/edição de processos
export const insertProcessoInputSchema = z.object({
  numero: z.string().min(1, "Número obrigatório"),
  tribunal: z.enum(TRIBUNAIS),
  apelido: z.string().optional().nullable(),
  observacoes: z.string().optional().nullable(),
});

export const insertProcessoSchema = insertProcessoInputSchema;

export type InsertProcesso = z.infer<typeof insertProcessoSchema>;

// Tipo do _source relevante do Datajud
export interface DatajudMovimento {
  codigo: number;
  dataHora: string;
  nome: string;
  complementosTabelados?: {
    codigo?: number;
    descricao?: string;
    valor?: number;
    nome?: string;
  }[];
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

// ============================================================
// Fase 2 — Publicações do DJEN
// ============================================================
export interface Publicacao {
  id: number;
  processoId: number;
  hash: string;
  dataDisponibilizacao: string; // YYYY-MM-DD
  tipoComunicacao: string | null;
  tipoDocumento: string | null;
  nomeOrgao: string | null;
  nomeClasse: string | null;
  texto: string | null;
  link: string | null;
  numeroComunicacao: number | null;
  criadoEm: string; // ISO 8601
  lidoEm: string | null; // ISO 8601, NULL quando ainda não foi lida
  informadoEm: string | null; // ISO 8601, NULL quando ainda não foi informada ao cliente
  anotacao: string | null; // Anotação livre do usuário sobre a publicação
}

// Publicação com dados do processo (para exibir no card global)
export interface PublicacaoComProcesso extends Publicacao {
  processoApelido: string | null;
  processoNumero: string;
}

// Item cru vindo da API DJEN (usado internamente pelo backend)
export interface DjenItem {
  id?: number;
  data_disponibilizacao?: string;
  siglaTribunal?: string;
  tipoComunicacao?: string;
  tipoDocumento?: string;
  nomeOrgao?: string;
  nomeClasse?: string;
  texto?: string;
  link?: string;
  numeroComunicacao?: number;
  hash?: string;
  numero_processo?: string;
}
