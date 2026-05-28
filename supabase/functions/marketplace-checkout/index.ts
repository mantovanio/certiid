// @ts-nocheck — Deno runtime
import { adminDb, CORS, json } from '../_shared/security.ts'

function cleanDoc(value: unknown) {
  return String(value ?? '').replace(/\D/g, '')
}

function cleanPhone(value: unknown) {
  return String(value ?? '').replace(/\D/g, '')
}

function cleanText(value: unknown) {
  const text = String(value ?? '').trim()
  return text || null
}

function cleanEmail(value: unknown) {
  const text = String(value ?? '').trim().toLowerCase()
  return text || null
}

function inferTipoCliente(doc: string) {
  return doc.length <= 11 ? 'pessoa_fisica' : 'pessoa_juridica'
}

function normalizeString(value: unknown) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function inferProdutoContext(certificado: Record<string, unknown> | null | undefined) {
  const categoria = normalizeString(certificado?.categoria)
  const tipo = normalizeString(certificado?.tipo)
  const full = `${categoria} ${tipo}`
  const isCompany = full.includes('cnpj') || full.includes('empresa') || full.includes('pj')
  const isPerson = full.includes('cpf') || full.includes('pf')
  return {
    isCompany,
    isPerson,
    titularLabel: isCompany ? 'representante' : 'titular',
  }
}

function combineDateAndTime(baseDate: Date, hhmm: string) {
  const [hour, minute] = hhmm.split(':').map(Number)
  const next = new Date(baseDate)
  next.setHours(hour ?? 0, minute ?? 0, 0, 0)
  return next
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()
}

function overlaps(startA: Date, endA: Date, startB: Date, endB: Date) {
  return startA < endB && startB < endA
}

function resolveAgentesElegiveisPorTabela({
  tabelaPrecoId,
  vinculados,
  parceiroId,
  parceirosAgentesPermitidos = [],
}: {
  tabelaPrecoId: string
  vinculados: Record<string, unknown>[]
  parceiroId?: string | null
  parceirosAgentesPermitidos?: Record<string, unknown>[]
}) {
  const elegiveisTabela = vinculados.filter(item => item.tabela_preco_id === tabelaPrecoId && item.ativo)
  if (!parceiroId) return elegiveisTabela

  const restricoesParceiro = parceirosAgentesPermitidos.filter(item => item.parceiro_id === parceiroId && item.ativo)
  if (restricoesParceiro.length === 0) return elegiveisTabela

  const combinacoes = new Map<string, Record<string, unknown>>()

  for (const vinculoTabela of elegiveisTabela) {
    const restricoesDoAgente = restricoesParceiro.filter(item => item.agente_registro_id === vinculoTabela.agente_registro_id)
    if (restricoesDoAgente.length === 0) continue

    for (const restricao of restricoesDoAgente) {
      const pontoTabela = vinculoTabela.ponto_atendimento_id
      const pontoParceiro = restricao.ponto_atendimento_id

      let pontoFinal: string | null = null
      if (pontoTabela && pontoParceiro && pontoTabela !== pontoParceiro) continue
      if (pontoTabela && pontoParceiro) pontoFinal = pontoTabela
      else if (pontoTabela) pontoFinal = pontoTabela
      else if (pontoParceiro) pontoFinal = pontoParceiro

      const key = `${vinculoTabela.agente_registro_id}:${pontoFinal ?? '*'}`
      combinacoes.set(key, {
        ...vinculoTabela,
        ponto_atendimento_id: pontoFinal,
      })
    }
  }

  return Array.from(combinacoes.values())
}

