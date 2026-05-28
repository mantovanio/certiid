// @ts-nocheck — Deno runtime shared helpers
import { createClient } from 'npm:@supabase/supabase-js@2'

export const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
export const SERVICE_KEY = Deno.env.get('SUPABASE_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const DEFAULT_ALLOWED_ORIGINS = [
  'https://certiid.mantovan.com.br',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
]

const allowedOrigins = (Deno.env.get('APP_ALLOWED_ORIGINS') ?? DEFAULT_ALLOWED_ORIGINS.join(','))
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean)

function resolveAllowedOrigin(origin: string | null) {
  if (origin && allowedOrigins.includes(origin)) return origin
  return allowedOrigins[0] ?? 'https://certiid.mantovan.com.br'
}

export function corsHeaders(req?: Request) {
  return {
    'Access-Control-Allow-Origin': resolveAllowedOrigin(req?.headers.get('origin') ?? null),
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-webhook-token, x-signature',
    'Vary': 'Origin',
  }
}

export const CORS = corsHeaders()

export const adminDb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

export function json(body: unknown, status = 200, req?: Request) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  })
}

export function unauthorizedWebhookResponse(req?: Request) {
  return json({ ok: false, error: 'Webhook sem assinatura válida.' }, 401, req)
}

function normalizeSecret(value: string | null | undefined) {
  return String(value ?? '').trim()
}

function constantTimeEquals(a: string, b: string) {
  const aBytes = new TextEncoder().encode(a)
  const bBytes = new TextEncoder().encode(b)
  if (aBytes.length !== bBytes.length) return false
  let diff = 0
  for (let i = 0; i < aBytes.length; i += 1) diff |= aBytes[i] ^ bBytes[i]
  return diff === 0
}

async function hmacSha256Hex(secret: string, content: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(content))
  return Array.from(new Uint8Array(signature))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

async function hmacSha256Base64(secret: string, content: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(content))
  return btoa(String.fromCharCode(...new Uint8Array(signature)))
}

type WebhookValidationOptions = {
  secret?: string | null
  rawBody?: string
  tokenHeaders?: string[]
  signatureHeaders?: string[]
  queryParams?: string[]
}

export async function verifyWebhookRequest(req: Request, options: WebhookValidationOptions = {}) {
  const configuredSecret = normalizeSecret(options.secret)
  const insecureAllowed = normalizeSecret(Deno.env.get('ALLOW_INSECURE_WEBHOOKS')).toLowerCase() === 'true'

  if (!configuredSecret) return insecureAllowed

  const tokenHeaders = options.tokenHeaders ?? ['x-webhook-token', 'x-safe2pay-token', 'authorization']
  for (const headerName of tokenHeaders) {
    const headerValue = normalizeSecret(req.headers.get(headerName))
    if (!headerValue) continue
    const candidate = headerName === 'authorization' && headerValue.toLowerCase().startsWith('bearer ')
      ? headerValue.slice(7).trim()
      : headerValue
    if (constantTimeEquals(candidate, configuredSecret)) return true
  }

  const url = new URL(req.url)
  for (const paramName of options.queryParams ?? ['token', 'signature']) {
    const paramValue = normalizeSecret(url.searchParams.get(paramName))
    if (paramValue && constantTimeEquals(paramValue, configuredSecret)) return true
  }

  if (options.rawBody) {
    const expectedHex = await hmacSha256Hex(configuredSecret, options.rawBody)
    const expectedBase64 = await hmacSha256Base64(configuredSecret, options.rawBody)
    for (const headerName of options.signatureHeaders ?? ['x-signature', 'x-webhook-signature']) {
      const signature = normalizeSecret(req.headers.get(headerName))
      if (!signature) continue
      if (constantTimeEquals(signature, expectedHex) || constantTimeEquals(signature, expectedBase64)) {
        return true
      }
    }
  }

  return false
}

export async function requireAuthenticatedUser(req: Request) {
  const authHeader = req.headers.get('Authorization') ?? ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return { ok: false, status: 401, error: 'Token ausente' }

  const { data: userData, error: userError } = await adminDb.auth.getUser(token)
  if (userError || !userData.user) {
    return { ok: false, status: 401, error: 'Sessão inválida' }
  }

  const { data: profile, error: profileError } = await adminDb
    .from('profiles')
    .select('id, perfil, status, permissoes')
    .eq('id', userData.user.id)
    .maybeSingle()

  if (profileError) return { ok: false, status: 500, error: profileError.message }
  if (!profile || profile.status !== 'ativo') {
    return { ok: false, status: 403, error: 'Usuário sem acesso ativo' }
  }

  return { ok: true, user: userData.user, profile }
}

export async function requireAdmin(req: Request) {
  const auth = await requireAuthenticatedUser(req)
  if (!auth.ok) return auth
  if (auth.profile.perfil !== 'admin') {
    return { ok: false, status: 403, error: 'Acesso restrito a administradores' }
  }
  return auth
}
