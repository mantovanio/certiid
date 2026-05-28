// @ts-nocheck — Deno runtime (Supabase Edge Functions)
import forge from 'npm:node-forge@1.3.1'
import { DOMParser } from 'npm:@xmldom/xmldom@0.8.10'
import { SignedXml } from 'npm:xml-crypto@6.1.2'
import { CORS, adminDb, json, requireAuthenticatedUser } from '../_shared/security.ts'

const NFSE_XML_NS = 'http://www.abrasf.org.br/nfse.xsd'

function digits(value: unknown) {
  return String(value ?? '').replace(/\D/g, '')
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
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
    .replace(/[^\x20-\x7E\n\r\t]/g, '')
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

async function fetchWsdl(wsdlUrl: string, certChain: string, privateKey: string) {
  const client = Deno.createHttpClient({ certChain, privateKey })
  const response = await fetch(wsdlUrl, {
    method: 'GET',
    client,
    headers: { 'User-Agent': 'CertiID-GissOnline/1.0' },
  })
  if (!response.ok) {
    throw new Error(`O WSDL do GISSONLINE respondeu com status ${response.status}.`)
  }
  return await response.text()
}

function resolveWsdlInfo(config: Record<string, unknown>) {
  const payload = (config.payload_reforma_tributaria ?? {}) as Record<string, unknown>
  const customHost = String(payload.gissonline_ws_host ?? '').trim()
  const municipalitySlug = slugify(String(config.municipio_nome ?? ''))

  let wsdlUrl = ''
  if (customHost.startsWith('http://') || customHost.startsWith('https://')) {
    wsdlUrl = customHost.includes('?wsdl') ? customHost : `${customHost.replace(/\/$/, '')}?wsdl`
  } else if (customHost) {
    wsdlUrl = `https://${customHost.replace(/\/$/, '')}/service-ws/nf/nfse-ws?wsdl`
  } else if (municipalitySlug) {
    wsdlUrl = `https://ws-${municipalitySlug}.giss.com.br/service-ws/nf/nfse-ws?wsdl`
  } else {
    throw new Error('Informe o host ou a URL do WSDL GISSONLINE na configuração fiscal.')
  }

  return { wsdlUrl }
}

function parseWsdl(wsdlXml: string, fallbackWsdlUrl: string) {
  const targetNamespace = wsdlXml.match(/targetNamespace="([^"]+)"/i)?.[1] ?? 'http://tempuri.org/'
  const soapActionMatch = wsdlXml.match(/soapAction="([^"]*RecepcionarLoteRps[^"]*)"/i)
  const addressMatch = wsdlXml.match(/address[^>]+location="([^"]+)"/i)
  const endpoint = addressMatch?.[1] ?? fallbackWsdlUrl.replace(/\?wsdl$/i, '')

  return {
    endpoint,
    targetNamespace,
    soapAction: soapActionMatch?.[1] ?? 'RecepcionarLoteRps',
  }
}

function buildDiscriminacao(venda: Record<string, unknown>) {
  const linhas = [
    `Servico de validacao e emissao de ${onlyText(venda.tipo_produto ?? 'certificado digital')}.`,
  ]
  if (String(venda.protocolo_numero ?? '').trim()) {
    linhas.push(`Protocolo: ${onlyText(venda.protocolo_numero)}.`)
  } else if (String(venda.pedido_numero ?? '').trim()) {
    linhas.push(`Pedido: ${onlyText(venda.pedido_numero)}.`)
  }
  if (String(venda.observacoes ?? '').trim()) {
    linhas.push(`Observacoes: ${onlyText(venda.observacoes)}.`)
  }
  return linhas.join('\n').slice(0, 1900)
}

