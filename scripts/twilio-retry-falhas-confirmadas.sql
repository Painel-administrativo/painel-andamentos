-- Replace the previous authentication-only exception; keep every attempt.
ALTER TABLE public.painel_whatsapp_envios DROP CONSTRAINT IF EXISTS painel_whatsapp_envios_publicacao_id_telefone_key;
DROP INDEX IF EXISTS public.painel_whatsapp_envios_envio_unico;
CREATE UNIQUE INDEX painel_whatsapp_envios_envio_unico
ON public.painel_whatsapp_envios(publicacao_id,telefone)
WHERE NOT (provedor='twilio' AND status='falha' AND COALESCE(
 (erro_codigo IN ('20003','63007') AND twilio_id IS NULL) OR erro_codigo='63016',false));
