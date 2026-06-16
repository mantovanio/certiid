-- ================================================================
-- CRM CHAT MESSAGES - METADADOS DE MIDIA
-- ================================================================

ALTER TABLE public.crm_chat_messages
  ADD COLUMN IF NOT EXISTS mime_type TEXT,
  ADD COLUMN IF NOT EXISTS file_name TEXT,
  ADD COLUMN IF NOT EXISTS media_url TEXT;

CREATE INDEX IF NOT EXISTS idx_crm_chat_msg_mime
  ON public.crm_chat_messages(mime_type);
