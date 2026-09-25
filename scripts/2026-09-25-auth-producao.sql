-- Migration reference. Already applied to production through Supabase migrations.
-- Do not rerun without first checking the migration history.
CREATE TABLE public.painel_auth_sessions (
  id_hash text PRIMARY KEY CHECK (length(id_hash)=64),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX painel_auth_sessions_expiry_idx ON public.painel_auth_sessions(expires_at);
ALTER TABLE public.painel_auth_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.painel_auth_sessions FROM PUBLIC, anon, authenticated;

CREATE TABLE public.painel_auth_rate_limits (
  kind text NOT NULL,
  bucket timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  PRIMARY KEY (kind,bucket)
);
ALTER TABLE public.painel_auth_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.painel_auth_rate_limits FROM PUBLIC, anon, authenticated;

REVOKE ALL ON public.processos, public.snapshots, public.publicacoes,
  public.processos_backup_20260804, public.snapshots_backup_20260804
  FROM PUBLIC, anon, authenticated;
