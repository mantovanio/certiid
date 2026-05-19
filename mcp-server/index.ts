/**
 * CertiID MCP Server
 * Expõe ferramentas do sistema CertiID para uso via Claude Code.
 * Credenciais lidas do .env do projeto — nunca hardcoded.
 * Campos sensíveis (tokens, senhas, chaves API) nunca retornados nas respostas.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// ── Ambiente ──────────────────────────────────────────────────────────────────

function loadEnv() {
  try {
    const dir  = dirname(fileURLToPath(import.meta.url))
    const path = resolve(dir, '..', '.env')
    const text = readFileSync(path, 'utf-8')
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq === -1) continue
      const key = trimmed.slice(0, eq).trim()
      const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
      if (!(key in process.env)) process.env[key] = val
    }
  } catch { /* .env ausente — usar vars do sistema */ }
}

loadEnv()

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.VITE_SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_KEY) {
  process.stderr.write('Faltam SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env do projeto.\n')
  process.exit(1)
}

const db: SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function ok(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
}

function err(msg: string) {
  return { content: [{ type: 'text' as const, text: `Erro: ${msg}` }] }
}

function maskSensitive(row: Record<string, unknown>, fields: string[]): Record<string, unknown> {
  const copy = { ...row }
  for (const f of fields) {
    if (f in copy && copy[f]) copy[f] = '***'
  }
  return copy
}

// ── Server ────────────────────────────────────────────────────────────────────

const server = new McpServer({ name: 'certiid', version: '2.0.0' })

// ═══════════════════════════════════════════════════════════════════════════════
// RENOVAÇÕES
// ═══════════════════════════════════════════════════════════════════════════════

server.tool(
  'renovacoes_listar',
  'Lista renovações. Filtros: status, vencimento, busca por nome/CPF/CNPJ.',
  {
    status:           z.enum(['pendente','contatado','em_negociacao','convertido','perdido']).optional(),
    vencendo_em_dias: z.number().optional().describe('Vence nos próximos N dias'),
    busca:            z.string().optional().describe('Nome, CPF, CNPJ, razão social'),
    incluir_renovados: z.boolean().optional().default(false),
    limite:           z.number().min(1).max(200).optional().default(30),
    pagina:           z.number().min(1).optional().default(1),
  },
  async ({ status, vencendo_em_dias, busca, incluir_renovados, limite, pagina }) => {
    const from = ((pagina ?? 1) - 1) * (limite ?? 30)
    let q = db
      .from('renovacoes')
      .select('id, razao_social, cpf, cnpj, data_vencimento, status, telefone, email, vendedor, agr, renovado, ultimo_lembrete, pedido, protocolo')
      .is('deleted_at', null)
      .order('data_vencimento', { ascending: true })
      .range(from, from + (limite ?? 30) - 1)

    if (status) q = q.eq('status', status)
    if (!incluir_renovados) q = q.eq('renovado', false)

    if (vencendo_em_dias !== undefined) {
      const ate = new Date()
      ate.setDate(ate.getDate() + vencendo_em_dias)
      q = q.lte('data_vencimento', ate.toISOString().slice(0, 10))
    }

    if (busca) {
      q = q.or(`razao_social.ilike.%${busca}%,cpf.ilike.%${busca}%,cnpj.ilike.%${busca}%`)
    }

    const { data, error } = await q
    if (error) return err(error.message)
    return ok({ total: data?.length, pagina, dados: data })
  },
)

server.tool(
  'renovacoes_buscar',
  'Busca uma renovação específica pelo ID.',
  { id: z.string().uuid() },
  async ({ id }) => {
    const { data, error } = await db
      .from('renovacoes')
      .select('*')
      .eq('id', id)
      .is('deleted_at', null)
      .single()
    if (error) return err(error.message)
    return ok(data)
  },
)

server.tool(
  'renovacoes_atualizar_status',
  'Atualiza status ou campos de uma renovação.',
  {
    id:         z.string().uuid(),
    status:     z.enum(['pendente','contatado','em_negociacao','convertido','perdido']).optional(),
    renovado:   z.boolean().optional(),
    observacoes: z.string().optional(),
    vendedor:   z.string().optional(),
  },
  async ({ id, status, renovado, observacoes, vendedor }) => {
    const update: Record<string, unknown> = {}
    if (status     !== undefined) update.status     = status
    if (renovado   !== undefined) update.renovado   = renovado
    if (observacoes !== undefined) update.observacoes = observacoes
    if (vendedor   !== undefined) update.vendedor   = vendedor

    if (Object.keys(update).length === 0) return err('Nenhum campo informado para atualizar.')

    const { error } = await db.from('renovacoes').update(update).eq('id', id).is('deleted_at', null)
    if (error) return err(error.message)
    return ok({ sucesso: true, id, atualizado: update })
  },
)

