-- ================================================================
-- BACKFILL CHATWOOT -> CRM INBOX
-- Executar uma vez no Supabase SQL Editor
-- Objetivo: trazer conversas e mensagens já existentes no Chatwoot
-- para o ledger do CRM sem desativar o Chatwoot.
-- ================================================================

WITH chatwoot_leads AS (
  SELECT
    l.id,
    l.id_conversa_chatwoot,
    l.nome_lead,
    l.whatsapp_lead,
    l.status,
    l.resumo_conversa,
    l.created_at,
    l.updated_at,
    regexp_replace(COALESCE(l.whatsapp_lead, ''), '\D', '', 'g') AS document_key
  FROM public.leads_contabilidade l
  WHERE l.id_conversa_chatwoot IS NOT NULL
    AND COALESCE(l.whatsapp_lead, '') <> ''
),
existing_conversations AS (
  SELECT
    conv.id,
    conv.document_key,
    lead.id AS lead_id,
    lead.id_conversa_chatwoot,
    lead.nome_lead,
    lead.whatsapp_lead,
    lead.status,
    lead.resumo_conversa,
    lead.created_at AS lead_created_at,
    lead.updated_at AS lead_updated_at
  FROM chatwoot_leads lead
  LEFT JOIN public.crm_chat_conversations conv
    ON conv.document_key = lead.document_key
),
inserted_conversations AS (
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
    e.document_key,
    NULL,
    e.whatsapp_lead,
    e.nome_lead,
    'chatwoot',
    'chatwoot',
    'atendimento',
    CASE
      WHEN e.status IN ('iniciou_conversa', 'conversando', 'agendado', 'cliente', 'follow_up', 'cancelou_agendamento', 'perdido')
        THEN e.status
      ELSE 'conversando'
    END,
    FALSE,
    NULL,
    LEFT(COALESCE(e.resumo_conversa, ''), 500),
    CASE WHEN COALESCE(e.resumo_conversa, '') <> '' THEN 'incoming' ELSE NULL END,
    COALESCE(e.lead_updated_at, e.lead_created_at, NOW()),
    COALESCE(e.lead_created_at, NOW()),
    COALESCE(e.lead_updated_at, NOW())
  FROM existing_conversations e
  WHERE e.id IS NULL
    AND e.document_key <> ''
  RETURNING id, document_key
)
UPDATE public.crm_chat_conversations conv
SET
  cliente_nome = COALESCE(lead.nome_lead, conv.cliente_nome),
  telefone = COALESCE(lead.whatsapp_lead, conv.telefone),
  whatsapp_instance = COALESCE(conv.whatsapp_instance, 'chatwoot'),
  numero_receptor = COALESCE(conv.numero_receptor, 'chatwoot'),
  fila = 'atendimento',
  kanban_status = CASE
    WHEN lead.status IN ('iniciou_conversa', 'conversando', 'agendado', 'cliente', 'follow_up', 'cancelou_agendamento', 'perdido')
      THEN lead.status
    ELSE COALESCE(conv.kanban_status, 'conversando')
  END,
  ultima_mensagem = COALESCE(lead.resumo_conversa, conv.ultima_mensagem),
  ultima_interacao_em = COALESCE(lead.lead_updated_at, lead.lead_created_at, conv.ultima_interacao_em),
  updated_at = NOW()
FROM existing_conversations lead
WHERE conv.document_key = lead.document_key;

INSERT INTO public.crm_chat_messages (
  conversation_id,
  document_key,
  direction,
  sender_type,
  sender_name,
  mensagem,
  mime_type,
  file_name,
  media_url,
  created_at
)
SELECT
  conv.id,
  conv.document_key,
  CASE
    WHEN COALESCE((ce.payload->'data'->>'message_type')::int, (ce.payload->>'message_type')::int, 0) = 1 THEN 'outgoing'
    ELSE 'incoming'
  END AS direction,
  CASE
    WHEN COALESCE((ce.payload->'data'->>'message_type')::int, (ce.payload->>'message_type')::int, 0) = 1 THEN 'humano'
    ELSE 'cliente'
  END AS sender_type,
  COALESCE(
    ce.payload->'data'->'sender'->>'name',
    ce.payload->'data'->>'sender_name',
    lead.nome_lead,
    CASE
      WHEN COALESCE((ce.payload->'data'->>'message_type')::int, (ce.payload->>'message_type')::int, 0) = 1 THEN 'Atendente'
      ELSE 'Cliente'
    END
  ) AS sender_name,
  COALESCE(
    ce.payload->'data'->>'content',
    ce.payload->>'content',
    ce.payload->'data'->'attachments'->0->>'file_name'
  ) AS mensagem,
  COALESCE(
    ce.payload->'data'->'attachments'->0->>'file_type',
    ce.payload->'data'->>'mimeType'
  ) AS mime_type,
  COALESCE(
    ce.payload->'data'->'attachments'->0->>'file_name',
    ce.payload->'data'->>'fileName'
  ) AS file_name,
  COALESCE(
    ce.payload->'data'->'attachments'->0->>'download_url',
    ce.payload->'data'->'attachments'->0->>'data_url'
  ) AS media_url,
  COALESCE(ce.created_at, lead.lead_updated_at, NOW()) AS created_at
FROM public.communication_events ce
JOIN existing_conversations lead
  ON ce.conversation_id = lead.id_conversa_chatwoot
JOIN public.crm_chat_conversations conv
  ON conv.document_key = lead.document_key
WHERE ce.source = 'chatwoot'
  AND ce.event_type = 'message_created'
  AND COALESCE(
    ce.payload->'data'->>'content',
    ce.payload->>'content',
    ce.payload->'data'->'attachments'->0->>'file_name'
  ) IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.crm_chat_messages msg
    WHERE msg.conversation_id = conv.id
      AND msg.created_at = COALESCE(ce.created_at, lead.lead_updated_at, NOW())
      AND COALESCE(msg.mensagem, '') = COALESCE(
        ce.payload->'data'->>'content',
        ce.payload->>'content',
        ce.payload->'data'->'attachments'->0->>'file_name'
      )
  );
