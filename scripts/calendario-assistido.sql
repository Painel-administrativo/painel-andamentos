CREATE TABLE public.painel_cal_documentos (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sha256 text NOT NULL UNIQUE,
 metodo text NOT NULL CHECK(metodo IN('url','arquivo')), fonte text NOT NULL, titulo text NOT NULL, mime text NOT NULL, original bytea NOT NULL,
 paginas integer NOT NULL, texto text NOT NULL, criado_em timestamptz NOT NULL DEFAULT now(),
 ultima_consulta timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.painel_cal_propostas (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), documento_id uuid NOT NULL REFERENCES public.painel_cal_documentos(id),
 chave text NOT NULL, pagina integer NOT NULL, trecho text NOT NULL, sugestao jsonb NOT NULL,
 status text NOT NULL DEFAULT 'pendente' CHECK(status IN('pendente','aprovada','rejeitada','revogada')),
 regra jsonb, revisado_em timestamptz, revisado_por text, justificativa text,
 criado_em timestamptz NOT NULL DEFAULT now(), UNIQUE(documento_id,chave)
);
CREATE UNIQUE INDEX painel_cal_ato_ativo ON public.painel_cal_propostas ((regra->>'ato'),(COALESCE(regra->>'origem',''))) WHERE status='aprovada';
CREATE TABLE public.painel_cal_revisoes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), proposta_id uuid NOT NULL REFERENCES public.painel_cal_propostas(id),
 acao text NOT NULL, regra jsonb, justificativa text NOT NULL, autor text NOT NULL,
 criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.painel_cal_impactos (
 id bigserial PRIMARY KEY, revisao_id uuid NOT NULL REFERENCES public.painel_cal_revisoes(id),
 publicacao_id bigint NOT NULL REFERENCES public.publicacoes(id), antes jsonb NOT NULL, depois jsonb NOT NULL,
 ja_informada boolean NOT NULL, criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.painel_cal_consultas (
 id bigserial PRIMARY KEY, fonte text NOT NULL, status text NOT NULL CHECK(status IN('sucesso','falha')),
 mensagem text NOT NULL, documento_id uuid REFERENCES public.painel_cal_documentos(id), criado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.painel_cal_documentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.painel_cal_propostas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.painel_cal_revisoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.painel_cal_impactos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.painel_cal_consultas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.painel_cal_documentos,public.painel_cal_propostas,public.painel_cal_revisoes,public.painel_cal_impactos,public.painel_cal_consultas FROM anon,authenticated;
REVOKE ALL ON SEQUENCE public.painel_cal_impactos_id_seq, public.painel_cal_consultas_id_seq FROM anon,authenticated;
CREATE INDEX ON public.painel_cal_propostas(status,criado_em DESC);
CREATE INDEX ON public.painel_cal_impactos(revisao_id);
CREATE INDEX ON public.painel_cal_consultas(criado_em DESC);

CREATE INDEX ON public.painel_cal_revisoes(proposta_id);
CREATE INDEX ON public.painel_cal_impactos(publicacao_id);
CREATE INDEX ON public.painel_cal_consultas(documento_id);