server.tool(
  'renovacoes_resumo_status',
  'Conta renovações por status. Útil para dashboard de campanha.',
  {},
  async () => {
    const { data, error } = await db
      .from('renovacoes')
      .select('status')
      .is('deleted_at', null)
      .eq('renovado', false)

    if (error) return err(error.message)

    const contagem: Record<string, number> = {}
    for (const row of data ?? []) {
      const s = (row.status as string) ?? 'sem_status'
      contagem[s] = (contagem[s] ?? 0) + 1
    }
    return ok(contagem)
  },
)

// ═══════════════════════════════════════════════════════════════════════════════
// CLIENTES
// ═══════════════════════════════════════════════════════════════════════════════

server.tool(
  'clientes_listar',
  'Lista cadastros de clientes (cadastros_base). Inclui PF e PJ.',
  {
    tipo:    z.enum(['pf','pj']).optional(),
    busca:   z.string().optional().describe('Nome, CPF, CNPJ, email ou telefone'),
    ativo:   z.boolean().optional().default(true),
    limite:  z.number().min(1).max(200).optional().default(30),
  },
  async ({ tipo, busca, ativo, limite }) => {
    let q = db
      .from('cadastros_base')
      .select('id, tipo_pessoa, nome_razao, cpf_cnpj, email, telefone, cidade, uf, ativo, created_at')
      .order('nome_razao', { ascending: true })
      .limit(limite ?? 30)

    if (tipo)  q = q.eq('tipo_pessoa', tipo)
    if (ativo !== undefined) q = q.eq('ativo', ativo)

    if (busca) {
      q = q.or(`nome_razao.ilike.%${busca}%,cpf_cnpj.ilike.%${busca}%,email.ilike.%${busca}%,telefone.ilike.%${busca}%`)
    }

    const { data, error } = await q
    if (error) return err(error.message)
    return ok({ total: data?.length, dados: data })
  },
)

server.tool(
  'clientes_buscar',
  'Busca um cliente pelo ID. Retorna dados completos de faturamento.',
  { id: z.string().uuid() },
  async ({ id }) => {
    const { data, error } = await db
      .from('cadastros_base')
      .select('*')
      .eq('id', id)
      .single()
    if (error) return err(error.message)
    return ok(data)
  },
)

server.tool(
  'titulares_listar',
  'Lista titulares de certificados (pessoa física vinculada a um CNPJ).',
  {
    busca:  z.string().optional().describe('Nome, CPF'),
    limite: z.number().min(1).max(100).optional().default(30),
  },
  async ({ busca, limite }) => {
    let q = db
      .from('titulares_certificado')
      .select('id, cpf, nome_completo, email, telefone, cargo, created_at')
      .order('nome_completo', { ascending: true })
      .limit(limite ?? 30)

    if (busca) {
      q = q.or(`nome_completo.ilike.%${busca}%,cpf.ilike.%${busca}%`)
    }

    const { data, error } = await q
    if (error) return err(error.message)
    return ok({ total: data?.length, dados: data })
  },
)

// ═══════════════════════════════════════════════════════════════════════════════
// VENDAS / COMERCIAL
// ═══════════════════════════════════════════════════════════════════════════════

