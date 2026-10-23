CREATE TABLE public.painel_rel_grupos (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), nome text NOT NULL, criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX painel_rel_grupo_nome ON public.painel_rel_grupos(lower(nome));
CREATE TABLE public.painel_rel_selecao (
 grupo_id uuid NOT NULL REFERENCES public.painel_rel_grupos(id),processo_id bigint NOT NULL REFERENCES public.processos(id) ON DELETE CASCADE,
 PRIMARY KEY(grupo_id,processo_id)
);
CREATE INDEX ON public.painel_rel_selecao(processo_id);
CREATE TABLE public.painel_rel_relatorios (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),grupo_id uuid NOT NULL REFERENCES public.painel_rel_grupos(id),
 nome_escritorio text NOT NULL,inicio date NOT NULL,fim date NOT NULL CHECK(fim>=inicio),
 estado text NOT NULL DEFAULT 'coletando' CHECK(estado IN('coletando','rascunho','conferido','cancelado')),
 versao integer NOT NULL DEFAULT 0,texto_editado text, texto_final text,criado_em timestamptz NOT NULL DEFAULT now(),conferido_em timestamptz,conferido_por text,
 copiado_em timestamptz
);
CREATE INDEX ON public.painel_rel_relatorios(grupo_id,criado_em DESC);
CREATE UNIQUE INDEX painel_rel_rascunho_unico ON public.painel_rel_relatorios(grupo_id) WHERE estado IN('coletando','rascunho');
CREATE TABLE public.painel_rel_itens (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),relatorio_id uuid NOT NULL REFERENCES public.painel_rel_relatorios(id),
 processo_id bigint REFERENCES public.processos(id) ON DELETE SET NULL,numero text NOT NULL,apelido text,tribunal text NOT NULL,
 estado text NOT NULL DEFAULT 'pendente' CHECK(estado IN('pendente','consultando','ok','inconclusivo')),
 referencia_id uuid REFERENCES public.painel_rel_itens(id),referencia jsonb,resultado jsonb,snapshot jsonb,
 tentativa uuid,consulta_iniciada timestamptz,consultado_em timestamptz,erro text,
 UNIQUE(relatorio_id,numero)
);
CREATE INDEX ON public.painel_rel_itens(processo_id);
CREATE INDEX ON public.painel_rel_itens(referencia_id);
CREATE INDEX ON public.painel_rel_itens(numero,relatorio_id);
ALTER TABLE public.painel_rel_grupos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.painel_rel_selecao ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.painel_rel_relatorios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.painel_rel_itens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.painel_rel_grupos,public.painel_rel_selecao,public.painel_rel_relatorios,public.painel_rel_itens FROM anon,authenticated;
INSERT INTO public.painel_rel_grupos(nome) VALUES('CARTAXO & VILLA') ON CONFLICT(lower(nome)) DO NOTHING;
INSERT INTO public.painel_rel_selecao(grupo_id,processo_id)
SELECT g.id,p.id FROM public.painel_rel_grupos g CROSS JOIN public.processos p
WHERE g.nome='CARTAXO & VILLA' AND regexp_replace(p.numero,'[^0-9]','','g') IN (
'00176810720258190000','01320741520208190001','00659712120238190001','01321097220208190001','02926686620218190001',
'00048726420218190213','00061766420228190213','08068198620228190213','08103675120248190213','08455163120258190001',
'08167466220248190001','01239273920168190001','00131997920268190000') ON CONFLICT DO NOTHING;
DO $$ BEGIN IF (SELECT count(*) FROM public.painel_rel_selecao s JOIN public.painel_rel_grupos g ON g.id=s.grupo_id WHERE g.nome='CARTAXO & VILLA')<>13 THEN RAISE EXCEPTION 'Seleção CARTAXO & VILLA deve conter os 13 processos informados';END IF;END $$;