function generateAgendaSlotsPreview({
  tabelaPrecoId,
  vinculados,
  parceiroId,
  parceirosAgentesPermitidos = [],
  disponibilidades,
  indisponibilidades,
  bookings,
  rangeDays = 21,
  limit = 120,
}: {
  tabelaPrecoId: string
  vinculados: Record<string, unknown>[]
  parceiroId?: string | null
  parceirosAgentesPermitidos?: Record<string, unknown>[]
  disponibilidades: Record<string, unknown>[]
  indisponibilidades: Record<string, unknown>[]
  bookings: Record<string, unknown>[]
  rangeDays?: number
  limit?: number
}) {
  const elegiveis = resolveAgentesElegiveisPorTabela({
    tabelaPrecoId,
    vinculados,
    parceiroId,
    parceirosAgentesPermitidos,
  })
  const elegiveisSet = new Set(elegiveis.map(item => item.agente_registro_id))
  const pontosPermitidos = new Map<string, Set<string | null>>()

  for (const item of elegiveis) {
    const current = pontosPermitidos.get(String(item.agente_registro_id)) ?? new Set<string | null>()
    current.add((item.ponto_atendimento_id as string | null) ?? null)
    pontosPermitidos.set(String(item.agente_registro_id), current)
  }

  const now = new Date()
  now.setSeconds(0, 0)
  const slots: Record<string, unknown>[] = []

  for (let offset = 0; offset < rangeDays; offset++) {
    const day = new Date(now)
    day.setDate(now.getDate() + offset)
    const weekday = day.getDay()

    for (const disp of disponibilidades) {
      if (!disp.ativo) continue
      if (!elegiveisSet.has(String(disp.agente_registro_id))) continue
      if (Number(disp.dia_semana) !== weekday) continue

      const pontosDoAgente = pontosPermitidos.get(String(disp.agente_registro_id))
      if (!pontosDoAgente || (!pontosDoAgente.has(null) && !pontosDoAgente.has(String(disp.ponto_atendimento_id)))) continue

      let cursor = combineDateAndTime(day, String(disp.hora_inicio))
      const endWindow = combineDateAndTime(day, String(disp.hora_fim))

      while (cursor < endWindow) {
        const slotEnd = new Date(cursor.getTime() + Number(disp.intervalo_minutos ?? 30) * 60_000)
        if (slotEnd > endWindow) break
        if (cursor <= now) {
          cursor = slotEnd
          continue
        }

        const blocked = indisponibilidades.some(item => {
          if (!item.ativo) return false
          if (String(item.agente_registro_id) !== String(disp.agente_registro_id)) return false
          if (item.ponto_atendimento_id && String(item.ponto_atendimento_id) !== String(disp.ponto_atendimento_id)) return false
          return overlaps(cursor, slotEnd, new Date(String(item.inicio_em)), new Date(String(item.fim_em)))
        })

        if (!blocked) {
          const ocupados = bookings.filter(item => {
            if (!item.agente_registro_id || !item.ponto_atendimento_id) return false
            if (String(item.status_agendamento) === 'cancelado') return false
            if (String(item.agente_registro_id) !== String(disp.agente_registro_id)) return false
            if (String(item.ponto_atendimento_id) !== String(disp.ponto_atendimento_id)) return false
            const bookedAt = new Date(String(item.data_agendada))
            return sameDay(bookedAt, cursor)
              && bookedAt.getHours() === cursor.getHours()
              && bookedAt.getMinutes() === cursor.getMinutes()
          }).length

          const capacidade = Math.max(1, Number(disp.capacidade_por_slot ?? 1))
          const vagasRestantes = Math.max(0, capacidade - ocupados)
          if (vagasRestantes > 0) {
            slots.push({
              agente_registro_id: String(disp.agente_registro_id),
              ponto_atendimento_id: String(disp.ponto_atendimento_id),
              inicio: cursor.toISOString(),
              fim: slotEnd.toISOString(),
              capacidade_total: capacidade,
              vagas_restantes: vagasRestantes,
              tipo_atendimento: disp.tipo_atendimento ?? null,
            })
          }
        }

        cursor = slotEnd
      }
    }
  }

  return slots
    .sort((a, b) => new Date(String(a.inicio)).getTime() - new Date(String(b.inicio)).getTime())
    .slice(0, limit)
}

