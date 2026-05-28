// @ts-nocheck — Deno runtime (Supabase Edge Functions), não Node.js
import { CORS, SERVICE_KEY, SUPABASE_URL, json, unauthorizedWebhookResponse, verifyWebhookRequest } from '../_shared/security.ts'

const DB = {
  'apikey':        SERVICE_KEY,
  'Authorization': `Bearer ${SERVICE_KEY}`,
  'Content-Type':  'application/json',
}

async function dbInsert(table: string, row: unknown) {
  return fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method:  'POST',
    headers: { ...DB, 'Prefer': 'return=minimal' },
    body:    JSON.stringify(row),
  })
}

async function dbPatch(table: string, filter: string, body: unknown) {
  return fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    method:  'PATCH',
    headers: { ...DB, 'Prefer': 'return=minimal' },
    body:    JSON.stringify(body),
  })
}

async function dbSelect(table: string, query: string) {
  return fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    method: 'GET',
    headers: DB,
  })
}

function formatTipoEmissaoLabel(value: string | null | undefined) {
  switch ((value ?? '').toLowerCase()) {
    case 'videoconferencia':
      return 'Videoconferencia'
    case 'auto_atendimento':
      return 'Autoatendimento'
    case 'presencial':
      return 'Presencial'
    case 'online':
      return 'Online'
    default:
      return value ?? ''
  }
}

function buildDiscriminacaoServicos(venda: Record<string, unknown> | null, lanc: Record<string, unknown>) {
  if (venda) {
    const produto = String(venda.tipo_produto ?? 'certificado digital')
    const linhas = [`Servico de validacao e emissao de ${produto}.`]
    const tipoEmissao = formatTipoEmissaoLabel(String(venda.tipo_emissao ?? ''))
    if (tipoEmissao) linhas.push(`Modalidade de atendimento: ${tipoEmissao}.`)
    const identificacao = String(venda.protocolo_numero ?? venda.pedido_numero ?? '')
    if (identificacao) linhas.push(`Identificacao do atendimento: ${identificacao}.`)
    const observacoes = String(venda.observacoes ?? '').trim()
    if (observacoes) linhas.push(`Observacoes complementares: ${observacoes}.`)
    return linhas.join('\n')
  }

  const descricaoLanc = String(lanc.descricao ?? '').trim()
  return descricaoLanc
    ? `Servico faturado: ${descricaoLanc}.`
    : 'Servico faturado conforme lancamento financeiro registrado.'
}

