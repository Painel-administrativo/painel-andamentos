CREATE TABLE public.painel_contatos (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 nome text NOT NULL CHECK(length(trim(nome)) BETWEEN 2 AND 100),
 telefone text NOT NULL UNIQUE CHECK(telefone ~ '^[1-9][0-9]{7,14}$'),
 versao integer NOT NULL DEFAULT 0,
 criado_em timestamptz NOT NULL DEFAULT now(),atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.painel_processo_contatos (
 processo_id bigint NOT NULL REFERENCES public.processos(id) ON DELETE CASCADE,
 contato_id uuid NOT NULL REFERENCES public.painel_contatos(id) ON DELETE CASCADE,
 criado_em timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(processo_id,contato_id)
);
CREATE INDEX painel_contatos_vinculos_idx ON public.painel_processo_contatos(contato_id);
ALTER TABLE public.painel_contatos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.painel_processo_contatos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.painel_contatos,public.painel_processo_contatos FROM PUBLIC,anon,authenticated;
