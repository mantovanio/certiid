-- Extensão da tabela parceiros para gestão completa

ALTER TABLE public.parceiros
  ADD COLUMN IF NOT EXISTS codigo_parceiro TEXT,
  ADD COLUMN IF NOT EXISTS cpf_cnpj TEXT,
  ADD COLUMN IF NOT EXISTS razao_social TEXT,
  ADD COLUMN IF NOT EXISTS nome_fantasia TEXT,
  ADD COLUMN IF NOT EXISTS id_local_atendimento TEXT,
  ADD COLUMN IF NOT EXISTS senha_acesso TEXT,
  ADD COLUMN IF NOT EXISTS email_acesso TEXT,
  ADD COLUMN IF NOT EXISTS ddd TEXT,
  ADD COLUMN IF NOT EXISTS email_adicional_1 TEXT,
  ADD COLUMN IF NOT EXISTS email_adicional_2 TEXT,
  ADD COLUMN IF NOT EXISTS email_adicional_3 TEXT,
  ADD COLUMN IF NOT EXISTS cep TEXT,
  ADD COLUMN IF NOT EXISTS logradouro TEXT,
  ADD COLUMN IF NOT EXISTS numero TEXT,
  ADD COLUMN IF NOT EXISTS ibge TEXT,
  ADD COLUMN IF NOT EXISTS complemento TEXT,
  ADD COLUMN IF NOT EXISTS bairro TEXT,
  ADD COLUMN IF NOT EXISTS observacao TEXT,
  ADD COLUMN IF NOT EXISTS token TEXT,
  ADD COLUMN IF NOT EXISTS inscricao_municipal TEXT,
  ADD COLUMN IF NOT EXISTS inscricao_estadual TEXT,
  ADD COLUMN IF NOT EXISTS tipo_parceiro TEXT,
  ADD COLUMN IF NOT EXISTS data_ativacao DATE,
  ADD COLUMN IF NOT EXISTS data_desativacao DATE,
  ADD COLUMN IF NOT EXISTS bloquear_vendas_protocolos BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS nao_enviar_whatsapp_vendas BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS nao_enviar_email_vendas BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS nao_enviar_renovacao_clientes BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS nao_quero_receber_whatsapp BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS nao_quero_receber_email BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS gestor_1_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS gestor_2_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS gestor_3_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS gestor_4_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS gestor_5_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tipo_conta TEXT,
  ADD COLUMN IF NOT EXISTS banco_id UUID REFERENCES public.bancos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS agencia TEXT,
  ADD COLUMN IF NOT EXISTS agencia_digito TEXT,
  ADD COLUMN IF NOT EXISTS conta TEXT,
  ADD COLUMN IF NOT EXISTS conta_digito TEXT,
  ADD COLUMN IF NOT EXISTS operacao TEXT,
  ADD COLUMN IF NOT EXISTS cnpj_cpf_titular TEXT,
  ADD COLUMN IF NOT EXISTS titular_conta TEXT,
  ADD COLUMN IF NOT EXISTS chave_pix TEXT,
  ADD COLUMN IF NOT EXISTS centro_custo_id UUID REFERENCES public.centros_custos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE OR REPLACE FUNCTION public.set_updated_at_parceiros()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS parceiros_set_updated_at ON public.parceiros;
CREATE TRIGGER parceiros_set_updated_at
  BEFORE UPDATE ON public.parceiros
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at_parceiros();

CREATE INDEX IF NOT EXISTS idx_parceiros_cpf_cnpj ON public.parceiros(cpf_cnpj);
CREATE INDEX IF NOT EXISTS idx_parceiros_codigo_parceiro ON public.parceiros(codigo_parceiro);
CREATE INDEX IF NOT EXISTS idx_parceiros_tipo_parceiro ON public.parceiros(tipo_parceiro);
CREATE INDEX IF NOT EXISTS idx_parceiros_status ON public.parceiros(status);
