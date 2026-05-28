-- LGPD Art. 18, IV — Direito ao esquecimento / exclusão de dados do titular

CREATE TABLE IF NOT EXISTS public.lgpd_solicitacoes_exclusao (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  motivo        TEXT,
  status        TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'aprovada', 'concluida', 'rejeitada')),
  solicitado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processado_em TIMESTAMPTZ,
  processado_por UUID REFERENCES auth.users(id),
  observacao    TEXT
);

ALTER TABLE public.lgpd_solicitacoes_exclusao ENABLE ROW LEVEL SECURITY;

-- Titular pode criar e ver sua própria solicitação
CREATE POLICY "titular_insert" ON public.lgpd_solicitacoes_exclusao
  FOR INSERT WITH CHECK (profile_id = auth.uid());

CREATE POLICY "titular_select" ON public.lgpd_solicitacoes_exclusao
  FOR SELECT USING (profile_id = auth.uid());

-- Admin pode ver e atualizar todas
CREATE POLICY "admin_all" ON public.lgpd_solicitacoes_exclusao
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND perfil = 'admin' AND status = 'ativo')
  );

-- Função de anonimização — chamada pelo admin após aprovação
CREATE OR REPLACE FUNCTION public.lgpd_anonimizar_titular(p_profile_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_hash TEXT := substring(md5(p_profile_id::text), 1, 12);
BEGIN
  -- Anonimiza dados do perfil
  UPDATE public.profiles SET
    nome        = 'DADO_EXCLUIDO',
    email       = 'excluido_' || v_hash || '@anonimizado.invalid',
    telefone    = NULL,
    updated_at  = NOW()
  WHERE id = p_profile_id;

  -- Anonimiza leads de responsabilidade do titular
  UPDATE public.leads_contabilidade SET
    nome_lead   = 'DADO_EXCLUIDO',
    telefone    = NULL,
    email       = NULL,
    updated_at  = NOW()
  WHERE responsavel_profile_id = p_profile_id;

  -- Marca solicitação como concluída
  UPDATE public.lgpd_solicitacoes_exclusao SET
    status        = 'concluida',
    processado_em = NOW()
  WHERE profile_id = p_profile_id AND status = 'aprovada';
END;
$$;
