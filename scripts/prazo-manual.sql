ALTER TABLE public.publicacoes ADD COLUMN prazo_manual date;
ALTER TABLE public.publicacoes ADD COLUMN prazo_manual_versao integer NOT NULL DEFAULT 0 CHECK (prazo_manual_versao>=0);
CREATE TABLE public.painel_prazo_ajustes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 publicacao_id bigint NOT NULL REFERENCES public.publicacoes(id) ON DELETE CASCADE,
 versao integer NOT NULL,
 anterior date, nova date,
 justificativa text NOT NULL CHECK(length(trim(justificativa)) BETWEEN 10 AND 1500),
 calculo_automatico jsonb,
 autor text NOT NULL,
 ja_informada boolean NOT NULL,
 criado_em timestamptz NOT NULL DEFAULT now(),
 UNIQUE(publicacao_id,versao)
);
ALTER TABLE public.painel_prazo_ajustes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.painel_prazo_ajustes FROM anon,authenticated;
