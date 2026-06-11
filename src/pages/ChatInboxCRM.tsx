import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Bot,
  Clock3,
  Columns3,
  List,
  Loader2,
  Mail,
  MessageCircle,
  Mic,
  Paperclip,
  Phone,
  RefreshCw,
  Search,
  Send,
  Smile,
  StopCircle,
  User,
  UserCheck,
  UserRound,
  X,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'

type QueueType = 'atendimento' | 'renovacao'
type DirectionType = 'incoming' | 'outgoing'
type SenderType = 'cliente' | 'ia' | 'humano'
type RecState = 'idle' | 'recording' | 'preview'

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
  sender_name?: string | null
  mensagem: string | null
  created_at: string
}

interface AgentOption {
  id: string
  nome: string
  perfil: string
}

interface EvolutionIntegration {
  id: string
  name: string | null
  status: string | null
  base_url: string | null
  api_token: string | null
  instance_name: string | null
  sender_name?: string | null
}

interface ManualConversationForm {
  contactName: string
  phone: string
  queue: QueueType
  integrationId: string
  firstMessage: string
}

const EDGE_FN = 'https://cvfrhfiaprdtwxxplngk.supabase.co/functions/v1/evolution-webhook'

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

const EMOJIS = ['😊', '😂', '🥰', '😍', '😘', '😁', '😎', '🤩', '😜', '😅', '😭', '😤', '🙏', '👍', '👏', '🙌', '💪', '🤝', '👋', '✌️', '❤️', '🔥', '✨', '⭐', '🎉', '🎯', '✅', '❌', '⚠️', '📌', '📎', '📞']

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

