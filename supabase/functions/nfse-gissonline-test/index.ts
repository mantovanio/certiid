// @ts-nocheck — Deno runtime (Supabase Edge Functions)
import forge from 'npm:node-forge@1.3.1'
import { CORS, adminDb, json, requireAdmin } from '../_shared/security.ts'

function arrayBufferToBinaryString(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  let result = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize)
    result += String.fromCharCode(...chunk)
  }
  return result
}

function extractCertificateSummary(pfxBuffer: ArrayBuffer, password: string) {
  const der = arrayBufferToBinaryString(pfxBuffer)
  const asn1 = forge.asn1.fromDer(der)
  const pkcs12 = forge.pkcs12.pkcs12FromAsn1(asn1, password)
  const bags = pkcs12.getBags({ bagType: forge.pki.oids.certBag })
  const certBags = bags[forge.pki.oids.certBag] ?? []
  if (certBags.length === 0) {
    throw new Error('O arquivo A1 não contém certificado legível.')
  }

  const cert = certBags[0].cert
  const getField = (shortName: string) => cert.subject.getField(shortName)?.value ?? ''

  return {
    commonName: getField('CN'),
    organization: getField('O'),
    serialNumber: cert.serialNumber ?? '',
    validFrom: cert.validity.notBefore?.toISOString?.() ?? String(cert.validity.notBefore),
    validTo: cert.validity.notAfter?.toISOString?.() ?? String(cert.validity.notAfter),
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS })
  }

  if (req.method !== 'POST') {
    return json({ ok: false, error: 'Método não permitido.' }, 405)
  }

  const auth = await requireAdmin(req)
  if (!auth.ok) {
    return json({ ok: false, error: auth.error }, auth.status)
  }

  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, error: 'Payload inválido.' }, 400)
  }

  const configuracaoId = String(body.configuracao_id ?? '').trim()
  if (!configuracaoId) {
    return json({ ok: false, error: 'Informe a configuração fiscal a ser testada.' }, 400)
  }

  const { data: config, error: configError } = await adminDb
    .from('nfse_configuracoes')
    .select('*')
    .eq('id', configuracaoId)
    .maybeSingle()

  if (configError) {
    return json({ ok: false, error: configError.message }, 500)
  }

  if (!config) {
    return json({ ok: false, error: 'Configuração fiscal não encontrada.' }, 404)
  }

  if (config.provedor !== 'gissonline') {
    return json({ ok: false, error: 'Essa rotina é exclusiva para perfis com provedor GISSONLINE.' }, 400)
  }

  const pendencias: string[] = []
  if (!String(config.municipio_nome ?? '').trim()) pendencias.push('Município')
  if (!String(config.cnpj_emitente ?? '').trim()) pendencias.push('CNPJ emitente')
  if (!String(config.inscricao_municipal ?? '').trim()) pendencias.push('Inscrição municipal')
  if (!String(config.codigo_servico_municipio ?? '').trim()) pendencias.push('Código do serviço')
  if (!String(config.usuario_prefeitura ?? '').trim()) pendencias.push('Usuário da prefeitura')
  if (!String(config.senha_prefeitura ?? '').trim()) pendencias.push('Senha da prefeitura')
  if (!String(config.certificado_pfx_path ?? '').trim()) pendencias.push('Certificado A1')
  if (!String(config.certificado_senha ?? '').trim()) pendencias.push('Senha do certificado')

  if (pendencias.length > 0) {
    return json({
      ok: false,
      stage: 'validacao',
      error: `Complete os campos obrigatórios antes do teste: ${pendencias.join(', ')}.`,
      checks: {
        configuracao: false,
      },
    }, 400)
  }

  const checks = {
    configuracao: true,
    certificado_storage: false,
    certificado_leitura: false,
    ambiente_homologacao: false,
  }

  const certificadosBucket = adminDb.storage.from('certificados-digitais')
  const certPath = String(config.certificado_pfx_path)
  const certPassword = String(config.certificado_senha)

  const { data: certFile, error: certDownloadError } = await certificadosBucket.download(certPath)
  if (certDownloadError || !certFile) {
    return json({
      ok: false,
      stage: 'certificado',
      error: `Não foi possível baixar o certificado A1 salvo no bucket: ${certDownloadError?.message ?? 'arquivo ausente'}.`,
      checks,
    }, 400)
  }
  checks.certificado_storage = true

  let certSummary: Record<string, unknown> | null = null
  try {
    const certBuffer = await certFile.arrayBuffer()
    certSummary = extractCertificateSummary(certBuffer, certPassword)
    checks.certificado_leitura = true
  } catch (error) {
    return json({
      ok: false,
      stage: 'certificado',
      error: `Não foi possível abrir o certificado A1 com a senha informada: ${error instanceof Error ? error.message : 'erro desconhecido'}.`,
      checks,
    }, 400)
  }

  let homologacaoStatus = 0
  let homologacaoSnippet = ''
  try {
    const response = await fetch('https://ws-homologacao.giss.com.br/giss-ajuda/desenvolvedores.html', {
      method: 'GET',
      headers: { 'User-Agent': 'CertiID-NFSE-Test/1.0' },
    })
    homologacaoStatus = response.status
    homologacaoSnippet = (await response.text()).slice(0, 200)
    if (!response.ok) {
      return json({
        ok: false,
        stage: 'homologacao',
        error: `O ambiente oficial de homologação do GISSONLINE respondeu com status ${response.status}.`,
        checks,
        homologacao_status: response.status,
      }, 502)
    }
    checks.ambiente_homologacao = true
  } catch (error) {
    return json({
      ok: false,
      stage: 'homologacao',
      error: `Não foi possível alcançar o ambiente de homologação do GISSONLINE: ${error instanceof Error ? error.message : 'erro desconhecido'}.`,
      checks,
    }, 502)
  }

  return json({
    ok: true,
    stage: 'conectividade',
    message: 'Seu perfil fiscal passou no teste técnico do GISSONLINE. Configuração, certificado A1 e ambiente de homologação estão acessíveis.',
    checks,
    certificado: certSummary,
    homologacao_status: homologacaoStatus,
    homologacao_hint: homologacaoSnippet,
    next_step: 'O próximo passo é ligar a assinatura XML e o envio SOAP para testar emissão, consulta e retorno municipal.',
  })
})
