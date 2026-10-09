-- Executar antes de publicar o painel. Não altera registros anteriores.
CREATE TABLE IF NOT EXISTS public.painel_djen_logs (
 id bigserial PRIMARY KEY,
 iniciado_em timestamptz NOT NULL,
 finalizado_em timestamptz,
 status text NOT NULL CHECK (status IN ('em_andamento','sem_erros','parcial','falha')),
 processos integer NOT NULL DEFAULT 0,
 novidades integer NOT NULL DEFAULT 0,
 erros integer NOT NULL DEFAULT 0,
 rate_limits integer NOT NULL DEFAULT 0,
 respostas_invalidas integer NOT NULL DEFAULT 0,
 lote_offset integer NOT NULL,
 janela_inicio date,
 janela_fim date,
 falhas jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX IF NOT EXISTS painel_djen_logs_data ON public.painel_djen_logs (iniciado_em DESC);
ALTER TABLE public.painel_djen_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.painel_djen_logs FROM anon, authenticated;

-- Identificador compartilhado pelos lotes de uma atualização manual.
ALTER TABLE public.painel_djen_logs ADD COLUMN IF NOT EXISTS rodada_id uuid;
CREATE INDEX IF NOT EXISTS painel_djen_logs_rodada ON public.painel_djen_logs (rodada_id) WHERE rodada_id IS NOT NULL;
