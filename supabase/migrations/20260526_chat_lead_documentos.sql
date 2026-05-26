-- ================================================================
-- CHAT AO VIVO - DOCUMENTOS DO CONTATO
-- ================================================================

CREATE TABLE IF NOT EXISTS public.chat_lead_documentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES public.leads_contabilidade(id) ON DELETE CASCADE,
  nome_original TEXT NOT NULL,
  mime_type TEXT NULL,
  tamanho_bytes BIGINT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  uploaded_by TEXT NULL,
  data_url TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_lead_documentos_lead_id
  ON public.chat_lead_documentos (lead_id, created_at DESC);
