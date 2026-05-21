import { supabase } from '@/lib/supabase'
import type { CommunicationChannel, CommunicationProvider } from '@/types'

interface QueueMessageInput {
  channel: CommunicationChannel
  provider: CommunicationProvider
  to: string
  body: string
  subject?: string | null
  payload?: Record<string, unknown>
  scheduledFor?: string
}

export async function queueCommunication({
  channel,
  provider,
  to,
  body,
  subject = null,
  payload = {},
  scheduledFor,
}: QueueMessageInput) {
  const { error } = await supabase.from('communication_outbox').insert([{
    channel,
    provider,
    to_address: to,
    subject,
    body,
    payload,
    scheduled_for: scheduledFor ?? new Date().toISOString(),
  }])

  return { error: error?.message ?? null }
}

export function queueWhatsAppMessage(input: Omit<QueueMessageInput, 'channel' | 'provider'>) {
  return queueCommunication({
    ...input,
    channel: 'whatsapp',
    provider: 'chatwoot_disparo',
  })
}

export function queueEmailMessage(input: Omit<QueueMessageInput, 'channel' | 'provider'>) {
  return queueCommunication({
    ...input,
    channel: 'email',
    provider: 'email_smtp',
  })
}

export function queueChatwootConversationAction(input: {
  to: string
  body: string
  subject?: string | null
  payload?: Record<string, unknown>
  scheduledFor?: string
}) {
  return queueCommunication({
    channel: 'webhook',
    provider: 'chatwoot',
    to: input.to,
    body: input.body,
    subject: input.subject ?? null,
    payload: {
      ...(input.payload ?? {}),
      _action: 'chatwoot_conversation_update',
    },
    scheduledFor: input.scheduledFor,
  })
}

export function renderTemplate(template: string, values: Record<string, string | number | null | undefined>) {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => String(values[key] ?? ''))
}

export function queueWhatsAppFollowUp(input: {
  to: string
  body: string
  renovacaoId: string
  delayHours?: number
}) {
  const delayMs = (input.delayHours ?? 48) * 3600 * 1000
  return queueCommunication({
    channel: 'whatsapp',
    provider: 'chatwoot_disparo',
    to: input.to,
    body: input.body,
    payload: {
      renovacao_id: input.renovacaoId,
      tipo: 'renovacao_followup_auto',
      followup_round: 1,
    },
    scheduledFor: new Date(Date.now() + delayMs).toISOString(),
  })
}
