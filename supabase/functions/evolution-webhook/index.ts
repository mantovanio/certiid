// @ts-nocheck — Deno runtime (Supabase Edge Functions)
import { CORS, SERVICE_KEY, SUPABASE_URL, getEnv, requireAuthenticatedUser, unauthorizedWebhookResponse, verifyWebhookRequest } from '../_shared/security.ts'

const DB = {
  'apikey':        SERVICE_KEY,
  'Authorization': `Bearer ${SERVICE_KEY}`,
  'Content-Type':  'application/json',
}

const CLOSED_KANBAN_STATUSES = new Set([
  'cliente',
  'perdido',
  'cancelou_agendamento',
  'resolvido',
  'resolvida',
  'resolved',
  'arquivado',
  'arquivada',
  'finalizado',
  'finalizada',
  'encerrado',
  'encerrada',
  'closed',
  'archived',
])

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

async function getCrmConversationState(documentKey: string) {
  const rows = await dbSelect(
    'crm_chat_conversations',
    `document_key=eq.${encodeURIComponent(documentKey)}&order=ultima_interacao_em.desc&limit=1`,
    'id,atendimento_humano,kanban_status,fila,whatsapp_instance,numero_receptor',
  )
  const row = rows[0] ?? null
  return {
    id: row?.id ? String(row.id) : null,
    atendimentoHumano: Boolean(row?.atendimento_humano),
    kanbanStatus: typeof row?.kanban_status === 'string' ? row.kanban_status : null,
    fila: typeof row?.fila === 'string' ? row.fila : null,
    whatsappInstance: typeof row?.whatsapp_instance === 'string' ? row.whatsapp_instance : null,
    numeroReceptor: typeof row?.numero_receptor === 'string' ? row.numero_receptor : null,
  }
}

async function loadCrmChatSettings() {
  const rows = await dbSelect('app_settings', 'key=eq.crm_chat_settings&limit=1', 'value')
  const value = rows[0]?.value as Record<string, unknown> | undefined
  return {
    sign_outgoing_messages: value?.sign_outgoing_messages !== false,
  }
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

async function insertReturning(table: string, row: Record<string, unknown>) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...DB, 'Prefer': 'return=representation' },
    body: JSON.stringify(row),
  })
  if (!res.ok) return null
  const data = await res.json() as Record<string, unknown>[]
  return data[0] ?? null
}

function resolveQueue(instance: string | null | undefined, content: string | null | undefined, queueOverride?: string | null) {
  if (queueOverride === 'renovacao' || queueOverride === 'atendimento') return queueOverride
  const normalizedInstance = (instance ?? '').trim().toLowerCase()
  if (normalizedInstance === 'renovacao' || normalizedInstance === 'certiid') return 'renovacao'
  if (normalizedInstance === 'atendimento') return 'atendimento'
  const probe = `${instance ?? ''} ${content ?? ''}`.toLowerCase()
  return probe.includes('renov') ? 'renovacao' : 'atendimento'
}

async function ensureCrmCustomer(input: {
  documentKey: string
  phone: string
  pushName?: string | null
}) {
  const { documentKey, phone, pushName } = input
  const existing = await dbSelect(
    'crm_customers',
    `document_key=eq.${encodeURIComponent(documentKey)}&limit=1`,
    'id,document_key,nome,telefone_principal,contato_status',
  )

  const customerId = existing[0]?.id as string | undefined
  if (customerId) {
    await dbPatch('crm_customers', `id=eq.${customerId}`, {
      nome: pushName ?? undefined,
      telefone_principal: phone,
      contato_status: 'conversando',
    })
    return customerId
  }

  const created = await insertReturning('crm_customers', {
    document_key: documentKey,
    nome: pushName ?? `+${phone}`,
    telefone_principal: phone,
    contato_status: 'conversando',
  })
  return created?.id ? String(created.id) : null
}

