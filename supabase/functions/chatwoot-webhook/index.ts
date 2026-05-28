// @ts-nocheck — Deno runtime (Supabase Edge Functions), não Node.js
import { CORS, SERVICE_KEY, SUPABASE_URL, requireAuthenticatedUser, unauthorizedWebhookResponse, verifyWebhookRequest } from '../_shared/security.ts'

const DB = {
  'apikey':        SERVICE_KEY,
  'Authorization': `Bearer ${SERVICE_KEY}`,
  'Content-Type':  'application/json',
}

const STATUS_MAP: Record<string, string> = {
  open: 'conversando', pending: 'iniciou_conversa', resolved: 'cliente', snoozed: 'follow_up',
}

// ── DB helpers ────────────────────────────────────────────────────────────────

async function dbUpsert(table: string, rows: unknown[]) {
  return fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method:  'POST',
    headers: { ...DB, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
    body:    JSON.stringify(rows),
  })
}

async function dbPatch(table: string, filter: string, body: unknown) {
  return fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    method:  'PATCH',
    headers: { ...DB, 'Prefer': 'return=minimal' },
    body:    JSON.stringify(body),
  })
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizePhone(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 0) return undefined
  if (digits.startsWith('55') && digits.length >= 12) return `+${digits}`
  if (digits.length === 10 || digits.length === 11) return `+55${digits}`
  return `+${digits}`
}

function tsToISO(ts: unknown): string | null {
  if (!ts) return null
  if (typeof ts === 'string') return ts
  if (typeof ts === 'number') return new Date(ts * 1000).toISOString()
  return null
}

function firstMessage(conv: Record<string, unknown>): string | null {
  const msgs = (conv.messages as Array<Record<string, unknown>> | undefined) ?? []
  const first = msgs.find(m => m.message_type === 0 && m.content)
  return (first?.content as string | undefined) ?? null
}

function buildLead(conv: Record<string, unknown>, isNew: boolean) {
  const meta   = conv.meta   as Record<string, unknown> | undefined
  const sender = meta?.sender as Record<string, unknown> | undefined
  const attrs  = conv.additional_attributes as Record<string, unknown> | undefined
  const resumo = firstMessage(conv) ?? (attrs?.mail_subject as string | undefined) ?? null

  const base = {
    id_conversa_chatwoot: String(conv.id),
    id_conta_chatwoot:    String(conv.account_id),
    id_lead_chatwoot:     sender?.id ? String(sender.id) : null,
    inbox_id_chatwoot:    String(conv.inbox_id),
    nome_lead:            (sender?.name         as string | undefined) ?? null,
    whatsapp_lead:        (sender?.phone_number as string | undefined) ?? null,
    motivo_contato:       (attrs?.mail_subject  as string | undefined) ?? null,
    status:               STATUS_MAP[(conv.status as string) ?? 'open'] ?? 'conversando',
    ultima_mensagem:      tsToISO(conv.last_activity_at),
  }

  if (isNew) {
    return {
      ...base,
      inicio_atendimento: tsToISO(conv.created_at) ?? new Date().toISOString(),
      resumo_conversa:    resumo,
    }
  }
  return base
}

// ── Proxy: test Chatwoot connection ───────────────────────────────────────────

