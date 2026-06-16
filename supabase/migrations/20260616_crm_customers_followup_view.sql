CREATE OR REPLACE VIEW "public"."crm_customers_followup_view" AS
WITH latest_conversation AS (
    SELECT DISTINCT ON (conv.document_key)
        conv.document_key,
        conv.id AS crm_chat_conversation_id,
        conv.crm_conversation_id,
        conv.crm_contact_id,
        conv.whatsapp_instance,
        conv.numero_receptor,
        conv.ultima_interacao_em,
        conv.updated_at,
        conv.created_at
    FROM public.crm_chat_conversations conv
    WHERE conv.document_key IS NOT NULL
      AND conv.document_key <> ''
    ORDER BY
        conv.document_key,
        conv.ultima_interacao_em DESC NULLS LAST,
        conv.updated_at DESC,
        conv.created_at DESC
)
SELECT
    cust.id,
    cust.document_key,
    cust.participant_id,
    cust.participant_nome,
    cust.nome,
    cust.email_principal,
    cust.telefone_principal,
    cust.cpf,
    cust.cnpj,
    cust.razao_social,
    cust.agente,
    cust.ar,
    cust.ponto_atendimento,
    cust.contato_status,
    cust.observacoes,
    cust.proximo_contato_em,
    cust.follow_up_1,
    cust.follow_up_2,
    cust.follow_up_3,
    cust.created_at,
    cust.updated_at,
    lc.crm_chat_conversation_id,
    lc.crm_conversation_id,
    lc.crm_contact_id,
    lc.whatsapp_instance,
    lc.whatsapp_instance AS canal_origem,
    lc.numero_receptor,
    COALESCE(lc.ultima_interacao_em, cust.updated_at, cust.created_at) AS ultima_interacao_em,
    GREATEST(
        0,
        FLOOR(
            EXTRACT(
                EPOCH FROM (NOW() - COALESCE(lc.ultima_interacao_em, cust.updated_at, cust.created_at))
            ) / 60
        )
    )::int AS minutos_ultima_mensagem_base
FROM public.crm_customers cust
LEFT JOIN latest_conversation lc
       ON lc.document_key = cust.document_key;
