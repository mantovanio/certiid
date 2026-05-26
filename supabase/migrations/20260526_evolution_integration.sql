-- ================================================================
-- EVOLUTION API INTEGRATION
-- Migra mensageria do Chatwoot para Evolution API direta
-- ================================================================

-- ── external_integrations ────────────────────────────────────────
-- Remove UNIQUE de provider (para suportar múltiplas instâncias Evolution)
ALTER TABLE public.external_integrations
  DROP CONSTRAINT IF EXISTS external_integrations_provider_key;

-- Remove CHECK antigo e adiciona novo com 'evolution' e 'chatwoot_disparo'
ALTER TABLE public.external_integrations
  DROP CONSTRAINT IF EXISTS external_integrations_provider_check;

ALTER TABLE public.external_integrations
  ADD CONSTRAINT external_integrations_provider_check
  CHECK (provider IN (
    'chatwoot', 'chatwoot_disparo', 'email_smtp', 'n8n',
    'gestao_ar', 'safe2pay', 'safeweb', 'supabase', 'evolution'
  ));

-- Coluna para armazenar o nome da instância Evolution
ALTER TABLE public.external_integrations
  ADD COLUMN IF NOT EXISTS instance_name TEXT;

-- ── leads_contabilidade ──────────────────────────────────────────
-- JID do WhatsApp: ex. 5511999999999@s.whatsapp.net
ALTER TABLE public.leads_contabilidade
  ADD COLUMN IF NOT EXISTS evolution_remote_jid TEXT;

-- Qual instância Evolution atende este lead
ALTER TABLE public.leads_contabilidade
  ADD COLUMN IF NOT EXISTS evolution_instance TEXT;

-- Índice para busca por JID (webhook de entrada precisa localizar o lead rapidamente)
CREATE INDEX IF NOT EXISTS idx_leads_evolution_remote_jid
  ON public.leads_contabilidade (evolution_remote_jid)
  WHERE evolution_remote_jid IS NOT NULL;

-- ── communication_outbox ─────────────────────────────────────────
-- Adiciona 'evolution' e 'chatwoot_disparo' como providers válidos
ALTER TABLE public.communication_outbox
  DROP CONSTRAINT IF EXISTS communication_outbox_provider_check;

ALTER TABLE public.communication_outbox
  ADD CONSTRAINT communication_outbox_provider_check
  CHECK (provider IN ('chatwoot', 'chatwoot_disparo', 'email_smtp', 'n8n', 'evolution'));

-- ── Registro inicial da integração Evolution ─────────────────────
INSERT INTO public.external_integrations
  (provider, name, description, status, metadata)
VALUES
  ('evolution', 'Evolution API / WhatsApp', 'Mensageria WhatsApp direta via Evolution API', 'pendente', '{"docs":"https://doc.evolution-api.com"}'::jsonb)
ON CONFLICT DO NOTHING;