server.tool(
  'vendas_listar',
  'Lista vendas de certificados. Filtros por período, status, ponto de atendimento.',
  {
    data_inicio:        z.string().optional().describe('YYYY-MM-DD'),
    data_fim:           z.string().optional().describe('YYYY-MM-DD'),
    status:             z.string().optional().describe('ex: emitido, agendado, cancelado'),
    ponto_atendimento:  z.string().optional().describe('Nome ou ID do ponto'),
    busca:              z.string().optional().describe('Pedido, protocolo, nome do cliente'),
    limite:             z.number().min(1).max(200).optional().default(30),
  },
  async ({ data_inicio, data_fim, status, busca, limite }) => {
    let q = db
      .from('vendas_certificados')
      .select(`
        id, pedido, protocolo, data_venda, status, valor_total, forma_pagamento,
        nome_cliente_snapshot, cpf_cnpj_snapshot, tipo_certificado_snapshot,
        vendedor_nome, ponto_atendimento_nome, comissao_total
      `)
      .order('data_venda', { ascending: false })
      .limit(limite ?? 30)

    if (status)      q = q.eq('status', status)
    if (data_inicio) q = q.gte('data_venda', data_inicio)
    if (data_fim)    q = q.lte('data_venda', data_fim)
    if (busca) {
      q = q.or(`pedido.ilike.%${busca}%,protocolo.ilike.%${busca}%,nome_cliente_snapshot.ilike.%${busca}%,cpf_cnpj_snapshot.ilike.%${busca}%`)
    }

    const { data, error } = await q
    if (error) return err(error.message)
    return ok({ total: data?.length, dados: data })
  },
)

server.tool(
  'vendas_buscar',
  'Busca uma venda pelo ID com todos os campos.',
  { id: z.string().uuid() },
  async ({ id }) => {
    const { data, error } = await db
      .from('vendas_certificados')
      .select('*')
      .eq('id', id)
      .single()
    if (error) return err(error.message)
    return ok(data)
  },
)

server.tool(
  'vendas_resumo',
  'Resumo de vendas por período: total faturado, quantidade, ticket médio.',
  {
    data_inicio: z.string().describe('YYYY-MM-DD'),
    data_fim:    z.string().describe('YYYY-MM-DD'),
  },
  async ({ data_inicio, data_fim }) => {
    const { data, error } = await db
      .from('vendas_certificados')
      .select('valor_total, status, tipo_certificado_snapshot')
      .gte('data_venda', data_inicio)
      .lte('data_venda', data_fim)
      .neq('status', 'cancelado')

    if (error) return err(error.message)

    const total    = (data ?? []).reduce((s, r) => s + (Number(r.valor_total) || 0), 0)
    const qtd      = data?.length ?? 0
    const ticket   = qtd > 0 ? total / qtd : 0
    const por_tipo: Record<string, number> = {}
    for (const r of data ?? []) {
      const t = (r.tipo_certificado_snapshot as string) ?? 'outro'
      por_tipo[t] = (por_tipo[t] ?? 0) + 1
    }

    return ok({ periodo: { de: data_inicio, ate: data_fim }, total_faturado: total.toFixed(2), quantidade: qtd, ticket_medio: ticket.toFixed(2), por_tipo })
  },
)

server.tool(
  'agendamentos_listar',
  'Lista agendamentos de validação presencial/videoconferência.',
  {
    data_inicio: z.string().optional().describe('YYYY-MM-DD'),
    data_fim:    z.string().optional().describe('YYYY-MM-DD'),
    status:      z.string().optional().describe('ex: agendado, realizado, cancelado'),
    limite:      z.number().min(1).max(100).optional().default(30),
  },
  async ({ data_inicio, data_fim, status, limite }) => {
    let q = db
      .from('agendamentos_validacao')
      .select('id, data_hora, tipo_validacao, status, nome_cliente, cpf_cliente, ponto_atendimento_id, observacoes')
      .order('data_hora', { ascending: true })
      .limit(limite ?? 30)

    if (status)      q = q.eq('status', status)
    if (data_inicio) q = q.gte('data_hora', `${data_inicio}T00:00:00`)
    if (data_fim)    q = q.lte('data_hora', `${data_fim}T23:59:59`)

    const { data, error } = await q
    if (error) return err(error.message)
    return ok({ total: data?.length, dados: data })
  },
)

server.tool(
  'certificados_listar',
  'Lista tipos de certificados e preços por canal.',
  {
    ativo:  z.boolean().optional().default(true),
    canal:  z.string().optional().describe('ex: balcao, ecommerce, parceiro'),
  },
  async ({ ativo, canal }) => {
    const certsQ = db
      .from('certificados')
      .select('id, nome, tipo, validade_meses, ativo')
    if (ativo !== undefined) certsQ.eq('ativo', ativo)

    const { data: certs, error: e1 } = await certsQ
    if (e1) return err(e1.message)

    let precosQ = db
      .from('precos_certificados')
      .select('certificado_id, canal, preco, ativo')
      .eq('ativo', true)
    if (canal) precosQ = precosQ.eq('canal', canal)

    const { data: precos, error: e2 } = await precosQ
    if (e2) return err(e2.message)

    const resultado = (certs ?? []).map(c => ({
      ...c,
      precos: (precos ?? []).filter(p => p.certificado_id === c.id).map(p => ({ canal: p.canal, preco: p.preco })),
    }))

    return ok(resultado)
  },
)

