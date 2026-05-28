-- Hardening inicial de RLS para tabelas críticas do CRM

ALTER TABLE IF EXISTS public.chat_kanban_columns ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.leads_contabilidade ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.cadastros_base ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chat_kanban_columns_select_auth ON public.chat_kanban_columns;
CREATE POLICY chat_kanban_columns_select_auth
ON public.chat_kanban_columns
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND status = 'ativo'
  )
);

DROP POLICY IF EXISTS chat_kanban_columns_write_admin ON public.chat_kanban_columns;
CREATE POLICY chat_kanban_columns_write_admin
ON public.chat_kanban_columns
FOR ALL
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND status = 'ativo'
      AND perfil = 'admin'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND status = 'ativo'
      AND perfil = 'admin'
  )
);

DROP POLICY IF EXISTS leads_contabilidade_select_auth ON public.leads_contabilidade;
CREATE POLICY leads_contabilidade_select_auth
ON public.leads_contabilidade
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND status = 'ativo'
  )
);

DROP POLICY IF EXISTS leads_contabilidade_write_owner_or_admin ON public.leads_contabilidade;
CREATE POLICY leads_contabilidade_write_owner_or_admin
ON public.leads_contabilidade
FOR ALL
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND status = 'ativo'
      AND (
        perfil = 'admin'
        OR responsavel_profile_id IS NULL
        OR responsavel_profile_id = auth.uid()
      )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND status = 'ativo'
      AND (
        perfil = 'admin'
        OR responsavel_profile_id IS NULL
        OR responsavel_profile_id = auth.uid()
      )
  )
);

DROP POLICY IF EXISTS cadastros_base_select_auth ON public.cadastros_base;
CREATE POLICY cadastros_base_select_auth
ON public.cadastros_base
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND status = 'ativo'
  )
);

DROP POLICY IF EXISTS cadastros_base_write_auth ON public.cadastros_base;
CREATE POLICY cadastros_base_write_auth
ON public.cadastros_base
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND status = 'ativo'
  )
);

DROP POLICY IF EXISTS cadastros_base_update_auth ON public.cadastros_base;
CREATE POLICY cadastros_base_update_auth
ON public.cadastros_base
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND status = 'ativo'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND status = 'ativo'
  )
);

DROP POLICY IF EXISTS cadastros_base_delete_admin ON public.cadastros_base;
CREATE POLICY cadastros_base_delete_admin
ON public.cadastros_base
FOR DELETE
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND status = 'ativo'
      AND perfil = 'admin'
  )
);
