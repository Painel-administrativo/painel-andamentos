-- ================================================================
-- Fase 3B — Adicionar coluna lido_em na tabela publicacoes
-- Data: 2026-08-12
-- Objetivo: permitir marcar publicações DJEN como lidas no frontend
-- ================================================================

-- 1) Adiciona a coluna. NULL = não lida. Timestamp = quando foi lida.
ALTER TABLE publicacoes
  ADD COLUMN IF NOT EXISTS lido_em TIMESTAMPTZ NULL DEFAULT NULL;

-- 2) Índice parcial pra query "quantas não lidas?" ficar instantânea.
--    Só indexa as não lidas (menor, mais rápido).
CREATE INDEX IF NOT EXISTS publicacoes_nao_lidas_idx
  ON publicacoes (data_disponibilizacao DESC)
  WHERE lido_em IS NULL;

-- 3) Verificação:
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE lido_em IS NULL) AS nao_lidas,
  COUNT(*) FILTER (WHERE lido_em IS NOT NULL) AS lidas
FROM publicacoes;