// ═══════════════════════════════════════════════════════════════════════════════
// FINANCEIRO
// ═══════════════════════════════════════════════════════════════════════════════

server.tool(
  'financeiro_lancamentos',
  'Lista lançamentos financeiros a pagar/receber.',
  {
    tipo:        z.enum(['pagar','receber']).optional(),
    status:      z.enum(['pendente','pago','cancelado','vencido']).optional(),
    data_inicio: z.string().optional().describe('YYYY-MM-DD (data do lançamento)'),
    data_fim:    z.string().optional().describe('YYYY-MM-DD'),
    busca:       z.string().optional().describe('Descrição, parceiro ou cliente'),
    limite:      z.number().min(1).max(200).optional().default(50),
  },
  async ({ tipo, status, data_inicio, data_fim, busca, limite }) => {
    let q = db
      .from('lancamentos_financeiros')
      .select('id, tipo, descricao, valor, data_lancamento, data_vencimento, data_pagamento, status, categoria, conta_bancaria_id, parceiro_id')
      .order('data_vencimento', { ascending: true })
      .limit(limite ?? 50)

    if (tipo)        q = q.eq('tipo', tipo)
    if (status)      q = q.eq('status', status)
    if (data_inicio) q = q.gte('data_lancamento', data_inicio)
    if (data_fim)    q = q.lte('data_lancamento', data_fim)
    if (busca)       q = q.ilike('descricao', `%${busca}%`)

    const { data, error } = await q
    if (error) return err(error.message)

    const totalReceber = (data ?? []).filter(r => r.tipo === 'receber' && r.status === 'pendente').reduce((s, r) => s + (Number(r.valor) || 0), 0)
    const totalPagar   = (data ?? []).filter(r => r.tipo === 'pagar'   && r.status === 'pendente').reduce((s, r) => s + (Number(r.valor) || 0), 0)

    return ok({ resumo: { a_receber: totalReceber.toFixed(2), a_pagar: totalPagar.toFixed(2) }, total: data?.length, dados: data })
  },
)

server.tool(
  'financeiro_contas_bancarias',
  'Lista contas bancárias cadastradas com saldo atual.',
  {},
  async () => {
    const { data, error } = await db
      .from('contas_bancarias')
      .select('id, nome, banco, tipo, saldo_atual, ativo')
      .eq('ativo', true)
      .order('nome', { ascending: true })

    if (error) return err(error.message)
    const saldo_total = (data ?? []).reduce((s, r) => s + (Number(r.saldo_atual) || 0), 0)
    return ok({ saldo_total: saldo_total.toFixed(2), contas: data })
  },
)

server.tool(
  'financeiro_criar_lancamento',
  'Cria um lançamento financeiro (a pagar ou a receber).',
  {
    tipo:            z.enum(['pagar','receber']),
    descricao:       z.string().min(3),
    valor:           z.number().positive(),
    data_vencimento: z.string().describe('YYYY-MM-DD'),
    categoria:       z.string().optional(),
    parceiro_id:     z.string().uuid().optional(),
    observacoes:     z.string().optional(),
  },
  async ({ tipo, descricao, valor, data_vencimento, categoria, parceiro_id, observacoes }) => {
    const { data, error } = await db
      .from('lancamentos_financeiros')
      .insert([{
        tipo,
        descricao,
        valor,
        data_lancamento:  new Date().toISOString().slice(0, 10),
        data_vencimento,
        status:    'pendente',
        categoria: categoria ?? null,
        parceiro_id: parceiro_id ?? null,
        observacoes:  observacoes ?? null,
      }])
      .select('id')
      .single()

    if (error) return err(error.message)
    return ok({ sucesso: true, id: data?.id, mensagem: `Lançamento "${descricao}" criado com sucesso.` })
  },
)

// ═══════════════════════════════════════════════════════════════════════════════
// NOTA FISCAL
// ═══════════════════════════════════════════════════════════════════════════════

