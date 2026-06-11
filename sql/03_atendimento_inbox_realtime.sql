-- ================================================================
-- REALTIME - INBOX CRM CERTIID
-- Executar no Supabase SQL Editor
-- ================================================================

ALTER publication supabase_realtime ADD TABLE public.crm_chat_conversations;
ALTER publication supabase_realtime ADD TABLE public.crm_chat_messages;
ALTER publication supabase_realtime ADD TABLE public.crm_chat_assignments;
ALTER publication supabase_realtime ADD TABLE public.crm_customers;
