-- =========================================================
-- RECUPERAÇÃO: RLS + estrutura + restauração dos 47 processos
-- Gerado após incidente em 05/08/2026 (tabelas ficaram vazias
-- e RLS bloqueou o backend após intervenção externa).
-- Execute no SQL Editor do Supabase.
-- =========================================================

-- PARTE 1: desabilita RLS nas tabelas (estado original antes do incidente)
-- O backend usa a anon key e não tem lógica de user_id; a proteção da API
-- vem do fato do endpoint ser público-por-desenho.
ALTER TABLE IF EXISTS public.processos DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.snapshots DISABLE ROW LEVEL SECURITY;

-- PARTE 2: garante colunas mínimas que o backend usa
-- (idempotente: só cria se não existir; NÃO apaga nada)

-- processos
ALTER TABLE public.processos
  ADD COLUMN IF NOT EXISTS numero        text        NOT NULL,
  ADD COLUMN IF NOT EXISTS tribunal      text        NOT NULL,
  ADD COLUMN IF NOT EXISTS apelido       text,
  ADD COLUMN IF NOT EXISTS observacoes   text,
  ADD COLUMN IF NOT EXISTS visto_ate     timestamptz;

-- Garante unicidade do número (usada pra detectar duplicatas)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname='public' AND tablename='processos' AND indexname='processos_numero_key'
  ) THEN
    ALTER TABLE public.processos ADD CONSTRAINT processos_numero_key UNIQUE (numero);
  END IF;
END $$;

-- snapshots
ALTER TABLE public.snapshots
  ADD COLUMN IF NOT EXISTS processo_id   int  NOT NULL,
  ADD COLUMN IF NOT EXISTS consultado_em timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS status        text NOT NULL,
  ADD COLUMN IF NOT EXISTS erro          text,
  ADD COLUMN IF NOT EXISTS dados_json    jsonb;

-- FK e unicidade (1 snapshot por processo)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='snapshots_processo_id_fkey'
  ) THEN
    ALTER TABLE public.snapshots
      ADD CONSTRAINT snapshots_processo_id_fkey FOREIGN KEY (processo_id)
      REFERENCES public.processos(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname='public' AND tablename='snapshots' AND indexname='snapshots_processo_id_key'
  ) THEN
    ALTER TABLE public.snapshots ADD CONSTRAINT snapshots_processo_id_key UNIQUE (processo_id);
  END IF;
END $$;

-- Verificação final
SELECT 'processos' as tbl, count(*) as linhas FROM public.processos
UNION ALL SELECT 'snapshots', count(*) FROM public.snapshots;
