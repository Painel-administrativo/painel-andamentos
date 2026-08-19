-- Adiciona coluna anotacao na tabela publicacoes
-- Anotação livre do usuário sobre a publicação, editável a qualquer momento

ALTER TABLE publicacoes ADD COLUMN IF NOT EXISTS anotacao text;

COMMENT ON COLUMN publicacoes.anotacao IS 'Anotação livre do usuário sobre a publicação (compreensão, resumo pro cliente)';
