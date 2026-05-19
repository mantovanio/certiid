import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// Lê .env do projeto pai (c:\projetos\CertiID_1.0.0\.env)
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
  } catch {
    // .env ausente — usar variáveis de ambiente do sistema
  }
}

loadEnv()

// Suporta tanto VITE_SUPABASE_* (frontend) quanto SUPABASE_* (direto)
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.VITE_SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_KEY) {
  process.stderr.write('Credenciais não encontradas. Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env do projeto.\n')
  process.exit(1)
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
})

const server = new McpServer({ name: 'certiid', version: '1.0.0' })

// ── Renovações ────────────────────────────────────────────────────────────────

server.tool(
  'listar_renovacoes',
  'Lista renovações com filtros. Retorna id, nome, CPF/CNPJ, vencimento, status, telefone.',
  {
    status:    z.string().optional().describe('ex: pendente, convertido, perdido'),
    vencendo_em_dias: z.number().optional().describe('Vence nos próximos N dias'),
    busca:     z.string().optional().describe('Nome, CPF, CNPJ ou razão social'),
    limite:    z.number().min(1).max(100).optional().default(20),
  },
  async ({ status, vencendo_em_dias, busca, limite }) => {
    let q = db
      .from('renovacoes')
      .select('id, razao_social, cpf, cnpj, data_vencimento, status, telefone, vendedor, agr')
      .is('deleted_at', null)
      .order('data_vencimento', { ascending: true })
      .limit(limite ?? 20)

    if (status) q = q.eq('status', status)

    if (vencendo_em_dias !== undefined) {
      const ate = new Date()
      ate.setDate(ate.getDate() + vencendo_em_dias)
      q = q.lte('data_vencimento', ate.toISOString().slice(0, 10))
    }

    if (busca) {
      q = q.or(`razao_social.ilike.%${busca}%,cpf.ilike.%${busca}%,cnpj.ilike.%${busca}%`)
    }

    const { data, error } = await q
    if (error) return { content: [{ type: 'text' as const, text: `Erro: ${error.message}` }] }
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  },
)

server.tool(
  'atualizar_status_renovacao',
  'Atualiza o status de uma renovação. Requer confirmação explícita do usuário antes de executar.',
  {
    id:     z.string().uuid().describe('ID da renovação'),
    status: z.enum(['pendente', 'contatado', 'em_negociacao', 'convertido', 'perdido']),
    obs:    z.string().optional().describe('Observação opcional'),
  },
  async ({ id, status, obs }) => {
    const update: Record<string, unknown> = { status }
    if (obs) update.observacoes = obs

    const { error } = await db.from('renovacoes').update(update).eq('id', id).is('deleted_at', null)
    if (error) return { content: [{ type: 'text' as const, text: `Erro: ${error.message}` }] }
    return { content: [{ type: 'text' as const, text: `Status atualizado para "${status}" com sucesso.` }] }
  },
)

// ── Leads / Kanban ────────────────────────────────────────────────────────────

server.tool(
  'listar_leads',
  'Lista leads do kanban de atendimento.',
  {
    status: z.string().optional().describe('ex: conversando, follow_up, cliente'),
    busca:  z.string().optional().describe('Nome ou telefone'),
    limite: z.number().min(1).max(100).optional().default(20),
  },
  async ({ status, busca, limite }) => {
    let q = db
      .from('leads_contabilidade')
      .select('id, nome_lead, whatsapp_lead, status, resumo_conversa, ultima_mensagem, id_conversa_chatwoot')
      .order('ultima_mensagem', { ascending: false, nullsFirst: false })
      .limit(limite ?? 20)

    if (status) q = q.eq('status', status)
    if (busca)  q = q.or(`nome_lead.ilike.%${busca}%,whatsapp_lead.ilike.%${busca}%`)

    const { data, error } = await q
    if (error) return { content: [{ type: 'text' as const, text: `Erro: ${error.message}` }] }
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  },
)

// ── Mensageria ────────────────────────────────────────────────────────────────

server.tool(
  'agendar_whatsapp',
  'Agenda uma mensagem WhatsApp via fila communication_outbox. Não envia imediatamente — o N8N processa a fila.',
  {
    para:     z.string().describe('Número E.164, ex: +5511999999999'),
    mensagem: z.string().max(4000),
    renovacao_id: z.string().uuid().optional().describe('Vincular à renovação para rastreamento'),
    delay_minutos: z.number().min(0).max(10080).optional().default(0).describe('Agendar com N minutos de delay'),
  },
  async ({ para, mensagem, renovacao_id, delay_minutos }) => {
    const scheduled_for = new Date(Date.now() + (delay_minutos ?? 0) * 60_000).toISOString()

    const payload: Record<string, unknown> = { tipo: 'manual_mcp' }
    if (renovacao_id) payload.renovacao_id = renovacao_id

    const { error } = await db.from('communication_outbox').insert([{
      channel:       'whatsapp',
      provider:      'chatwoot',
      to_address:    para,
      body:          mensagem,
      payload,
      scheduled_for,
    }])

    if (error) return { content: [{ type: 'text' as const, text: `Erro: ${error.message}` }] }
    return { content: [{ type: 'text' as const, text: `Mensagem agendada para ${scheduled_for}.` }] }
  },
)

// ── Histórico de conversa ─────────────────────────────────────────────────────

server.tool(
  'historico_conversa',
  'Retorna mensagens trocadas de uma conversa, ordenadas por data.',
  {
    conversation_id: z.string().describe('ID da conversa no Chatwoot'),
    limite:          z.number().min(1).max(200).optional().default(50),
  },
  async ({ conversation_id, limite }) => {
    const { data, error } = await db
      .from('communication_events')
      .select('event_type, payload, created_at')
      .eq('conversation_id', conversation_id)
      .eq('event_type', 'message_created')
      .order('created_at', { ascending: true })
      .limit(limite ?? 50)

    if (error) return { content: [{ type: 'text' as const, text: `Erro: ${error.message}` }] }

    const msgs = (data ?? []).map(row => {
      const ev   = row.payload as Record<string, unknown>
      const msg  = ev?.data as Record<string, unknown> | undefined
      const tipo = msg?.message_type === 0 ? 'Cliente' : 'Atendente'
      return `[${new Date(row.created_at as string).toLocaleString('pt-BR')}] ${tipo}: ${msg?.content ?? '(sem conteúdo)'}`
    })

    return { content: [{ type: 'text' as const, text: msgs.join('\n') || 'Nenhuma mensagem encontrada.' }] }
  },
)

server.tool(
  'resumo_fila_mensagens',
  'Mostra mensagens pendentes na fila de envio (communication_outbox).',
  {
    canal:  z.enum(['whatsapp', 'email', 'webhook']).optional(),
    limite: z.number().min(1).max(50).optional().default(20),
  },
  async ({ canal, limite }) => {
    let q = db
      .from('communication_outbox')
      .select('id, channel, to_address, body, scheduled_for, sent_at, payload')
      .is('sent_at', null)
      .order('scheduled_for', { ascending: true })
      .limit(limite ?? 20)

    if (canal) q = q.eq('channel', canal)

    const { data, error } = await q
    if (error) return { content: [{ type: 'text' as const, text: `Erro: ${error.message}` }] }
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  },
)

// ── Start ─────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport()
await server.connect(transport)
