ALTER TABLE public.painel_whatsapp_envios ADD COLUMN provedor text NOT NULL DEFAULT 'meta' CHECK (provedor IN ('meta','twilio'));
ALTER TABLE public.painel_whatsapp_envios ADD COLUMN twilio_id text UNIQUE;
ALTER TABLE public.painel_whatsapp_envios ADD COLUMN provider_account_sid text;
ALTER TABLE public.painel_whatsapp_envios ADD CONSTRAINT painel_whatsapp_twilio_conta CHECK (provedor<>'twilio' OR (provider_account_sid IS NOT NULL AND provider_account_sid ~ '^AC[0-9a-fA-F]{32}$'));
-- Existing rows retain provider=meta. Existing unique(publicacao_id,telefone)
-- continues to prevent duplicate sends across providers, including uncertain ones.