function buildTomadorXml(venda: Record<string, unknown>) {
  const documento = digits(venda.documento_faturamento)
  const isCpf = documento.length === 11
  const cidade = xmlEscape(venda.cidade ?? '')
  const uf = xmlEscape(venda.uf ?? '')

  return `
    <TomadorServico>
      <IdentificacaoTomador>
        <CpfCnpj>
          ${isCpf ? `<Cpf>${documento}</Cpf>` : `<Cnpj>${documento}</Cnpj>`}
        </CpfCnpj>
      </IdentificacaoTomador>
      <RazaoSocial>${xmlEscape(venda.nome_faturamento ?? '')}</RazaoSocial>
      <Endereco>
        <Endereco>${xmlEscape(venda.logradouro ?? '')}</Endereco>
        <Numero>${xmlEscape(venda.numero ?? 'S/N')}</Numero>
        <Complemento>${xmlEscape(venda.complemento ?? '')}</Complemento>
        <Bairro>${xmlEscape(venda.bairro ?? '')}</Bairro>
        <CodigoMunicipio>${xmlEscape(venda.municipio_codigo_ibge ?? '')}</CodigoMunicipio>
        <Uf>${uf}</Uf>
        <Cep>${digits(venda.cep)}</Cep>
      </Endereco>
      <Contato>
        <Telefone>${digits(venda.telefone_faturamento)}</Telefone>
        <Email>${xmlEscape(venda.email_faturamento ?? '')}</Email>
      </Contato>
    </TomadorServico>
  `.trim()
}

function buildEnviarLoteRpsXml(config: Record<string, unknown>, venda: Record<string, unknown>) {
  const numeroRps = Number(config.numero_rps_atual ?? 1)
  const serieRps = xmlEscape(config.serie_rps ?? 'RPS')
  const dataIso = new Date().toISOString().slice(0, 19)
  const cnpjEmitente = digits(config.cnpj_emitente)
  const documentoTomador = digits(venda.documento_faturamento)
  if (![11, 14].includes(documentoTomador.length)) {
    throw new Error('O tomador da nota precisa ter CPF ou CNPJ válido para emissão no GISSONLINE.')
  }

  const loteId = `L${Date.now()}`
  const declaracaoId = `R${numeroRps}`
  const discriminacao = xmlEscape(buildDiscriminacao(venda))
  const codigoServico = xmlEscape(config.codigo_servico_municipio ?? '')
  const codigoTributacao = xmlEscape(config.codigo_tributacao_municipio ?? config.codigo_servico_municipio ?? '')
  const aliquota = Number(config.aliquota_iss ?? 0) / 100
  const ibge = xmlEscape(config.municipio_codigo_ibge ?? venda.municipio_codigo_ibge ?? '')

  const xml = `
<EnviarLoteRpsEnvio xmlns="${NFSE_XML_NS}">
  <LoteRps Id="${loteId}" versao="2.04">
    <NumeroLote>${numeroRps}</NumeroLote>
    <Prestador>
      <Cnpj>${cnpjEmitente}</Cnpj>
      <InscricaoMunicipal>${xmlEscape(config.inscricao_municipal ?? '')}</InscricaoMunicipal>
    </Prestador>
    <QuantidadeRps>1</QuantidadeRps>
    <ListaRps>
      <Rps>
        <InfDeclaracaoPrestacaoServico Id="${declaracaoId}">
          <Rps>
            <IdentificacaoRps>
              <Numero>${numeroRps}</Numero>
              <Serie>${serieRps}</Serie>
              <Tipo>1</Tipo>
            </IdentificacaoRps>
            <DataEmissao>${dataIso}</DataEmissao>
            <Status>1</Status>
          </Rps>
          <Competencia>${dataIso}</Competencia>
          <Servico>
            <Valores>
              <ValorServicos>${formatDecimal(venda.valor_venda, 2)}</ValorServicos>
              <ValorDeducoes>0.00</ValorDeducoes>
              <ValorPis>0.00</ValorPis>
              <ValorCofins>0.00</ValorCofins>
              <ValorInss>0.00</ValorInss>
              <ValorIr>0.00</ValorIr>
              <ValorCsll>0.00</ValorCsll>
              <IssRetido>${boolCode(Boolean(venda.iss_retido))}</IssRetido>
              <Aliquota>${formatDecimal(aliquota, 4)}</Aliquota>
              <DescontoIncondicionado>0.00</DescontoIncondicionado>
              <DescontoCondicionado>0.00</DescontoCondicionado>
            </Valores>
            <ItemListaServico>${codigoServico}</ItemListaServico>
            <CodigoTributacaoMunicipio>${codigoTributacao}</CodigoTributacaoMunicipio>
            <Discriminacao>${discriminacao}</Discriminacao>
            <CodigoMunicipio>${ibge}</CodigoMunicipio>
          </Servico>
          <Prestador>
            <Cnpj>${cnpjEmitente}</Cnpj>
            <InscricaoMunicipal>${xmlEscape(config.inscricao_municipal ?? '')}</InscricaoMunicipal>
          </Prestador>
          ${buildTomadorXml(venda)}
          <RegimeEspecialTributacao>${xmlEscape(config.regime_especial ?? '')}</RegimeEspecialTributacao>
          <OptanteSimplesNacional>${boolCode(Boolean(config.simples_nacional))}</OptanteSimplesNacional>
          <IncentivadorCultural>${boolCode(Boolean(config.incentivo_fiscal))}</IncentivadorCultural>
          <Status>1</Status>
        </InfDeclaracaoPrestacaoServico>
      </Rps>
    </ListaRps>
  </LoteRps>
</EnviarLoteRpsEnvio>`.trim()

  return { xml, numeroRps, declaracaoId }
}

