-- Fase 3C: adicionar coluna informado_em na tabela publicacoes.
-- Marca quando o advogado comunicou o cliente sobre a publicação (WhatsApp etc.).
-- lido_em já existe (Fase 3B).

ALTER TABLE publicacoes
  ADD COLUMN IF NOT EXISTS informado_em TIMESTAMPTZ NULL DEFAULT NULL;