// Safe2Pay status codes → internal status
const STATUS_MAP: Record<string, string> = {
  '1': 'processando',  // PENDING (Aguardando pagamento)
  '2': 'pago',         // APPROVED (Pago / Aprovado)
  '3': 'cancelado',    // CANCELLED (Cancelado)
  '4': 'erro',         // REJECTED (Rejeitado)
  'paid': 'pago',
  'confirmed': 'pago',
  'cancelled': 'cancelado',
  'failed': 'erro',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS })
  }
  if (req.method !== 'POST') {
    return json({ error: 'Método não permitido' }, 405, req)
  }

  const rawBody = await req.text()
  const webhookSecret =
    Deno.env.get('PAYMENT_WEBHOOK_SECRET')
    ?? Deno.env.get('SAFE2PAY_WEBHOOK_SECRET')
    ?? ''

  const webhookOk = await verifyWebhookRequest(req, {
    secret: webhookSecret,
    rawBody,
    tokenHeaders: ['x-webhook-token', 'x-safe2pay-token', 'authorization'],
    signatureHeaders: ['x-signature', 'x-safe2pay-signature'],
    queryParams: ['token', 'signature'],
  })

  if (!webhookOk) {
    return unauthorizedWebhookResponse(req)
  }

  let payload: Record<string, unknown> = {}
  try {
    payload = rawBody ? JSON.parse(rawBody) : {}
  } catch {
    return json({ error: 'Payload inválido' }, 400, req)
  }

  // Responde imediatamente para evitar timeout do gateway
  const gateway    = (req.headers.get('x-gateway') ?? payload['gateway'] ?? 'unknown') as string
  const evento     = (payload['evento'] ?? payload['event'] ?? payload['EventType'] ?? 'notification') as string
  const externalId = (payload['TransactionId'] ?? payload['transaction_id'] ?? payload['id'] ?? null) as string | null
  const rawStatus  = String(payload['Status'] ?? payload['status'] ?? '')

  // Log do webhook
  await dbInsert('webhook_log', {
    gateway,
    evento,
    payload,
    status:      'recebido',
    external_id: externalId,
  })

  // Atualiza ordem de pagamento se houver external_id e mapeamento de status
  if (externalId) {
    const newStatus = STATUS_MAP[rawStatus] ?? null
    if (newStatus) {
      await dbPatch(
        'ordens_pagamento',
        `external_payment_id=eq.${encodeURIComponent(externalId)}`,
        { status_integracao: newStatus, processado_em: new Date().toISOString() }
      )

      // Se pago, atualiza também o campo de cobrança no lançamento
      if (newStatus === 'pago') {
        // 1. Atualiza o lançamento financeiro por ID externo de cobrança
        await dbPatch(
          'lancamentos_financeiros',
          `cobranca_id_externo=eq.${encodeURIComponent(externalId)}`,
          { status: 'recebido' }
        )

        // 2. Busca informações do lançamento financeiro para gerar a NFS-e mock
        try {
          const queryUrl = `${SUPABASE_URL}/rest/v1/lancamentos_financeiros?cobranca_id_externo=eq.${encodeURIComponent(externalId)}`
          const response = await fetch(queryUrl, { headers: DB })
          if (response.ok) {
            const list = await response.json()
            if (list && list.length > 0) {
              const lanc = list[0]
              
              // Se tiver venda associada, gera NFS-e mock automática
              if (lanc.venda_certificado_id) {
                const numeroMock = 'MOCK-' + Math.random().toString(36).substring(2, 9).toUpperCase()
                let venda: Record<string, unknown> | null = null
                try {
                  const vendaRes = await dbSelect(
                    'vendas_certificados',
                    `id=eq.${encodeURIComponent(lanc.venda_certificado_id)}&select=id,tipo_produto,tipo_emissao,pedido_numero,protocolo_numero,observacoes,documento_faturamento,nome_faturamento,email_faturamento,telefone_faturamento,logradouro,numero,complemento,bairro,cidade,uf,cep,inscricao_municipal,valor_venda,iss_retido`
                  )
                  if (vendaRes.ok) {
                    const vendas = await vendaRes.json()
                    venda = vendas?.[0] ?? null
                  }
                } catch (vendaError) {
                  console.error('Erro ao buscar venda para NFS-e mock:', vendaError)
                }

                const discriminacaoServicos = buildDiscriminacaoServicos(venda, lanc)
                const tomador = venda
                  ? {
                      nome: venda.nome_faturamento ?? '',
                      documento: venda.documento_faturamento ?? '',
                      inscricao_municipal: venda.inscricao_municipal ?? '',
                      telefone: venda.telefone_faturamento ?? '',
                      email: venda.email_faturamento ?? '',
                      endereco: [venda.logradouro, venda.numero, venda.bairro, venda.cep ? `CEP ${venda.cep}` : ''].filter(Boolean).join(', '),
                      complemento: venda.complemento ?? '',
                      municipio: [venda.cidade, venda.uf].filter(Boolean).join(' - '),
                    }
                  : {}

                await dbInsert('nfse_emitidas', {
                  lancamento_financeiro_id: lanc.id,
                  cadastro_base_tomador_id: lanc.cadastro_base_id,
                  venda_certificado_id:     lanc.venda_certificado_id,
                  numero_nf:                numeroMock,
                  status_nf:                'pendente',
                  data_emissao:             new Date().toISOString(),
                  valor_servico:            lanc.valor ?? 0,
                  payload_envio:            {
                    origin: 'payment-webhook',
                    type: 'auto-mock',
                    discriminacao_servicos: discriminacaoServicos,
                    tomador,
                  },
                  payload_retorno:          { success: true },
                  metadata:                 {
                    modo: 'auto-mock-webhook',
                    discriminacao_servicos: discriminacaoServicos,
                  }
                })
              }
            }
          }
        } catch (e) {
          console.error('Erro ao gerar NFS-e mock no webhook:', e)
        }
      }
    }
  }

  return json({ received: true }, 200, req)
})
