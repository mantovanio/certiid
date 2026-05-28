// @ts-nocheck — Deno runtime (Supabase Edge Functions)
import forge from 'npm:node-forge@1.3.1'
import { SignedXml } from 'npm:xml-crypto@6.1.2'
import { CORS, adminDb, json, requireAuthenticatedUser } from '../_shared/security.ts'

const NFSE_XML_NS = 'http://www.abrasf.org.br/nfse.xsd'
const SOAP_NS = 'http://nfse.abrasf.org.br'
const DEFAULT_ENDPOINTS = {
  homologacao: 'https://homol-notajoseense.sjc.sp.gov.br/notafiscal-abrasfv203-ws/NotaFiscalSoap',
  producao_restrita: 'https://homol-notajoseense.sjc.sp.gov.br/notafiscal-abrasfv203-ws/NotaFiscalSoap',
  producao: 'https://notajoseense.sjc.sp.gov.br/notafiscal-abrasfv203-ws/NotaFiscalSoap',
}

function digits(value: unknown) {
  return String(value ?? '').replace(/\D/g, '')
}

function xmlEscape(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function formatDecimal(value: unknown, fractionDigits = 2) {
  return Number(value ?? 0).toFixed(fractionDigits)
}

function boolCode(value: boolean | null | undefined) {
  return value ? '1' : '2'
}

function onlyText(value: unknown) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E\n\r\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

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

function extractPfxMaterials(pfxBuffer: ArrayBuffer, password: string) {
  const der = arrayBufferToBinaryString(pfxBuffer)
  const asn1 = forge.asn1.fromDer(der)
  const pkcs12 = forge.pkcs12.pkcs12FromAsn1(asn1, password)

  const certBags = pkcs12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? []
  const keyBags =
    pkcs12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag]
    ?? pkcs12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag]
    ?? []

  if (!certBags.length || !keyBags.length) {
    throw new Error('O certificado A1 não possui certificado e chave privada válidos.')
  }

  const cert = certBags[0].cert
  const privateKey = keyBags[0].key
  return {
    certPem: forge.pki.certificateToPem(cert),
    keyPem: forge.pki.privateKeyToPem(privateKey),
    summary: {
      commonName: cert.subject.getField('CN')?.value ?? '',
      organization: cert.subject.getField('O')?.value ?? '',
      validFrom: cert.validity.notBefore?.toISOString?.() ?? String(cert.validity.notBefore),
      validTo: cert.validity.notAfter?.toISOString?.() ?? String(cert.validity.notAfter),
      serialNumber: cert.serialNumber ?? '',
    },
  }
}

function parsePositiveInt(value: unknown) {
  const clean = digits(value)
  return clean ? Number(clean) : null
}

function normalizeByte(value: unknown, fallback: string) {
  const text = String(value ?? '').trim()
  if (!text) return fallback
  if (/^\d+$/.test(text)) return text
  const low = text.toLowerCase()
  if (low.includes('exig')) return '1'
  if (low.includes('nenhum')) return '0'
  if (low.includes('microempresa')) return '1'
  if (low.includes('estimativa')) return '2'
  if (low.includes('sociedade')) return '3'
  if (low.includes('cooperativa')) return '4'
  if (low.includes('mei')) return '6'
  return fallback
}

function buildDiscriminacao(venda: Record<string, unknown>) {
  const linhas = [
    `Tipo: ${onlyText(venda.produto_tipo ?? venda.tipo_produto ?? 'certificado digital')}.`,
  ]
  if (String(venda.produto_modelo ?? '').trim()) {
    linhas.push(`Modelo: ${onlyText(venda.produto_modelo)}.`)
  }
  if (String(venda.produto_validade ?? '').trim()) {
    linhas.push(`Validade: ${onlyText(venda.produto_validade)}.`)
  }
  if (String(venda.tipo_emissao ?? '').trim()) {
    linhas.push(`Tipo de emissao: ${onlyText(venda.tipo_emissao)}.`)
  }
  return linhas.join('\n').slice(0, 1900)
}