server.tool(
  'nf_listar',
  'Lista notas fiscais emitidas (NFS-e).',
  {
    status:      z.string().optional().describe('ex: emitida, cancelada, contingencia'),
    data_inicio: z.string().optional().describe('YYYY-MM-DD'),
    data_fim:    z.string().optional().describe('YYYY-MM-DD'),
    busca:       z.string().optional().describe('Número da NF, tomador, descrição'),
    limite:      z.number().min(1).max(200).optional().default(50),
  },
  async ({ status, data_inicio, data_fim, busca, limite }) => {
    let q = db
      .from('nfse_emitidas')
      .select('id, numero_nfse, data_emissao, status, valor_servico, tomador_razao, tomador_cpf_cnpj, descricao_servico, xml_retorno_url, pdf_url')
      .order('data_emissao', { ascending: false })
      .limit(limite ?? 50)

    if (status)      q = q.eq('status', status)
    if (data_inicio) q = q.gte('data_emissao', data_inicio)
    if (data_fim)    q = q.lte('data_emissao', data_fim)
    if (busca)       q = q.or(`numero_nfse.ilike.%${busca}%,tomador_razao.ilike.%${busca}%,tomador_cpf_cnpj.ilike.%${busca}%`)

    const { data, error } = await q
    if (error) return err(error.message)

    const total_valor = (data ?? []).filter(r => r.status === 'emitida').reduce((s, r) => s + (Number(r.valor_servico) || 0), 0)
    return ok({ total_emitido_periodo: total_valor.toFixed(2), total: data?.length, dados: data })
  },
)

server.tool(
  'nf_buscar',
  'Busca uma nota fiscal pelo ID.',
  { id: z.string().uuid() },
  async ({ id }) => {
    const { data, error } = await db
      .from('nfse_emitidas')
      .select('id, numero_nfse, data_emissao, status, valor_servico, iss_valor, tomador_razao, tomador_cpf_cnpj, descricao_servico, pdf_url, xml_retorno_url, created_at')
      .eq('id', id)
      .single()
    if (error) return err(error.message)
    return ok(data)
  },
)

// ═══════════════════════════════════════════════════════════════════════════════
// PARCEIROS
// ═══════════════════════════════════════════════════════════════════════════════

server.tool(
  'parceiros_listar',
  'Lista parceiros cadastrados.',
  {
    tipo:   z.string().optional().describe('ex: ar, contador, indicador'),
    status: z.string().optional().describe('ex: ativo, inativo, em_analise'),
    busca:  z.string().optional().describe('Nome, CPF/CNPJ, código'),
    limite: z.number().min(1).max(200).optional().default(50),
  },
  async ({ tipo, status, busca, limite }) => {
    let q = db
      .from('parceiros')
      .select('id, nome, cpf_cnpj, codigo_parceiro, tipo_parceiro, status, cidade, uf, email, telefone')
      .order('nome', { ascending: true })
      .limit(limite ?? 50)

    if (tipo)   q = q.eq('tipo_parceiro', tipo)
    if (status) q = q.eq('status', status)
    if (busca)  q = q.or(`nome.ilike.%${busca}%,cpf_cnpj.ilike.%${busca}%,codigo_parceiro.ilike.%${busca}%`)

    const { data, error } = await q
    if (error) return err(error.message)
    return ok({ total: data?.length, dados: data })
  },
)

server.tool(
  'parceiros_buscar',
  'Busca um parceiro pelo ID com todos os dados operacionais.',
  { id: z.string().uuid() },
  async ({ id }) => {
    const { data, error } = await db
      .from('parceiros')
      .select('id, nome, cpf_cnpj, codigo_parceiro, tipo_parceiro, status, cidade, uf, email, telefone, responsavel_nome, responsavel_email, responsavel_telefone, banco, agencia, conta, tipo_conta, observacoes, created_at')
      .eq('id', id)
      .single()
    if (error) return err(error.message)
    return ok(data)
  },
)

