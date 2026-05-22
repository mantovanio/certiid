// @ts-nocheck — Deno runtime
import { adminDb, CORS, json, requireAdmin } from '../_shared/security.ts'

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405)

  const auth = await requireAdmin(req)
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status)

  let body: { action?: string; payload?: Record<string, unknown> }
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, error: 'JSON inválido' }, 400)
  }

  const action = body.action
  const payload = body.payload ?? {}

  try {
    if (action === 'create_user') {
      const email = String(payload.email ?? '').trim().toLowerCase()
      const password = String(payload.senha ?? '')
      const nome = String(payload.nome ?? '').trim()
      const perfil = String(payload.perfil ?? 'usuario')
      const tipoVinculo = String(payload.tipo_vinculo ?? 'usuario_comum')
      const permissoes = Array.isArray(payload.permissoes) ? payload.permissoes : []

      if (!email || !password || !nome) return json({ ok: false, error: 'Dados obrigatórios ausentes' }, 400)

      const { data, error } = await adminDb.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { nome, perfil },
      })
      if (error || !data.user) return json({ ok: false, error: error?.message ?? 'Falha ao criar usuário' }, 400)

      const { error: upsertError } = await adminDb.from('profiles').upsert({
        id: data.user.id,
        nome,
        email,
        perfil,
        status: 'ativo',
        tipo_vinculo: tipoVinculo,
        permissoes,
      })
      if (upsertError) return json({ ok: false, error: upsertError.message }, 400)

      return json({ ok: true, userId: data.user.id })
    }

    if (action === 'update_password') {
      const userId = String(payload.userId ?? '')
      const password = String(payload.password ?? '')
      if (!userId || password.length < 6) {
        return json({ ok: false, error: 'Dados inválidos para troca de senha' }, 400)
      }

      const { error } = await adminDb.auth.admin.updateUserById(userId, { password })
      if (error) return json({ ok: false, error: error.message }, 400)

      return json({ ok: true })
    }

    if (action === 'delete_user') {
      const userId = String(payload.userId ?? '')
      if (!userId) return json({ ok: false, error: 'userId obrigatório' }, 400)

      const { error: profileError } = await adminDb.from('profiles').delete().eq('id', userId)
      if (profileError) return json({ ok: false, error: profileError.message }, 400)

      const { error: authError } = await adminDb.auth.admin.deleteUser(userId)
      if (authError) return json({ ok: false, error: authError.message }, 400)

      return json({ ok: true })
    }

    return json({ ok: false, error: 'Ação inválida' }, 400)
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : 'Erro interno' }, 500)
  }
})
