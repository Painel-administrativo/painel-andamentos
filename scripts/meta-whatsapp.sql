CREATE TABLE public.painel_whatsapp_envios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  publicacao_id integer NOT NULL REFERENCES public.publicacoes(id) ON DELETE RESTRICT,
  nome text NOT NULL,
  telefone text NOT NULL CHECK (telefone ~ '^[1-9][0-9]{7,14}$'),
  texto text NOT NULL,
  template text NOT NULL,
  phone_number_id text NOT NULL,
  consentimento_em timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'reservada' CHECK (status IN ('reservada','aceita','enviada','entregue','lida','falha','incerto')),
  status_ordem integer NOT NULL DEFAULT 0 CHECK (status_ordem BETWEEN 0 AND 5),
  meta_id text UNIQUE,
  erro_codigo text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE(publicacao_id,telefone)
);
ALTER TABLE public.painel_whatsapp_envios ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.painel_whatsapp_envios FROM anon, authenticated;
