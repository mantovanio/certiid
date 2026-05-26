-- ================================================================
-- CHAT AO VIVO - RESPONSAVEL E TRANSFERENCIA DE CONVERSA
-- ================================================================

ALTER TABLE public.leads_contabilidade
  ADD COLUMN IF NOT EXISTS responsavel_profile_id UUID NULL,
  ADD COLUMN IF NOT EXISTS responsavel_nome TEXT NULL,
  ADD COLUMN IF NOT EXISTS transferido_em TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS transferido_por TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_contabilidade_responsavel_profile_id
  ON public.leads_contabilidade (responsavel_profile_id)
  WHERE responsavel_profile_id IS NOT NULL;
