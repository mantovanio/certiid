import { useState, useEffect, useRef } from 'react'
import { X, Send, Loader2, MessageCircle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { Lead } from '@/types'

const EDGE_FN = 'https://cvfrhfiaprdtwxxplngk.supabase.co/functions/v1/chatwoot-webhook'

export interface ChatwootCfg {
  base_url:   string
  api_token:  string
  account_id: string
  inbox_id:   string | null
}

interface Message {
  id:           number | string
  content:      string
  message_type: number
  created_at:   number
  sender_name?: string | null
}

interface Props {
  lead:     Lead
  chatwoot: ChatwootCfg
  onClose:  () => void
}

function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null
  const digits = raw.replace(/\D/g, '')
  if (!digits) return null
  if (digits.startsWith('55') && digits.length >= 12) return `+${digits}`
  if (digits.length === 10 || digits.length === 11) return `+55${digits}`
  return null // menos de 10 dígitos — inválido
}

export default function ChatPanel({ lead, chatwoot, onClose }: Props) {
  const [conversationId, setConversationId] = useState<string | null>(lead.id_conversa_chatwoot)
  const [messages, setMessages]   = useState<Message[]>([])
  const [loading, setLoading]     = useState(true)
  const [loadingLabel, setLoadingLabel] = useState('Carregando...')
  const [input, setInput]         = useState('')
  const [sending, setSending]     = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef  = useRef<HTMLTextAreaElement>(null)

  // Inicializa: cria conversa se necessário, depois carrega mensagens
  useEffect(() => {
    void init()
    inputRef.current?.focus()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Assina realtime assim que tiver o ID da conversa
  useEffect(() => {
    if (!conversationId) return
    const channel = supabase
      .channel(`chat-events-${conversationId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'communication_events', filter: `conversation_id=eq.${conversationId}` },
        (change) => {
          const row = change.new as Record<string, unknown>
          const evPayload = row.payload as Record<string, unknown> | undefined
          if (row.event_type !== 'message_created') return
          const data = evPayload?.data as Record<string, unknown> | undefined
          if (!data || (data.message_type !== 0 && data.message_type !== 1)) return
          const msg: Message = {
            id:           data.id as number,
            content:      (data.content as string) ?? '',
            message_type: data.message_type as number,
            created_at:   data.created_at as number,
            sender_name:  ((data.sender as Record<string, unknown>)?.name as string) ?? null,
          }
          setMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg])
        },
      )
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [conversationId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function init() {
    setLoading(true)
    setFetchError(null)

    let convId = lead.id_conversa_chatwoot

    if (!convId) {
      const phone = normalizePhone(lead.whatsapp_lead)
      if (!phone) {
        setFetchError(
          lead.whatsapp_lead
            ? `Número "${lead.whatsapp_lead}" inválido — informe DDD + número (ex: 11 99999-9999) e salve o contato antes de abrir o chat.`
            : 'Contato sem número de WhatsApp. Edite o contato e adicione um número antes de abrir o chat.'
        )
        setLoading(false)
        return
      }

      setLoadingLabel('Criando conversa no Chatwoot...')
      try {
        const res  = await fetch(EDGE_FN, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            _action:       'create_conversation',
            base_url:      chatwoot.base_url,
            api_token:     chatwoot.api_token,
            account_id:    chatwoot.account_id,
            inbox_id:      chatwoot.inbox_id,
            contact_phone: phone,
            contact_name:  lead.nome_lead ?? 'Cliente',
            lead_id:       lead.id,
          }),
        })
        const data = await res.json() as { ok: boolean; conversation_id?: string; error?: string }
        if (!data.ok || !data.conversation_id) {
          setFetchError(data.error ?? 'Não foi possível criar a conversa')
          setLoading(false)
          return
        }
        convId = data.conversation_id
        setConversationId(convId)
      } catch {
        setFetchError('Sem conexão com o servidor')
        setLoading(false)
        return
      }
    }

    setLoadingLabel('Carregando mensagens...')
    await fetchMessages(convId)
    await loadHistory(convId)
  }

  async function fetchMessages(convId: string) {
    setFetchError(null)
    try {
      const res  = await fetch(EDGE_FN, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          _action:         'get_messages',
          conversation_id: convId,
          account_id:      chatwoot.account_id,
          base_url:        chatwoot.base_url,
          api_token:       chatwoot.api_token,
        }),
      })
      const data = await res.json() as { ok: boolean; messages?: Message[]; error?: string }
      if (data.ok && data.messages) {
        setMessages(data.messages)
      } else {
        setFetchError(data.error ?? 'Erro ao carregar mensagens')
      }
    } catch {
      setFetchError('Sem conexão com o servidor')
    } finally {
      setLoading(false)
    }
  }

  async function loadHistory(convId: string) {
    const { data, error } = await supabase
      .from('communication_events')
      .select('payload, created_at')
      .eq('conversation_id', convId)
      .eq('event_type', 'message_created')
      .order('created_at', { ascending: true })

    if (error || !data) return

    const history = data
      .map(row => {
        const evPayload = row.payload as Record<string, unknown> | undefined
        const msgData = evPayload?.data as Record<string, unknown> | undefined
        if (!msgData || (msgData.message_type !== 0 && msgData.message_type !== 1)) return null
        return {
          id: msgData.id as number | string,
          content: (msgData.content as string) ?? '',
          message_type: msgData.message_type as number,
          created_at: msgData.created_at as number,
          sender_name: ((msgData.sender as Record<string, unknown>)?.name as string) ?? null,
        } as Message
      })
      .filter((message): message is Message => message !== null)

    if (history.length > 0) {
      setMessages(prev => {
        const merged = [...prev]
        for (const msg of history) {
          if (!merged.some(item => item.id === msg.id)) merged.push(msg)
        }
        merged.sort((a, b) => {
          const aTime = a.created_at > 1e10 ? a.created_at : a.created_at * 1000
          const bTime = b.created_at > 1e10 ? b.created_at : b.created_at * 1000
          return aTime - bTime
        })
        return merged
      })
    }
  }

  async function handleSend() {
    const text = input.trim()
    if (!text || sending || !conversationId) return

    setSending(true)
    setInput('')

    const tempId = `temp-${Date.now()}`
    setMessages(prev => [...prev, {
      id: tempId, content: text, message_type: 1, created_at: Math.floor(Date.now() / 1000),
    }])

    try {
      const res  = await fetch(EDGE_FN, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          _action:         'send_message',
          conversation_id: conversationId,
          account_id:      chatwoot.account_id,
          base_url:        chatwoot.base_url,
          api_token:       chatwoot.api_token,
          content:         text,
        }),
      })
      const data = await res.json() as { ok: boolean; message?: Message }
      if (data.ok && data.message) {
        setMessages(prev => prev.map(m => m.id === tempId ? { ...data.message!, id: data.message!.id } : m))
      }
    } catch {
      // mantém mensagem otimista
    } finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSend() }
  }

  return (
    <div className="fixed bottom-4 right-4 w-96 h-[580px] bg-white dark:bg-gray-950 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-800 flex flex-col z-50 overflow-hidden">

      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-gray-100 dark:bg-gray-900 shrink-0 border-b border-gray-200 dark:border-gray-800">
        <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-800 flex items-center justify-center shrink-0">
          <MessageCircle size={16} className="text-gray-600 dark:text-gray-300" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-gray-900 dark:text-gray-100 font-semibold text-sm truncate">{lead.nome_lead || 'Sem nome'}</p>
          {lead.whatsapp_lead && <p className="text-gray-500 dark:text-gray-400 text-xs truncate">{lead.whatsapp_lead}</p>}
        </div>
        <button type="button" onClick={onClose} title="Fechar" aria-label="Fechar conversa" className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors shrink-0">
          <X size={18} />
        </button>
      </div>

      {/* Área de mensagens */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 bg-gray-50 dark:bg-gray-950/40">
        {loading && (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-gray-400 text-sm">
            <Loader2 size={20} className="animate-spin" />
            {loadingLabel}
          </div>
        )}

        {!loading && fetchError && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-4">
            <p className="text-sm text-red-500">{fetchError}</p>
            <button type="button" onClick={() => void init()} className="text-xs text-blue-500 hover:underline">
              Tentar novamente
            </button>
          </div>
        )}

        {!loading && !fetchError && messages.length === 0 && (
          <div className="flex items-center justify-center h-full text-gray-400 text-sm">
            Nenhuma mensagem ainda. Diga olá!
          </div>
        )}

        {!loading && !fetchError && messages.map(msg => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-3 py-3 border-t border-gray-100 dark:border-gray-700 flex items-end gap-2 shrink-0 bg-white dark:bg-[#1E2535]">
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Digite uma mensagem… (Enter para enviar)"
          rows={1}
          disabled={loading || !!fetchError}
          className="flex-1 resize-none max-h-24 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gray-400 dark:focus:ring-gray-500 dark:text-gray-100 placeholder-gray-400 overflow-y-auto disabled:opacity-50"
          onInput={e => {
            const el = e.currentTarget
            el.style.height = 'auto'
            el.style.height = `${Math.min(el.scrollHeight, 96)}px`
          }}
        />
        <button
          type="button"
          onClick={() => void handleSend()}
          disabled={!input.trim() || sending || loading || !!fetchError}
          className="shrink-0 w-9 h-9 flex items-center justify-center bg-gray-900 hover:bg-black dark:bg-gray-200 dark:hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed text-white dark:text-gray-900 rounded-xl transition-colors"
        >
          {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
        </button>
      </div>
    </div>
  )
}

function MessageBubble({ message }: { message: Message }) {
  const isOut = message.message_type === 1
  const time  = new Date(
    message.created_at > 1e10 ? message.created_at : message.created_at * 1000,
  ).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

  return (
    <div className={`flex ${isOut ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[78%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
        isOut
          ? 'bg-green-600 text-white rounded-br-none'
          : 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-bl-none border border-gray-100 dark:border-gray-600'
      }`}>
        {!isOut && message.sender_name && (
          <p className="text-[10px] font-semibold text-green-600 dark:text-green-400 mb-0.5">{message.sender_name}</p>
        )}
        <p className="whitespace-pre-wrap break-words leading-relaxed">{message.content}</p>
        <p className={`text-[10px] mt-1 text-right ${isOut ? 'text-green-200' : 'text-gray-400 dark:text-gray-500'}`}>{time}</p>
      </div>
    </div>
  )
}