async function ensureCrmConversation(input: {
  documentKey: string
  phone: string
  customerId?: string | null
  instance?: string | null
  pushName?: string | null
  content?: string | null
  direction: 'incoming' | 'outgoing'
  queueOverride?: string | null
}) {
  const { documentKey, phone, customerId, instance, pushName, content, direction, queueOverride } = input
  const queue = resolveQueue(instance, content, queueOverride)
  const existing = await dbSelect(
    'crm_chat_conversations',
    `document_key=eq.${encodeURIComponent(documentKey)}&order=ultima_interacao_em.desc&limit=1`,
    'id,kanban_status',
  )

  const now = new Date().toISOString()
  const conversationId = existing[0]?.id as string | undefined
  const existingStatus = existing[0]?.kanban_status as string | undefined
  const reopenStatus = direction === 'incoming' && existingStatus && CLOSED_KANBAN_STATUSES.has(existingStatus)
    ? 'conversando'
    : undefined

  if (conversationId) {
    await dbPatch('crm_chat_conversations', `id=eq.${conversationId}`, {
      crm_customer_id: customerId ?? undefined,
      telefone: phone,
      cliente_nome: pushName ?? undefined,
      whatsapp_instance: instance ?? undefined,
      numero_receptor: instance ?? undefined,
      fila: queue,
      kanban_status: reopenStatus ?? undefined,
      ultima_mensagem: content ?? undefined,
      ultima_mensagem_direcao: direction,
      ultima_interacao_em: now,
    })
    return conversationId
  }

  const created = await insertReturning('crm_chat_conversations', {
    document_key: documentKey,
    crm_customer_id: customerId ?? null,
    telefone: phone,
    cliente_nome: pushName ?? `+${phone}`,
    whatsapp_instance: instance ?? null,
    numero_receptor: instance ?? null,
    fila: queue,
    kanban_status: direction === 'incoming' ? 'iniciou_conversa' : 'conversando',
    atendimento_humano: false,
    ultima_mensagem: content ?? null,
    ultima_mensagem_direcao: direction,
    ultima_interacao_em: now,
  })
  return created?.id ? String(created.id) : null
}

