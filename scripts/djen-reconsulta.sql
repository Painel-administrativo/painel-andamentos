ALTER TABLE public.painel_djen_logs ADD COLUMN reconsulta_de bigint REFERENCES public.painel_djen_logs(id) ON DELETE SET NULL;
ALTER TABLE public.painel_djen_logs ADD COLUMN reconsulta_processo_id bigint;
CREATE INDEX painel_djen_reconsulta_idx ON public.painel_djen_logs(reconsulta_de,reconsulta_processo_id);
CREATE UNIQUE INDEX painel_djen_reconsulta_ativa_idx ON public.painel_djen_logs(reconsulta_de,reconsulta_processo_id) WHERE reconsulta_de IS NOT NULL AND status='em_andamento';
