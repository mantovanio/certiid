// @ts-nocheck — Deno runtime (Supabase Edge Functions)
import { CORS, json, requireAuthenticatedUser } from '../_shared/security.ts'

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? ''
const ANTHROPIC_MODEL = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-sonnet-4-6'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS })
  }
  if (req.method !== 'POST') {
    return json({ ok: false, error: 'Método não permitido.' }, 405, req)
  }

  const auth = await requireAuthenticatedUser(req)
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status, req)

  if (!ANTHROPIC_API_KEY) {
    return json({ ok: false, error: 'Integração com IA não configurada no servidor.' }, 503, req)
  }

  let payload: { messages?: Array<{ role: 'user' | 'assistant'; content: string }>; system?: string }
  try {
    payload = await req.json()
  } catch {
    return json({ ok: false, error: 'Payload inválido.' }, 400, req)
  }

  const messages = Array.isArray(payload.messages)
    ? payload.messages
        .filter(message => message && (message.role === 'user' || message.role === 'assistant'))
        .map(message => ({
          role: message.role,
          content: String(message.content ?? '').slice(0, 8000),
        }))
        .filter(message => message.content.trim().length > 0)
    : []

  if (!messages.length) {
    return json({ ok: false, error: 'Nenhuma mensagem válida foi enviada.' }, 400, req)
  }

  const systemPrompt = String(
    payload.system
      ?? 'Você é um assistente do sistema CertiID. Responda sempre em português do Brasil, de forma direta, objetiva e segura.',
  ).slice(0, 2000)

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 2048,
      system: systemPrompt,
      messages,
    }),
  })

  const data = await upstream.json().catch(() => ({}))
  if (!upstream.ok) {
    const errorMessage = String(data?.error?.message ?? 'Falha ao consultar a IA.')
    return json({ ok: false, error: errorMessage }, upstream.status, req)
  }

  const reply = String(data?.content?.[0]?.text ?? '').trim()
  return json({ ok: true, reply: reply || 'Sem resposta.' }, 200, req)
})
