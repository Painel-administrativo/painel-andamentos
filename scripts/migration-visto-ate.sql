-- Migration: adicionar coluna visto_ate na tabela processos
-- visto_ate = ISO timestamp da última movimentação que o usuário marcou como lida.
-- Se a última movimentação do snapshot é mais recente que visto_ate, o processo
-- é "não lido". NULL = nunca foi marcado como lido.

ALTER TABLE processos
  ADD COLUMN IF NOT EXISTS visto_ate timestamptz;

-- Comentário pra referência futura
COMMENT ON COLUMN processos.visto_ate IS
  'Timestamp da última movimentação processual que o usuário marcou como lida. NULL = nunca lido. Se última movimentação > visto_ate, processo é "não lido".';
