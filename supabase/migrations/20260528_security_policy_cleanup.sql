-- Remove políticas antigas permissivas após o hardening inicial

DROP POLICY IF EXISTS leads_public ON public.leads_contabilidade;
DROP POLICY IF EXISTS cadastros_base_select ON public.cadastros_base;
DROP POLICY IF EXISTS chat_kanban_columns_select ON public.chat_kanban_columns;
DROP POLICY IF EXISTS "autenticado lê" ON public.chat_kanban_columns;