function optionalTag(tag: string, value: unknown) {
  const text = String(value ?? '').trim()
  return text ? `<${tag}>${xmlEscape(text)}</${tag}>` : ''
}

function optionalIntTag(tag: string, value: unknown) {
  const parsed = parsePositiveInt(value)
  return parsed ? `<${tag}>${parsed}</${tag}>` : ''
}

function buildTomadorXml(venda: Record<string, unknown>) {
  const documento = digits(venda.documento_faturamento)
  const nome = String(venda.nome_faturamento ?? '').trim()
  if (![11, 14].includes(documento.length) || !nome) return ''

  const cpfCnpj = documento.length === 11
    ? `<Cpf>${documento}</Cpf>`
    : `<Cnpj>${documento}</Cnpj>`

  return `
    <Tomador>
      <IdentificacaoTomador>
        <CpfCnpj>${cpfCnpj}</CpfCnpj>
        ${optionalTag('InscricaoMunicipal', venda.inscricao_municipal)}
      </IdentificacaoTomador>
      <RazaoSocial>${xmlEscape(nome)}</RazaoSocial>
      <Endereco>
        ${optionalTag('Endereco', venda.logradouro)}
        ${optionalTag('Numero', venda.numero)}
        ${optionalTag('Complemento', venda.complemento)}
        ${optionalTag('Bairro', venda.bairro)}
        ${optionalIntTag('CodigoMunicipio', venda.municipio_codigo_ibge ?? venda.codigo_municipio)}
        ${optionalTag('Uf', venda.uf)}
        ${optionalTag('Cep', digits(venda.cep))}
      </Endereco>
      <Contato>
        ${optionalTag('Telefone', digits(venda.telefone_faturamento))}
        ${optionalTag('Email', venda.email_faturamento)}
      </Contato>
    </Tomador>
  `.replace(/\n\s+/g, '').trim()
}

function buildTomadorSnapshot(venda: Record<string, unknown>) {
  const endereco = [
    String(venda.logradouro ?? '').trim(),
    String(venda.numero ?? '').trim(),
    String(venda.bairro ?? '').trim(),
    String(venda.cep ?? '').trim() ? `CEP ${String(venda.cep).trim()}` : '',
  ].filter(Boolean).join(', ')

  return {
    nome: String(venda.nome_faturamento ?? '').trim(),
    documento: String(venda.documento_faturamento ?? '').trim(),
    inscricao_municipal: String(venda.inscricao_municipal ?? '').trim(),
    telefone: String(venda.telefone_faturamento ?? '').trim(),
    email: String(venda.email_faturamento ?? '').trim(),
    endereco,
    complemento: String(venda.complemento ?? '').trim(),
    municipio: [String(venda.cidade ?? '').trim(), String(venda.uf ?? '').trim()].filter(Boolean).join(' - '),
  }
}

function buildEmitenteSnapshot(config: Record<string, unknown>) {
  const payload = (config.payload_reforma_tributaria ?? {}) as Record<string, unknown>
  return {
    nome: String(payload.razao_social ?? payload.nome_emitente ?? config.identificador ?? '').trim(),
    documento: String(config.cnpj_emitente ?? '').trim(),
    inscricao_municipal: String(config.inscricao_municipal ?? '').trim(),
    telefone: String(payload.telefone ?? '').trim(),
    email: String(payload.email ?? '').trim(),
    endereco: String(payload.endereco ?? '').trim(),
    complemento: String(payload.complemento ?? '').trim(),
    municipio: String(payload.municipio ?? config.municipio_nome ?? '').trim(),
  }
}

