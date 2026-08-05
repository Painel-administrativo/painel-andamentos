-- Se os 47 processos estão intactos no Supabase (Arilson confirmou),
-- o problema é apenas RLS bloqueando a anon key.
-- Este SQL desliga RLS nas 3 tabelas envolvidas e volta ao estado original.
-- Execute no SQL Editor do Supabase.

ALTER TABLE public.processos DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.snapshots DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.clientes  DISABLE ROW LEVEL SECURITY;

-- Verificação: quantas linhas o anon consegue ver depois
SELECT 'processos' as tbl, count(*) FROM public.processos
UNION ALL SELECT 'snapshots', count(*) FROM public.snapshots
UNION ALL SELECT 'clientes',  count(*) FROM public.clientes;
