// @ts-nocheck — Deno runtime (Supabase Edge Functions)
import { CORS, SERVICE_KEY, SUPABASE_URL, requireAuthenticatedUser, unauthorizedWebhookResponse, verifyWebhookRequest } from '../_shared/security.ts'

const DB = {
  'apikey':        SERVICE_KEY,
  'Authorization': `Bearer ${SERVICE_KEY}`,
  'Content-Type':  'application/json',
}

// ── DB helpers ────────────────────────────────────────────────────────────────

async function dbInsert(table: string, rows: unknown[]) {
  return fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method:  'POST',
    headers: { ...DB, 'Prefer': 'return=minimal' },
    body:    JSON.stringify(rows),
  })
}

async function dbUpsert(table: string, rows: unknown[], onConflict: string) {
  return fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method:  'POST',
    headers: { ...DB, 'Prefer': `resolution=merge-duplicates,return=minimal`, 'on_conflict': onConflict },
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

async function dbSelect(table: string, filter: string, select = '*') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}&select=${select}`, {
    headers: DB,
  })
  if (!res.ok) return []
  return res.json() as Promise<Record<string, unknown>[]>
}

async function ensureLeadForConversation(input: {
  remoteJid: string
  instance?: string | null
  pushName?: string | null
  content?: string | null
}) {
  const { remoteJid, instance, pushName, content } = input
  const leads = await dbSelect(
    'leads_contabilidade',
    `evolution_remote_jid=eq.${encodeURIComponent(remoteJid)}&select=id,nome_lead`,
  )

  let leadId: string | null = leads[0]?.id as string ?? null
  const phone = jidToPhone(remoteJid)

  if (!leadId) {
    const newLeadRes = await fetch(`${SUPABASE_URL}/rest/v1/leads_contabilidade`, {
      method: 'POST',
      headers: { ...DB, 'Prefer': 'return=representation' },
      body: JSON.stringify({
        nome_lead: pushName ?? `+${phone}`,
        whatsapp_lead: `+${phone}`,
        evolution_remote_jid: remoteJid,
        evolution_instance: instance ?? null,
        status: 'iniciou_conversa',
        inicio_atendimento: new Date().toISOString(),
        ultima_mensagem: content ?? new Date().toISOString(),
        resumo_conversa: content ?? null,
      }),
    })
    if (newLeadRes.ok) {
      const created = await newLeadRes.json() as Record<string, unknown>[]
      leadId = created[0]?.id as string ?? null
    }
  } else {
    await dbPatch('leads_contabilidade', `id=eq.${leadId}`, {
      nome_lead: pushName ?? undefined,
      evolution_instance: instance ?? undefined,
      ultima_mensagem: content ?? new Date().toISOString(),
    })
  }

  return leadId
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizePhone(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 0) return undefined
  if (digits.startsWith('55') && digits.length >= 12) return digits
  if (digits.length === 10 || digits.length === 11) return `55${digits}`
  return digits
}

function phoneToJid(phone: string): string {
  const digits = normalizePhone(phone) ?? phone.replace(/\D/g, '')
  return `${digits}@s.whatsapp.net`
}

function jidToPhone(jid: string): string {
  return jid.replace('@s.whatsapp.net', '').replace('@g.us', '')
}

function extractQuoted(message: Record<string, unknown>) {
  const ext = message.extendedTextMessage as Record<string, unknown> | undefined
  const context = ext?.contextInfo as Record<string, unknown> | undefined
  const quotedMessage = context?.quotedMessage as Record<string, unknown> | undefined
  const stanzaId = context?.stanzaId as string | undefined
  if (!context || !quotedMessage || !stanzaId) return null

  const quotedText =
    (quotedMessage.conversation as string | undefined)
    ?? ((quotedMessage.extendedTextMessage as Record<string, unknown> | undefined)?.text as string | undefined)
    ?? ((quotedMessage.imageMessage as Record<string, unknown> | undefined)?.caption as string | undefined)
    ?? ((quotedMessage.videoMessage as Record<string, unknown> | undefined)?.caption as string | undefined)
    ?? ((quotedMessage.documentMessage as Record<string, unknown> | undefined)?.fileName as string | undefined)
    ?? (quotedMessage.audioMessage ? 'Audio' : undefined)

  return {
    messageId: stanzaId,
    content: quotedText ?? 'Mensagem respondida',
  }
}

function extractContent(message: Record<string, unknown>): { content: string | null; messageType: string; mediaUrl: string | null; quoted: { messageId: string; content: string } | null } {
  const quoted = extractQuoted(message)
  if (message.conversation) return { content: message.conversation as string, messageType: 'conversation', mediaUrl: null, quoted }

  const img = message.imageMessage as Record<string, unknown> | undefined
  if (img) return { content: (img.caption as string | null) ?? null, messageType: 'imageMessage', mediaUrl: (img.url as string | null) ?? null, quoted }

  const vid = message.videoMessage as Record<string, unknown> | undefined
  if (vid) return { content: (vid.caption as string | null) ?? null, messageType: 'videoMessage', mediaUrl: (vid.url as string | null) ?? null, quoted }

  const doc = message.documentMessage as Record<string, unknown> | undefined
  if (doc) return { content: (doc.fileName as string | null) ?? null, messageType: 'documentMessage', mediaUrl: (doc.url as string | null) ?? null, quoted }

  const aud = message.audioMessage as Record<string, unknown> | undefined
  if (aud) return { content: '🎵 Áudio', messageType: 'audioMessage', mediaUrl: (aud.url as string | null) ?? null, quoted }

  const ext = message.extendedTextMessage as Record<string, unknown> | undefined
  if (ext) return { content: ext.text as string | null, messageType: 'extendedTextMessage', mediaUrl: null, quoted }

  return { content: null, messageType: 'unknown', mediaUrl: null, quoted }
}

function evolutionHeaders(apiKey: string) {
  return { 'Content-Type': 'application/json', 'apikey': apiKey }
}

function normalizeMimeType(mime: string | null | undefined) {
  return (mime ?? '').replace(/\s+/g, '')
}

async function readResponseText(res: Response) {
  try {
    return await res.text()
  } catch {
    return ''
  }
}

// ── Proxy: test connection ────────────────────────────────────────────────────

async function actionTestConnection(p: Record<string, unknown>) {
  const baseUrl    = (p.base_url      as string | undefined)?.replace(/\/$/, '')
  const apiKey     = p.api_token     as string | undefined
  const instance   = p.instance_name as string | undefined

  if (!baseUrl || !apiKey || !instance) {
    return { ok: false, error: 'base_url, api_token e instance_name são obrigatórios' }
  }

  try {
    const res = await fetch(`${baseUrl}/instance/connectionState/${instance}`, {
      headers: evolutionHeaders(apiKey),
      signal:  AbortSignal.timeout(8000),
    })
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    const data = await res.json() as Record<string, unknown>
    const state = (data.instance as Record<string, unknown>)?.state ?? data.state ?? 'unknown'
    const connected = state === 'open'
    return { ok: connected, state, error: connected ? null : `Instância ${state} (esperado: open)` }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

// ── Proxy: send text message ──────────────────────────────────────────────────

async function actionSendMessage(p: Record<string, unknown>) {
  const baseUrl  = (p.base_url      as string | undefined)?.replace(/\/$/, '')
  const apiKey   = p.api_token     as string | undefined
  const instance = p.instance_name as string | undefined
  const number   = p.number        as string | undefined
  const text     = p.content       as string | undefined
  const leadId   = p.lead_id       as string | undefined
  const quotedId = p.quoted_message_id as string | undefined
  const quotedContent = p.quoted_content as string | undefined

  if (!baseUrl || !apiKey || !instance || !number || !text) {
    return { ok: false, error: 'Parâmetros incompletos' }
  }

  const phone = normalizePhone(number) ?? number

  try {
    const res = await fetch(`${baseUrl}/message/sendText/${instance}`, {
      method:  'POST',
      headers: evolutionHeaders(apiKey),
      body:    JSON.stringify({
        number: phone,
        text,
        ...(quotedId ? {
          quoted: {
            key: { id: quotedId },
            message: { conversation: quotedContent ?? 'Mensagem respondida' },
          },
        } : {}),
      }),
      signal:  AbortSignal.timeout(15000),
    })
    if (!res.ok) return { ok: false, error: `Evolution HTTP ${res.status}` }
    const msg = await res.json() as Record<string, unknown>
    const msgId = (msg.key as Record<string, unknown>)?.id ?? msg.id ?? null

    // Registra mensagem enviada no histórico local
    const remoteJid = phoneToJid(phone)
    const ensuredLeadId = await ensureLeadForConversation({
      remoteJid,
      instance,
      content: text,
    })
    await dbInsert('communication_events', [{
      source:          'evolution',
      event_type:      'message_sent',
      external_id:     msgId ? String(msgId) : null,
      conversation_id: remoteJid,
      lead_id:         leadId ?? ensuredLeadId ?? null,
      payload: {
        remoteJid, fromMe: true,
        messageId: msgId,
        content: text,
        messageType: 'conversation',
        quoted: quotedId ? { messageId: quotedId, content: quotedContent ?? 'Mensagem respondida' } : null,
        instance,
      },
    }])

    return { ok: true, messageId: msgId, remoteJid }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

// ── Proxy: send media (image, video, document) ───────────────────────────────

async function actionSendAttachment(form: FormData) {
  const baseUrl  = (form.get('base_url')      as string | null)?.replace(/\/$/, '')
  const apiKey   = form.get('api_token')      as string | null
  const instance = form.get('instance_name')  as string | null
  const number   = form.get('number')         as string | null
  const file     = form.get('file')           as File   | null
  const caption  = (form.get('caption')       as string | null) ?? ''
  const leadId   = form.get('lead_id')        as string | null

  if (!baseUrl || !apiKey || !instance || !number || !file) {
    return { ok: false, error: 'Parâmetros incompletos para envio de anexo' }
  }

  const phone = normalizePhone(number) ?? number
  const mime  = normalizeMimeType(file.type)
  const isAudio    = mime.startsWith('audio/')
  const isImage    = mime.startsWith('image/')
  const isVideo    = mime.startsWith('video/')

  // Converte arquivo para base64
  const arrayBuffer = await file.arrayBuffer()
  const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)))

  try {
    let endpoint: string
    let body: Record<string, unknown>

    if (isAudio) {
      endpoint = `${baseUrl}/message/sendWhatsAppAudio/${instance}`
      const audioData = `data:${mime};base64,${base64}`

      // A doc oficial pede url ou base64. Algumas instalações aceitam
      // base64 puro; outras aceitam data URI ou wrapper audioMessage.
      const attempts: Record<string, unknown>[] = [
        {
          number: phone,
          audio: base64,
        },
        {
          number: phone,
          audio: audioData,
        },
        {
          number: phone,
          audioMessage: { audio: base64 },
          options: { encoding: true, presence: 'recording' },
        },
      ]

      let audioRes: Response | null = null
      let audioErrorText = ''

      for (const attemptBody of attempts) {
        const res = await fetch(endpoint, {
          method:  'POST',
          headers: evolutionHeaders(apiKey),
          body:    JSON.stringify(attemptBody),
          signal:  AbortSignal.timeout(60000),
        })
        if (res.ok) {
          audioRes = res
          break
        }
        audioErrorText = await readResponseText(res)
      }

      if (!audioRes) {
        return { ok: false, error: audioErrorText || 'Falha ao enviar áudio para a Evolution API' }
      }

      const msg = await audioRes.json() as Record<string, unknown>
      const msgId = (msg.key as Record<string, unknown>)?.id ?? null
      const remoteJid = phoneToJid(phone)
      const ensuredLeadId = await ensureLeadForConversation({
        remoteJid,
        instance,
        content: caption || file.name,
      })

      await dbInsert('communication_events', [{
        source:          'evolution',
        event_type:      'message_sent',
        external_id:     msgId ? String(msgId) : null,
        conversation_id: remoteJid,
        lead_id:         leadId ?? ensuredLeadId ?? null,
        payload: {
          remoteJid, fromMe: true,
          messageId: msgId,
          content: caption || file.name,
          messageType: 'audioMessage',
          instance,
        },
      }])

      return { ok: true, messageId: msgId, remoteJid }
    } else if (isImage || isVideo) {
      const mediatype = isImage ? 'image' : 'video'
      endpoint = `${baseUrl}/message/sendMedia/${instance}`
      body = { number: phone, mediatype, mimetype: mime, caption, media: `data:${mime};base64,${base64}` }
    } else {
      endpoint = `${baseUrl}/message/sendMedia/${instance}`
      body = { number: phone, mediatype: 'document', mimetype: mime, caption: file.name, fileName: file.name, media: `data:${mime};base64,${base64}` }
    }

    const res = await fetch(endpoint, {
      method:  'POST',
      headers: evolutionHeaders(apiKey),
      body:    JSON.stringify(body),
      signal:  AbortSignal.timeout(60000),
    })
    if (!res.ok) {
      const errorText = await readResponseText(res)
      return { ok: false, error: errorText || `Evolution HTTP ${res.status}` }
    }
    const msg = await res.json() as Record<string, unknown>
    const msgId = (msg.key as Record<string, unknown>)?.id ?? null
    const remoteJid = phoneToJid(phone)
    const ensuredLeadId = await ensureLeadForConversation({
      remoteJid,
      instance,
      content: caption || file.name,
    })

    await dbInsert('communication_events', [{
      source:          'evolution',
      event_type:      'message_sent',
      external_id:     msgId ? String(msgId) : null,
      conversation_id: remoteJid,
      lead_id:         leadId ?? ensuredLeadId ?? null,
      payload: {
        remoteJid, fromMe: true,
        messageId: msgId,
        content: caption || file.name,
        messageType: isAudio ? 'audioMessage' : isImage ? 'imageMessage' : 'documentMessage',
        instance,
      },
    }])

    return { ok: true, messageId: msgId, remoteJid }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

// ── Proxy: init chat (resolve JID, salva no lead, retorna histórico) ──────────

async function actionInitChat(p: Record<string, unknown>) {
  const phone    = p.phone    as string | undefined
  const leadId   = p.lead_id  as string | undefined
  const instance = p.instance_name as string | undefined

  if (!phone) return { ok: false, error: 'phone é obrigatório' }

  const digits = normalizePhone(phone)
  if (!digits) return { ok: false, error: 'Número de telefone inválido' }

  const remoteJid = `${digits}@s.whatsapp.net`

  // Salva JID e instância no lead
  if (leadId) {
    await dbPatch('leads_contabilidade', `id=eq.${leadId}`, {
      evolution_remote_jid: remoteJid,
      evolution_instance:   instance ?? null,
    })
  }

  // Busca histórico de mensagens do Supabase
  const events = await dbSelect(
    'communication_events',
    `conversation_id=eq.${encodeURIComponent(remoteJid)}&source=eq.evolution&order=created_at.asc&limit=100`,
    'id,event_type,payload,created_at',
  )

  return { ok: true, remoteJid, messages: events }
}

// ── Proxy: get messages from local DB ────────────────────────────────────────

async function actionGetMessages(p: Record<string, unknown>) {
  const remoteJid = p.remote_jid as string | undefined
  if (!remoteJid) return { ok: false, error: 'remote_jid é obrigatório' }

  const events = await dbSelect(
    'communication_events',
    `conversation_id=eq.${encodeURIComponent(remoteJid)}&source=eq.evolution&order=created_at.asc&limit=200`,
    'id,event_type,payload,created_at',
  )

  return { ok: true, messages: events }
}

// ── Proxy: get media base64 from Evolution ───────────────────────────────────

async function actionGetMediaBase64(p: Record<string, unknown>) {
  const baseUrl      = (p.base_url      as string | undefined)?.replace(/\/$/, '')
  const apiKey       = p.api_token      as string | undefined
  const instance     = p.instance_name  as string | undefined
  const messageId    = p.message_id     as string | undefined
  const convertToMp4 = Boolean(p.convert_to_mp4)

  if (!baseUrl || !apiKey || !instance || !messageId) {
    return { ok: false, error: 'base_url, api_token, instance_name e message_id são obrigatórios' }
  }

  try {
    const res = await fetch(`${baseUrl}/chat/getBase64FromMediaMessage/${instance}`, {
      method: 'POST',
      headers: evolutionHeaders(apiKey),
      body: JSON.stringify({
        message: { key: { id: messageId } },
        convertToMp4,
      }),
      signal: AbortSignal.timeout(30000),
    })

    if (!res.ok) {
      const errorText = await readResponseText(res)
      return { ok: false, error: errorText || `Evolution HTTP ${res.status}` }
    }

    const data = await res.json() as Record<string, unknown>
    return {
      ok: true,
      mediaType: data.mediaType ?? null,
      fileName: data.fileName ?? null,
      mimetype: data.mimetype ?? null,
      base64: data.base64 ?? null,
    }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

// ── Proxy: list Evolution instances ──────────────────────────────────────────

async function actionListInstances() {
  const rows = await dbSelect(
    'external_integrations',
    'provider=eq.evolution&select=id,name,status,base_url,api_token,instance_name,last_test_at,last_error',
  )
  // Não retorna api_token ao browser por segurança
  return {
    ok: true,
    instances: rows.map(r => ({
      id:           r.id,
      name:         r.name,
      status:       r.status,
      base_url:     r.base_url,
      instance_name: r.instance_name,
      last_test_at: r.last_test_at,
      last_error:   r.last_error,
    })),
  }
}

// ── Webhook: processar eventos da Evolution API ───────────────────────────────

async function processWebhook(payload: Record<string, unknown>) {
  const event    = payload.event    as string | undefined
  const instance = payload.instance as string | undefined
  const data     = payload.data     as Record<string, unknown> | undefined

  await dbInsert('webhook_log', [{
    gateway: 'evolution',
    evento: event ?? 'unknown',
    payload,
    status: 'recebido',
    external_id: instance ?? null,
  }])

  if (!event || !data) return { ok: true, skipped: true }

  // ── messages.upsert ────────────────────────────────────────────
  if (event === 'messages.upsert') {
    const key       = data.key     as Record<string, unknown> | undefined
    const message   = data.message as Record<string, unknown> | undefined

    if (!key || !message) return { ok: true, skipped: true }

    const remoteJid = key.remoteJid as string | undefined
    const fromMe    = key.fromMe    as boolean | undefined
    const msgId     = key.id        as string | undefined
    const pushName  = data.pushName as string | undefined

    if (!remoteJid) return { ok: true, skipped: true }

    // Ignora mensagens de grupos
    if (remoteJid.endsWith('@g.us')) return { ok: true, skipped: true, reason: 'group' }

    const { content, messageType, mediaUrl, quoted } = extractContent(message)
    const eventType = fromMe ? 'message_sent' : 'message_received'

    const leadId = await ensureLeadForConversation({
      remoteJid,
      instance,
      pushName: pushName ?? null,
      content,
    })

    // Salva evento
    await dbInsert('communication_events', [{
      source:          'evolution',
      event_type:      eventType,
      external_id:     msgId ?? null,
      conversation_id: remoteJid,
      lead_id:         leadId,
      payload: {
        remoteJid,
        fromMe: fromMe ?? false,
        messageId: msgId,
        pushName:  pushName ?? null,
        content,
        messageType,
        mediaUrl,
        quoted,
        instance,
      },
    }])

    return { ok: true }
  }

  // ── connection.update ──────────────────────────────────────────
  if (event === 'connection.update') {
    const state = data.state as string | undefined
    if (instance && state) {
      const status = state === 'open' ? 'ativo' : state === 'close' ? 'inativo' : 'erro'
      await dbPatch(
        'external_integrations',
        `provider=eq.evolution&instance_name=eq.${encodeURIComponent(instance)}`,
        { status, last_test_at: new Date().toISOString() },
      )
    }
    return { ok: true }
  }

  return { ok: true, skipped: true, event }
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST')   return new Response('Method not allowed', { status: 405, headers: CORS })

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

  // ── Multipart (envio de arquivo) ───────────────────────────────
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

  // ── Proxy actions (chamadas autenticadas do browser) ───────────
  if (payload._action) {
    const auth = await requireAuthenticatedUser(req)
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status)

    switch (payload._action) {
      case 'test_connection':  return json(await actionTestConnection(payload))
      case 'send_message':     return json(await actionSendMessage(payload))
      case 'init_chat':        return json(await actionInitChat(payload))
      case 'get_messages':     return json(await actionGetMessages(payload))
      case 'get_media_base64': return json(await actionGetMediaBase64(payload))
      case 'list_instances':   return json(await actionListInstances())
      default:                 return json({ ok: false, error: 'Ação desconhecida' })
    }
  }

  const webhookSecret = Deno.env.get('EVOLUTION_WEBHOOK_SECRET') ?? ''
  const webhookOk = await verifyWebhookRequest(req, {
    secret: webhookSecret,
    rawBody,
    tokenHeaders: ['x-webhook-token', 'authorization'],
    signatureHeaders: ['x-signature'],
    queryParams: ['token', 'signature'],
  })
  if (!webhookOk) return unauthorizedWebhookResponse(req)

  // ── Webhook da Evolution API (sem auth — IP/token via header) ──
  return json(await processWebhook(payload))
})