function buildGerarNfseXml(config: Record<string, unknown>, venda: Record<string, unknown>) {
  const numeroRps = Number(config.numero_rps_atual ?? 1)
  const serieRps = xmlEscape(config.serie_rps ?? 'RPS')
  const cnpjEmitente = digits(config.cnpj_emitente)
  const ibge = parsePositiveInt(config.municipio_codigo_ibge)
  const cnae = parsePositiveInt(config.cnae)
  const itemListaServico = String(config.codigo_servico_municipio ?? '').trim()
  const valorServico = Number(venda.valor_venda ?? 0)

  if (!ibge) throw new Error('Informe o código IBGE do município na configuração fiscal.')
  if (!cnae) throw new Error('Informe o CNAE numérico do emitente na configuração fiscal.')
  if (!itemListaServico) throw new Error('Informe o código do serviço na configuração fiscal.')

  const documentoTomador = digits(venda.documento_faturamento)
  if (![11, 14].includes(documentoTomador.length)) {
    throw new Error('O tomador da nota precisa ter CPF ou CNPJ válido.')
  }

  const infId = `RPS${numeroRps}`
  const dataHoje = new Date()
  const dataRps = dataHoje.toISOString().slice(0, 10)
  const competencia = dataRps
  const aliquota = Number(config.aliquota_iss ?? 0) / 100
  const issRetido = Boolean(venda.iss_retido)
  const tomadorXml = buildTomadorXml(venda)
  const discriminacao = xmlEscape(buildDiscriminacao(venda))

  const xml = `
<GerarNfseEnvio xmlns="${NFSE_XML_NS}">
  <Rps>
    <InfDeclaracaoPrestacaoServico Id="${infId}">
      <Rps>
        <IdentificacaoRps>
          <Numero>${numeroRps}</Numero>
          <Serie>${serieRps}</Serie>
          <Tipo>1</Tipo>
        </IdentificacaoRps>
        <DataEmissao>${dataRps}</DataEmissao>
        <Status>1</Status>
      </Rps>
      <Competencia>${competencia}</Competencia>
      <Servico>
        <Valores>
          <ValorServicos>${formatDecimal(valorServico)}</ValorServicos>
          <ValorDeducoes>0.00</ValorDeducoes>
          <ValorPis>0.00</ValorPis>
          <ValorCofins>0.00</ValorCofins>
          <ValorInss>0.00</ValorInss>
          <ValorIr>0.00</ValorIr>
          <ValorCsll>0.00</ValorCsll>
          <OutrasRetencoes>0.00</OutrasRetencoes>
          <ValorIss>${formatDecimal(0)}</ValorIss>
          <Aliquota>${formatDecimal(aliquota, 4)}</Aliquota>
          <DescontoIncondicionado>0.00</DescontoIncondicionado>
          <DescontoCondicionado>0.00</DescontoCondicionado>
        </Valores>
        <IssRetido>${issRetido ? '1' : '2'}</IssRetido>
        <ItemListaServico>${xmlEscape(itemListaServico)}</ItemListaServico>
        <CodigoCnae>${cnae}</CodigoCnae>
        ${optionalTag('CodigoTributacaoMunicipio', config.codigo_tributacao_municipio)}
        <Discriminacao>${discriminacao}</Discriminacao>
        <CodigoMunicipio>${ibge}</CodigoMunicipio>
        <ExigibilidadeISS>${normalizeByte(config.exigibilidade_iss, '1')}</ExigibilidadeISS>
        <MunicipioIncidencia>${ibge}</MunicipioIncidencia>
      </Servico>
      <Prestador>
        <CpfCnpj><Cnpj>${cnpjEmitente}</Cnpj></CpfCnpj>
        <InscricaoMunicipal>${xmlEscape(config.inscricao_municipal ?? '')}</InscricaoMunicipal>
      </Prestador>
      ${tomadorXml}
      ${optionalTag('RegimeEspecialTributacao', /^\d+$/.test(String(config.regime_especial ?? '').trim()) ? String(config.regime_especial).trim() : '')}
      <OptanteSimplesNacional>${boolCode(Boolean(config.simples_nacional))}</OptanteSimplesNacional>
      <IncentivoFiscal>${boolCode(Boolean(config.incentivo_fiscal))}</IncentivoFiscal>
    </InfDeclaracaoPrestacaoServico>
  </Rps>
</GerarNfseEnvio>`.trim()

  return { xml, numeroRps }
}

