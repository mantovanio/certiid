-- ================================================================
-- ATENDIMENTO INBOX + KANBAN - CRM CERTID
-- Executar no Supabase SQL Editor
-- Dependência: crm_customers já deve existir
-- ================================================================

-- ---------------------------------------------------------------
-- 1. CONVERSAS
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.crm_chat_conversations (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_key              TEXT NOT NULL,           -- whatsapp_lead (chave natural)
  crm_customer_id           UUID REFERENCES public.crm_customers(id) ON DELETE SET NULL,
  telefone                  TEXT,
  cliente_nome              TEXT,
  whatsapp_instance         TEXT,                    -- ex: 'CertiID', 'atendimento', 'renovacao'
  numero_receptor           TEXT,                    -- numero da instancia que recebeu
  fila                      TEXT NOT NULL DEFAULT 'atendimento'
                              CHECK (fila IN ('atendimento', 'renovacao')),
  kanban_status             TEXT NOT NULL DEFAULT 'conversando',
  atendimento_humano        BOOLEAN NOT NULL DEFAULT FALSE,
  agente_nome               TEXT,                    -- preenchido quando humano assume
  ultima_mensagem           TEXT,
  ultima_mensagem_direcao   TEXT CHECK (ultima_mensagem_direcao IN ('incoming', 'outgoing')),
  ultima_interacao_em       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crm_chat_conv_document_key
  ON public.crm_chat_conversations(document_key);

CREATE INDEX IF NOT EXISTS idx_crm_chat_conv_kanban
  ON public.crm_chat_conversations(kanban_status, fila);

CREATE INDEX IF NOT EXISTS idx_crm_chat_conv_interacao
  ON public.crm_chat_conversations(ultima_interacao_em DESC);

-- ---------------------------------------------------------------
-- 2. MENSAGENS
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.crm_chat_messages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  UUID NOT NULL REFERENCES public.crm_chat_conversations(id) ON DELETE CASCADE,
  document_key     TEXT NOT NULL,
  direction        TEXT NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
  sender_type      TEXT NOT NULL CHECK (sender_type IN ('cliente', 'ia', 'humano')),
  mensagem         TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crm_chat_msg_conv
  ON public.crm_chat_messages(conversation_id, created_at DESC);

-- ---------------------------------------------------------------
-- 3. ATRIBUIÇÃO DE AGENTE
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.crm_chat_assignments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  UUID NOT NULL REFERENCES public.crm_chat_conversations(id) ON DELETE CASCADE,
  agent_id         UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  agente_nome      TEXT,
  atribuido_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ativo            BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_crm_chat_assign_conv
  ON public.crm_chat_assignments(conversation_id) WHERE ativo = TRUE;

-- ---------------------------------------------------------------
-- 4. TRIGGER updated_at em conversas
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at_crm_chat_conversations()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS crm_chat_conv_updated_at ON public.crm_chat_conversations;
CREATE TRIGGER crm_chat_conv_updated_at
  BEFORE UPDATE ON public.crm_chat_conversations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_crm_chat_conversations();

-- ---------------------------------------------------------------
-- 5. VIEW ADMINISTRATIVA (painel ADM)
-- ---------------------------------------------------------------
CREATE OR REPLACE VIEW public.crm_chat_admin_view AS
SELECT
  conv.id,
  conv.document_key,
  conv.telefone,
  conv.cliente_nome,
  conv.whatsapp_instance,
  conv.numero_receptor,
  conv.fila,
  conv.kanban_status,
  conv.atendimento_humano,
  conv.agente_nome,
  conv.ultima_mensagem,
  conv.ultima_mensagem_direcao,
  conv.ultima_interacao_em,
  conv.created_at,
  -- dados do crm_customers
  cust.id               AS crm_customer_id,
  cust.nome             AS nome_crm,
  cust.email_principal,
  cust.cpf,
  cust.cnpj,
  cust.observacoes,
  cust.contato_status,
  -- agente ativo
  asgn.agente_nome      AS agente_atual,
  asgn.atribuido_em     AS agente_desde
FROM public.crm_chat_conversations conv
LEFT JOIN public.crm_customers cust
  ON cust.document_key = conv.document_key
LEFT JOIN public.crm_chat_assignments asgn
  ON asgn.conversation_id = conv.id AND asgn.ativo = TRUE
ORDER BY conv.ultima_interacao_em DESC;

-- ---------------------------------------------------------------
-- 6. RLS
-- ---------------------------------------------------------------
ALTER TABLE public.crm_chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_chat_messages      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_chat_assignments   ENABLE ROW LEVEL SECURITY;

-- Leitura: qualquer autenticado
CREATE POLICY "conv_select" ON public.crm_chat_conversations
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "msg_select" ON public.crm_chat_messages
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "assign_select" ON public.crm_chat_assignments
  FOR SELECT USING (auth.role() = 'authenticated');

-- Escrita: service_role (N8N usa service key, bypassa RLS automaticamente)
-- Nenhuma policy de escrita necessária para autenticados comuns
-- Admin pode escrever via política específica se necessário
