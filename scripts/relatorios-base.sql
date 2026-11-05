ALTER TABLE public.painel_rel_relatorios ADD COLUMN base_relatorio_id uuid REFERENCES public.painel_rel_relatorios(id) ON DELETE SET NULL;
CREATE INDEX painel_rel_base_idx ON public.painel_rel_relatorios(base_relatorio_id);