server.tool(
  'parceiros_comissoes',
  'Lista lançamentos de comissão de um parceiro.',
  {
    parceiro_id: z.string().uuid(),
    data_inicio: z.string().optional().describe('YYYY-MM-DD'),
    data_fim:    z.string().optional().describe('YYYY-MM-DD'),
    status:      z.string().optional().describe('ex: pendente, pago'),
    limite:      z.number().min(1).max(200).optional().default(50),
  },
  async ({ parceiro_id, data_inicio, data_fim, status, limite }) => {
    let q = db
      .from('comissao_lancamentos')
      .select('id, venda_id, valor, percentual, papel, status, data_lancamento, data_pagamento')
      .eq('parceiro_id', parceiro_id)
      .order('data_lancamento', { ascending: false })
      .limit(limite ?? 50)

    if (status)      q = q.eq('status', status)
    if (data_inicio) q = q.gte('data_lancamento', data_inicio)
    if (data_fim)    q = q.lte('data_lancamento', data_fim)

    const { data, error } = await q
    if (error) return err(error.message)

    const total_pendente = (data ?? []).filter(r => r.status === 'pendente').reduce((s, r) => s + (Number(r.valor) || 0), 0)
    return ok({ total_pendente: total_pendente.toFixed(2), total: data?.length, dados: data })
  },
)

// ═══════════════════════════════════════════════════════════════════════════════
// LEADS / CRM / KANBAN
// ═══════════════════════════════════════════════════════════════════════════════

server.tool(
  'leads_listar',
  'Lista leads do kanban de atendimento.',
  {
    status:  z.string().optional().describe('ex: conversando, follow_up, cliente, perdido'),
    busca:   z.string().optional().describe('Nome ou telefone'),
    limite:  z.number().min(1).max(200).optional().default(30),
  },
  async ({ status, busca, limite }) => {
    let q = db
      .from('leads_contabilidade')
      .select('id, nome_lead, whatsapp_lead, status, resumo_conversa, ultima_mensagem, inicio_atendimento, id_conversa_chatwoot')
      .order('ultima_mensagem', { ascending: false, nullsFirst: false })
      .limit(limite ?? 30)

    if (status) q = q.eq('status', status)
    if (busca)  q = q.or(`nome_lead.ilike.%${busca}%,whatsapp_lead.ilike.%${busca}%`)

    const { data, error } = await q
    if (error) return err(error.message)
    return ok({ total: data?.length, dados: data })
  },
)

server.tool(
  'leads_mover_kanban',
  'Move um lead para outra coluna do kanban (atualiza status).',
  {
    id:     z.string().uuid(),
    status: z.enum(['iniciou_conversa','conversando','agendado','cliente','follow_up','cancelou','perdido']),
    obs:    z.string().optional(),
  },
  async ({ id, status, obs }) => {
    const update: Record<string, unknown> = { status }
    if (obs) update.resumo_conversa = obs

    const { error } = await db.from('leads_contabilidade').update(update).eq('id', id)
    if (error) return err(error.message)
    return ok({ sucesso: true, id, novo_status: status })
  },
)

server.tool(
  'leads_resumo_kanban',
  'Conta leads por coluna do kanban para visão geral.',
  {},
  async () => {
    const { data, error } = await db
      .from('leads_contabilidade')
      .select('status')

    if (error) return err(error.message)

    const contagem: Record<string, number> = {}
    for (const row of data ?? []) {
      const s = (row.status as string) ?? 'sem_status'
      contagem[s] = (contagem[s] ?? 0) + 1
    }
    return ok({ total: data?.length, por_coluna: contagem })
  },
)

// ═══════════════════════════════════════════════════════════════════════════════
// MENSAGERIA / COMUNICAÇÃO
// ═══════════════════════════════════════════════════════════════════════════════

server.tool(
  'mensagem_agendar_whatsapp',
  'Agenda uma mensagem WhatsApp na fila de envio. O N8N processa e envia.',
  {
    para:          z.string().describe('Número E.164, ex: +5511999999999'),
    mensagem:      z.string().max(4000),
    renovacao_id:  z.string().uuid().optional(),
    lead_id:       z.string().uuid().optional(),
    delay_minutos: z.number().min(0).max(10080).optional().default(0),
    tipo:          z.string().optional().default('manual_mcp').describe('Categoria para rastreamento'),
  },
  async ({ para, mensagem, renovacao_id, lead_id, delay_minutos, tipo }) => {
    const scheduled_for = new Date(Date.now() + (delay_minutos ?? 0) * 60_000).toISOString()
    const payload: Record<string, unknown> = { tipo: tipo ?? 'manual_mcp' }
    if (renovacao_id) payload.renovacao_id = renovacao_id
    if (lead_id)      payload.lead_id      = lead_id

    const { error } = await db.from('communication_outbox').insert([{
      channel: 'whatsapp', provider: 'chatwoot',
      to_address: para, body: mensagem, payload, scheduled_for,
    }])

    if (error) return err(error.message)
    return ok({ sucesso: true, agendado_para: scheduled_for })
  },
)