async function loadPaymentRuntime() {
  const { data: runtimeSetting } = await adminDb
    .from('app_settings')
    .select('value')
    .eq('key', 'payment_runtime')
    .maybeSingle()

  return {
    modo_teste_geral: runtimeSetting?.value?.modo_teste_geral === true,
    bloquear_integracoes_reais: runtimeSetting?.value?.bloquear_integracoes_reais === true,
    aviso_checkout: String(runtimeSetting?.value?.aviso_checkout ?? 'O atendimento será liberado após a confirmação do pagamento.'),
  }
}

async function resolveLoja(slug: string) {
  let lojaQuery = adminDb
    .from('lojas_marketplace')
    .select('id, nome_loja, slug, tabela_preco_id, owner_tipo, owner_profile_id, owner_parceiro_id, ativo')
    .eq('ativo', true)

  if (slug) lojaQuery = lojaQuery.eq('slug', slug)
  else lojaQuery = lojaQuery.eq('owner_tipo', 'institucional').order('created_at', { ascending: true }).limit(1)

  const { data: loja, error } = await lojaQuery.maybeSingle()
  if (error) throw new Error(error.message)
  if (!loja) throw new Error('Loja não encontrada')
  return loja
}

async function resolveItem(loja: Record<string, unknown>, itemId: string) {
  const { data: item, error } = await adminDb
    .from('tabelas_preco_itens')
    .select('id, tabela_preco_id, certificado_id, valor, ativo, certificados(*)')
    .eq('id', itemId)
    .eq('tabela_preco_id', String(loja.tabela_preco_id))
    .eq('ativo', true)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!item) throw new Error('Produto indisponível nesta loja')
  return item
}

async function buildAgendaContext(loja: Record<string, unknown>) {
  const parceiroId = ['contador', 'parceiro', 'revendedor'].includes(String(loja.owner_tipo))
    ? String(loja.owner_parceiro_id ?? '') || null
    : null

  const [
    agentesTabelaRes,
    parceirosPermitidosRes,
    disponibilidadesRes,
    indisponibilidadesRes,
    bookingsRes,
    pontosRes,
    pagamentosRes,
  ] = await Promise.all([
    adminDb.from('agentes_tabelas_preco').select('*').eq('ativo', true).eq('tabela_preco_id', String(loja.tabela_preco_id)),
    adminDb.from('parceiros_agentes_permitidos').select('*').eq('ativo', true),
    adminDb.from('agentes_disponibilidade').select('*').eq('ativo', true),
    adminDb.from('agentes_indisponibilidades').select('*').eq('ativo', true),
    adminDb
      .from('agendamentos_validacao')
      .select('agente_registro_id, ponto_atendimento_id, data_agendada, status_agendamento')
      .not('data_agendada', 'is', null)
      .in('status_agendamento', ['pendente', 'confirmado', 'realizado']),
    adminDb.from('pontos_atendimento').select('id, nome').eq('status', 'ativo').order('nome', { ascending: true }),
    adminDb.from('formas_pagamento_v2').select('id, nome, codigo, tipo').eq('ativo', true).order('nome', { ascending: true }),
  ])

  const firstError = agentesTabelaRes.error
    ?? parceirosPermitidosRes.error
    ?? disponibilidadesRes.error
    ?? indisponibilidadesRes.error
    ?? bookingsRes.error
    ?? pontosRes.error
    ?? pagamentosRes.error

  if (firstError) throw new Error(firstError.message)

  const slots = generateAgendaSlotsPreview({
    tabelaPrecoId: String(loja.tabela_preco_id),
    vinculados: agentesTabelaRes.data ?? [],
    parceiroId,
    parceirosAgentesPermitidos: parceirosPermitidosRes.data ?? [],
    disponibilidades: disponibilidadesRes.data ?? [],
    indisponibilidades: indisponibilidadesRes.data ?? [],
    bookings: bookingsRes.data ?? [],
  })

  const agenteIds = Array.from(new Set(slots.map(item => String(item.agente_registro_id))))
  const pontoIds = Array.from(new Set(slots.map(item => String(item.ponto_atendimento_id))))

  const [{ data: agentesProfiles, error: agentesErr }] = await Promise.all([
    agenteIds.length
      ? adminDb.from('profiles').select('id, nome').in('id', agenteIds).eq('status', 'ativo').order('nome', { ascending: true })
      : Promise.resolve({ data: [], error: null }),
  ])

  if (agentesErr) throw new Error(agentesErr.message)

  const agentes = (agentesProfiles ?? []).map(item => ({ id: item.id, nome: item.nome }))
  const pontos = (pontosRes.data ?? []).filter(item => pontoIds.includes(String(item.id))).map(item => ({ id: item.id, nome: item.nome }))
  const pontoById = new Map(pontos.map(item => [item.id, item.nome]))
  const agenteById = new Map(agentes.map(item => [item.id, item.nome]))

  return {
    pagamentos: (pagamentosRes.data ?? []).map(item => ({
      id: item.id,
      nome: item.nome,
      codigo: item.codigo,
      tipo: item.tipo,
    })),
    agentes,
    pontos,
    slots: slots.map(slot => ({
      ...slot,
      agente_nome: agenteById.get(String(slot.agente_registro_id)) ?? 'Agente',
      ponto_nome: pontoById.get(String(slot.ponto_atendimento_id)) ?? 'Ponto',
    })),
  }
}

