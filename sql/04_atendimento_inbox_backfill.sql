-- ================================================================
-- BACKFILL INICIAL - INBOX CRM CERTIID
-- Cria conversas iniciais a partir de crm_customers ja existentes
-- Executar apenas uma vez, se quiser popular o painel imediatamente
-- ================================================================

INSERT INTO public.crm_chat_conversations (
  document_key,
  crm_customer_id,
  telefone,
  cliente_nome,
  whatsapp_instance,
  numero_receptor,
  fila,
  kanban_status,
  atendimento_humano,
  agente_nome,
  ultima_mensagem,
  ultima_mensagem_direcao,
  ultima_interacao_em,
  created_at,
  updated_at
)
SELECT
  cust.document_key,
  cust.id,
  COALESCE(cust.telefone_principal, cust.document_key) AS telefone,
  cust.nome,
  NULL AS whatsapp_instance,
  NULL AS numero_receptor,
  'atendimento' AS fila,
  CASE
    WHEN cust.contato_status IN ('iniciou_conversa','conversando','agendado','cliente','follow_up','cancelou_agendamento','perdido')
      THEN cust.contato_status
    ELSE 'conversando'
  END AS kanban_status,
  FALSE AS atendimento_humano,
  NULL AS agente_nome,
  LEFT(COALESCE(cust.observacoes, ''), 500) AS ultima_mensagem,
  CASE WHEN COALESCE(cust.observacoes, '') <> '' THEN 'outgoing' ELSE NULL END AS ultima_mensagem_direcao,
  COALESCE(cust.updated_at, cust.created_at, NOW()) AS ultima_interacao_em,
  COALESCE(cust.created_at, NOW()) AS created_at,
  COALESCE(cust.updated_at, NOW()) AS updated_at
FROM public.crm_customers cust
LEFT JOIN public.crm_chat_conversations conv
  ON conv.document_key = cust.document_key
WHERE cust.document_key IS NOT NULL
  AND conv.id IS NULL;