server.tool(
  'mensagem_fila_pendente',
  'Mensagens pendentes na fila de envio (não enviadas ainda).',
  {
    canal:  z.enum(['whatsapp','email','webhook']).optional(),
    limite: z.number().min(1).max(100).optional().default(20),
  },
  async ({ canal, limite }) => {
    let q = db
      .from('communication_outbox')
      .select('id, channel, to_address, body, scheduled_for, payload, created_at')
      .is('sent_at', null)
      .order('scheduled_for', { ascending: true })
      .limit(limite ?? 20)

    if (canal) q = q.eq('channel', canal)

    const { data, error } = await q
    if (error) return err(error.message)
    return ok({ total: data?.length, dados: data })
  },
)

server.tool(
  'mensagem_historico_conversa',
  'Transcrição de uma conversa do Chatwoot salva no banco.',
  {
    conversation_id: z.string().describe('ID da conversa no Chatwoot'),
    limite:          z.number().min(1).max(500).optional().default(100),
  },
  async ({ conversation_id, limite }) => {
    const { data, error } = await db
      .from('communication_events')
      .select('event_type, payload, created_at')
      .eq('conversation_id', conversation_id)
      .eq('event_type', 'message_created')
      .order('created_at', { ascending: true })
      .limit(limite ?? 100)

    if (error) return err(error.message)

    const msgs = (data ?? []).map(row => {
      const ev  = row.payload as Record<string, unknown>
      const msg = ev?.data as Record<string, unknown> | undefined
      const tipo = msg?.message_type === 0 ? 'Cliente' : 'Atendente'
      const ts   = new Date(row.created_at as string).toLocaleString('pt-BR')
      return `[${ts}] ${tipo}: ${msg?.content ?? '(sem conteúdo)'}`
    })

    return ok({ conversation_id, mensagens: msgs, total: msgs.length })
  },
)

server.tool(
  'templates_listar',
  'Lista templates de mensagem WhatsApp e Email disponíveis.',
  {
    canal:  z.enum(['whatsapp','email']).optional(),
    ativo:  z.boolean().optional().default(true),
  },
  async ({ canal, ativo }) => {
    let q = db
      .from('communication_templates')
      .select('id, nome, canal, assunto, corpo, variaveis, padrao, ativo')
      .order('nome', { ascending: true })

    if (canal) q = q.eq('canal', canal)
    if (ativo !== undefined) q = q.eq('ativo', ativo)

    const { data, error } = await q
    if (error) return err(error.message)
    return ok(data)
  },
)

server.tool(
  'automacoes_listar',
  'Lista regras de automação de comunicação.',
  {},
  async () => {
    const { data, error } = await db
      .from('automation_rules')
      .select('id, nome, evento, dias_antecedencia, canal, ativo, template_id')
      .order('nome', { ascending: true })
    if (error) return err(error.message)
    return ok(data)
  },
)

// ═══════════════════════════════════════════════════════════════════════════════
// SISTEMA / CONFIGURAÇÕES
// ═══════════════════════════════════════════════════════════════════════════════

server.tool(
  'sistema_dashboard',
  'Visão geral do sistema: leads, renovações, financeiro e fila de mensagens.',
  {},
  async () => {
    const hoje = new Date().toISOString().slice(0, 10)
    const em30 = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10)

    const [leads, renovVencendo, lancPendentes, filaMsg] = await Promise.all([
      db.from('leads_contabilidade').select('status', { count: 'exact', head: true }),
      db.from('renovacoes').select('id', { count: 'exact', head: true })
        .is('deleted_at', null).eq('renovado', false).lte('data_vencimento', em30),
      db.from('lancamentos_financeiros').select('tipo, valor').eq('status', 'pendente'),
      db.from('communication_outbox').select('id', { count: 'exact', head: true }).is('sent_at', null),
    ])

    const receber = (lancPendentes.data ?? []).filter(r => r.tipo === 'receber').reduce((s, r) => s + (Number(r.valor) || 0), 0)
    const pagar   = (lancPendentes.data ?? []).filter(r => r.tipo === 'pagar').reduce((s, r) => s + (Number(r.valor) || 0), 0)

    return ok({
      data_referencia: hoje,
      leads_total:           leads.count ?? 0,
      renovacoes_vencendo_30d: renovVencendo.count ?? 0,
      financeiro: {
        a_receber: receber.toFixed(2),
        a_pagar:   pagar.toFixed(2),
        saldo_previsto: (receber - pagar).toFixed(2),
      },
      mensagens_na_fila: filaMsg.count ?? 0,
    })
  },
)