async function detectWhatsAppProvider() {
  const { data, error } = await adminDb
    .from('external_integrations')
    .select('id, provider, instance_name, metadata')
    .eq('status', 'ativo')
    .order('updated_at', { ascending: false })

  if (error) return { provider: 'evolution', integration_id: null, instance_name: null, whatsapp_engine: 'evolution' }

  const list = (data ?? []).filter(item => {
    const metadata = item.metadata && typeof item.metadata === 'object' ? item.metadata : {}
    return item.provider === 'evolution' || metadata.integration_family === 'whatsapp_api'
  })
  const preferred = list[0]
  if (!preferred) return { provider: 'evolution', integration_id: null, instance_name: null, whatsapp_engine: 'evolution' }

  const metadata = preferred.metadata && typeof preferred.metadata === 'object' ? preferred.metadata : {}
  return {
    provider: preferred.provider === 'evolution' ? 'evolution' : 'n8n',
    integration_id: preferred.id ?? null,
    instance_name: preferred.instance_name ?? null,
    whatsapp_engine: String(metadata.whatsapp_engine ?? (preferred.provider === 'evolution' ? 'evolution' : 'custom')),
  }
}

async function enqueueMessages(input: {
  telefone: string | null
  email: string | null
  productName: string
  valorVenda: number
  formaPagamento: string
  compradorNome: string
  agendamento: null | {
    data_agendada: string
    agente_nome: string
    ponto_nome: string
  }
  vendaId: string
}) {
  const formatCurrency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
  const formatDateTime = (iso: string) => new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(iso))

  const common = [
    `Certificado: ${input.productName}.`,
    `Valor: ${formatCurrency.format(Number(input.valorVenda ?? 0))}.`,
    `Forma de pagamento: ${input.formaPagamento}.`,
    'Seu atendimento será liberado somente após a confirmação do pagamento.',
  ]

  const scheduleMessage = input.agendamento
    ? [
        ...common,
        `Sua validação por vídeo foi agendada para ${formatDateTime(input.agendamento.data_agendada)}.`,
        `Seu atendimento será com ${input.agendamento.agente_nome}.`,
      ].join(' ')
    : [
        ...common,
        'Seu agendamento ainda está pendente.',
        'Você receberá orientações pelos canais informados para concluir essa etapa.',
      ].join(' ')

  const emailSubject = input.agendamento
    ? `Sua compra foi confirmada e sua validação foi agendada - ${input.productName}`
    : `Sua compra foi confirmada - agendamento pendente - ${input.productName}`

  const rows: Record<string, unknown>[] = []
  if (input.telefone) {
    const provider = await detectWhatsAppProvider()
    rows.push({
      channel: 'whatsapp',
      provider: provider.provider,
      to_address: input.telefone,
      subject: null,
      body: `Olá, ${input.compradorNome}. ${scheduleMessage}`,
      payload: {
        venda_id: input.vendaId,
        integration_id: provider.integration_id,
        instance_name: provider.instance_name,
        whatsapp_engine: provider.whatsapp_engine,
        tipo: input.agendamento ? 'marketplace_agendamento_confirmado' : 'marketplace_agendamento_pendente',
      },
      scheduled_for: new Date().toISOString(),
    })
  }

  if (input.email) {
    rows.push({
      channel: 'email',
      provider: 'email_smtp',
      to_address: input.email,
      subject: emailSubject,
      body: `Olá, ${input.compradorNome}.\n\n${scheduleMessage}\n\nEquipe CertiID.`,
      payload: {
        venda_id: input.vendaId,
        tipo: input.agendamento ? 'marketplace_agendamento_confirmado' : 'marketplace_agendamento_pendente',
      },
      scheduled_for: new Date().toISOString(),
    })
  }

  if (rows.length === 0) return
  await adminDb.from('communication_outbox').insert(rows)
}