async function syncCrmInbox(input: {
  remoteJid: string
  instance?: string | null
  pushName?: string | null
  content?: string | null
  externalMessageId?: string | null
  direction: 'incoming' | 'outgoing'
  senderType: 'cliente' | 'ia' | 'humano'
  senderName?: string | null
  queueOverride?: string | null
  mediaUrl?: string | null
  mimeType?: string | null
  fileName?: string | null
}) {
  const { remoteJid, instance, pushName, content, externalMessageId, direction, senderType, senderName, queueOverride, mediaUrl, mimeType, fileName } = input
  const phone = jidToPhone(remoteJid)
  const documentKey = normalizePhone(phone) ?? phone
  if (!documentKey) return null

  const customerId = await ensureCrmCustomer({
    documentKey,
    phone: documentKey,
    pushName,
  })

  const conversationId = await ensureCrmConversation({
    documentKey,
    phone: documentKey,
    customerId,
    instance,
    pushName,
    content,
    direction,
    queueOverride,
  })

  if (conversationId) {
    const latestRows = await dbSelect(
      'crm_chat_messages',
      externalMessageId
        ? `conversation_id=eq.${encodeURIComponent(conversationId)}&external_message_id=eq.${encodeURIComponent(externalMessageId)}&limit=1`
        : `conversation_id=eq.${encodeURIComponent(conversationId)}&direction=eq.${encodeURIComponent(direction)}&sender_type=eq.${encodeURIComponent(senderType)}&order=created_at.desc&limit=1`,
      'id,mensagem,created_at,external_message_id',
    )

    const latest = latestRows[0]
    const latestContent = typeof latest?.mensagem === 'string' ? latest.mensagem : null
    const latestCreatedAt = typeof latest?.created_at === 'string' ? latest.created_at : null
    const normalizedContent = content ?? null
    const isDuplicateRecentMessage = Boolean(externalMessageId && latest?.external_message_id === externalMessageId)

    if (!isDuplicateRecentMessage) {
      await dbInsert('crm_chat_messages', [{
        conversation_id: conversationId,
        document_key: documentKey,
        external_message_id: externalMessageId ?? null,
        direction,
        sender_type: senderType,
        sender_name: senderType === 'humano' ? senderName ?? null : senderType === 'ia' ? 'IA Clara' : pushName ?? 'Cliente',
        mensagem: normalizedContent,
        mime_type: mimeType ?? null,
        file_name: fileName ?? null,
        media_url: mediaUrl ?? null,
        created_at: new Date().toISOString(),
      }])
    }
  }

  return { conversationId, customerId, documentKey }
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

function inferOutgoingSenderType(instance: string | null | undefined): 'ia' | 'humano' {
  const normalizedInstance = (instance ?? '').trim().toLowerCase()
  if (normalizedInstance === 'renovacao' || normalizedInstance === 'certiid') return 'ia'
  return 'humano'
}

function signOutgoingContent(content: string, senderName?: string | null) {
  const name = (senderName ?? '').trim()
  if (!name) return content
  if (content.trimEnd().endsWith(`— ${name}`)) return content
  return `${content}\n\n— ${name}`
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

function unwrapMessage(message: Record<string, unknown>): Record<string, unknown> {
  const wrapperKeys = [
    'ephemeralMessage',
    'viewOnceMessage',
    'viewOnceMessageV2',
    'viewOnceMessageV2Extension',
    'documentWithCaptionMessage',
  ]

  for (const key of wrapperKeys) {
    const wrapper = message[key] as Record<string, unknown> | undefined
    if (!wrapper) continue
    const nested =
      (wrapper.message as Record<string, unknown> | undefined)
      ?? (wrapper.messageV2 as Record<string, unknown> | undefined)
      ?? (wrapper.viewOnceMessage as Record<string, unknown> | undefined)
    if (nested) return unwrapMessage(nested)
  }

  return message
}

function extractContent(message: Record<string, unknown>): {
  content: string | null
  messageType: string
  mediaUrl: string | null
  mimeType: string | null
  fileName: string | null
  quoted: { messageId: string; content: string } | null
} {
  const normalized = unwrapMessage(message)
  const quoted = extractQuoted(normalized)
  if (normalized.conversation) return { content: normalized.conversation as string, messageType: 'conversation', mediaUrl: null, mimeType: null, fileName: null, quoted }

  const img = normalized.imageMessage as Record<string, unknown> | undefined
  if (img) return {
    content: (img.caption as string | null) ?? 'Imagem',
    messageType: 'imageMessage',
    mediaUrl: (img.url as string | null) ?? null,
    mimeType: (img.mimetype as string | null) ?? null,
    fileName: (img.fileName as string | null) ?? null,
    quoted,
  }

  const vid = normalized.videoMessage as Record<string, unknown> | undefined
  if (vid) return {
    content: (vid.caption as string | null) ?? 'Video',
    messageType: 'videoMessage',
    mediaUrl: (vid.url as string | null) ?? null,
    mimeType: (vid.mimetype as string | null) ?? null,
    fileName: (vid.fileName as string | null) ?? null,
    quoted,
  }

  const doc = normalized.documentMessage as Record<string, unknown> | undefined
  if (doc) return {
    content: (doc.fileName as string | null) ?? (doc.caption as string | null) ?? 'Arquivo',
    messageType: 'documentMessage',
    mediaUrl: (doc.url as string | null) ?? null,
    mimeType: (doc.mimetype as string | null) ?? null,
    fileName: (doc.fileName as string | null) ?? null,
    quoted,
  }

  const aud = normalized.audioMessage as Record<string, unknown> | undefined
  if (aud) return {
    content: 'Áudio',
    messageType: 'audioMessage',
    mediaUrl: (aud.url as string | null) ?? null,
    mimeType: (aud.mimetype as string | null) ?? null,
    fileName: (aud.fileName as string | null) ?? null,
    quoted,
  }

  const ext = normalized.extendedTextMessage as Record<string, unknown> | undefined
  if (ext) return { content: ext.text as string | null, messageType: 'extendedTextMessage', mediaUrl: null, mimeType: null, fileName: null, quoted }

  return { content: null, messageType: 'unknown', mediaUrl: null, mimeType: null, fileName: null, quoted }
}

function evolutionHeaders(apiKey: string) {
  return { 'Content-Type': 'application/json', 'apikey': apiKey }
}

function normalizeMimeType(mime: string | null | undefined) {
  return (mime ?? '').replace(/\s+/g, '')
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000
  let binary = ''

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize)
    binary += String.fromCharCode(...chunk)
  }

  return btoa(binary)
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
  const senderName = p.sender_name as string | undefined
  const contactName = p.contact_name as string | undefined
  const queueOverride = p.queue_override as string | undefined
  const quotedId = p.quoted_message_id as string | undefined
  const quotedContent = p.quoted_content as string | undefined

  if (!baseUrl || !apiKey || !instance || !number || !text) {
    return { ok: false, error: 'Parâmetros incompletos' }
  }

  const phone = normalizePhone(number) ?? number
  const settings = await loadCrmChatSettings()
  const signedText = settings.sign_outgoing_messages ? signOutgoingContent(text, senderName) : text

  try {
    const remoteJid = phoneToJid(phone)
    const ensuredLeadId = await ensureLeadForConversation({
      remoteJid,
      instance,
      content: signedText,
    })

    const res = await fetch(`${baseUrl}/message/sendText/${instance}`, {
      method:  'POST',
      headers: evolutionHeaders(apiKey),
      body:    JSON.stringify({
        number: phone,
        text: signedText,
        ...(quotedId ? {
          quoted: {
            key: { id: quotedId },
            message: { conversation: quotedContent ?? 'Mensagem respondida' },
          },
        } : {}),
      }),
      signal:  AbortSignal.timeout(15000),
    })
    if (!res.ok) {
      const errBody = await readResponseText(res)
      const isNotOnWA = errBody.toLowerCase().includes('not registered') || errBody.toLowerCase().includes('not in whatsapp') || errBody.toLowerCase().includes('invalid phone') || errBody.toLowerCase().includes('bad number') || res.status === 400
      if (isNotOnWA) return { ok: false, error: `Numero ${phone} nao encontrado no WhatsApp. Verifique se o numero esta correto e tem WhatsApp ativo.` }
      return { ok: false, error: `Erro ao enviar (HTTP ${res.status}): ${errBody || 'sem detalhes'}` }
    }
    const msg = await res.json() as Record<string, unknown>
    const msgId = (msg.key as Record<string, unknown>)?.id ?? msg.id ?? null
    await dbInsert('communication_events', [{
      source:          'evolution',
      event_type:      'message_sent',
      external_id:     msgId ? String(msgId) : null,
      conversation_id: remoteJid,
      lead_id:         leadId ?? ensuredLeadId ?? null,
      payload: {
        remoteJid, fromMe: true,
        messageId: msgId,
        content: signedText,
        messageType: 'conversation',
        mimeType: null,
        fileName: null,
        mediaUrl: null,
        quoted: quotedId ? { messageId: quotedId, content: quotedContent ?? 'Mensagem respondida' } : null,
        instance,
      },
    }])

    const crmSync = await syncCrmInbox({
      remoteJid,
      instance,
      pushName: contactName,
      content: signedText,
      direction: 'outgoing',
      senderType: 'humano',
      senderName,
      queueOverride,
      mediaUrl: null,
      mimeType: null,
      fileName: null,
    })

    return { ok: true, messageId: msgId, remoteJid, conversationId: crmSync?.conversationId ?? null }
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
  const senderName = form.get('sender_name')  as string | null

  if (!baseUrl || !apiKey || !instance || !number || !file) {
    return { ok: false, error: 'Parâmetros incompletos para envio de anexo' }
  }

  const phone = normalizePhone(number) ?? number
  const mime  = normalizeMimeType(file.type)
  const isAudio = mime.startsWith('audio/')
  const isImage = mime.startsWith('image/')
  const isVideo = mime.startsWith('video/')
  const settings = await loadCrmChatSettings()
  const signedCaption = settings.sign_outgoing_messages ? signOutgoingContent(caption, senderName) : caption

  const arrayBuffer = await file.arrayBuffer()
  const base64 = arrayBufferToBase64(arrayBuffer)
  const dataUrl = `data:${mime};base64,${base64}`

  try {
    const remoteJid = phoneToJid(phone)
    const ensuredLeadId = await ensureLeadForConversation({
      remoteJid,
      instance,
      content: signedCaption || file.name,
    })

    let endpoint: string

    if (isAudio) {
      endpoint = `${baseUrl}/message/sendWhatsAppAudio/${instance}`
      const audioData = `data:${mime};base64,${base64}`

      const attempts: Record<string, unknown>[] = [
        { number: phone, audio: base64 },
        { number: phone, audio: audioData },
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
          method: 'POST',
          headers: evolutionHeaders(apiKey),
          body: JSON.stringify(attemptBody),
          signal: AbortSignal.timeout(60000),
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

      await dbInsert('communication_events', [{
        source: 'evolution',
        event_type: 'message_sent',
        external_id: msgId ? String(msgId) : null,
        conversation_id: remoteJid,
        lead_id: leadId ?? ensuredLeadId ?? null,
        payload: {
          remoteJid,
          fromMe: true,
          messageId: msgId,
          content: signedCaption || file.name,
          messageType: 'audioMessage',
          mimeType: mime,
          fileName: file.name,
          mediaUrl: null,
          instance,
        },
      }])

      const crmSync = await syncCrmInbox({
        remoteJid,
        instance,
        content: signedCaption || file.name,
        direction: 'outgoing',
        senderType: 'humano',
        senderName,
        mediaUrl: null,
        mimeType: mime,
        fileName: file.name,
      })

      return { ok: true, messageId: msgId, remoteJid, conversationId: crmSync?.conversationId ?? null }
    }

    endpoint = `${baseUrl}/message/sendMedia/${instance}`
    const mediaType = isImage ? 'image' : isVideo ? 'video' : 'document'
    const fileLabel = caption || file.name

    const attempts: Record<string, unknown>[] = isImage || isVideo
      ? [
          { number: phone, mediatype: mediaType, mimetype: mime, caption: fileLabel, media: dataUrl },
          { number: phone, mediatype: mediaType, mimetype: mime, caption: fileLabel, media: base64 },
          { number: phone, mediatype: mediaType, mimetype: mime, caption: fileLabel, base64 },
        ]
      : [
          { number: phone, mediatype: 'document', mimetype: mime, caption: fileLabel, fileName: file.name, media: dataUrl },
          { number: phone, mediatype: 'document', mimetype: mime, caption: fileLabel, fileName: file.name, media: base64 },
          { number: phone, mediatype: 'document', mimetype: mime, caption: fileLabel, fileName: file.name, base64 },
        ]

    let mediaRes: Response | null = null
    let mediaErrorText = ''

    for (const attemptBody of attempts) {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: evolutionHeaders(apiKey),
        body: JSON.stringify(attemptBody),
        signal: AbortSignal.timeout(60000),
      })
      if (res.ok) {
        mediaRes = res
        break
      }
      mediaErrorText = await readResponseText(res)
    }

    if (!mediaRes) {
      return { ok: false, error: mediaErrorText || 'Falha ao enviar anexo para a Evolution API' }
    }

    const msg = await mediaRes.json() as Record<string, unknown>
    const msgId = (msg.key as Record<string, unknown>)?.id ?? null

    await dbInsert('communication_events', [{
      source: 'evolution',
      event_type: 'message_sent',
      external_id: msgId ? String(msgId) : null,
      conversation_id: remoteJid,
      lead_id: leadId ?? ensuredLeadId ?? null,
      payload: {
        remoteJid,
        fromMe: true,
        messageId: msgId,
        content: signedCaption || file.name,
        messageType: isImage ? 'imageMessage' : isVideo ? 'videoMessage' : 'documentMessage',
        mimeType: mime,
        fileName: file.name,
        mediaUrl: null,
        instance,
      },
    }])

    const crmSync = await syncCrmInbox({
      remoteJid,
      instance,
      content: signedCaption || file.name,
      direction: 'outgoing',
      senderType: 'humano',
      senderName,
      mediaUrl: null,
      mimeType: mime,
      fileName: file.name,
    })

    return { ok: true, messageId: msgId, remoteJid, conversationId: crmSync?.conversationId ?? null }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

// ── Proxy: init chat ──────────────────────────────────────────────────────────

async function actionInitChat(p: Record<string, unknown>) {
  const phone    = p.phone    as string | undefined
  const leadId   = p.lead_id  as string | undefined
  const instance = p.instance_name as string | undefined

  if (!phone) return { ok: false, error: 'phone é obrigatório' }

  const digits = normalizePhone(phone)
  if (!digits) return { ok: false, error: 'Número de telefone inválido' }

  const remoteJid = `${digits}@s.whatsapp.net`

  if (leadId) {
    await dbPatch('leads_contabilidade', `id=eq.${leadId}`, {
      evolution_remote_jid: remoteJid,
      evolution_instance:   instance ?? null,
    })
  }

  const events = await dbSelect(
    'communication_events',
    `conversation_id=eq.${encodeURIComponent(remoteJid)}&source=eq.evolution&order=created_at.asc&limit=100`,
    'id,event_type,payload,created_at',
  )

  return { ok: true, remoteJid, messages: events }
}

// ── Proxy: get messages ───────────────────────────────────────────────────────

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

// ── Proxy: get media base64 ───────────────────────────────────────────────────

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

// ── N8N: send message by instance name ───────────────────────────────────────

async function actionSendMessageByInstance(p: Record<string, unknown>) {
  const instanceName = p.instance_name as string | undefined
  const number       = p.number        as string | undefined
  const content      = p.content       as string | undefined
  const leadId       = p.lead_id       as string | undefined
  const senderName   = (p.sender_name as string | undefined)?.trim() || null

  if (!instanceName || !number || !content) {
    return { ok: false, error: 'instance_name, number e content são obrigatórios' }
  }

  const rows = await dbSelect(
    'external_integrations',
    `provider=eq.evolution&instance_name=eq.${encodeURIComponent(instanceName)}&status=eq.ativo`,
    'base_url,api_token,instance_name',
  )

  const instance = rows[0]
  if (!instance) {
    return { ok: false, error: `Instância Evolution não encontrada ou inativa: ${instanceName}` }
  }

  const baseUrl = (instance.base_url as string | undefined)?.replace(/\/$/, '')
  const apiKey  = instance.api_token as string | undefined

  if (!baseUrl || !apiKey) {
    return { ok: false, error: 'Credenciais da instância incompletas' }
  }

  const phone = normalizePhone(number) ?? number
  const settings = await loadCrmChatSettings()
  const signedContent = settings.sign_outgoing_messages ? signOutgoingContent(content, senderName) : content
  try {
    const res = await fetch(`${baseUrl}/message/sendText/${instanceName}`, {
      method: 'POST',
      headers: evolutionHeaders(apiKey),
      body: JSON.stringify({ number: phone, text: signedContent }),
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return { ok: false, error: `Evolution HTTP ${res.status}` }
    const msg = await res.json() as Record<string, unknown>
    const msgId = (msg.key as Record<string, unknown>)?.id ?? null

    const remoteJid = phoneToJid(phone)
    const ensuredLeadId = await ensureLeadForConversation({ remoteJid, instance: instanceName, content })
    await dbInsert('communication_events', [{
      source: 'evolution',
      event_type: 'message_sent',
      external_id: msgId ? String(msgId) : null,
      conversation_id: remoteJid,
      lead_id: leadId ?? ensuredLeadId ?? null,
      payload: { remoteJid, fromMe: true, messageId: msgId, content: signedContent, messageType: 'conversation', instance: instanceName, senderName },
    }])

    await syncCrmInbox({
      remoteJid,
      instance: instanceName,
      content: signedContent,
      direction: 'outgoing',
      senderType: 'ia',
      senderName,
    })

    return { ok: true, messageId: msgId, remoteJid }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

// ── Processa fila communication_outbox ───────────────────────────────────────

async function actionProcessOutbox(p: Record<string, unknown>) {
  const batchSize = Math.min(Number(p.batch_size ?? 30), 50)
  const dryRun = p.dry_run === true

  const rows = await dbSelect(
    'communication_outbox',
    `status=eq.queued&provider=eq.evolution&channel=eq.whatsapp&order=created_at.asc&limit=${batchSize}`,
    'id,to_address,body,payload',
  )

  if (rows.length === 0) return { ok: true, sent: 0, failed: 0, message: 'Nenhuma mensagem na fila.' }

  let sent = 0
  let failed = 0
  const errors: string[] = []

  for (const row of rows) {
    const id = row.id as string
    const phone = (row.to_address as string | undefined)?.replace(/\D/g, '') ?? ''
    const body = row.body as string | undefined
    const payload = row.payload as Record<string, unknown> | undefined
    const instanceName = payload?.instance_name as string | undefined

    if (!phone || !body || !instanceName) {
      await dbPatch('communication_outbox', `id=eq.${id}`, { status: 'error', sent_at: new Date().toISOString() })
      failed++
      errors.push(`${id}: dados incompletos`)
      continue
    }

    if (dryRun) { sent++; continue }

    const result = await actionSendMessageByInstance({ instance_name: instanceName, number: phone, content: body })

    if (result.ok) {
      await dbPatch('communication_outbox', `id=eq.${id}`, { status: 'sent', sent_at: new Date().toISOString() })
      sent++
    } else {
      await dbPatch('communication_outbox', `id=eq.${id}`, { status: 'error', sent_at: new Date().toISOString() })
      failed++
      errors.push(`${phone}: ${result.error}`)
    }

    // Pequena pausa para não sobrecarregar a Evolution API
    await new Promise(resolve => setTimeout(resolve, 300))
  }

  return { ok: true, sent, failed, errors: errors.slice(0, 10), remaining: rows.length - sent - failed }
}

// ── Proxy: list Evolution instances ──────────────────────────────────────────

async function actionListInstances() {
  const rows = await dbSelect(
    'external_integrations',
    'provider=eq.evolution&select=id,name,status,base_url,api_token,instance_name,last_test_at,last_error',
  )
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

    if (remoteJid.endsWith('@g.us')) return { ok: true, skipped: true, reason: 'group' }

    const { content, messageType, mediaUrl, mimeType, fileName, quoted } = extractContent(message)
    const eventType = fromMe ? 'message_sent' : 'message_received'

    const leadId = await ensureLeadForConversation({
      remoteJid,
      instance,
      pushName: pushName ?? null,
      content,
    })

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
        mimeType,
        fileName,
        quoted,
        instance,
      },
    }])

    if (!fromMe) {
      const crmSync = await syncCrmInbox({
        remoteJid,
        instance,
        pushName: pushName ?? null,
        content,
        externalMessageId: msgId ?? null,
        direction: 'incoming',
        senderType: 'cliente',
        mediaUrl,
        mimeType,
        fileName,
      })

      const documentKey = crmSync?.documentKey ?? jidToPhone(remoteJid).replace(/\D/g, '')
      const crmState = documentKey ? await getCrmConversationState(documentKey) : null
      const shouldForwardToN8N = Boolean(crmState && !crmState.atendimentoHumano)

      if (shouldForwardToN8N) {
        const n8nUrl = Deno.env.get('N8N_INBOUND_WEBHOOK_URL')
          ?? 'https://auto.mantovan.com.br/webhook/crm-certiid/inbound'
        const phone = jidToPhone(remoteJid)
        await fetch(n8nUrl, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            whatsapp_lead: phone,
            mensagem:      content ?? '',
            pushName:      pushName ?? null,
            remoteJid,
            messageType,
            mediaUrl:      mediaUrl ?? null,
            quoted:        quoted ?? null,
            instance:      instance ?? null,
            leadId:        leadId ?? null,
            messageId:     msgId ?? null,
            conversationId: crmState?.id ?? null,
            atendimentoHumano: crmState?.atendimentoHumano ?? false,
            automationMode: crmState?.atendimentoHumano ? 'humano' : 'clara',
          }),
          signal: AbortSignal.timeout(10000),
        }).catch(() => { /* ignora erro — não bloqueia resposta ao Evolution */ })
      }
    } else {
      await syncCrmInbox({
        remoteJid,
        instance,
        pushName: pushName ?? null,
        content,
        externalMessageId: msgId ?? null,
        direction: 'outgoing',
        senderType: inferOutgoingSenderType(instance),
        senderName: inferOutgoingSenderType(instance) === 'humano' ? (instance ?? 'Humano') : null,
        mediaUrl,
        mimeType,
        fileName,
      })
    }

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

  // ── N8N: ação interna autenticada por secret (sem JWT) ────────
  if (payload._action === 'send_message_by_instance') {
    const n8nSecret = getEnv('N8N_SHARED_SECRET')
    const incoming  = req.headers.get('x-n8n-secret') ?? ''
    if (!n8nSecret || incoming !== n8nSecret) {
      return json({ ok: false, error: 'Unauthorized' }, 401)
    }
    return json(await actionSendMessageByInstance(payload))
  }

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

  // Extrai o token recebido (query param ou header)
  const url = new URL(req.url)
  const incomingToken =
    url.searchParams.get('token')
    ?? url.searchParams.get('signature')
    ?? req.headers.get('x-webhook-token')
    ?? (req.headers.get('authorization') ?? '').replace(/^[Bb]earer\s+/, '')
    ?? ''

  if (!incomingToken) return unauthorizedWebhookResponse(req)

  // Aceita se o token bater com QUALQUER secret configurado
  const knownSecrets = [
    getEnv('EVOLUTION_WEBHOOK_SECRET'),
    getEnv('WEBHOOK_SECRET_ATENDIMENTO'),
    getEnv('WEBHOOK_SECRET_RENOVACAO'),
    getEnv('WEBHOOK_SECRET_CERTIID'),
  ].filter((s): s is string => Boolean(s))

  const webhookOk = knownSecrets.some(secret => secret === incomingToken)
  if (!webhookOk) return unauthorizedWebhookResponse(req)

  return json(await processWebhook(payload))
})
