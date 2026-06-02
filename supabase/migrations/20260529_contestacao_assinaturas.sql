CREATE TABLE IF NOT EXISTS public.contestacao_documentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  public_token TEXT NOT NULL UNIQUE,
  titulo TEXT NOT NULL,
  descricao TEXT NULL,
  pdf_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'assinando'
    CHECK (status IN ('rascunho', 'assinando', 'concluido', 'cancelado')),
  provedor_assinatura TEXT NULL,
  assinatura_base_url TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.contestacao_signatarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  documento_id UUID NOT NULL REFERENCES public.contestacao_documentos(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  email TEXT NOT NULL,
  cargo TEXT NULL,
  status TEXT NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente', 'enviado', 'assinado', 'recusado', 'expirado')),
  ordem INTEGER NOT NULL DEFAULT 1,
  assinatura_url TEXT NULL,
  certificado_subject TEXT NULL,
  certificado_serial TEXT NULL,
  assinado_em TIMESTAMPTZ NULL,
  observacoes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT contestacao_signatarios_documento_email_key UNIQUE (documento_id, email)
);

CREATE INDEX IF NOT EXISTS idx_contestacao_documentos_status
  ON public.contestacao_documentos(status);

CREATE INDEX IF NOT EXISTS idx_contestacao_documentos_public_token
  ON public.contestacao_documentos(public_token);

CREATE INDEX IF NOT EXISTS idx_contestacao_signatarios_documento
  ON public.contestacao_signatarios(documento_id, ordem, created_at);

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_contestacao_documentos_updated_at ON public.contestacao_documentos;
CREATE TRIGGER trg_contestacao_documentos_updated_at
  BEFORE UPDATE ON public.contestacao_documentos
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_contestacao_signatarios_updated_at ON public.contestacao_signatarios;
CREATE TRIGGER trg_contestacao_signatarios_updated_at
  BEFORE UPDATE ON public.contestacao_signatarios
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.contestacao_documentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contestacao_signatarios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "contestacao_documentos_admin_write" ON public.contestacao_documentos;
CREATE POLICY "contestacao_documentos_admin_write"
  ON public.contestacao_documentos
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE id = auth.uid()
        AND perfil = 'admin'
        AND status = 'ativo'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE id = auth.uid()
        AND perfil = 'admin'
        AND status = 'ativo'
    )
  );

DROP POLICY IF EXISTS "contestacao_signatarios_admin_write" ON public.contestacao_signatarios;
CREATE POLICY "contestacao_signatarios_admin_write"
  ON public.contestacao_signatarios
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE id = auth.uid()
        AND perfil = 'admin'
        AND status = 'ativo'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE id = auth.uid()
        AND perfil = 'admin'
        AND status = 'ativo'
    )
  );

COMMENT ON TABLE public.contestacao_documentos IS 'Controle público de documentos de contestação publicados para assinatura digital.';
COMMENT ON TABLE public.contestacao_signatarios IS 'Lista de participantes e status de assinatura do documento de contestação.';