function formatRecTime(seconds: number) {
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`
}

function statusLabel(status: string) {
  const found = STATUS_COLUMNS.find(item => item.key === status)
  return found ? found.label : status.replace(/_/g, ' ')
}

function queueLabel(fila: QueueType) {
  return fila === 'renovacao' ? 'Renovacao' : 'Atendimento'
}

function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, '')
  if (!digits) return ''
  if (digits.startsWith('55')) return digits
  if (digits.length === 10 || digits.length === 11) return `55${digits}`
  return digits
}

function inferQueueFromIntegration(integration: Pick<EvolutionIntegration, 'name' | 'instance_name' | 'sender_name'>) {
  const instance = (integration.instance_name ?? '').toLowerCase()
  const label = `${integration.name ?? ''} ${integration.sender_name ?? ''}`.toLowerCase()
  if (instance === 'renovacao' || instance === 'certiid') return 'renovacao'
  if (instance === 'atendimento') return 'atendimento'
  return label.includes('renov') ? 'renovacao' : 'atendimento'
}

function integrationDisplayName(integration: EvolutionIntegration) {
  return integration.sender_name || integration.name || integration.instance_name || 'Instancia sem nome'
}

function createEmptyManualConversationForm(): ManualConversationForm {
  return {
    contactName: '',
    phone: '',
    queue: 'atendimento',
    integrationId: '',
    firstMessage: '',
  }
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
  const [kanbanOpen, setKanbanOpen] = useState(false)
  const [selectedAgentId, setSelectedAgentId] = useState('')
  const [draggedConversationId, setDraggedConversationId] = useState<string | null>(null)
  const [humanMessage, setHumanMessage] = useState('')
  const [sendingHumanMessage, setSendingHumanMessage] = useState(false)
  const [manualConversationOpen, setManualConversationOpen] = useState(false)
  const [manualConversationLoading, setManualConversationLoading] = useState(false)
  const [manualConversationError, setManualConversationError] = useState<string | null>(null)
  const [integrations, setIntegrations] = useState<EvolutionIntegration[]>([])
  const [manualConversation, setManualConversation] = useState<ManualConversationForm>(createEmptyManualConversationForm)
  const [leftPanelWidth, setLeftPanelWidth] = useState(420)
  const [rightPanelWidth, setRightPanelWidth] = useState(330)
  const [isResizingLeft, setIsResizingLeft] = useState(false)
  const [isResizingRight, setIsResizingRight] = useState(false)
  const [humanOverrideIds, setHumanOverrideIds] = useState<string[]>([])
  const [showEmoji, setShowEmoji] = useState(false)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [pendingPreview, setPendingPreview] = useState<string | null>(null)
  const [recState, setRecState] = useState<RecState>('idle')
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [recSecs, setRecSecs] = useState(0)

  const layoutRef = useRef<HTMLDivElement>(null)
  const detailRef = useRef<HTMLDivElement>(null)
  const inboxListRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const selectedConversation = useMemo(
    () => conversations.find(item => item.id === selectedId) ?? null,
    [conversations, selectedId],
  )

  const humanModeActive = useMemo(
    () => Boolean(selectedConversation && (selectedConversation.atendimento_humano || humanOverrideIds.includes(selectedConversation.id))),
      [humanOverrideIds, selectedConversation],
    )

  const currentHumanAgentName = selectedConversation?.agente_atual
    || selectedConversation?.agente_nome
    || profile?.nome
    || 'Humano'

  const manualChannelOptions = useMemo(() => {
    const preferredByQueue = new Map<QueueType, EvolutionIntegration>()

    for (const integration of integrations) {
      const queue = inferQueueFromIntegration(integration)
      const current = preferredByQueue.get(queue)
      const isPreferred = integration.instance_name?.toLowerCase() === queue
      const currentPreferred = current?.instance_name?.toLowerCase() === queue

      if (!current || (isPreferred && !currentPreferred)) {
        preferredByQueue.set(queue, integration)
      }
    }

    return Array.from(preferredByQueue.entries()).map(([queue, integration]) => ({
      queue,
      integration,
      label: `${queueLabel(queue)} - ${integrationDisplayName(integration)}`,
    }))
  }, [integrations])

  useEffect(() => {
    void bootstrap()
  }, [])

  useEffect(() => {
    if (!selectedConversation) {
      setMessages([])
      setHumanMessage('')
      setShowEmoji(false)
      return
    }

    setHumanMessage('')
    setShowEmoji(false)
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
        if (selectedId && conversationId === selectedId) void loadMessages(selectedId)
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

  useEffect(() => {
    function handleMouseMove(event: MouseEvent) {
      if (isResizingLeft && layoutRef.current) {
        const rect = layoutRef.current.getBoundingClientRect()
        const next = Math.min(Math.max(event.clientX - rect.left, 300), Math.max(300, rect.width - 560))
        setLeftPanelWidth(next)
      }

      if (isResizingRight && detailRef.current) {
        const rect = detailRef.current.getBoundingClientRect()
        const next = Math.min(Math.max(rect.right - event.clientX, 280), Math.max(280, rect.width - 380))
        setRightPanelWidth(next)
      }
    }

    function handleMouseUp() {
      setIsResizingLeft(false)
      setIsResizingRight(false)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizingLeft, isResizingRight])

  useEffect(() => {
    return () => {
      if (pendingPreview) URL.revokeObjectURL(pendingPreview)
      if (audioUrl) URL.revokeObjectURL(audioUrl)
      if (recTimerRef.current) clearInterval(recTimerRef.current)
      mediaRecorderRef.current?.stream?.getTracks().forEach(track => track.stop())
    }
  }, [audioUrl, pendingPreview])

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

    if (!queryError) setMessages((data ?? []) as CrmMessage[])
    setLoadingMessages(false)
  }

  async function loadAgents() {
    const { data } = await supabase
      .from('profiles')
      .select('id, nome, perfil')
      .eq('status', 'ativo')
      .in('perfil', ['admin', 'usuario', 'vendedor', 'agente_registro'])
      .order('nome', { ascending: true })

    const rows = ((data ?? []) as Partial<AgentOption>[])
      .filter(item => Boolean(item.id) && Boolean(item.nome))
      .map(item => ({
        id: String(item.id),
        nome: String(item.nome),
        perfil: String(item.perfil ?? 'usuario'),
      }))

    setAgents(rows)
  }

  async function fetchEvolutionIntegrations() {
    const { data: integrations, error: integrationError } = await supabase
      .from('external_integrations')
      .select('id, name, status, base_url, api_token, instance_name, sender_name')
      .eq('provider', 'evolution')
      .eq('status', 'ativo')
      .order('updated_at', { ascending: false })

    if (integrationError) throw new Error(`Nao foi possivel carregar a integracao Evolution: ${integrationError.message}`)

    return (integrations ?? []) as EvolutionIntegration[]
  }

  async function resolveEvolutionIntegration(instanceName?: string | null) {
    const rows = await fetchEvolutionIntegrations()

    const integration = rows.find(item => item.instance_name === instanceName) ?? rows[0]
    if (!integration?.base_url || !integration?.api_token || !integration?.instance_name) {
      throw new Error('Nenhuma integracao Evolution ativa foi encontrada para essa conversa.')
    }

    return integration
  }

  function markConversationAsHuman(conversationId: string) {
    setHumanOverrideIds(prev => prev.includes(conversationId) ? prev : [...prev, conversationId])
  }

  function unmarkConversationAsHuman(conversationId: string) {
    setHumanOverrideIds(prev => prev.filter(item => item !== conversationId))
  }

  function openKanban() {
    setViewMode('kanban')
    setKanbanOpen(true)
  }

  function closeKanban() {
    setViewMode('lista')
    setKanbanOpen(false)
  }

  function selectConversationFromKanban(conversationId: string) {
    setSelectedId(conversationId)
    closeKanban()
  }

  async function openManualConversationModal() {
    setManualConversationLoading(true)
    setManualConversationError(null)

    try {
      const rows = await fetchEvolutionIntegrations()
      setIntegrations(rows)

      if (rows.length === 0) {
        throw new Error('Nenhuma integracao Evolution ativa foi encontrada para iniciar uma conversa manual.')
      }

      const defaultIntegration =
        rows.find(item => item.instance_name?.toLowerCase() === 'atendimento')
        ?? rows.find(item => item.instance_name?.toLowerCase() === 'renovacao')
        ?? rows.find(item => item.instance_name?.toLowerCase() === 'certiid')
        ?? rows[0]
      setManualConversation({
        contactName: '',
        phone: '',
        queue: inferQueueFromIntegration(defaultIntegration),
        integrationId: defaultIntegration.id,
        firstMessage: '',
      })
      setManualConversationOpen(true)
    } catch (err) {
      setManualConversationError(err instanceof Error ? err.message : String(err))
    } finally {
      setManualConversationLoading(false)
    }
  }

  function closeManualConversationModal() {
    setManualConversationOpen(false)
    setManualConversationError(null)
    setManualConversation(createEmptyManualConversationForm())
  }

  async function activateConversationOwner(conversationId: string, agent: { id: string; nome: string }) {
    const { error: deactivateError } = await supabase
      .from('crm_chat_assignments')
      .update({ ativo: false })
      .eq('conversation_id', conversationId)
      .eq('ativo', true)

    if (deactivateError) throw new Error(`Nao foi possivel limpar a atribuicao anterior: ${deactivateError.message}`)

    const { error: insertError } = await supabase
      .from('crm_chat_assignments')
      .insert([{
        conversation_id: conversationId,
        agente_id: agent.id,
        agente_nome: agent.nome,
        ativo: true,
      }])

    if (insertError) throw new Error(`Nao foi possivel atribuir o atendimento: ${insertError.message}`)

    const { error: updateError } = await supabase
      .from('crm_chat_conversations')
      .update({
        atendimento_humano: true,
        agente_nome: agent.nome,
      })
      .eq('id', conversationId)

    if (updateError) throw new Error(`A atribuicao foi criada, mas a conversa nao foi atualizada: ${updateError.message}`)

    markConversationAsHuman(conversationId)
  }

  async function updateConversationStatus(status: string) {
    if (!selectedConversation) return
    setActionLoading(true)
    setActionError(null)
    const { error: queryError } = await supabase
      .from('crm_chat_conversations')
      .update({ kanban_status: status })
      .eq('id', selectedConversation.id)

    if (queryError) setActionError(`Nao foi possivel atualizar a etapa: ${queryError.message}`)
    else await loadConversations(false)
    setActionLoading(false)
  }

  async function updateConversationStatusById(conversationId: string, status: string) {
    const { error: queryError } = await supabase
      .from('crm_chat_conversations')
      .update({ kanban_status: status })
      .eq('id', conversationId)

    if (queryError) {
      setActionError(`Nao foi possivel mover o card no Kanban: ${queryError.message}`)
      return
    }

    await loadConversations(false)
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
        await supabase.from('crm_chat_assignments').update({ ativo: false }).eq('conversation_id', selectedConversation.id).eq('ativo', true)
        unmarkConversationAsHuman(selectedConversation.id)
      } else {
        markConversationAsHuman(selectedConversation.id)
      }
      await loadConversations(false)
    }

    setActionLoading(false)
  }

  async function assignConversation() {
    if (!selectedConversation || !selectedAgentId) return

    const selectedById = agents.find(item => item.id === selectedAgentId)
    const fallbackToCurrentProfile = profile?.id && selectedAgentId === profile.id
      ? { id: profile.id, nome: profile.nome ?? 'Usuario atual', perfil: profile.perfil ?? 'usuario' }
      : null
    const agent = selectedById ?? fallbackToCurrentProfile

    if (!agent?.id) {
      setActionError('Nao foi possivel identificar o ID do agente selecionado. Recarregue a tela e tente novamente.')
      return
    }

    setActionLoading(true)
    setActionError(null)

    try {
      await activateConversationOwner(selectedConversation.id, { id: agent.id, nome: agent.nome })
      await loadConversations(false)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    }

    setActionLoading(false)
  }

  async function createManualConversation() {
    const normalizedPhone = normalizePhone(manualConversation.phone)
    const firstMessage = manualConversation.firstMessage.trim()
    const contactName = manualConversation.contactName.trim()
    const selectedChannel = manualChannelOptions.find(item => item.integration.id === manualConversation.integrationId)

    if (!selectedChannel?.integration.instance_name || !selectedChannel.integration.base_url || !selectedChannel.integration.api_token) {
      setManualConversationError('Selecione um canal valido para iniciar a conversa.')
      return
    }

    if (!normalizedPhone) {
      setManualConversationError('Informe um telefone valido com DDD.')
      return
    }

    if (!firstMessage) {
      setManualConversationError('Informe a primeira mensagem para iniciar a conversa.')
      return
    }

    setManualConversationLoading(true)
    setManualConversationError(null)

    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const accessToken = sessionData.session?.access_token
      if (!accessToken) throw new Error('Sessao expirada. Atualize a pagina e tente novamente.')

      const response = await fetch(EDGE_FN, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          _action: 'send_message',
          base_url: selectedChannel.integration.base_url,
          api_token: selectedChannel.integration.api_token,
          instance_name: selectedChannel.integration.instance_name,
          number: normalizedPhone,
          content: firstMessage,
          sender_name: profile?.nome ?? 'Humano',
          contact_name: contactName || null,
          queue_override: manualConversation.queue,
        }),
      })

      const payload = await response.json() as { ok?: boolean; error?: string }
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? 'Nao foi possivel iniciar a conversa manual.')

      const { data: createdRows, error: createdError } = await supabase
        .from('crm_chat_admin_view')
        .select('*')
        .eq('document_key', normalizedPhone)
        .eq('whatsapp_instance', selectedChannel.integration.instance_name)
        .order('ultima_interacao_em', { ascending: false })
        .limit(1)

      if (createdError) throw new Error(`A conversa foi enviada, mas nao foi localizada no CRM: ${createdError.message}`)

      const createdConversation = (createdRows?.[0] ?? null) as ConversationRow | null
      if (!createdConversation?.id) throw new Error('A conversa foi enviada, mas ainda nao apareceu no CRM. Atualize e tente novamente.')

      if (contactName) {
        await supabase
          .from('crm_chat_conversations')
          .update({ cliente_nome: contactName, fila: manualConversation.queue })
          .eq('id', createdConversation.id)

        if (createdConversation.crm_customer_id) {
          await supabase
            .from('crm_customers')
            .update({ nome: contactName, contato_status: 'conversando' })
            .eq('id', createdConversation.crm_customer_id)
        }
      }

      if (profile?.id && profile?.nome) {
        await activateConversationOwner(createdConversation.id, { id: profile.id, nome: profile.nome })
      }

      await loadConversations(false)
      setSelectedId(createdConversation.id)
      closeManualConversationModal()
    } catch (err) {
      setManualConversationError(err instanceof Error ? err.message : String(err))
    } finally {
      setManualConversationLoading(false)
    }
  }

  function clearPendingFile() {
    if (pendingPreview) URL.revokeObjectURL(pendingPreview)
    setPendingFile(null)
    setPendingPreview(null)
  }

  function discardAudio() {
    if (recTimerRef.current) clearInterval(recTimerRef.current)
    mediaRecorderRef.current?.stream?.getTracks().forEach(track => track.stop())
    if (audioUrl) URL.revokeObjectURL(audioUrl)
    setAudioBlob(null)
    setAudioUrl(null)
    setRecState('idle')
    setRecSecs(0)
  }

  async function sendHumanReply() {
    if (!selectedConversation) return
    const text = humanMessage.trim()
    if (!text) return

    setSendingHumanMessage(true)
    setActionError(null)

    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const accessToken = sessionData.session?.access_token
      if (!accessToken) throw new Error('Sessao expirada. Atualize a pagina e tente novamente.')

      const integration = await resolveEvolutionIntegration(selectedConversation.whatsapp_instance)
      const destinationNumber = selectedConversation.telefone || selectedConversation.document_key
      if (!destinationNumber) throw new Error('Nao foi possivel identificar o numero do contato para envio.')

      const tempId = `temp-human-${Date.now()}`
      const tempCreatedAt = new Date().toISOString()
      const senderName = currentHumanAgentName
      setMessages(prev => [...prev, {
        id: tempId,
        conversation_id: selectedConversation.id,
        document_key: selectedConversation.document_key,
        direction: 'outgoing',
        sender_type: 'humano',
        sender_name: senderName,
        mensagem: text,
        created_at: tempCreatedAt,
      }])
      setHumanMessage('')

      const response = await fetch(EDGE_FN, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          _action: 'send_message',
          base_url: integration.base_url,
          api_token: integration.api_token,
          instance_name: integration.instance_name,
          number: destinationNumber,
          content: text,
          lead_id: selectedConversation.crm_customer_id,
          sender_name: senderName,
        }),
      })

      const payload = await response.json() as { ok?: boolean; error?: string; messageId?: string }
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? 'Nao foi possivel enviar a mensagem humana.')

      setMessages(prev => prev.map(item => item.id === tempId ? { ...item, id: payload.messageId ?? tempId } : item))
      markConversationAsHuman(selectedConversation.id)
      await loadConversations(false)
    } catch (err) {
      setActionError(`Falha no envio humano: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSendingHumanMessage(false)
    }
  }

  async function sendHumanAttachment(file: File | Blob, filename: string, mimeType?: string) {
    if (!selectedConversation) return { ok: false, error: 'Nenhuma conversa selecionada.' }

    const { data: sessionData } = await supabase.auth.getSession()
    const accessToken = sessionData.session?.access_token
    if (!accessToken) return { ok: false, error: 'Sessao expirada. Atualize a pagina e tente novamente.' }

    const integration = await resolveEvolutionIntegration(selectedConversation.whatsapp_instance)
    const destinationNumber = selectedConversation.telefone || selectedConversation.document_key
    if (!destinationNumber) return { ok: false, error: 'Nao foi possivel identificar o numero do contato.' }

    const finalMimeType = mimeType || file.type || 'application/octet-stream'
    const blob = file
    const form = new FormData()
    form.append('_action', 'send_attachment')
    form.append('base_url', integration.base_url ?? '')
    form.append('api_token', integration.api_token ?? '')
    form.append('instance_name', integration.instance_name ?? '')
    form.append('number', destinationNumber)
    form.append('lead_id', selectedConversation.crm_customer_id ?? '')
    form.append('sender_name', currentHumanAgentName)
    form.append('file', blob, filename)
    form.append('caption', filename)

    const response = await fetch(EDGE_FN, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}` },
      body: form,
    })

    const payload = await response.json() as { ok?: boolean; error?: string }
    if (!response.ok || !payload.ok) return { ok: false, error: payload.error ?? 'Nao foi possivel enviar o anexo.' }

    markConversationAsHuman(selectedConversation.id)
    await loadConversations(false)
    await loadMessages(selectedConversation.id)
    return { ok: true }
  }

  function handleFileSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    clearPendingFile()
    setPendingFile(file)
    setPendingPreview(file.type.startsWith('image/') ? URL.createObjectURL(file) : null)
    event.target.value = ''
  }

  async function handleFileSend() {
    if (!pendingFile) return
    setSendingHumanMessage(true)
    setActionError(null)
    try {
      const result = await sendHumanAttachment(pendingFile, pendingFile.name)
      if (!result.ok) throw new Error(result.error ?? 'Nao foi possivel enviar o anexo.')
      clearPendingFile()
    } catch (err) {
      setActionError(`Falha ao enviar anexo: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSendingHumanMessage(false)
    }
  }

  async function startRecording() {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Seu navegador nao expoe getUserMedia para capturar audio.')
      }

      if (typeof MediaRecorder === 'undefined') {
        throw new Error('Seu navegador nao suporta gravacao de audio via MediaRecorder.')
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const supportedMimeType = [
        'audio/webm;codecs=opus',
        'audio/ogg;codecs=opus',
        'audio/mp4',
        'audio/webm',
        'audio/ogg',
      ].find(type => MediaRecorder.isTypeSupported(type))

      const recorder = supportedMimeType ? new MediaRecorder(stream, { mimeType: supportedMimeType }) : new MediaRecorder(stream)
      mediaRecorderRef.current = recorder
      audioChunksRef.current = []
      recorder.ondataavailable = event => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data)
      }
      recorder.onstop = () => {
        stream.getTracks().forEach(track => track.stop())
        const blob = new Blob(audioChunksRef.current, { type: supportedMimeType ?? recorder.mimeType ?? 'audio/webm' })
        setAudioBlob(blob)
        setAudioUrl(URL.createObjectURL(blob))
        setRecState('preview')
      }
      recorder.start()
      setRecState('recording')
      setRecSecs(0)
      recTimerRef.current = setInterval(() => setRecSecs(current => current + 1), 1000)
    } catch (err) {
      setActionError(`Nao foi possivel acessar o microfone: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  function stopRecording() {
    if (recTimerRef.current) clearInterval(recTimerRef.current)
    mediaRecorderRef.current?.stop()
  }

  async function sendAudio() {
    if (!audioBlob) return
    setSendingHumanMessage(true)
    setActionError(null)
    try {
      const extension = audioBlob.type.includes('webm') ? 'webm' : 'ogg'
      const result = await sendHumanAttachment(audioBlob, `audio_${Date.now()}.${extension}`, audioBlob.type)
      if (!result.ok) throw new Error(result.error ?? 'Nao foi possivel enviar o audio.')
      discardAudio()
    } catch (err) {
      setActionError(`Falha ao enviar audio: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSendingHumanMessage(false)
    }
  }

  function insertEmoji(emoji: string) {
    const input = composerRef.current
    if (!input) {
      setHumanMessage(prev => prev + emoji)
      setShowEmoji(false)
      return
    }

    const start = input.selectionStart ?? humanMessage.length
    const end = input.selectionEnd ?? humanMessage.length
    setHumanMessage(`${humanMessage.slice(0, start)}${emoji}${humanMessage.slice(end)}`)
    setShowEmoji(false)

    requestAnimationFrame(() => {
      input.selectionStart = input.selectionEnd = start + emoji.length
      input.focus()
    })
  }

  async function handleComposerPaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const imageItem = Array.from(event.clipboardData.items).find(item => item.type.startsWith('image/'))
    if (!imageItem) return
    const file = imageItem.getAsFile()
    if (!file) return
    event.preventDefault()
    clearPendingFile()
    setPendingFile(file)
    setPendingPreview(URL.createObjectURL(file))
  }

  function handleHumanComposerKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void sendHumanReply()
    }
  }

  const searchMatchedConversations = useMemo(() => {
    return conversations.filter(item => {
      const text = `${item.cliente_nome ?? ''} ${item.nome_crm ?? ''} ${item.telefone ?? ''} ${item.document_key ?? ''} ${item.ultima_mensagem ?? ''}`.toLowerCase()
      return !search.trim() || text.includes(search.trim().toLowerCase())
    })
  }, [conversations, search])

  const filteredConversations = useMemo(() => {
    return searchMatchedConversations.filter(item => {
      const matchesQueue = queueFilter === 'todas' || item.fila === queueFilter
      const matchesHuman = humanFilter === 'todos'
        || (humanFilter === 'humano' && (item.atendimento_humano || humanOverrideIds.includes(item.id)))
        || (humanFilter === 'ia' && !item.atendimento_humano && !humanOverrideIds.includes(item.id))
      return matchesQueue && matchesHuman
    })
  }, [searchMatchedConversations, queueFilter, humanFilter, humanOverrideIds])

  const summary = useMemo(() => ({
      total: searchMatchedConversations.length,
      atendimento: searchMatchedConversations.filter(item => item.fila === 'atendimento').length,
      renovacao: searchMatchedConversations.filter(item => item.fila === 'renovacao').length,
      humano: searchMatchedConversations.filter(item => item.atendimento_humano || humanOverrideIds.includes(item.id)).length,
    }), [searchMatchedConversations, humanOverrideIds])

  const activeShortcut = useMemo(() => ({
    all: queueFilter === 'todas' && humanFilter === 'todos',
    atendimento: queueFilter === 'atendimento' && humanFilter === 'todos',
    renovacao: queueFilter === 'renovacao' && humanFilter === 'todos',
    humano: queueFilter === 'todas' && humanFilter === 'humano',
  }), [queueFilter, humanFilter])

  const groupedByStatus = useMemo(() => {
      return STATUS_COLUMNS.map(column => ({
        ...column,
        items: filteredConversations.filter(item => item.kanban_status === column.key),
      }))
    }, [filteredConversations])

  function applySummaryShortcut(target: 'all' | 'atendimento' | 'renovacao' | 'humano') {
    const nextQueue: 'todas' | QueueType =
      target === 'atendimento' ? 'atendimento' :
      target === 'renovacao' ? 'renovacao' :
      'todas'

    const nextHuman: 'todos' | 'ia' | 'humano' = target === 'humano' ? 'humano' : 'todos'

    setQueueFilter(nextQueue)
    setHumanFilter(nextHuman)

    const nextConversation = searchMatchedConversations.find(item => {
      const matchesQueue = nextQueue === 'todas' || item.fila === nextQueue
      const matchesHuman = nextHuman === 'todos'
        || (nextHuman === 'humano' && (item.atendimento_humano || humanOverrideIds.includes(item.id)))
      return matchesQueue && matchesHuman
    })

    setSelectedId(nextConversation?.id ?? null)
    requestAnimationFrame(() => {
      inboxListRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50 text-slate-900">
      <div className="shrink-0 border-b border-slate-200 bg-white px-6 py-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h1 className="text-2xl font-bold">Central de Atendimento CRM</h1>
            <p className="text-sm text-slate-500">Painel unificado do Kanban, filas de WhatsApp e historico de mensagens.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void openManualConversationModal()} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50" disabled={manualConversationLoading}>
              <MessageCircle size={15} /> Nova conversa
            </button>
            <button type="button" onClick={() => void loadConversations(true)} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} /> Atualizar
            </button>
            <button type="button" onClick={closeKanban} className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium ${!kanbanOpen ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-700'}`}>
              <List size={15} /> Chat
            </button>
            <button type="button" onClick={openKanban} className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium ${kanbanOpen ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-700'}`}>
              <Columns3 size={15} /> Kanban
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <SummaryCard label="Conversas visiveis" value={summary.total} active={activeShortcut.all} onClick={() => applySummaryShortcut('all')} />
          <SummaryCard label="Fila atendimento" value={summary.atendimento} active={activeShortcut.atendimento} onClick={() => applySummaryShortcut('atendimento')} />
          <SummaryCard label="Fila renovacao" value={summary.renovacao} active={activeShortcut.renovacao} onClick={() => applySummaryShortcut('renovacao')} />
          <SummaryCard label="Atendimento humano" value={summary.humano} active={activeShortcut.humano} onClick={() => applySummaryShortcut('humano')} />
        </div>

        <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_180px_180px]">
          <label className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
            <Search size={16} className="text-slate-400" />
            <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar por nome, telefone, documento ou mensagem" className="w-full bg-transparent text-sm outline-none" />
          </label>

          <select value={queueFilter} onChange={event => setQueueFilter(event.target.value as 'todas' | QueueType)} className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none">
            <option value="todas">Todas as filas</option>
            <option value="atendimento">Fila atendimento</option>
            <option value="renovacao">Fila renovacao</option>
          </select>

          <select value={humanFilter} onChange={event => setHumanFilter(event.target.value as 'todos' | 'ia' | 'humano')} className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none">
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
        <div className="flex flex-1 items-center justify-center text-slate-400">Carregando conversas do CRM...</div>
      ) : (
        <div ref={layoutRef} className="flex min-h-0 flex-1 flex-col gap-4 p-4 xl:flex-row">
          <section className="min-h-0 shrink-0 overflow-hidden rounded-3xl border border-slate-200 bg-white" style={{ width: `${leftPanelWidth}px` }}>
            <div className="border-b border-slate-200 px-4 py-3">
              <h2 className="text-sm font-semibold text-slate-700">Inbox operacional</h2>
              <p className="text-xs text-slate-400">Lista viva de conversas com filtros e abertura imediata do chat.</p>
            </div>

              <div ref={inboxListRef} className="h-[calc(100%-73px)] overflow-y-auto p-3">
                <div className="space-y-3">
                {filteredConversations.map(item => (
                  <ConversationCard key={item.id} item={item} selected={item.id === selectedId} onClick={() => setSelectedId(item.id)} human={item.atendimento_humano || humanOverrideIds.includes(item.id)} />
                ))}
                {filteredConversations.length === 0 && <EmptyState text="Nenhuma conversa encontrada com os filtros atuais." />}
              </div>
            </div>
          </section>

          <div className="hidden w-2 shrink-0 cursor-col-resize rounded-full bg-slate-200/80 transition hover:bg-sky-300 xl:block" onMouseDown={() => setIsResizingLeft(true)} />

          <section className="min-h-0 min-w-0 flex-1 overflow-hidden rounded-3xl border border-slate-200 bg-white">
            {!selectedConversation ? (
              <div className="flex h-full items-center justify-center text-slate-400">Selecione uma conversa para abrir o painel ADM.</div>
            ) : (
              <div ref={detailRef} className="flex h-full min-h-0 flex-col xl:flex-row">
                <div className="flex min-h-0 min-w-0 flex-1 flex-col xl:border-r xl:border-slate-200">
                  <div className="shrink-0 border-b border-slate-200 px-4 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="text-lg font-semibold">{selectedConversation.cliente_nome || selectedConversation.nome_crm || 'Sem nome identificado'}</h3>
                        <p className="mt-1 text-sm text-slate-500">{selectedConversation.telefone || selectedConversation.document_key}</p>
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs">
                        <Badge text={queueLabel(selectedConversation.fila)} tone={selectedConversation.fila === 'renovacao' ? 'violet' : 'blue'} />
                        <Badge text={statusLabel(selectedConversation.kanban_status)} tone="slate" />
                        <Badge text={humanModeActive ? 'Humano' : 'IA'} tone={humanModeActive ? 'green' : 'amber'} />
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
                          <MessageRow
                            key={message.id}
                            message={message}
                            fallbackHumanName={currentHumanAgentName}
                          />
                        ))}
                      </div>
                    )}
                  </div>

                  {humanModeActive && (
                    <div className="relative shrink-0 border-t border-slate-200 bg-white px-4 py-3">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-700">Resposta humana</p>
                          <p className="text-xs text-slate-500">Barra fixa com anexo, colagem de imagem, emoji e audio.</p>
                        </div>
                        <Badge text={selectedConversation.agente_atual || profile?.nome || 'Humano'} tone="green" />
                      </div>

                      {pendingFile && (
                        <div className="mb-3 flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
                          {pendingPreview ? (
                            <img src={pendingPreview} alt="Preview" className="h-14 w-14 rounded-xl object-cover" />
                          ) : (
                            <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-white text-[11px] font-semibold text-slate-500">
                              {pendingFile.name.split('.').pop()?.toUpperCase()}
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-slate-700">{pendingFile.name}</p>
                            <p className="text-xs text-slate-500">Pronto para envio manual</p>
                          </div>
                          <button type="button" onClick={() => void handleFileSend()} disabled={sendingHumanMessage} className="inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-600 px-3 text-sm font-medium text-white disabled:opacity-50">
                            {sendingHumanMessage ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                            Enviar
                          </button>
                          <button type="button" onClick={clearPendingFile} className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500">
                            <X size={15} />
                          </button>
                        </div>
                      )}

                      {recState === 'preview' && audioUrl && (
                        <div className="mb-3 flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
                          <audio src={audioUrl} controls className="min-w-0 flex-1" />
                          <button type="button" onClick={() => void sendAudio()} disabled={sendingHumanMessage} className="inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-600 px-3 text-sm font-medium text-white disabled:opacity-50">
                            {sendingHumanMessage ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                            Enviar
                          </button>
                          <button type="button" onClick={discardAudio} className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500">
                            <X size={15} />
                          </button>
                        </div>
                      )}

                      {showEmoji && (
                        <div className="absolute bottom-[96px] left-4 z-10 grid w-72 grid-cols-8 gap-1 rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl">
                          {EMOJIS.map(emoji => (
                            <button key={emoji} type="button" onClick={() => insertEmoji(emoji)} className="flex h-8 w-8 items-center justify-center rounded-lg text-lg hover:bg-slate-100">
                              {emoji}
                            </button>
                          ))}
                        </div>
                      )}

                      {recState === 'recording' && (
                        <div className="mb-2 flex items-center gap-2 px-1 text-sm text-red-600">
                          <span className="h-2 w-2 rounded-full bg-red-500" />
                          <span>{formatRecTime(recSecs)}</span>
                          <span className="text-xs text-slate-500">Gravando audio</span>
                        </div>
                      )}

                      <div className="flex items-end gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                        <input ref={fileInputRef} type="file" accept="image/*,.pdf,.doc,.docx,.txt,.csv,.xls,.xlsx" className="hidden" onChange={handleFileSelect} />
                        <button type="button" onClick={() => setShowEmoji(current => !current)} className={`inline-flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 ${showEmoji ? 'bg-amber-100 text-amber-700' : 'bg-white text-slate-500'}`}>
                          <Smile size={18} />
                        </button>
                        <button type="button" onClick={() => fileInputRef.current?.click()} disabled={sendingHumanMessage || recState === 'recording'} className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 disabled:opacity-50">
                          <Paperclip size={18} />
                        </button>
                        <textarea
                          ref={composerRef}
                          value={humanMessage}
                          onChange={event => setHumanMessage(event.target.value)}
                          onKeyDown={handleHumanComposerKeyDown}
                          onPaste={handleComposerPaste}
                          rows={2}
                          placeholder="Digite a resposta do atendimento humano. Enter envia e Shift+Enter quebra linha."
                          disabled={sendingHumanMessage || recState === 'recording'}
                          className="min-h-[52px] max-h-28 flex-1 resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-sky-400 disabled:opacity-60"
                          onInput={event => {
                            const element = event.currentTarget
                            element.style.height = 'auto'
                            element.style.height = `${Math.min(element.scrollHeight, 112)}px`
                          }}
                        />
                        {humanMessage.trim() ? (
                          <button type="button" onClick={() => void sendHumanReply()} disabled={sendingHumanMessage || !humanMessage.trim()} className="inline-flex h-11 items-center gap-2 rounded-xl bg-sky-600 px-4 text-sm font-medium text-white disabled:opacity-50">
                            {sendingHumanMessage ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                            Enviar
                          </button>
                        ) : (
                          <button type="button" onClick={recState === 'idle' ? () => void startRecording() : stopRecording} disabled={sendingHumanMessage || recState === 'preview'} className={`inline-flex h-11 w-11 items-center justify-center rounded-xl ${recState === 'recording' ? 'bg-red-500 text-white' : 'border border-slate-200 bg-white text-slate-500'} disabled:opacity-50`}>
                            {recState === 'recording' ? <StopCircle size={18} /> : <Mic size={18} />}
                          </button>
                        )}
                      </div>

                      {actionError && (
                        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">{actionError}</div>
                      )}
                    </div>
                  )}
                </div>

                <div className="hidden w-2 shrink-0 cursor-col-resize rounded-full bg-slate-200/80 transition hover:bg-sky-300 xl:block" onMouseDown={() => setIsResizingRight(true)} />

                <aside className="min-h-0 shrink-0 overflow-y-auto px-4 py-4" style={{ width: `${rightPanelWidth}px` }}>
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
                      <select value={selectedConversation.kanban_status} onChange={event => void updateConversationStatus(event.target.value)} disabled={actionLoading} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none">
                        {STATUS_COLUMNS.map(column => (
                          <option key={column.key} value={column.key}>{column.label}</option>
                        ))}
                      </select>

                      <div className="mt-3 flex flex-wrap gap-2">
                        <button type="button" disabled={actionLoading || humanModeActive} onClick={() => void toggleHumanMode(true)} className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
                          Assumir humano
                        </button>
                        <button type="button" disabled={actionLoading || !humanModeActive} onClick={() => void toggleHumanMode(false)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-50">
                          Voltar para IA
                        </button>
                      </div>

                      <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-slate-500">Atribuir agente</label>
                      <select value={selectedAgentId} onChange={event => setSelectedAgentId(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none">
                        <option value="">Selecione um agente</option>
                        {agents.map(agent => (
                          <option key={agent.id} value={agent.id}>{agent.nome} - {agent.perfil}</option>
                        ))}
                      </select>
                      <button type="button" onClick={() => void assignConversation()} disabled={actionLoading || !selectedAgentId} className="mt-2 w-full rounded-xl bg-sky-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
                        Atribuir conversa
                      </button>
                    </PanelBlock>

                    <PanelBlock title="Observacoes do contato">
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{selectedConversation.observacoes || 'Sem observacoes no crm_customers.'}</p>
                    </PanelBlock>

                    <PanelBlock title="Leitura operacional">
                      <ul className="space-y-2 text-sm text-slate-600">
                        <li>Fila: <strong>{queueLabel(selectedConversation.fila)}</strong></li>
                        <li>Modo atual: <strong>{humanModeActive ? 'Humano' : 'IA Clara'}</strong></li>
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

      {manualConversationOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-2xl rounded-[28px] border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Nova conversa manual</h3>
                <p className="text-sm text-slate-500">Escolha o numero de saida, informe o contato e envie a primeira mensagem.</p>
              </div>
              <button type="button" onClick={closeManualConversationModal} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                <X size={15} /> Fechar
              </button>
            </div>

            <div className="space-y-4 px-5 py-5">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Nome do contato</span>
                  <input
                    value={manualConversation.contactName}
                    onChange={event => setManualConversation(prev => ({ ...prev, contactName: event.target.value }))}
                    placeholder="Ex.: Alexandre"
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-sky-400"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Telefone com DDD</span>
                  <input
                    value={manualConversation.phone}
                    onChange={event => setManualConversation(prev => ({ ...prev, phone: event.target.value }))}
                    placeholder="5511999999999"
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-sky-400"
                  />
                </label>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Numero de saida</span>
                  <select
                    value={manualConversation.integrationId}
                    onChange={event => {
                      const next = manualChannelOptions.find(item => item.integration.id === event.target.value)
                      setManualConversation(prev => ({
                        ...prev,
                        integrationId: event.target.value,
                        queue: next?.queue ?? prev.queue,
                      }))
                    }}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-sky-400"
                  >
                    <option value="">Selecione um canal</option>
                    {manualChannelOptions.map(option => (
                      <option key={option.integration.id} value={option.integration.id}>{option.label}</option>
                    ))}
                  </select>
                </label>

                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Fila da conversa</span>
                  <select
                    value={manualConversation.queue}
                    onChange={event => setManualConversation(prev => ({ ...prev, queue: event.target.value as QueueType }))}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-sky-400"
                  >
                    <option value="atendimento">Atendimento</option>
                    <option value="renovacao">Renovacao</option>
                  </select>
                </label>
              </div>

              <label className="block space-y-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Primeira mensagem</span>
                <textarea
                  value={manualConversation.firstMessage}
                  onChange={event => setManualConversation(prev => ({ ...prev, firstMessage: event.target.value }))}
                  rows={5}
                  placeholder="Digite aqui a mensagem inicial para o contato."
                  className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm outline-none focus:border-sky-400"
                />
              </label>

              {manualConversationError && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                  {manualConversationError}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-end gap-2">
                <button type="button" onClick={closeManualConversationModal} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                  Cancelar
                </button>
                <button type="button" onClick={() => void createManualConversation()} disabled={manualConversationLoading} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
                  {manualConversationLoading ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                  Iniciar conversa
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {kanbanOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[2px]">
          <div className="flex h-[min(92vh,960px)] w-[min(98vw,1720px)] flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Kanban operacional</h3>
                <p className="text-sm text-slate-500">Janela ampla para organizar as filas. Ao clicar no card, voce volta direto para o chat.</p>
              </div>
              <button type="button" onClick={closeKanban} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                <X size={15} /> Fechar
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden p-4">
              <div className="flex h-full gap-3" style={{ minWidth: `${STATUS_COLUMNS.length * 290}px` }}>
                {groupedByStatus.map(column => (
                  <div
                    key={column.key}
                    className={`flex min-h-0 w-[280px] flex-col rounded-2xl border ${TONE_STYLES[column.tone]}`}
                    onDragOver={event => event.preventDefault()}
                    onDrop={event => {
                      event.preventDefault()
                      const droppedId = event.dataTransfer.getData('text/plain') || draggedConversationId
                      if (!droppedId) return
                      setDraggedConversationId(null)
                      void updateConversationStatusById(droppedId, column.key)
                    }}
                  >
                    <div className="flex items-center justify-between border-b border-black/5 px-3 py-3">
                      <span className="text-sm font-semibold">{column.label}</span>
                      <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-slate-600">{column.items.length}</span>
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto p-2">
                      <div className="space-y-2">
                        {column.items.map(item => (
                          <ConversationMiniCard
                            key={item.id}
                            item={item}
                            selected={item.id === selectedId}
                            onClick={() => selectConversationFromKanban(item.id)}
                            human={item.atendimento_humano || humanOverrideIds.includes(item.id)}
                            draggable
                            onDragStart={event => {
                              setDraggedConversationId(item.id)
                              event.dataTransfer.setData('text/plain', item.id)
                              event.dataTransfer.effectAllowed = 'move'
                            }}
                            onDragEnd={() => setDraggedConversationId(null)}
                          />
                        ))}
                        {column.items.length === 0 && <EmptyState text="Sem conversas" compact />}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function SummaryCard({
  label,
  value,
  active = false,
  onClick,
}: {
  label: string
  value: number
  active?: boolean
  onClick?: () => void
}) {
  const className = `rounded-2xl border px-4 py-3 text-left transition ${
    active
      ? 'border-sky-300 bg-sky-50 shadow-sm'
      : 'border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white'
  }`

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={className}>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
        <p className="mt-2 text-2xl font-bold text-slate-900">{value}</p>
        <p className="mt-1 text-xs text-slate-400">Clique para filtrar os contatos</p>
      </button>
    )
  }

  return (
    <div className={className}>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-bold text-slate-900">{value}</p>
    </div>
  )
}

function ConversationCard({ item, selected, onClick, human }: { item: ConversationRow; selected: boolean; onClick: () => void; human: boolean }) {
  return (
    <button type="button" onClick={onClick} className={`w-full rounded-2xl border px-4 py-3 text-left transition ${selected ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{item.cliente_nome || item.nome_crm || 'Sem nome'}</p>
          <p className={`mt-1 truncate text-xs ${selected ? 'text-slate-300' : 'text-slate-500'}`}>{item.telefone || item.document_key}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${selected ? 'bg-white/15 text-white' : 'bg-slate-100 text-slate-600'}`}>{queueLabel(item.fila)}</span>
          {human ? <UserRound size={14} /> : <Bot size={14} />}
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

function ConversationMiniCard({
  item,
  selected,
  onClick,
  human,
  draggable = false,
  onDragStart,
  onDragEnd,
}: {
  item: ConversationRow
  selected: boolean
  onClick: () => void
  human: boolean
  draggable?: boolean
  onDragStart?: (event: React.DragEvent<HTMLButtonElement>) => void
  onDragEnd?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`w-full rounded-xl border px-3 py-3 text-left ${selected ? 'border-slate-900 bg-slate-900 text-white' : 'border-white/70 bg-white hover:border-slate-300'}`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-sm font-semibold">{item.cliente_nome || item.nome_crm || 'Sem nome'}</p>
        {human ? <UserRound size={14} /> : <Bot size={14} />}
      </div>
      <p className={`mt-1 truncate text-xs ${selected ? 'text-slate-300' : 'text-slate-500'}`}>{item.telefone || item.document_key}</p>
      <p className={`mt-2 line-clamp-2 text-xs ${selected ? 'text-slate-100' : 'text-slate-600'}`}>{item.ultima_mensagem || 'Sem mensagem'}</p>
    </button>
  )
}

function MessageRow({ message, fallbackHumanName }: { message: CrmMessage; fallbackHumanName?: string | null }) {
    const isOutgoing = message.direction === 'outgoing'
  const senderLabel = message.sender_type === 'cliente'
    ? 'Cliente'
    : message.sender_type === 'ia'
      ? 'IA Clara'
      : message.sender_name || fallbackHumanName || 'Humano'

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