function signEnviarLoteRpsXml(xml: string, certPem: string, keyPem: string) {
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

function buildCabecalhoXml() {
  return `<?xml version="1.0" encoding="UTF-8"?><cabecalho xmlns="${NFSE_XML_NS}" versao="2.04"><versaoDados>2.04</versaoDados></cabecalho>`
}

function buildSoapEnvelope(targetNamespace: string, soapAction: string, cabecalhoXml: string, dadosXml: string) {
  return {
    soapAction,
    body: `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ws="${xmlEscape(targetNamespace)}">
  <soapenv:Header/>
  <soapenv:Body>
    <ws:RecepcionarLoteRps>
      <nfseCabecMsg><![CDATA[${cabecalhoXml}]]></nfseCabecMsg>
      <nfseDadosMsg><![CDATA[${dadosXml}]]></nfseDadosMsg>
    </ws:RecepcionarLoteRps>
  </soapenv:Body>
</soapenv:Envelope>`,
  }
}

function extractSoapData(xml: string) {
  const protocolo = xml.match(/<Protocolo>([^<]+)<\/Protocolo>/i)?.[1] ?? null
  const numeroLote = xml.match(/<NumeroLote>([^<]+)<\/NumeroLote>/i)?.[1] ?? null
  const numeroNf = xml.match(/<Numero>([^<]+)<\/Numero>/i)?.[1] ?? null
  const codigoErro = xml.match(/<Codigo>([^<]+)<\/Codigo>/i)?.[1] ?? null
  const mensagemErro = xml.match(/<Mensagem>([^<]+)<\/Mensagem>/i)?.[1] ?? null
  return { protocolo, numeroLote, numeroNf, codigoErro, mensagemErro }
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
  if (!vendaId) {
    return json({ ok: false, error: 'Informe a venda que será enviada ao GISSONLINE.' }, 400)
  }

  const [{ data: venda, error: vendaError }, { data: config, error: configError }] = await Promise.all([
    adminDb
      .from('vendas_certificados')
      .select('*')
      .eq('id', vendaId)
      .maybeSingle(),
    adminDb
      .from('nfse_configuracoes')
      .select('*')
      .eq('ativo', true)
      .eq('provedor', 'gissonline')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  if (vendaError) return json({ ok: false, error: vendaError.message }, 500)
  if (configError) return json({ ok: false, error: configError.message }, 500)
  if (!venda) return json({ ok: false, error: 'Venda não encontrada.' }, 404)
  if (!config) return json({ ok: false, error: 'Nenhuma configuração ativa do GISSONLINE foi encontrada.' }, 404)

  const obrigatorios = [
    ['CNPJ emitente', config.cnpj_emitente],
    ['Inscrição municipal do emitente', config.inscricao_municipal],
    ['Código do serviço', config.codigo_servico_municipio],
    ['Certificado A1', config.certificado_pfx_path],
    ['Senha do certificado', config.certificado_senha],
    ['Documento do tomador', venda.documento_faturamento],
    ['Nome do tomador', venda.nome_faturamento],
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

  const { wsdlUrl } = resolveWsdlInfo(config as Record<string, unknown>)
  let wsdlXml = ''
  try {
    wsdlXml = await fetchWsdl(wsdlUrl, certPem, keyPem)
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : 'Falha ao abrir o WSDL do GISSONLINE.', stage: 'wsdl' }, 502)
  }

  const wsdl = parseWsdl(wsdlXml, wsdlUrl)
  const rps = buildEnviarLoteRpsXml(config as Record<string, unknown>, venda as Record<string, unknown>)
  const signedRpsXml = signEnviarLoteRpsXml(rps.xml, certPem, keyPem)
  const cabecalhoXml = buildCabecalhoXml()
  const soapEnvelope = buildSoapEnvelope(wsdl.targetNamespace, wsdl.soapAction, cabecalhoXml, signedRpsXml)

  const client = Deno.createHttpClient({ certChain: certPem, privateKey: keyPem })
  const response = await fetch(wsdl.endpoint, {
    method: 'POST',
    client,
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: wsdl.soapAction,
    },
    body: soapEnvelope.body,
  })

  const rawXml = await response.text()
  const parsed = extractSoapData(rawXml)

  if (!response.ok) {
    return json({
      ok: false,
      error: `O GISSONLINE respondeu com status ${response.status}.`,
      stage: 'soap',
      payload_retorno: rawXml.slice(0, 2000),
    }, 502)
  }

  if (parsed.codigoErro || parsed.mensagemErro) {
    return json({
      ok: false,
      error: `${parsed.codigoErro ?? 'ERRO'} - ${parsed.mensagemErro ?? 'Retorno de erro do GISSONLINE.'}`,
      stage: 'retorno',
      payload_retorno: rawXml.slice(0, 4000),
    }, 400)
  }

  const { data: nota, error: notaError } = await adminDb
    .from('nfse_emitidas')
    .insert([{
      venda_certificado_id: venda.id,
      cadastro_base_tomador_id: venda.cadastro_base_id,
      status_nf: parsed.numeroNf ? 'emitida' : 'pendente',
      numero_nf: parsed.numeroNf,
      codigo_verificacao: parsed.protocolo ?? parsed.numeroLote,
      data_emissao: new Date().toISOString(),
      valor_servico: venda.valor_venda ?? 0,
      payload_envio: {
        provider: 'gissonline',
        wsdl_url: wsdlUrl,
        endpoint: wsdl.endpoint,
        soap_action: wsdl.soapAction,
        cabecalho_xml: cabecalhoXml,
        dados_xml: signedRpsXml,
      },
      payload_retorno: {
        raw_xml: rawXml,
        protocolo: parsed.protocolo,
        numero_lote: parsed.numeroLote,
        numero_nf: parsed.numeroNf,
      },
      metadata: {
        modo: 'gissonline-soap',
        certificado: certSummary,
        justificativa_fora_etapa: justificativaForaEtapa,
      },
    }])
    .select('id')
    .single()

  if (notaError) {
    return json({
      ok: false,
      error: `A nota foi enviada ao GISSONLINE, mas não consegui registrar o retorno interno: ${notaError.message}.`,
      stage: 'persistencia',
      protocolo: parsed.protocolo,
      numero_lote: parsed.numeroLote,
      numero_nf: parsed.numeroNf,
    }, 500)
  }

  await adminDb
    .from('nfse_configuracoes')
    .update({ numero_rps_atual: Number(config.numero_rps_atual ?? 1) + 1 })
    .eq('id', config.id)

  return json({
    ok: true,
    message: parsed.numeroNf
      ? `Sua NFS-e foi emitida pelo GISSONLINE com o número ${parsed.numeroNf}.`
      : `Seu lote RPS foi enviado ao GISSONLINE e está aguardando processamento.`,
    nota_id: nota.id,
    protocolo: parsed.protocolo,
    numero_lote: parsed.numeroLote,
    numero_nf: parsed.numeroNf,
    stage: parsed.numeroNf ? 'emitida' : 'lote_enviado',
  })
})
