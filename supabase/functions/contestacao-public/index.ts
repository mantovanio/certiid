// @ts-nocheck — Deno runtime
import { adminDb, CORS, json } from '../_shared/security.ts'

function cleanToken(value: unknown) {
  return String(value ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 120)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ ok: false, error: 'Método não permitido.' }, 405, req)

  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, error: 'JSON inválido.' }, 400, req)
  }

  const token = cleanToken(body.token)
  if (!token || token.length < 12) {
    return json({ ok: false, error: 'Token inválido.' }, 400, req)
  }

  const { data: documento, error: documentoError } = await adminDb
    .from('contestacao_documentos')
    .select('id, titulo, descricao, pdf_url, status, provedor_assinatura, assinatura_base_url, updated_at')
    .eq('public_token', token)
    .in('status', ['assinando', 'concluido'])
    .maybeSingle()

  if (documentoError) return json({ ok: false, error: documentoError.message }, 500, req)
  if (!documento) return json({ ok: false, error: 'Documento não encontrado.' }, 404, req)

  const { data: signatarios, error: signatariosError } = await adminDb
    .from('contestacao_signatarios')
    .select('id, nome, email, cargo, status, ordem, assinatura_url, certificado_subject, assinado_em, observacoes')
    .eq('documento_id', documento.id)
    .order('ordem', { ascending: true })
    .order('created_at', { ascending: true })

  if (signatariosError) return json({ ok: false, error: signatariosError.message }, 500, req)

  return json({
    ok: true,
    documento,
    signatarios: signatarios ?? [],
    fetched_at: new Date().toISOString(),
  }, 200, req)
})
