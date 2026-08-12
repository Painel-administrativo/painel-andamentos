-- =====================================================================
-- Fase 2 DJEN · Criação da tabela `publicacoes`
-- Data: 2026-08-12
-- Autor: Cesar/Arilson via Perplexity
--
-- OBJETIVO
--   Guardar as publicações/intimações do DJEN (Diário de Justiça
--   Eletrônico Nacional) por processo, com deduplicação por hash.
--   Alimentada pelo cron matinal do backend Vercel.
--
-- COMO RODAR
--   Colar todo este arquivo no SQL Editor do Supabase → Run.
--   Rodar 1x só. Idempotente: usa IF NOT EXISTS.
-- =====================================================================

-- 1) Tabela principal ----------------------------------------------------
CREATE TABLE IF NOT EXISTS publicacoes (
  id                     BIGSERIAL PRIMARY KEY,
  processo_id            BIGINT NOT NULL,
  hash                   TEXT NOT NULL,
  data_disponibilizacao  DATE NOT NULL,
  tipo_comunicacao       TEXT,
  tipo_documento         TEXT,
  nome_orgao             TEXT,
  nome_classe            TEXT,
  texto                  TEXT,
  link                   TEXT,
  numero_comunicacao     BIGINT,
  raw_json               JSONB,
  criado_em              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Deduplicação: mesmo hash DJEN nunca entra duas vezes
  CONSTRAINT publicacoes_hash_unique UNIQUE (hash),

  -- FK: se o processo for deletado, apaga as publicações junto
  CONSTRAINT publicacoes_processo_fk
    FOREIGN KEY (processo_id)
    REFERENCES processos(id)
    ON DELETE CASCADE
);

-- 2) Índices para consultas rápidas -------------------------------------
CREATE INDEX IF NOT EXISTS idx_publicacoes_processo
  ON publicacoes (processo_id);

CREATE INDEX IF NOT EXISTS idx_publicacoes_data
  ON publicacoes (data_disponibilizacao DESC);

CREATE INDEX IF NOT EXISTS idx_publicacoes_criado
  ON publicacoes (criado_em DESC);

-- Índice composto pra listagem "publicações de X processo em ordem
-- cronológica" (usado pelo card do frontend no futuro)
CREATE INDEX IF NOT EXISTS idx_publicacoes_processo_data
  ON publicacoes (processo_id, data_disponibilizacao DESC);

-- 3) Row Level Security --------------------------------------------------
-- Só o service_role (backend) acessa. Os anon/authenticated ficam de fora.
-- Isso é padrão do projeto — endpoints públicos vão pelo backend Vercel,
-- que usa a connection string PG diretamente.
ALTER TABLE publicacoes ENABLE ROW LEVEL SECURITY;

-- 4) Comentários pra documentação ---------------------------------------
COMMENT ON TABLE publicacoes IS
  'Publicações/intimações do DJEN (Diário de Justiça Eletrônico Nacional). Alimentada pelo cron diário do backend Vercel.';

COMMENT ON COLUMN publicacoes.hash IS
  'Hash único vindo do DJEN (campo hash). Garante idempotência: mesma publicação nunca entra 2x.';

COMMENT ON COLUMN publicacoes.data_disponibilizacao IS
  'Data em que a publicação foi disponibilizada no DJEN (não é a data do ato judicial).';

COMMENT ON COLUMN publicacoes.tipo_documento IS
  'Ex: Despacho, Decisão, Sentença, Acórdão, Ato ordinatório.';

COMMENT ON COLUMN publicacoes.raw_json IS
  'Payload cru completo do DJEN, pra auditoria e recuperação futura de campos.';

-- 5) Sanity check --------------------------------------------------------
-- Se rodou tudo certo, esta consulta deve retornar 0 linhas e não dar erro:
SELECT COUNT(*) AS total_publicacoes FROM publicacoes;

-- Fim.
