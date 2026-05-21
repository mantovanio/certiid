// @ts-nocheck — Deno runtime
const EVOLUTION_URL      = (Deno.env.get('EVOLUTION_URL') ?? '').replace(/\/$/, '')
const EVOLUTION_KEY      = Deno.env.get('EVOLUTION_API_KEY') ?? ''
const EVOLUTION_INSTANCE = Deno.env.get('EVOLUTION_INSTANCE') ?? ''
const SUPABASE_URL       = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY        = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

async function getAdminPhone(): Promise<string | null> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/app_settings?key=eq.agency&select=value`, {
    headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` },
  })
  if (!res.ok) return null
  const rows = await res.json() as Array<{ value: Record<string, unknown> }>
  const telefone = rows[0]?.value?.telefone as string | undefined
  if (!telefone) return null
  return telefone.replace(/\D/g, '')
}

async function sendWhatsApp(to: string, text: string): Promise<boolean> {
  if (!EVOLUTION_URL || !EVOLUTION_KEY || !EVOLUTION_INSTANCE) return false
  try {
    const res = await fetch(`${EVOLUTION_URL}/message/sendText/${EVOLUTION_INSTANCE}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_KEY },
      body:    JSON.stringify({ number: to, text }),
      signal:  AbortSignal.timeout(10000),
    })
    return res.ok
  } catch {
    return false
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST')   return new Response('Method not allowed', { status: 405, headers: CORS })

  let payload: { nome: string; email: string; vinculo: string }
  try { payload = await req.json() }
  catch { return json({ ok: false, error: 'JSON inválido' }, 400) }

  const { nome, email, vinculo } = payload
  if (!nome || !email) return json({ ok: false, error: 'nome e email são obrigatórios' }, 400)

  const dataHora = new Date().toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
  })

  const adminPhone = await getAdminPhone()

  // WhatsApp para o admin
  let whatsappOk = false
  if (adminPhone) {
    const msg = [
      `🔔 *Novo usuário aguardando aprovação*`,
      ``,
      `Um novo cadastro foi realizado na plataforma e aguarda a sua liberação.`,
      ``,
      `*Dados do usuário:*`,
      `👤 *Nome:* ${nome}`,
      `📧 *E-mail:* ${email}`,
      `🔗 *Perfil:* ${vinculo}`,
      `🕐 *Data/hora:* ${dataHora}`,
      ``,
      `Acesse o painel para aprovar ou recusar o acesso.`,
    ].join('\n')
    whatsappOk = await sendWhatsApp(adminPhone, msg)
  }

  return json({ ok: true, whatsapp: whatsappOk, adminPhone: adminPhone ?? 'não encontrado' })
})