function signGerarNfseXml(xml: string, certPem: string, keyPem: string) {
  const sig = new SignedXml()
  sig.privateKey = keyPem
  sig.publicCert = certPem
  sig.signatureAlgorithm = 'http://www.w3.org/2000/09/xmldsig#rsa-sha1'
  sig.canonicalizationAlgorithm = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'
  sig.addReference({
    xpath: "//*[local-name(.)='InfDeclaracaoPrestacaoServico']",
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    ],
    digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
  })
  sig.computeSignature(xml, {
    location: {
      reference: "//*[local-name(.)='InfDeclaracaoPrestacaoServico']",
      action: 'after',
    },
  })
  return sig.getSignedXml()
}

function buildSoapEnvelope(dadosXml: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ws="${SOAP_NS}">
  <soapenv:Header/>
  <soapenv:Body>
    <ws:GerarNfse>
      ${dadosXml}
    </ws:GerarNfse>
  </soapenv:Body>
</soapenv:Envelope>`
}

function extractSoapData(xml: string) {
  const numeroNf = xml.match(/<Numero>([^<]+)<\/Numero>/i)?.[1] ?? null
  const codigoVerificacao = xml.match(/<CodigoVerificacao>([^<]+)<\/CodigoVerificacao>/i)?.[1] ?? null
  const dataEmissao = xml.match(/<DataEmissao>([^<]+)<\/DataEmissao>/i)?.[1] ?? null
  const codigoErro = xml.match(/<Codigo>([^<]+)<\/Codigo>/i)?.[1] ?? null
  const mensagemErro = xml.match(/<Mensagem>([^<]+)<\/Mensagem>/i)?.[1] ?? null
  return { numeroNf, codigoVerificacao, dataEmissao, codigoErro, mensagemErro }
}

function resolveEndpoint(config: Record<string, unknown>) {
  const payload = (config.payload_reforma_tributaria ?? {}) as Record<string, unknown>
  const custom = String(payload.municipal_ws_endpoint ?? '').trim()
  if (custom) return custom
  const ambiente = String(config.ambiente ?? 'homologacao').trim()
  return DEFAULT_ENDPOINTS[ambiente] || DEFAULT_ENDPOINTS.homologacao
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS })
  }
  if (req.method !== 'POST') {
    return json({ ok: false, error: 'Método não permitido.' }, 405)
  }

  const auth = await requireAuthenticatedUser(req)
  if (!auth.ok) {
    return json({ ok: false, error: auth.error }, auth.status)
  }

  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, error: 'Payload inválido.' }, 400)
  }

  const vendaId = String(body.venda_certificado_id ?? '').trim()
  const justificativaForaEtapa = String(body.justificativa_fora_etapa ?? '').trim() || null
  const produtoTipo = String(body.produto_tipo ?? '').trim() || null
  const produtoModelo = String(body.produto_modelo ?? '').trim() || null
  const produtoValidade = String(body.produto_validade ?? '').trim() || null
  const tipoEmissao = String(body.tipo_emissao ?? '').trim() || null
  if (!vendaId) {
    return json({ ok: false, error: 'Informe a venda que será enviada à Nota Joseense.' }, 400)
  }

  const [{ data: venda, error: vendaError }, { data: configs, error: configError }] = await Promise.all([
    adminDb
      .from('vendas_certificados')
      .select('*')
      .eq('id', vendaId)
      .maybeSingle(),
    adminDb
      .from('nfse_configuracoes')
      .select('*')
      .eq('ativo', true)
      .eq('provedor', 'municipal')
      .order('updated_at', { ascending: false }),
  ])

  if (vendaError) return json({ ok: false, error: vendaError.message }, 500)
  if (configError) return json({ ok: false, error: configError.message }, 500)
  if (!venda) return json({ ok: false, error: 'Venda não encontrada.' }, 404)

  const config = (configs ?? []).find(item => {
    const payload = (item.payload_reforma_tributaria ?? {}) as Record<string, unknown>
    return String(payload.municipal_adapter ?? '').trim() === 'nota_joseense'
  })
  if (!config) {
    return json({ ok: false, error: 'Nenhuma configuração ativa da Nota Joseense foi encontrada.' }, 404)
  }

  const vendaFiscal = {
    ...(venda as Record<string, unknown>),
    produto_tipo: produtoTipo,
    produto_modelo: produtoModelo,
    produto_validade: produtoValidade,
    tipo_emissao: tipoEmissao,
  }
  const emitenteSnapshot = buildEmitenteSnapshot(config as Record<string, unknown>)
  const tomadorSnapshot = buildTomadorSnapshot(vendaFiscal)

  const obrigatorios = [
    ['CNPJ emitente', config.cnpj_emitente],
    ['Nome ou razão social do emitente', emitenteSnapshot.nome],
    ['Inscrição municipal do emitente', config.inscricao_municipal],
    ['Endereço do emitente', emitenteSnapshot.endereco],
    ['Município do emitente', emitenteSnapshot.municipio],
    ['Telefone do emitente', emitenteSnapshot.telefone],
    ['E-mail do emitente', emitenteSnapshot.email],
    ['Código do serviço', config.codigo_servico_municipio],
    ['CNAE do emitente', config.cnae],
    ['Código IBGE do município', config.municipio_codigo_ibge],
    ['Certificado A1', config.certificado_pfx_path],
    ['Senha do certificado', config.certificado_senha],
    ['Documento do tomador', venda.documento_faturamento],
    ['Nome do tomador', venda.nome_faturamento],
    ['E-mail do tomador', venda.email_faturamento],
    ['Telefone do tomador', venda.telefone_faturamento],
    ['Logradouro do tomador', venda.logradouro],
    ['Número do tomador', venda.numero],
    ['Bairro do tomador', venda.bairro],
    ['Cidade do tomador', venda.cidade],
    ['UF do tomador', venda.uf],
    ['CEP do tomador', venda.cep],
    ['Tipo de emissão da venda', tipoEmissao],
  ].filter(([, value]) => !String(value ?? '').trim())

  if (obrigatorios.length > 0) {
    return json({
      ok: false,
      error: `Complete antes os campos obrigatórios para emissão SOAP: ${obrigatorios.map(([label]) => label).join(', ')}.`,
      stage: 'validacao',
    }, 400)
  }

  const { data: certFile, error: certError } = await adminDb.storage
    .from('certificados-digitais')
    .download(String(config.certificado_pfx_path))
  if (certError || !certFile) {
    return json({ ok: false, error: `Não foi possível baixar o certificado A1: ${certError?.message ?? 'arquivo ausente'}.`, stage: 'certificado' }, 400)
  }

  let certPem = ''
  let keyPem = ''
  let certSummary: Record<string, unknown> | null = null
  try {
    const materials = extractPfxMaterials(await certFile.arrayBuffer(), String(config.certificado_senha))
    certPem = materials.certPem
    keyPem = materials.keyPem
    certSummary = materials.summary
  } catch (error) {
    return json({ ok: false, error: `Falha ao abrir o certificado A1: ${error instanceof Error ? error.message : 'erro desconhecido'}.`, stage: 'certificado' }, 400)
  }

  let dadosXml = ''
  let numeroRps = 0
  try {
    const generated = buildGerarNfseXml(config as Record<string, unknown>, vendaFiscal)
    dadosXml = signGerarNfseXml(generated.xml, certPem, keyPem)
    numeroRps = generated.numeroRps
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : 'Falha ao montar o XML da Nota Joseense.', stage: 'xml' }, 400)
  }

  const endpoint = resolveEndpoint(config as Record<string, unknown>)
  const endpointHost = new URL(endpoint).hostname
  const client = Deno.createHttpClient({
    certChain: certPem,
    privateKey: keyPem,
    unsafelyIgnoreCertificateErrors: [endpointHost],
  })

  let response: Response
  let rawXml = ''
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      client,
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        SOAPAction: '',
      },
      body: buildSoapEnvelope(dadosXml),
    })
    rawXml = await response.text()
  } catch (error) {
    return json({
      ok: false,
      error: `Não foi possível enviar a requisição SOAP para a Nota Joseense: ${error instanceof Error ? error.message : 'erro desconhecido'}.`,
      stage: 'soap',
    }, 502)
  }

  const parsed = extractSoapData(rawXml)
  if (!response.ok) {
    return json({
      ok: false,
      error: `A Nota Joseense respondeu com status ${response.status}.`,
      stage: 'soap',
      payload_retorno: rawXml.slice(0, 3000),
    }, 502)
  }

  if (parsed.codigoErro || parsed.mensagemErro) {
    return json({
      ok: false,
      error: `${parsed.codigoErro ?? 'ERRO'} - ${parsed.mensagemErro ?? 'Retorno de erro da Nota Joseense.'}`,
      stage: 'retorno',
      payload_retorno: rawXml.slice(0, 5000),
    }, 400)
  }

  const emitenteSnapshot = buildEmitenteSnapshot(config as Record<string, unknown>)
  const tomadorSnapshot = buildTomadorSnapshot(venda as Record<string, unknown>)

  const { data: nota, error: notaError } = await adminDb
    .from('nfse_emitidas')
    .insert([{
      venda_certificado_id: venda.id,
      cadastro_base_tomador_id: venda.cadastro_base_id,
      status_nf: parsed.numeroNf ? 'emitida' : 'pendente',
      numero_nf: parsed.numeroNf,
      codigo_verificacao: parsed.codigoVerificacao,
      data_emissao: parsed.dataEmissao ?? new Date().toISOString(),
      valor_servico: venda.valor_venda ?? 0,
      payload_envio: {
        provider: 'nota_joseense',
        endpoint,
        operation: 'GerarNfse',
        dados_xml: dadosXml,
        discriminacao_servicos: buildDiscriminacao(vendaFiscal),
        emitente: emitenteSnapshot,
        tomador: tomadorSnapshot,
      },
      payload_retorno: {
        raw_xml: rawXml,
        numero_nf: parsed.numeroNf,
        codigo_verificacao: parsed.codigoVerificacao,
        data_emissao: parsed.dataEmissao,
      },
      metadata: {
        modo: 'nota-joseense-soap',
        certificado: certSummary,
        numero_rps: numeroRps,
        justificativa_fora_etapa: justificativaForaEtapa,
      },
    }])
    .select('id')
    .single()

  if (notaError) {
    return json({
      ok: false,
      error: `A nota foi enviada à Nota Joseense, mas não consegui registrar o retorno interno: ${notaError.message}.`,
      stage: 'persistencia',
      numero_nf: parsed.numeroNf,
      codigo_verificacao: parsed.codigoVerificacao,
    }, 500)
  }

  await adminDb
    .from('nfse_configuracoes')
    .update({ numero_rps_atual: Number(config.numero_rps_atual ?? 1) + 1 })
    .eq('id', config.id)

  return json({
    ok: true,
    message: parsed.numeroNf
      ? `Sua NFS-e foi emitida na Nota Joseense com o número ${parsed.numeroNf}.`
      : 'Sua solicitação foi enviada à Nota Joseense e aguarda confirmação de retorno.',
    nota_id: nota.id,
    numero_nf: parsed.numeroNf,
    codigo_verificacao: parsed.codigoVerificacao,
    stage: parsed.numeroNf ? 'emitida' : 'enviada',
  })
})