async function handleContext(body: Record<string, unknown>) {
  const slug = String(body.slug ?? '').trim()
  const loja = await resolveLoja(slug)
  const paymentRuntime = await loadPaymentRuntime()
  const agenda = await buildAgendaContext(loja)
  return json({
    ok: true,
    payment_runtime: paymentRuntime,
    pagamentos: agenda.pagamentos,
    agentes: agenda.agentes,
    pontos: agenda.pontos,
    slots: agenda.slots,
  })
}

async function handleSubmit(body: Record<string, unknown>) {
  const slug = String(body.slug ?? '').trim()
  const itemId = String(body.item_id ?? '').trim()
  if (!itemId) return json({ ok: false, error: 'Produto não informado' }, 400)

  const comprador = typeof body.comprador === 'object' && body.comprador ? body.comprador as Record<string, unknown> : {}
  const fiscal = typeof body.fiscal === 'object' && body.fiscal ? body.fiscal as Record<string, unknown> : {}
  const titular = typeof body.titular === 'object' && body.titular ? body.titular as Record<string, unknown> : {}
  const pagamento = typeof body.pagamento === 'object' && body.pagamento ? body.pagamento as Record<string, unknown> : {}
  const agendamento = typeof body.agendamento === 'object' && body.agendamento ? body.agendamento as Record<string, unknown> : null

  const nomeComprador = String(comprador.nome ?? '').trim()
  const responsavelNome = cleanText(comprador.responsavel_nome)
  const cpfCnpjComprador = cleanDoc(comprador.cpf_cnpj)
  const emailComprador = cleanEmail(comprador.email)
  const telefoneComprador = cleanPhone(comprador.telefone)
  const titularNome = String(titular.nome ?? '').trim()
  const titularCpf = cleanDoc(titular.cpf)
  const formaPagamentoId = String(pagamento.forma_pagamento_id ?? '').trim()

  if (!nomeComprador || !cpfCnpjComprador || !emailComprador || !telefoneComprador || !titularNome || !titularCpf || !formaPagamentoId) {
    return json({ ok: false, error: 'Preencha todos os campos obrigatórios da compra.' }, 400)
  }

  const loja = await resolveLoja(slug)
  const item = await resolveItem(loja, itemId)
  const certificado = item.certificados ?? null
  const productCtx = inferProdutoContext(certificado)
  const paymentRuntime = await loadPaymentRuntime()

  const { data: formaPagamento, error: formaErr } = await adminDb
    .from('formas_pagamento_v2')
    .select('id, nome')
    .eq('id', formaPagamentoId)
    .eq('ativo', true)
    .maybeSingle()

  if (formaErr) return json({ ok: false, error: formaErr.message }, 400)
  if (!formaPagamento) return json({ ok: false, error: 'Forma de pagamento inválida.' }, 400)

  const tipoCliente = inferTipoCliente(cpfCnpjComprador)
  const cadastroPayload = {
    tipo_cliente: tipoCliente,
    tipo_cadastro: 'cliente',
    cpf_cnpj: cpfCnpjComprador,
    nome: nomeComprador,
    nome_fantasia: cleanText(comprador.nome_fantasia),
    email: emailComprador,
    telefone: telefoneComprador,
    cidade: cleanText(fiscal.cidade),
    logradouro: cleanText(fiscal.logradouro),
    numero: cleanText(fiscal.numero),
    complemento: cleanText(fiscal.complemento),
    bairro: cleanText(fiscal.bairro),
    uf: cleanText(fiscal.uf),
    cep: cleanDoc(fiscal.cep) || null,
    inscricao_municipal: cleanText(fiscal.inscricao_municipal),
    inscricao_estadual: cleanText(fiscal.inscricao_estadual),
    iss_retido: fiscal.iss_retido === true,
    status: 'ativo',
    metadata: {
      origem: 'marketplace_publico',
      loja_slug: slug || loja.slug,
      responsavel_nome: responsavelNome,
      payment_runtime: paymentRuntime,
    },
  }

  const { data: cadastro, error: cadastroErr } = await adminDb
    .from('cadastros_base')
    .upsert([cadastroPayload], { onConflict: 'cpf_cnpj', ignoreDuplicates: false })
    .select('id, cpf_cnpj, nome, email, telefone')
    .single()

  if (cadastroErr || !cadastro) {
    return json({ ok: false, error: cadastroErr?.message ?? 'Falha ao criar cadastro base.' }, 400)
  }

  let empresaId: string | null = null
  if (productCtx.isCompany || cpfCnpjComprador.length > 11) {
    const { data: empresaExistente } = await adminDb
      .from('empresas_cliente')
      .select('id')
      .eq('cadastro_base_id', cadastro.id)
      .eq('cnpj', cpfCnpjComprador)
      .maybeSingle()

    if (empresaExistente?.id) {
      empresaId = empresaExistente.id
      await adminDb.from('empresas_cliente').update({
        razao_social: nomeComprador,
        nome_fantasia: cleanText(comprador.nome_fantasia),
        email: emailComprador,
        telefone: telefoneComprador,
        cidade: cleanText(fiscal.cidade),
        status: 'ativo',
        metadata: {
          origem: 'marketplace_publico',
          loja_slug: slug || loja.slug,
          responsavel_nome: responsavelNome,
        },
      }).eq('id', empresaExistente.id)
    } else {
      const { data: empresaCriada, error: empresaErr } = await adminDb
        .from('empresas_cliente')
        .insert([{
          cadastro_base_id: cadastro.id,
          cnpj: cpfCnpjComprador,
          razao_social: nomeComprador,
          nome_fantasia: cleanText(comprador.nome_fantasia),
          email: emailComprador,
          telefone: telefoneComprador,
          cidade: cleanText(fiscal.cidade),
          status: 'ativo',
          metadata: {
            origem: 'marketplace_publico',
            loja_slug: slug || loja.slug,
            responsavel_nome: responsavelNome,
          },
        }])
        .select('id')
        .single()

      if (empresaErr) return json({ ok: false, error: empresaErr.message }, 400)
      empresaId = empresaCriada?.id ?? null
    }
  }

  const { data: titularExistente } = await adminDb
    .from('titulares_certificado')
    .select('id')
    .eq('cpf', titularCpf)
    .maybeSingle()

  let titularId = titularExistente?.id ?? null
  if (titularId) {
    await adminDb.from('titulares_certificado').update({
      nome: titularNome,
      data_nascimento: cleanText(titular.data_nascimento),
      email: cleanEmail(titular.email),
      telefone: cleanPhone(titular.telefone),
      metadata: {
        origem: 'marketplace_publico',
        loja_slug: slug || loja.slug,
        papel: productCtx.titularLabel,
      },
    }).eq('id', titularId)
  } else {
    const { data: titularCriado, error: titularErr } = await adminDb
      .from('titulares_certificado')
      .insert([{
        nome: titularNome,
        cpf: titularCpf,
        data_nascimento: cleanText(titular.data_nascimento),
        email: cleanEmail(titular.email),
        telefone: cleanPhone(titular.telefone),
        metadata: {
          origem: 'marketplace_publico',
          loja_slug: slug || loja.slug,
          papel: productCtx.titularLabel,
        },
      }])
      .select('id')
      .single()

    if (titularErr || !titularCriado) {
      return json({ ok: false, error: titularErr?.message ?? 'Falha ao salvar titular/representante.' }, 400)
    }
    titularId = titularCriado.id
  }

  const agendaContext = await buildAgendaContext(loja)
  const agendamentoSelecionado = agendamento
    ? agendaContext.slots.find(slot =>
        String(slot.agente_registro_id) === String(agendamento.agente_registro_id)
        && String(slot.ponto_atendimento_id) === String(agendamento.ponto_atendimento_id)
        && String(slot.inicio) === String(agendamento.data_agendada)
      ) ?? null
    : null

  if (agendamento && !agendamentoSelecionado) {
    return json({ ok: false, error: 'O horário escolhido não está mais disponível. Atualize e tente novamente.' }, 409)
  }

  const pontoAtendimentoId = agendamentoSelecionado?.ponto_atendimento_id
    ?? agendaContext.pontos[0]?.id
    ?? null

  if (!pontoAtendimentoId) {
    return json({ ok: false, error: 'Nenhum ponto de atendimento ativo está disponível para concluir a compra.' }, 400)
  }

  const parceiroId = ['contador', 'parceiro', 'revendedor'].includes(String(loja.owner_tipo))
    ? String(loja.owner_parceiro_id ?? '') || null
    : null
  const vendedorId = String(loja.owner_tipo) === 'vendedor' ? String(loja.owner_profile_id ?? '') || null : null

  const vendaPayload = {
    loja_marketplace_id: loja.id,
    cadastro_base_id: cadastro.id,
    empresa_id: empresaId,
    titular_id: titularId,
    certificado_id: item.certificado_id ?? null,
    tabela_preco_id: loja.tabela_preco_id,
    tabela_preco_item_id: item.id,
    pago: false,
    data_pagamento: null,
    data_vencimento: cleanText(pagamento.data_vencimento),
    tipo_produto: certificado?.tipo ?? 'Certificado digital',
    tipo_venda: 'ecommerce',
    tipo_emissao: certificado?.tipo_emissao_padrao ?? 'online',
    tabela_preco: loja.nome_loja,
    forma_pagamento_id: formaPagamento.id,
    valor_venda: Number(item.valor ?? 0),
    valor_custo: null,
    documento_faturamento: cadastro.cpf_cnpj,
    nome_faturamento: cadastro.nome,
    email_faturamento: emailComprador,
    telefone_faturamento: telefoneComprador,
    logradouro: cleanText(fiscal.logradouro),
    numero: cleanText(fiscal.numero),
    complemento: cleanText(fiscal.complemento),
    bairro: cleanText(fiscal.bairro),
    cidade: cleanText(fiscal.cidade),
    uf: cleanText(fiscal.uf),
    cep: cleanDoc(fiscal.cep) || null,
    inscricao_municipal: cleanText(fiscal.inscricao_municipal),
    inscricao_estadual: cleanText(fiscal.inscricao_estadual),
    iss_retido: fiscal.iss_retido === true,
    vendedor_id: vendedorId,
    agente_registro_id: agendamentoSelecionado?.agente_registro_id ?? null,
    contador_id: parceiroId,
    ponto_atendimento_id: pontoAtendimentoId,
    pedido_numero: null,
    pedido_status: 'nao_gerado',
    protocolo_numero: null,
    protocolo_status: 'nao_gerado',
    certificadora: null,
    numero_serie: null,
    data_inicio_validade: null,
    voucher_codigo: null,
    voucher_percentual: null,
    voucher_valor: null,
    nome_ar: null,
    nome_local_atendimento: agendamentoSelecionado?.ponto_nome ?? null,
    status_certificado: null,
    nome_parceiro_safeweb: null,
    validado_safeweb: null,
    api_payload_pedido: {},
    api_payload_protocolo: {},
    comissao_vendedor_tipo: null,
    comissao_vendedor_valor: null,
    comissao_agente_tipo: null,
    comissao_agente_valor: null,
    status_venda: agendamentoSelecionado ? 'agendado' : 'vendido',
    observacoes: cleanText(body.observacoes),
    metadata: {
      origem: 'marketplace_publico',
      loja_slug: slug || loja.slug,
      owner_tipo: loja.owner_tipo,
      owner_profile_id: loja.owner_profile_id,
      owner_parceiro_id: loja.owner_parceiro_id,
      forma_pagamento: formaPagamento.nome,
      comprador_nome_fantasia: cleanText(comprador.nome_fantasia),
      comprador_responsavel_nome: responsavelNome,
      titular_papel: productCtx.titularLabel,
      payment_runtime: paymentRuntime,
      ambiente_teste: paymentRuntime.modo_teste_geral,
    },
  }

  const { data: venda, error: vendaErr } = await adminDb
    .from('vendas_certificados')
    .insert([vendaPayload])
    .select('id')
    .single()

  if (vendaErr || !venda) {
    return json({ ok: false, error: vendaErr?.message ?? 'Falha ao criar venda.' }, 400)
  }

  const agendaPayload = {
    venda_certificado_id: venda.id,
    cadastro_base_id: cadastro.id,
    empresa_id: empresaId,
    titular_id: titularId,
    contador_id: parceiroId,
    agente_registro_id: agendamentoSelecionado?.agente_registro_id ?? null,
    ponto_atendimento_id: agendamentoSelecionado?.ponto_atendimento_id ?? null,
    data_agendada: agendamentoSelecionado?.inicio ?? null,
    tipo_atendimento: agendamentoSelecionado ? 'videoconferencia' : null,
    status_agendamento: agendamentoSelecionado ? 'confirmado' : 'pendente',
    observacoes: agendamentoSelecionado
      ? 'Agendamento criado pelo checkout público do marketplace.'
      : 'Compra concluída sem agendamento imediato. Você ainda precisa concluir a validação por vídeo.',
    metadata: {
      origem: 'marketplace_publico',
      loja_slug: slug || loja.slug,
      payment_runtime: paymentRuntime,
      ambiente_teste: paymentRuntime.modo_teste_geral,
    },
  }

  const { error: agendaErr } = await adminDb
    .from('agendamentos_validacao')
    .insert([agendaPayload])

  if (agendaErr) {
    return json({ ok: false, error: agendaErr.message }, 400)
  }

  await enqueueMessages({
    telefone: telefoneComprador,
    email: emailComprador,
    productName: String(certificado?.tipo ?? 'Certificado digital'),
    valorVenda: Number(item.valor ?? 0),
    formaPagamento: formaPagamento.nome,
    compradorNome: responsavelNome ?? nomeComprador,
    agendamento: agendamentoSelecionado
      ? {
          data_agendada: String(agendamentoSelecionado.inicio),
          agente_nome: String(agendamentoSelecionado.agente_nome ?? 'Agente'),
          ponto_nome: String(agendamentoSelecionado.ponto_nome ?? 'Ponto'),
        }
      : null,
    vendaId: venda.id,
  })

  return json({
    ok: true,
    venda_id: venda.id,
    cliente_id: cadastro.id,
    agendamento_status: agendamentoSelecionado ? 'confirmado' : 'pendente',
    message: agendamentoSelecionado
      ? 'Sua compra foi concluída e sua validação por vídeo já ficou agendada.'
      : 'Sua compra foi concluída. Seu agendamento ficou pendente e ainda será necessário antes do atendimento.',
  })
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, error: 'JSON inválido' }, 400)
  }

  const action = String(body.action ?? 'submit').trim()

  try {
    if (action === 'context') return await handleContext(body)
    return await handleSubmit(body)
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : 'Erro interno' }, 500)
  }
})