server.tool(
  'sistema_agencia',
  'Dados da agência: nome, responsável, configurações gerais.',
  {},
  async () => {
    const { data, error } = await db
      .from('app_settings')
      .select('chave, valor')

    if (error) return err(error.message)
    const config: Record<string, unknown> = {}
    for (const row of data ?? []) {
      config[(row.chave as string)] = row.valor
    }
    return ok(config)
  },
)

server.tool(
  'sistema_usuarios',
  'Lista usuários do sistema com perfil e status.',
  {
    perfil: z.enum(['admin','usuario','vendedor','agente_registro']).optional(),
    ativo:  z.boolean().optional(),
  },
  async ({ perfil, ativo }) => {
    let q = db
      .from('profiles')
      .select('id, nome, email, perfil, ativo, created_at, tipo_vinculo, parceiro_id')
      .order('nome', { ascending: true })

    if (perfil) q = q.eq('perfil', perfil)
    if (ativo !== undefined) q = q.eq('ativo', ativo)

    const { data, error } = await q
    if (error) return err(error.message)
    return ok(data)
  },
)

server.tool(
  'sistema_integracoes',
  'Lista integrações externas configuradas (Chatwoot, N8N, etc). Tokens e senhas são omitidos.',
  {},
  async () => {
    const { data, error } = await db
      .from('external_integrations')
      .select('id, nome, tipo, ativo, base_url, created_at')
      .order('tipo', { ascending: true })

    if (error) return err(error.message)
    return ok(data)
  },
)

server.tool(
  'sistema_pontos_atendimento',
  'Lista pontos de atendimento da agência.',
  { ativo: z.boolean().optional().default(true) },
  async ({ ativo }) => {
    let q = db
      .from('pontos_atendimento')
      .select('id, nome, endereco, cidade, uf, responsavel, telefone, ativo')
      .order('nome', { ascending: true })

    if (ativo !== undefined) q = q.eq('ativo', ativo)

    const { data, error } = await q
    if (error) return err(error.message)
    return ok(data)
  },
)

// ═══════════════════════════════════════════════════════════════════════════════
// BUSCA GLOBAL
// ═══════════════════════════════════════════════════════════════════════════════

server.tool(
  'busca_global',
  'Busca um termo em clientes, renovações, leads e parceiros ao mesmo tempo.',
  { termo: z.string().min(2).describe('Nome, CPF, CNPJ, telefone, razão social') },
  async ({ termo }) => {
    const like = `%${termo}%`

    const [clientes, renovacoes, leads, parceiros] = await Promise.all([
      db.from('cadastros_base').select('id, nome_razao, cpf_cnpj, email, tipo_pessoa').or(`nome_razao.ilike.${like},cpf_cnpj.ilike.${like},email.ilike.${like}`).limit(10),
      db.from('renovacoes').select('id, razao_social, cpf, cnpj, status, data_vencimento').is('deleted_at', null).or(`razao_social.ilike.${like},cpf.ilike.${like},cnpj.ilike.${like}`).limit(10),
      db.from('leads_contabilidade').select('id, nome_lead, whatsapp_lead, status').or(`nome_lead.ilike.${like},whatsapp_lead.ilike.${like}`).limit(10),
      db.from('parceiros').select('id, nome, cpf_cnpj, tipo_parceiro, status').or(`nome.ilike.${like},cpf_cnpj.ilike.${like}`).limit(10),
    ])

    return ok({
      termo,
      clientes:   clientes.data ?? [],
      renovacoes: renovacoes.data ?? [],
      leads:      leads.data ?? [],
      parceiros:  parceiros.data ?? [],
    })
  },
)

// ── Start ─────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport()
await server.connect(transport)
