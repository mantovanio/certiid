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

function normalizeUrl(value: unknown, fallback: string) {
  const text = String(value ?? '').trim()
  return text || fallback
}

function isUnknownIssuerError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return /UnknownIssuer|invalid peer certificate/i.test(message)
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error ?? 'erro desconhecido')
}

async function fetchNotaJoseenseUrl(url: string) {
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': 'CertiID-NotaJoseense-Test/1.0' },
    })
    return { response, tlsBypassed: false }
  } catch (error) {
    if (!isUnknownIssuerError(error)) throw error
    const client = Deno.createHttpClient({
      unsafelyIgnoreCertificateErrors: ['notajoseense.sjc.sp.gov.br'],
    })
    const response = await fetch(url, {
      method: 'GET',
      client,
      headers: { 'User-Agent': 'CertiID-NotaJoseense-Test/1.0' },
    })
    return { response, tlsBypassed: true }
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

  if (config.provedor !== 'municipal') {
    return json({ ok: false, error: 'Essa rotina é exclusiva para perfis com provedor Portal Municipal.' }, 400)
  }

  const payload = (config.payload_reforma_tributaria ?? {}) as Record<string, unknown>
  const adapter = String(payload.municipal_adapter ?? '').trim()
  if (adapter !== 'nota_joseense') {
    return json({ ok: false, error: 'Esse teste técnico atende apenas o adaptador Nota Joseense.' }, 400)
  }

  const pendencias: string[] = []
  if (!String(config.municipio_nome ?? '').trim()) pendencias.push('Município')
  if (!String(config.cnpj_emitente ?? '').trim()) pendencias.push('CNPJ emitente')
  if (!String(config.inscricao_municipal ?? '').trim()) pendencias.push('Inscrição municipal')
  if (!String(config.codigo_servico_municipio ?? '').trim()) pendencias.push('Código do serviço')
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
    portal_login: false,
    portal_app: false,
    manual_publico_upload: false,
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

  const portalLoginUrl = normalizeUrl(
    payload.municipal_portal_url,
    'https://notajoseense.sjc.sp.gov.br/notafiscal/paginas/portal/#/login'
  )
  const loginPageUrl = 'https://notajoseense.sjc.sp.gov.br/notafiscal/paginas/login/login.jsf?faces-redirect=true&multiTenantId=8'

  let loginStatus = 0
  let portalStatus = 0
  let tlsBypassed = false
  try {
    const loginAttempt = await fetchNotaJoseenseUrl(loginPageUrl)
    const loginResponse = loginAttempt.response
    tlsBypassed = tlsBypassed || loginAttempt.tlsBypassed
    loginStatus = loginResponse.status
    const loginHtml = await loginResponse.text()
    if (!loginResponse.ok || !/Acesso via Senha|Certificado Digital|Nota Fiscal de Servi[cç]o Eletr[oô]nica/i.test(loginHtml)) {
      return json({
        ok: false,
        stage: 'portal_login',
        error: `O login público da Nota Joseense não respondeu como esperado. Status ${loginResponse.status}.`,
        checks,
        login_status: loginResponse.status,
      }, 502)
    }
    checks.portal_login = true

    const portalAttempt = await fetchNotaJoseenseUrl(portalLoginUrl)
    const portalResponse = portalAttempt.response
    tlsBypassed = tlsBypassed || portalAttempt.tlsBypassed
    portalStatus = portalResponse.status
    const portalHtml = await portalResponse.text()
    if (!portalResponse.ok || !/portal n[aã]o funciona corretamente sem o JavaScript ativado|login|nota fiscal/i.test(portalHtml)) {
      return json({
        ok: false,
        stage: 'portal_app',
        error: `O portal atual da Nota Joseense não respondeu como esperado. Status ${portalResponse.status}.`,
        checks,
        portal_status: portalResponse.status,
      }, 502)
    }
    checks.portal_app = true
  } catch (error) {
    if (isUnknownIssuerError(error)) {
      return json({
        ok: true,
        stage: 'conectividade_parcial',
        message: 'Seu perfil da Nota Joseense está pronto no que depende do seu sistema. A verificação automática do portal ficou pendente por causa do certificado SSL público da prefeitura.',
        checks,
        certificado: certSummary,
        login_status: loginStatus || null,
        portal_status: portalStatus || null,
        tls_warning: 'O portal da prefeitura apresentou certificado SSL com cadeia não reconhecida pelo ambiente técnico. Isso não invalida o seu perfil fiscal nem o certificado A1 salvo no sistema.',
        manual_status: 'O município prevê conversão de RPS via webservice, mas o formato do arquivo, o upload e o procedimento dependem do manual oficial da Nota Joseense.',
        next_step: 'Você pode seguir com a validação interna do perfil. Para emissão automática real, ainda será necessário o manual oficial de RPS/upload e, em paralelo, a preparação para o Emissor Nacional.',
      })
    }
    return json({
      ok: false,
      stage: 'portal',
      error: `Não foi possível alcançar o portal atual da Nota Joseense: ${errorMessage(error)}.`,
      checks,
    }, 502)
  }

  return json({
    ok: true,
    stage: 'conectividade',
    message: 'Seu perfil da Nota Joseense passou no teste técnico atual. Configuração, certificado A1 e portal municipal estão acessíveis.',
    checks,
    certificado: certSummary,
    login_status: loginStatus,
    portal_status: portalStatus,
    tls_warning: tlsBypassed
      ? 'O portal respondeu, mas o certificado SSL público exigiu tolerância técnica no teste por causa da cadeia do emissor.'
      : null,
    manual_status: 'O município prevê conversão de RPS via webservice, mas o formato do arquivo, o upload e o procedimento dependem do manual oficial da Nota Joseense.',
    next_step: 'Agora o próximo passo é obter com a prefeitura o manual oficial de RPS/upload ou o endpoint técnico liberado para integração, para então ligar a emissão automática real.',
  })
})