async function actionTestConnection(p: Record<string, unknown>) {
  const base  = (p.base_url  as string | undefined)?.replace(/\/$/, '')
  const token = p.api_token as string | undefined
  if (!base || !token) return { ok: false, error: 'base_url e api_token são obrigatórios' }
  try {
    const res = await fetch(`${base}/api/v1/profile`, {
      headers: { 'api_access_token': token },
      signal:  AbortSignal.timeout(8000),
    })
    if (res.ok) {
      const profile = await res.json() as Record<string, unknown>
      return { ok: true, name: profile.name ?? 'conectado' }
    }
    return { ok: false, error: `HTTP ${res.status}` }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

// ── Proxy: sync all open/pending conversations → leads ────────────────────────

async function actionSyncConversations(p: Record<string, unknown>) {
  const base       = (p.base_url   as string | undefined)?.replace(/\/$/, '')
  const token      = p.api_token  as string | undefined
  const account_id = p.account_id as string | undefined
  if (!base || !token || !account_id) {
    return { ok: false, error: 'base_url, api_token e account_id são obrigatórios' }
  }

  try {
    const h = { 'api_access_token': token }
    const [openRes, pendingRes] = await Promise.all([
      fetch(`${base}/api/v1/accounts/${account_id}/conversations?status=open&page=1`,    { headers: h }),
      fetch(`${base}/api/v1/accounts/${account_id}/conversations?status=pending&page=1`, { headers: h }),
    ])
    if (!openRes.ok) return { ok: false, error: `Chatwoot HTTP ${openRes.status}` }

    const openPayload    = (((await openRes.json() as Record<string, unknown>).data as Record<string, unknown>)?.payload    as Record<string, unknown>[]) ?? []
    const pendingPayload = pendingRes.ok
      ? ((((await pendingRes.json() as Record<string, unknown>).data as Record<string, unknown>)?.payload as Record<string, unknown>[]) ?? [])
      : []

    const leads = [...openPayload, ...pendingPayload].map(conv => buildLead(conv, true))
    if (leads.length > 0) await dbUpsert('leads_contabilidade', leads)
    return { ok: true, count: leads.length }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

// ── Proxy: find/create contact + create conversation ─────────────────────────

async function actionCreateConversation(p: Record<string, unknown>) {
  const base    = (p.base_url      as string | undefined)?.replace(/\/$/, '')
  const token   = p.api_token     as string | undefined
  const accId   = p.account_id    as string | undefined
  const inboxId = p.inbox_id      as string | undefined
  const phone   = normalizePhone(p.contact_phone as string | undefined)
  const name    = (p.contact_name  as string | undefined) ?? 'Cliente'
  const leadId  = p.lead_id       as string | undefined

  if (!base || !token || !accId || !inboxId) {
    return { ok: false, error: 'base_url, api_token, account_id e inbox_id são obrigatórios' }
  }

  const h = { 'Content-Type': 'application/json', 'api_access_token': token }

  try {
    // 1. Busca contato existente pelo telefone
    let contactId: number | undefined

    if (phone) {
      const q       = encodeURIComponent(phone)
      const search  = await fetch(`${base}/api/v1/accounts/${accId}/contacts/search?q=${q}&page=1`, { headers: h, signal: AbortSignal.timeout(8000) })
      if (search.ok) {
        const sd = await search.json() as Record<string, unknown>
        const payload = (sd.payload as Array<Record<string, unknown>>) ?? []
        if (payload.length > 0) contactId = payload[0].id as number
      }
    }

    // 2. Cria contato se não encontrado
    if (!contactId) {
      const cr = await fetch(`${base}/api/v1/accounts/${accId}/contacts`, {
        method: 'POST', headers: h,
        body:   JSON.stringify({ name, phone_number: phone }),
        signal: AbortSignal.timeout(8000),
      })
      if (!cr.ok) return { ok: false, error: `Criar contato HTTP ${cr.status}` }
      const cd = await cr.json() as Record<string, unknown>
      contactId = cd.id as number
    }

    // 3. Cria conversa no inbox
    const convRes = await fetch(`${base}/api/v1/accounts/${accId}/conversations`, {
      method: 'POST', headers: h,
      body:   JSON.stringify({ inbox_id: Number(inboxId), contact_id: contactId }),
      signal: AbortSignal.timeout(8000),
    })
    if (!convRes.ok) return { ok: false, error: `Criar conversa HTTP ${convRes.status}` }
    const conv = await convRes.json() as Record<string, unknown>
    const conversationId = String(conv.id)

    // 4. Salva id_conversa_chatwoot no lead
    if (leadId) {
      await dbPatch('leads_contabilidade', `id=eq.${leadId}`, {
        id_conversa_chatwoot: conversationId,
        id_lead_chatwoot:     String(contactId),
      })
    }

    return { ok: true, conversation_id: conversationId, contact_id: String(contactId) }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

// ── Proxy: get messages from a conversation ───────────────────────────────────

async function actionGetMessages(p: Record<string, unknown>) {
  const base   = (p.base_url        as string | undefined)?.replace(/\/$/, '')
  const token  = p.api_token       as string | undefined
  const accId  = p.account_id      as string | undefined
  const convId = p.conversation_id as string | undefined
  if (!base || !token || !accId || !convId) return { ok: false, error: 'Parâmetros incompletos' }

  try {
    const res = await fetch(
      `${base}/api/v1/accounts/${accId}/conversations/${convId}/messages`,
      { headers: { 'api_access_token': token }, signal: AbortSignal.timeout(10000) },
    )
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    const data = await res.json() as Record<string, unknown>
    const payload = (data.payload as Array<Record<string, unknown>>) ?? []

    const messages = payload
      .filter(m => (m.message_type === 0 || m.message_type === 1) && (m.content || (m.attachments as unknown[])?.length))
      .map(m => ({
        id:           m.id,
        content:      m.content ?? '',
        message_type: m.message_type,
        created_at:   m.created_at,
        sender_name:  (m.sender as Record<string, unknown>)?.name ?? null,
        attachments:  ((m.attachments as Array<Record<string, unknown>>) ?? []).map(a => ({
          file_type:    a.file_type,
          data_url:     a.data_url,
          download_url: a.download_url,
          file_name:    a.file_name,
        })),
      }))

    return { ok: true, messages }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

// ── Proxy: send message to a conversation ────────────────────────────────────

async function actionSendMessage(p: Record<string, unknown>) {
  const base    = (p.base_url        as string | undefined)?.replace(/\/$/, '')
  const token   = p.api_token       as string | undefined
  const accId   = p.account_id      as string | undefined
  const convId  = p.conversation_id as string | undefined
  const content = p.content         as string | undefined
  if (!base || !token || !accId || !convId || !content) return { ok: false, error: 'Parâmetros incompletos' }

  try {
    const res = await fetch(
      `${base}/api/v1/accounts/${accId}/conversations/${convId}/messages`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'api_access_token': token },
        body:    JSON.stringify({ content, message_type: 1, private: false }),
        signal:  AbortSignal.timeout(10000),
      },
    )
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    const msg = await res.json() as Record<string, unknown>
    return {
      ok: true,
      message: {
        id:           msg.id,
        content:      msg.content,
        message_type: msg.message_type,
        created_at:   msg.created_at,
        sender_name:  (msg.sender as Record<string, unknown>)?.name ?? null,
      },
    }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

// ── Proxy: update Chatwoot conversation status + label ───────────────────────

async function actionUpdateConversation(p: Record<string, unknown>) {
  const base    = (p.base_url        as string | undefined)?.replace(/\/$/, '')
  const token   = p.api_token       as string | undefined
  const accId   = p.account_id      as string | undefined
  const convId  = p.conversation_id as string | undefined
  const status  = p.status          as string | undefined
  const label   = p.label           as string | null | undefined

  if (!base || !token || !accId || !convId) {
    return { ok: false, error: 'base_url, api_token, account_id e conversation_id são obrigatórios' }
  }

  const convUrl = `${base}/api/v1/accounts/${accId}/conversations/${convId}`
  const h = { 'Content-Type': 'application/json', 'api_access_token': token }

  try {
    if (status) {
      const r = await fetch(`${convUrl}/toggle_status`, {
        method: 'POST', headers: h,
        body:   JSON.stringify({ status }),
        signal: AbortSignal.timeout(8000),
      })
      if (!r.ok) return { ok: false, error: `toggle_status HTTP ${r.status}` }
    }

    if (label) {
      const r = await fetch(`${convUrl}/labels`, {
        method: 'POST', headers: h,
        body:   JSON.stringify({ labels: [label] }),
        signal: AbortSignal.timeout(8000),
      })
      if (!r.ok) return { ok: false, error: `labels HTTP ${r.status}` }
    }

    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

// ── Proxy: send file attachment ───────────────────────────────────────────────

async function actionSendAttachment(form: FormData) {
  const base_url  = (form.get('base_url')        as string | null)?.replace(/\/$/, '')
  const token     = form.get('api_token')         as string | null
  const accId     = form.get('account_id')        as string | null
  const convId    = form.get('conversation_id')   as string | null
  const file      = form.get('file')              as File   | null
  const filename  = (form.get('filename') as string | null) ?? file?.name ?? 'arquivo'

  if (!base_url || !token || !accId || !convId || !file) {
    return { ok: false, error: 'Parâmetros incompletos para envio de anexo' }
  }

  const out = new FormData()
  out.append('content', '')
  out.append('message_type', 'outgoing')
  out.append('private', 'false')
  out.append('attachments[]', file, filename)

  try {
    const res = await fetch(
      `${base_url}/api/v1/accounts/${accId}/conversations/${convId}/messages`,
      { method: 'POST', headers: { 'api_access_token': token }, body: out, signal: AbortSignal.timeout(30000) },
    )
    if (!res.ok) return { ok: false, error: `Chatwoot HTTP ${res.status}` }
    const msg = await res.json() as Record<string, unknown>
    const atts = (msg.attachments as Array<Record<string, unknown>>) ?? []
    return {
      ok: true,
      message: {
        id:           msg.id,
        content:      msg.content ?? '',
        message_type: 1,
        created_at:   msg.created_at,
        attachments:  atts.map(a => ({
          file_type:    a.file_type,
          data_url:     a.data_url,
          download_url: a.download_url,
          file_name:    a.file_name,
        })),
      },
    }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST')   return new Response('Method not allowed', { status: 405, headers: CORS })

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

  // Requisição multipart (upload de arquivo)
  const contentType = req.headers.get('content-type') ?? ''
  if (contentType.includes('multipart/form-data')) {
    try {
      const form = await req.formData()
      if (form.get('_action') === 'send_attachment') {
        const auth = await requireAuthenticatedUser(req)
        if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status)
        return json(await actionSendAttachment(form))
      }
      return json({ ok: false, error: 'Ação inválida' })
    } catch (e) {
      return json({ ok: false, error: String(e) })
    }
  }

  const rawBody = await req.text()
  let payload: Record<string, unknown>
  try { payload = rawBody ? JSON.parse(rawBody) : {} }
  catch { return new Response('Invalid JSON', { status: 400, headers: CORS }) }

  // ── Proxy actions (chamadas do browser) ────────────────────────────────────
  if (payload._action) {
    const auth = await requireAuthenticatedUser(req)
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status)
    if (payload._action === 'test_connection')    return json(await actionTestConnection(payload))
    if (payload._action === 'sync_conversations') return json(await actionSyncConversations(payload))
    if (payload._action === 'create_conversation') return json(await actionCreateConversation(payload))
    if (payload._action === 'get_messages')       return json(await actionGetMessages(payload))
    if (payload._action === 'send_message')       return json(await actionSendMessage(payload))
    if (payload._action === 'update_conversation') return json(await actionUpdateConversation(payload))
  }

  const webhookSecret = Deno.env.get('CHATWOOT_WEBHOOK_SECRET') ?? ''
  const webhookOk = await verifyWebhookRequest(req, {
    secret: webhookSecret,
    rawBody,
    tokenHeaders: ['x-webhook-token', 'authorization'],
    signatureHeaders: ['x-signature'],
    queryParams: ['token', 'signature'],
  })
  if (!webhookOk) return unauthorizedWebhookResponse(req)

  // ── Chatwoot webhook events ────────────────────────────────────────────────
  const event = payload.event as string
  const data  = payload.data  as Record<string, unknown>

  await dbUpsert('communication_events', [{
    source:          'chatwoot',
    event_type:      event ?? 'unknown',
    external_id:     data?.id ? String(data.id) : null,
    conversation_id: data?.id
                       ? String(data.id)
                       : data?.conversation_id ? String(data.conversation_id) : null,
    payload,
  }])

  // Nova conversa → salva tudo incluindo inicio_atendimento e resumo_conversa
  if (event === 'conversation_created') {
    await dbUpsert('leads_contabilidade', [buildLead(data, true)])
  }

  // Conversa atualizada → atualiza só status, contato e ultima_mensagem
  if (event === 'conversation_updated') {
    await dbPatch(
      'leads_contabilidade',
      `id_conversa_chatwoot=eq.${String(data.id)}`,
      {
        status:          STATUS_MAP[(data.status as string) ?? 'open'] ?? 'conversando',
        nome_lead:       ((data.meta as Record<string, unknown>)?.sender as Record<string, unknown>)?.name ?? null,
        whatsapp_lead:   ((data.meta as Record<string, unknown>)?.sender as Record<string, unknown>)?.phone_number ?? null,
        ultima_mensagem: tsToISO(data.last_activity_at),
      },
    )
  }

  // Nova mensagem do contato
  if (event === 'message_created') {
    const msg = data as Record<string, unknown>
    if (msg.message_type === 0 && msg.conversation_id) {
      const convId  = String(msg.conversation_id)
      const content = (msg.content as string | undefined) ?? null

      await dbPatch('leads_contabilidade', `id_conversa_chatwoot=eq.${convId}`,
        { ultima_mensagem: new Date().toISOString() })

      if (content) {
        await dbPatch('leads_contabilidade',
          `id_conversa_chatwoot=eq.${convId}&resumo_conversa=is.null`,
          { resumo_conversa: content })
      }
    }
  }

  // Contato atualizado → sincroniza nome e telefone
  if (event === 'contact_updated') {
    const c = data as Record<string, unknown>
    if (c.id) {
      await dbPatch('leads_contabilidade', `id_lead_chatwoot=eq.${String(c.id)}`, {
        nome_lead:     (c.name         as string | undefined) ?? null,
        whatsapp_lead: (c.phone_number as string | undefined) ?? null,
      })
    }
  }

  return json({ ok: true })
})
