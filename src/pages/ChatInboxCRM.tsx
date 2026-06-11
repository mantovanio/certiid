import { useEffect, useMemo, useState } from 'react'
import {
  MessageCircle,
  RefreshCw,
  Search,
  User,
  UserCheck,
  Phone,
  Mail,
  Clock3,
  Bot,
  UserRound,
  Columns3,
  List,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'

type QueueType = 'atendimento' | 'renovacao'
type DirectionType = 'incoming' | 'outgoing'
type SenderType = 'cliente' | 'ia' | 'humano'

interface ConversationRow {
  id: string
  document_key: string
  telefone: string | null
  cliente_nome: string | null
  whatsapp_instance: string | null
  numero_receptor: string | null
  fila: QueueType
  kanban_status: string
  atendimento_humano: boolean
  agente_nome: string | null
  ultima_mensagem: string | null
  ultima_mensagem_direcao: DirectionType | null
  ultima_interacao_em: string
  created_at: string
  crm_customer_id: string | null
  nome_crm: string | null
  email_principal: string | null
  cpf: string | null
  cnpj: string | null
  observacoes: string | null
  contato_status: string | null
  agente_atual: string | null
  agente_desde: string | null
}

interface CrmMessage {
  id: string
  conversation_id: string
  document_key: string
  direction: DirectionType
  sender_type: SenderType
  mensagem: string | null
  created_at: string
}

interface AgentOption {
  id: string
  nome: string
  perfil: string
}

const STATUS_COLUMNS = [
  { key: 'iniciou_conversa', label: 'Iniciou Conversa', tone: 'amber' },
  { key: 'conversando', label: 'Conversando', tone: 'blue' },
  { key: 'agendado', label: 'Agendado', tone: 'green' },
  { key: 'cliente', label: 'Cliente', tone: 'violet' },
  { key: 'follow_up', label: 'Follow Up', tone: 'orange' },
  { key: 'cancelou_agendamento', label: 'Cancelou', tone: 'red' },
  { key: 'perdido', label: 'Perdido', tone: 'zinc' },
] as const

const TONE_STYLES: Record<string, string> = {
  amber: 'border-amber-200 bg-amber-50',
  blue: 'border-blue-200 bg-blue-50',
  green: 'border-green-200 bg-green-50',
  violet: 'border-violet-200 bg-violet-50',
  orange: 'border-orange-200 bg-orange-50',
  red: 'border-red-200 bg-red-50',
  zinc: 'border-zinc-200 bg-zinc-50',
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return 'Nao informado'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatRelative(value: string | null | undefined) {
  if (!value) return 'Sem interacao'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const diff = Date.now() - date.getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'agora'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h`
  const days = Math.floor(hours / 24)
  return `${days} d`
}

function statusLabel(status: string) {
  const found = STATUS_COLUMNS.find(item => item.key === status)
  if (found) return found.label
  return status.replace(/_/g, ' ')
}

function queueLabel(fila: QueueType) {
  return fila === 'renovacao' ? 'Renovacao' : 'Atendimento'
}

export default function ChatInboxCRM() {
  const { profile } = useAuth()
  const [conversations, setConversations] = useState<ConversationRow[]>([])
  const [messages, setMessages] = useState<CrmMessage[]>([])
  const [agents, setAgents] = useState<AgentOption[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [queueFilter, setQueueFilter] = useState<'todas' | QueueType>('todas')
  const [humanFilter, setHumanFilter] = useState<'todos' | 'ia' | 'humano'>('todos')
  const [viewMode, setViewMode] = useState<'lista' | 'kanban'>('lista')
  const [selectedAgentId, setSelectedAgentId] = useState('')

  const selectedConversation = useMemo(
    () => conversations.find(item => item.id === selectedId) ?? null,
    [conversations, selectedId],
  )

  useEffect(() => {
    void bootstrap()
  }, [])

  useEffect(() => {
    if (!selectedConversation) {
      setMessages([])
      return
    }
    void loadMessages(selectedConversation.id)
  }, [selectedConversation?.id])

  useEffect(() => {
    const channel = supabase
      .channel('crm-chat-admin-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_chat_conversations' }, () => {
        void loadConversations(false)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_chat_messages' }, payload => {
        const nextRow = (payload.new ?? {}) as Record<string, unknown>
        const prevRow = (payload.old ?? {}) as Record<string, unknown>
        const conversationId = String((nextRow['conversation_id'] as string | undefined) ?? (prevRow['conversation_id'] as string | undefined) ?? '')
        void loadConversations(false)
        if (selectedId && conversationId === selectedId) {
          void loadMessages(selectedId)
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_chat_assignments' }, () => {
        void loadConversations(false)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_customers' }, () => {
        void loadConversations(false)
      })
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [selectedId])

  async function bootstrap() {
    setLoading(true)
    setError(null)
    await Promise.all([loadConversations(false), loadAgents()])
    setLoading(false)
  }

  async function loadConversations(showRefreshing = true) {
    if (showRefreshing) setRefreshing(true)
    const { data, error: queryError } = await supabase
      .from('crm_chat_admin_view')
      .select('*')
      .order('ultima_interacao_em', { ascending: false })

    if (queryError) {
      setError(queryError.message)
      if (showRefreshing) setRefreshing(false)
      return
    }

    const rows = (data ?? []) as ConversationRow[]
    setConversations(rows)
    setSelectedId(current => {
      if (current && rows.some(item => item.id === current)) return current
      return rows[0]?.id ?? null
    })
    if (showRefreshing) setRefreshing(false)
  }

  async function loadMessages(conversationId: string) {
    setLoadingMessages(true)
    const { data, error: queryError } = await supabase
      .from('crm_chat_messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })

    if (!queryError) {
      setMessages((data ?? []) as CrmMessage[])
    }
    setLoadingMessages(false)
  }

  async function loadAgents() {
    const { data } = await supabase
      .from('profiles')
      .select('id, nome, perfil')
      .eq('status', 'ativo')
      .order('nome', { ascending: true })

    setAgents((data ?? []) as AgentOption[])
  }

  async function updateConversationStatus(status: string) {
    if (!selectedConversation) return
    setActionLoading(true)
    setActionError(null)
    const { error: queryError } = await supabase
      .from('crm_chat_conversations')
      .update({ kanban_status: status })
      .eq('id', selectedConversation.id)

    if (queryError) {
      setActionError(`Nao foi possivel atualizar a etapa: ${queryError.message}`)
    } else {
      await loadConversations(false)
    }
    setActionLoading(false)
  }

  async function toggleHumanMode(nextValue: boolean) {
    if (!selectedConversation) return
    setActionLoading(true)
    setActionError(null)

    const payload = nextValue
      ? { atendimento_humano: true, agente_nome: selectedConversation.agente_atual ?? profile?.nome ?? selectedConversation.agente_nome }
      : { atendimento_humano: false, agente_nome: null }

    const { error: queryError } = await supabase
      .from('crm_chat_conversations')
      .update(payload)
      .eq('id', selectedConversation.id)

    if (queryError) {
      setActionError(`Nao foi possivel alterar o modo de atendimento: ${queryError.message}`)
    } else {
      if (!nextValue) {
        await supabase
          .from('crm_chat_assignments')
          .update({ ativo: false })
          .eq('conversation_id', selectedConversation.id)
          .eq('ativo', true)
      }
      await loadConversations(false)
    }
    setActionLoading(false)
  }

  async function assignConversation() {
    if (!selectedConversation || !selectedAgentId) return
    const agent = agents.find(item => item.id === selectedAgentId)
    if (!agent) return

    setActionLoading(true)
    setActionError(null)

    const { error: deactivateError } = await supabase
      .from('crm_chat_assignments')
      .update({ ativo: false })
      .eq('conversation_id', selectedConversation.id)
      .eq('ativo', true)

    if (deactivateError) {
      setActionError(`Nao foi possivel limpar a atribuicao anterior: ${deactivateError.message}`)
      setActionLoading(false)
      return
    }

    const { error: insertError } = await supabase
      .from('crm_chat_assignments')
      .insert([{
        conversation_id: selectedConversation.id,
        agente_id: agent.id,
        agente_nome: agent.nome,
        ativo: true,
      }])

    if (insertError) {
      setActionError(`Nao foi possivel atribuir o atendimento: ${insertError.message}`)
      setActionLoading(false)
      return
    }

    const { error: updateError } = await supabase
      .from('crm_chat_conversations')
      .update({
        atendimento_humano: true,
        agente_nome: agent.nome,
      })
      .eq('id', selectedConversation.id)

    if (updateError) {
      setActionError(`A atribuicao foi criada, mas a conversa nao foi atualizada: ${updateError.message}`)
    }

    await loadConversations(false)
    setActionLoading(false)
  }

  const filteredConversations = useMemo(() => {
    return conversations.filter(item => {
      const text = `${item.cliente_nome ?? ''} ${item.nome_crm ?? ''} ${item.telefone ?? ''} ${item.document_key ?? ''} ${item.ultima_mensagem ?? ''}`.toLowerCase()
      const matchesSearch = !search.trim() || text.includes(search.trim().toLowerCase())
      const matchesQueue = queueFilter === 'todas' || item.fila === queueFilter
      const matchesHuman = humanFilter === 'todos'
        || (humanFilter === 'humano' && item.atendimento_humano)
        || (humanFilter === 'ia' && !item.atendimento_humano)
      return matchesSearch && matchesQueue && matchesHuman
    })
  }, [conversations, search, queueFilter, humanFilter])

  const summary = useMemo(() => ({
    total: filteredConversations.length,
    atendimento: filteredConversations.filter(item => item.fila === 'atendimento').length,
    renovacao: filteredConversations.filter(item => item.fila === 'renovacao').length,
    humano: filteredConversations.filter(item => item.atendimento_humano).length,
  }), [filteredConversations])

  const groupedByStatus = useMemo(() => {
    return STATUS_COLUMNS.map(column => ({
      ...column,
      items: filteredConversations.filter(item => item.kanban_status === column.key),
    }))
  }, [filteredConversations])

  return (
    <div className="h-full bg-slate-50 text-slate-900">
      <div className="border-b border-slate-200 bg-white px-6 py-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h1 className="text-2xl font-bold">Central de Atendimento CRM</h1>
            <p className="text-sm text-slate-500">Painel unificado do Kanban, filas de WhatsApp e historico de mensagens.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void loadConversations(true)}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} /> Atualizar
            </button>
            <button
              type="button"
              onClick={() => setViewMode('lista')}
              className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium ${viewMode === 'lista' ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-700'}`}
            >
              <List size={15} /> Lista
            </button>
            <button
              type="button"
              onClick={() => setViewMode('kanban')}
              className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium ${viewMode === 'kanban' ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-700'}`}
            >
              <Columns3 size={15} /> Kanban
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <SummaryCard label="Conversas visiveis" value={summary.total} />
          <SummaryCard label="Fila atendimento" value={summary.atendimento} />
          <SummaryCard label="Fila renovacao" value={summary.renovacao} />
          <SummaryCard label="Atendimento humano" value={summary.humano} />
        </div>

        <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_180px_180px]">
          <label className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
            <Search size={16} className="text-slate-400" />
            <input
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Buscar por nome, telefone, documento ou mensagem"
              className="w-full bg-transparent text-sm outline-none"
            />
          </label>

          <select
            value={queueFilter}
            onChange={event => setQueueFilter(event.target.value as 'todas' | QueueType)}
            className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
          >
            <option value="todas">Todas as filas</option>
            <option value="atendimento">Fila atendimento</option>
            <option value="renovacao">Fila renovacao</option>
          </select>

          <select
            value={humanFilter}
            onChange={event => setHumanFilter(event.target.value as 'todos' | 'ia' | 'humano')}
            className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
          >
            <option value="todos">IA e humano</option>
            <option value="ia">So IA</option>
            <option value="humano">So humano</option>
          </select>
        </div>
      </div>

      {error ? (
        <div className="p-6">
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        </div>
      ) : loading ? (
        <div className="flex h-[calc(100%-180px)] items-center justify-center text-slate-400">Carregando conversas do CRM...</div>
      ) : (
        <div className="grid h-[calc(100%-180px)] min-h-0 gap-4 p-4 xl:grid-cols-[minmax(380px,32%)_minmax(0,1fr)]">
          <section className="min-h-0 overflow-hidden rounded-3xl border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-4 py-3">
              <h2 className="text-sm font-semibold text-slate-700">Inbox operacional</h2>
              <p className="text-xs text-slate-400">Cada conversa mostra fila, numero, etapa e quem esta atendendo.</p>
            </div>

            {viewMode === 'lista' ? (
              <div className="h-[calc(100%-73px)] overflow-y-auto p-3">
                <div className="space-y-3">
                  {filteredConversations.map(item => (
                    <ConversationCard key={item.id} item={item} selected={item.id === selectedId} onClick={() => setSelectedId(item.id)} />
                  ))}
                  {filteredConversations.length === 0 && (
                    <EmptyState text="Nenhuma conversa encontrada com os filtros atuais." />
                  )}
                </div>
              </div>
            ) : (
              <div className="h-[calc(100%-73px)] overflow-x-auto overflow-y-hidden p-3">
                <div className="flex h-full gap-3" style={{ minWidth: `${STATUS_COLUMNS.length * 260}px` }}>
                  {groupedByStatus.map(column => (
                    <div key={column.key} className={`flex min-h-0 w-64 flex-col rounded-2xl border ${TONE_STYLES[column.tone]}`}>
                      <div className="flex items-center justify-between border-b border-black/5 px-3 py-3">
                        <span className="text-sm font-semibold">{column.label}</span>
                        <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-slate-600">{column.items.length}</span>
                      </div>
                      <div className="min-h-0 flex-1 overflow-y-auto p-2">
                        <div className="space-y-2">
                          {column.items.map(item => (
                            <ConversationMiniCard key={item.id} item={item} selected={item.id === selectedId} onClick={() => setSelectedId(item.id)} />
                          ))}
                          {column.items.length === 0 && <EmptyState text="Sem conversas" compact />}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          <section className="min-h-0 overflow-hidden rounded-3xl border border-slate-200 bg-white">
            {!selectedConversation ? (
              <div className="flex h-full items-center justify-center text-slate-400">Selecione uma conversa para abrir o painel ADM.</div>
            ) : (
              <div className="grid h-full min-h-0 xl:grid-cols-[minmax(0,1fr)_340px]">
                <div className="flex min-h-0 flex-col border-r border-slate-200">
                  <div className="border-b border-slate-200 px-4 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="text-lg font-semibold">{selectedConversation.cliente_nome || selectedConversation.nome_crm || 'Sem nome identificado'}</h3>
                        <p className="mt-1 text-sm text-slate-500">{selectedConversation.telefone || selectedConversation.document_key}</p>
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs">
                        <Badge text={queueLabel(selectedConversation.fila)} tone={selectedConversation.fila === 'renovacao' ? 'violet' : 'blue'} />
                        <Badge text={statusLabel(selectedConversation.kanban_status)} tone="slate" />
                        <Badge text={selectedConversation.atendimento_humano ? 'Humano' : 'IA'} tone={selectedConversation.atendimento_humano ? 'green' : 'amber'} />
                      </div>
                    </div>
                    <div className="mt-3 grid gap-2 text-xs text-slate-500 md:grid-cols-3">
                      <div>Instancia: <strong className="text-slate-700">{selectedConversation.whatsapp_instance || 'Nao definida'}</strong></div>
                      <div>Numero receptor: <strong className="text-slate-700">{selectedConversation.numero_receptor || 'Nao definido'}</strong></div>
                      <div>Ultima interacao: <strong className="text-slate-700">{formatDateTime(selectedConversation.ultima_interacao_em)}</strong></div>
                    </div>
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50 px-4 py-4">
                    {loadingMessages ? (
                      <div className="text-sm text-slate-400">Carregando mensagens...</div>
                    ) : messages.length === 0 ? (
                      <EmptyState text="Ainda nao existem mensagens gravadas para esta conversa." />
                    ) : (
                      <div className="space-y-3">
                        {messages.map(message => (
                          <MessageRow key={message.id} message={message} />
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <aside className="min-h-0 overflow-y-auto px-4 py-4">
                  <div className="space-y-4">
                    <PanelBlock title="Resumo do CRM">
                      <InfoRow icon={<User size={14} />} label="Cliente" value={selectedConversation.nome_crm || selectedConversation.cliente_nome || 'Nao informado'} />
                      <InfoRow icon={<Phone size={14} />} label="Telefone" value={selectedConversation.telefone || selectedConversation.document_key} mono />
                      <InfoRow icon={<Mail size={14} />} label="Email" value={selectedConversation.email_principal || 'Nao informado'} />
                      <InfoRow icon={<Clock3 size={14} />} label="Status CRM" value={selectedConversation.contato_status || 'Nao definido'} />
                      <InfoRow icon={<UserCheck size={14} />} label="Agente atual" value={selectedConversation.agente_atual || selectedConversation.agente_nome || 'Nao atribuido'} />
                    </PanelBlock>

                    <PanelBlock title="Controles do atendimento">
                      <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Etapa do Kanban</label>
                      <select
                        value={selectedConversation.kanban_status}
                        onChange={event => void updateConversationStatus(event.target.value)}
                        disabled={actionLoading}
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
                      >
                        {STATUS_COLUMNS.map(column => (
                          <option key={column.key} value={column.key}>{column.label}</option>
                        ))}
                      </select>

                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={actionLoading || selectedConversation.atendimento_humano}
                          onClick={() => void toggleHumanMode(true)}
                          className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                        >
                          Assumir humano
                        </button>
                        <button
                          type="button"
                          disabled={actionLoading || !selectedConversation.atendimento_humano}
                          onClick={() => void toggleHumanMode(false)}
                          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-50"
                        >
                          Voltar para IA
                        </button>
                      </div>

                      <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-slate-500">Atribuir agente</label>
                      <select
                        value={selectedAgentId}
                        onChange={event => setSelectedAgentId(event.target.value)}
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
                      >
                        <option value="">Selecione um agente</option>
                        {agents.map(agent => (
                          <option key={agent.id} value={agent.id}>{agent.nome} - {agent.perfil}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => void assignConversation()}
                        disabled={actionLoading || !selectedAgentId}
                        className="mt-2 w-full rounded-xl bg-sky-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                      >
                        Atribuir conversa
                      </button>

                      {actionError && (
                        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">{actionError}</div>
                      )}
                    </PanelBlock>

                    <PanelBlock title="Observacoes do contato">
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{selectedConversation.observacoes || 'Sem observacoes no crm_customers.'}</p>
                    </PanelBlock>

                    <PanelBlock title="Leitura operacional">
                      <ul className="space-y-2 text-sm text-slate-600">
                        <li>Fila: <strong>{queueLabel(selectedConversation.fila)}</strong></li>
                        <li>Modo atual: <strong>{selectedConversation.atendimento_humano ? 'Humano' : 'IA Clara'}</strong></li>
                        <li>Documento-chave: <strong>{selectedConversation.document_key}</strong></li>
                        <li>Agente desde: <strong>{formatDateTime(selectedConversation.agente_desde)}</strong></li>
                        <li>Ultima mensagem: <strong>{selectedConversation.ultima_mensagem || 'Sem resumo'}</strong></li>
                      </ul>
                    </PanelBlock>
                  </div>
                </aside>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-bold text-slate-900">{value}</p>
    </div>
  )
}

function ConversationCard({ item, selected, onClick }: { item: ConversationRow; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-2xl border px-4 py-3 text-left transition ${selected ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{item.cliente_nome || item.nome_crm || 'Sem nome'}</p>
          <p className={`mt-1 truncate text-xs ${selected ? 'text-slate-300' : 'text-slate-500'}`}>{item.telefone || item.document_key}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${selected ? 'bg-white/15 text-white' : 'bg-slate-100 text-slate-600'}`}>{queueLabel(item.fila)}</span>
          {item.atendimento_humano ? <UserRound size={14} /> : <Bot size={14} />}
        </div>
      </div>
      <p className={`mt-3 line-clamp-2 text-sm ${selected ? 'text-slate-100' : 'text-slate-600'}`}>{item.ultima_mensagem || 'Sem ultima mensagem gravada.'}</p>
      <div className={`mt-3 flex items-center justify-between text-xs ${selected ? 'text-slate-300' : 'text-slate-500'}`}>
        <span>{statusLabel(item.kanban_status)}</span>
        <span>{formatRelative(item.ultima_interacao_em)}</span>
      </div>
    </button>
  )
}

function ConversationMiniCard({ item, selected, onClick }: { item: ConversationRow; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-xl border px-3 py-3 text-left ${selected ? 'border-slate-900 bg-slate-900 text-white' : 'border-white/70 bg-white hover:border-slate-300'}`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-sm font-semibold">{item.cliente_nome || item.nome_crm || 'Sem nome'}</p>
        {item.atendimento_humano ? <UserRound size={14} /> : <Bot size={14} />}
      </div>
      <p className={`mt-1 truncate text-xs ${selected ? 'text-slate-300' : 'text-slate-500'}`}>{item.telefone || item.document_key}</p>
      <p className={`mt-2 line-clamp-2 text-xs ${selected ? 'text-slate-100' : 'text-slate-600'}`}>{item.ultima_mensagem || 'Sem mensagem'}</p>
    </button>
  )
}

function MessageRow({ message }: { message: CrmMessage }) {
  const isOutgoing = message.direction === 'outgoing'
  const senderLabel = message.sender_type === 'cliente' ? 'Cliente' : message.sender_type === 'ia' ? 'IA Clara' : 'Humano'

  return (
    <div className={`flex ${isOutgoing ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[78%] rounded-2xl px-4 py-3 shadow-sm ${isOutgoing ? 'bg-emerald-100 text-emerald-950' : 'bg-white text-slate-800'}`}>
        <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          <span>{senderLabel}</span>
          <span>•</span>
          <span>{formatDateTime(message.created_at)}</span>
        </div>
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{message.mensagem || 'Mensagem sem texto'}</p>
      </div>
    </div>
  )
}

function PanelBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h4>
      <div className="mt-3 space-y-3">{children}</div>
    </div>
  )
}

function InfoRow({ icon, label, value, mono = false }: { icon: React.ReactNode; label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start gap-2">
      <div className="mt-0.5 text-slate-400">{icon}</div>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
        <p className={`mt-0.5 break-words text-sm text-slate-700 ${mono ? 'font-mono' : ''}`}>{value}</p>
      </div>
    </div>
  )
}

function Badge({ text, tone }: { text: string; tone: 'blue' | 'violet' | 'green' | 'amber' | 'slate' }) {
  const classes = {
    blue: 'bg-blue-100 text-blue-700',
    violet: 'bg-violet-100 text-violet-700',
    green: 'bg-green-100 text-green-700',
    amber: 'bg-amber-100 text-amber-700',
    slate: 'bg-slate-100 text-slate-700',
  }
  return <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${classes[tone]}`}>{text}</span>
}

function EmptyState({ text, compact = false }: { text: string; compact?: boolean }) {
  return (
    <div className={`flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 text-center text-slate-400 ${compact ? 'px-3 py-6 text-xs' : 'px-4 py-10 text-sm'}`}>
      <MessageCircle size={compact ? 18 : 24} className="mb-2" />
      <p>{text}</p>
    </div>
  )
}



