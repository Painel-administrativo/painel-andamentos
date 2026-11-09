-- Only an explicit Twilio authentication refusal without a message SID releases
-- the recipient/publication slot. All uncertain or accepted sends stay blocked.
ALTER TABLE public.painel_whatsapp_envios DROP CONSTRAINT IF EXISTS painel_whatsapp_envios_publicacao_id_telefone_key;
CREATE UNIQUE INDEX painel_whatsapp_envios_envio_unico
ON public.painel_whatsapp_envios(publicacao_id,telefone)
WHERE NOT (provedor='twilio' AND status='falha' AND erro_codigo IS NOT DISTINCT FROM '20003' AND twilio_id IS NULL);
