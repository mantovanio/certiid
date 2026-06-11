-- ================================================================
-- POLITICAS DE ESCRITA - INBOX CRM CERTIID
-- Executar no Supabase SQL Editor apos 01_atendimento_inbox_kanban.sql
-- ================================================================

ALTER TABLE public.crm_chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_chat_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "conv_update_authenticated" ON public.crm_chat_conversations;
CREATE POLICY "conv_update_authenticated"
ON public.crm_chat_conversations
FOR UPDATE
USING (auth.role() = 'authenticated')
WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "conv_insert_authenticated" ON public.crm_chat_conversations;
CREATE POLICY "conv_insert_authenticated"
ON public.crm_chat_conversations
FOR INSERT
WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "msg_insert_authenticated" ON public.crm_chat_messages;
CREATE POLICY "msg_insert_authenticated"
ON public.crm_chat_messages
FOR INSERT
WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "assign_insert_authenticated" ON public.crm_chat_assignments;
CREATE POLICY "assign_insert_authenticated"
ON public.crm_chat_assignments
FOR INSERT
WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "assign_update_authenticated" ON public.crm_chat_assignments;
CREATE POLICY "assign_update_authenticated"
ON public.crm_chat_assignments
FOR UPDATE
USING (auth.role() = 'authenticated')
WITH CHECK (auth.role() = 'authenticated');
