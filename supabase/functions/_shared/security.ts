// @ts-nocheck — Deno runtime shared helpers
import { createClient } from 'npm:@supabase/supabase-js@2'

export const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
export const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
}

export const adminDb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
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
