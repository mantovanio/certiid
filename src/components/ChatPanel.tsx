import { useState, useEffect, useRef } from 'react'
import { X, Send, Loader2, Smile, Paperclip, Mic, StopCircle, Trash2, MessageCircle, ExternalLink } from 'lucide-react'
import { supabase, SUPABASE_ANON_KEY } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/logger'
import type { ChatContact } from '@/types'

// ── Public types ───────────────────────────────────────────────

export type { ChatContact }

export interface ChatwootCfg {
  base_url:   string
  api_token:  string
  account_id: string
  inbox_id:   string | null
}

// ── Internal types ─────────────────────────────────────────────

interface Attachment {
  file_type?:    string
  data_url?:     string
  download_url?: string
  file_name?:    string
}

interface Message {
  id:           number | string
  content:      string
  message_type: number
  created_at:   number
  sender_name?: string | null
  attachments?: Attachment[]
}

interface Props {
  contact:  ChatContact
  chatwoot: ChatwootCfg | null
  onClose:  () => void
}

// ── Constants ──────────────────────────────────────────────────

const EDGE_FN = 'https://cvfrhfiaprdtwxxplngk.supabase.co/functions/v1/chatwoot-webhook'

const EMOJIS = [
  '😊','😂','🥰','😍','😘','😁','😎','🤩','😜','😅','😭','😤',
  '🙏','👍','👏','🙌','💪','🤝','👋','✌️','❤️','🔥','✨','⭐',
  '🎉','🎊','🏆','💯','🎯','🚀','💡','✅','❌','⚠️','📌','📎',
  '📞','📲','💬','📧','📅','🔒','🔑','💰','📋','🔔','📣','💻',
]

// ── Helpers ────────────────────────────────────────────────────

function whatsappWebUrl(telefone: string | null | undefined): string | null {
  if (!telefone) return null
  const digits = telefone.replace(/\D/g, '')
  if (!digits) return null
  const full = digits.startsWith('55') ? digits : `55${digits}`
  return `https://wa.me/${full}`
}

function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null
  const digits = raw.replace(/\D/g, '')
  if (!digits) return null
  if (digits.startsWith('55') && digits.length >= 12) return `+${digits}`
  if (digits.length === 10 || digits.length === 11) return `+55${digits}`
  return null
}

function fmtTime(seconds: number) {
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`
}

// ── Component ──────────────────────────────────────────────────

export default function ChatPanel({ contact, chatwoot, onClose }: Props) {
  const [conversationId, setConversationId] = useState<string | null>(contact.id_conversa_chatwoot)
  const [messages, setMessages]             = useState<Message[]>([])
  const [loading, setLoading]               = useState(true)
  const [loadingLabel, setLoadingLabel]     = useState('Carregando...')
  const [input, setInput]                   = useState('')
  const [sending, setSending]               = useState(false)
  const [fetchError, setFetchError]         = useState<string | null>(null)
  const [showEmoji, setShowEmoji]           = useState(false)

  // file attachment
  const [pendingFile, setPendingFile]       = useState<File | null>(null)
  const [pendingPreview, setPendingPreview] = useState<string | null>(null)

  // audio recording
  type RecState = 'idle' | 'recording' | 'preview'
  const [recState, setRecState]   = useState<RecState>('idle')
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null)
  const [audioUrl, setAudioUrl]   = useState<string | null>(null)
  const [recSecs, setRecSecs]     = useState(0)

  const bottomRef         = useRef<HTMLDivElement>(null)
  const inputRef          = useRef<HTMLTextAreaElement>(null)
  const fileInputRef      = useRef<HTMLInputElement>(null)
  const mediaRecorderRef  = useRef<MediaRecorder | null>(null)
  const audioChunksRef    = useRef<Blob[]>([])
  const recTimerRef       = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Init & realtime ─────────────────────────────────────────

  useEffect(() => {
    void init()
    inputRef.current?.focus()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!conversationId) return
    const channel = supabase
      .channel(`chat-events-${conversationId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'communication_events', filter: `conversation_id=eq.${conversationId}` },
        (change) => {
          const row      = change.new as Record<string, unknown>
          const evPld    = row.payload as Record<string, unknown> | undefined
          if (row.event_type !== 'message_created') return
          const data = evPld?.data as Record<string, unknown> | undefined
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

  // ── Conversation ────────────────────────────────────────────

  async function init() {
    setLoading(true)
    setFetchError(null)
    logger.info('ChatPanel', 'init', { contact_id: contact.id, nome: contact.nome, telefone: contact.telefone, id_conversa: contact.id_conversa_chatwoot })

    if (!chatwoot) {
      logger.warn('ChatPanel', 'chatwoot não configurado — integration ausente ou campos incompletos')
      setFetchError('chatwoot_not_configured')
      setLoading(false)
      return
    }

    logger.info('ChatPanel', 'chatwoot config carregada', { base_url: chatwoot.base_url, account_id: chatwoot.account_id, inbox_id: chatwoot.inbox_id })

    let convId = contact.id_conversa_chatwoot

    if (!convId) {
      const phone = normalizePhone(contact.telefone)
      if (!phone) {
        logger.warn('ChatPanel', 'telefone inválido ou ausente', { telefone: contact.telefone })
        setFetchError(
          contact.telefone
            ? `Número "${contact.telefone}" inválido. Informe DDD + número e salve antes de abrir o chat.`
            : 'Contato sem WhatsApp. Adicione um número antes de abrir o chat.',
        )
        setLoading(false)
        return
      }
      setLoadingLabel('Criando conversa no Chatwoot...')
      logger.info('ChatPanel', 'criando conversa no Chatwoot', { phone, inbox_id: chatwoot.inbox_id })
      try {
        const res  = await fetch(EDGE_FN, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
          body:    JSON.stringify({
            _action:       'create_conversation',
            base_url:      chatwoot.base_url,
            api_token:     chatwoot.api_token,
            account_id:    chatwoot.account_id,
            inbox_id:      chatwoot.inbox_id,
            contact_phone: phone,
            contact_name:  contact.nome ?? 'Cliente',
            lead_id:       contact.id,
          }),
        })
        const data = await res.json() as { ok: boolean; conversation_id?: string; error?: string }
        logger.info('ChatPanel', 'create_conversation resposta', data)
        if (!data.ok || !data.conversation_id) {
          logger.error('ChatPanel', 'falha ao criar conversa', { error: data.error, inbox_id: chatwoot.inbox_id })
          setFetchError(data.error ?? 'Não foi possível criar a conversa')
          setLoading(false)
          return
        }
        convId = data.conversation_id
        setConversationId(convId)
      } catch (e) {
        logger.error('ChatPanel', 'exceção ao criar conversa', String(e))
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
    if (!chatwoot) return
    setFetchError(null)
    logger.info('ChatPanel', 'buscando mensagens', { convId })
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
      logger.info('ChatPanel', 'get_messages resposta', { ok: data.ok, count: data.messages?.length, error: data.error })
      if (data.ok && data.messages) {
        setMessages(data.messages)
      } else {
        const detail = data.error ?? `HTTP ${res.status}`
        if (detail.includes('404') || detail.includes('not found')) {
          logger.warn('ChatPanel', 'conversa não encontrada — recriando automaticamente', { convId })
          void clearAndRecreate()
        } else {
          logger.error('ChatPanel', 'falha ao buscar mensagens', { detail, convId })
          setFetchError(detail)
        }
      }
    } catch (e) {
      logger.error('ChatPanel', 'exceção ao buscar mensagens', String(e))
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
        const evPld  = row.payload as Record<string, unknown> | undefined
        const msgData = evPld?.data as Record<string, unknown> | undefined
        if (!msgData || (msgData.message_type !== 0 && msgData.message_type !== 1)) return null
        return {
          id:           msgData.id as number | string,
          content:      (msgData.content as string) ?? '',
          message_type: msgData.message_type as number,
          created_at:   msgData.created_at as number,
          sender_name:  ((msgData.sender as Record<string, unknown>)?.name as string) ?? null,
        } as Message
      })
      .filter((m): m is Message => m !== null)

    if (history.length > 0) {
      setMessages(prev => {
        const merged = [...prev]
        for (const msg of history) {
          if (!merged.some(m => m.id === msg.id)) merged.push(msg)
        }
        merged.sort((a, b) => {
          const aT = a.created_at > 1e10 ? a.created_at : a.created_at * 1000
          const bT = b.created_at > 1e10 ? b.created_at : b.created_at * 1000
          return aT - bT
        })
        return merged
      })
    }
  }

  async function clearAndRecreate() {
    if (contact._table === 'leads_contabilidade') {
      await supabase.from('leads_contabilidade').update({ id_conversa_chatwoot: null }).eq('id', contact.id)
    }
    setConversationId(null)
    setFetchError(null)
    setMessages([])
    void init()
  }

  // ── Send text ────────────────────────────────────────────────

  async function handleSend() {
    if (!chatwoot) return
    const text = input.trim()
    if (!text || sending || !conversationId) return
    logger.info('ChatPanel', 'enviando mensagem', { convId: conversationId, length: text.length })
    setSending(true)
    setInput('')
    const tempId = `temp-${Date.now()}`
    setMessages(prev => [...prev, { id: tempId, content: text, message_type: 1, created_at: Math.floor(Date.now() / 1000) }])
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
    } catch (e) {
      logger.error('ChatPanel', 'falha ao enviar mensagem', String(e))
    } finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }

  // ── Send attachment (direct Chatwoot API — CORS deve estar habilitado) ──

  async function sendAttachment(file: File | Blob, filename: string, mimeType?: string): Promise<boolean> {
    if (!chatwoot || !conversationId) return false
    const blob = (mimeType && !(file instanceof File)) ? new Blob([file], { type: mimeType }) : file
    const form = new FormData()
    form.append('_action',         'send_attachment')
    form.append('base_url',        chatwoot.base_url)
    form.append('api_token',       chatwoot.api_token)
    form.append('account_id',      chatwoot.account_id)
    form.append('conversation_id', conversationId)
    form.append('file',            blob, filename)
    form.append('filename',        filename)
    try {
      const res = await fetch(EDGE_FN, {
        method:  'POST',
        headers: { 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
        body:    form,
      })
      const data = await res.json() as { ok: boolean; message?: { id: number; content?: string; message_type: number; created_at: number } }
      logger.info('ChatPanel', 'send_attachment resposta', { ok: data.ok })
      if (data.ok && data.message) {
        setMessages(prev => [
          ...prev,
          { id: data.message!.id, content: data.message!.content ?? '', message_type: 1, created_at: data.message!.created_at ?? Math.floor(Date.now() / 1000), attachments: [{ file_name: filename }] },
        ])
        return true
      }
      logger.error('ChatPanel', 'falha ao enviar anexo via Edge Function', data)
    } catch (e) {
      logger.error('ChatPanel', 'falha ao enviar anexo', String(e))
    }
    return false
  }

  // ── File attachment ──────────────────────────────────────────

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setPendingFile(file)
    if (file.type.startsWith('image/')) {
      setPendingPreview(URL.createObjectURL(file))
    } else {
      setPendingPreview(null)
    }
    e.target.value = ''
  }

  function clearFile() {
    if (pendingPreview) URL.revokeObjectURL(pendingPreview)
    setPendingFile(null)
    setPendingPreview(null)
  }

  async function handleFileSend() {
    if (!pendingFile || !conversationId) return
    setSending(true)
    const ok = await sendAttachment(pendingFile, pendingFile.name)
    setSending(false)
    if (!ok) alert('Não foi possível enviar o arquivo. Verifique as configurações de CORS do Chatwoot.')
    clearFile()
  }

  // ── Audio recording ──────────────────────────────────────────

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream)
      mediaRecorderRef.current = mr
      audioChunksRef.current = []
      mr.ondataavailable = e => { if (e.data.size > 0) audioChunksRef.current.push(e.data) }
      mr.onstop = () => {
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
        setAudioBlob(blob)
        setAudioUrl(URL.createObjectURL(blob))
        setRecState('preview')
      }
      mr.start()
      setRecState('recording')
      setRecSecs(0)
      recTimerRef.current = setInterval(() => setRecSecs(s => s + 1), 1000)
    } catch {
      alert('Não foi possível acessar o microfone. Verifique as permissões do navegador.')
    }
  }

  function stopRecording() {
    if (recTimerRef.current) clearInterval(recTimerRef.current)
    mediaRecorderRef.current?.stop()
  }

  async function sendAudio() {
    if (!audioBlob || !conversationId) return
    setSending(true)
    const ok = await sendAttachment(audioBlob, `audio_${Date.now()}.webm`, 'audio/webm')
    setSending(false)
    if (!ok) alert('Não foi possível enviar o áudio. Verifique as configurações de CORS do Chatwoot.')
    discardAudio()
  }

  function discardAudio() {
    if (recTimerRef.current) clearInterval(recTimerRef.current)
    mediaRecorderRef.current?.stop()
    if (audioUrl) URL.revokeObjectURL(audioUrl)
    setAudioBlob(null)
    setAudioUrl(null)
    setRecState('idle')
    setRecSecs(0)
  }

  // ── Emoji ────────────────────────────────────────────────────

  function insertEmoji(emoji: string) {
    const el = inputRef.current
    if (!el) { setInput(prev => prev + emoji); setShowEmoji(false); return }
    const start = el.selectionStart ?? input.length
    const end   = el.selectionEnd   ?? input.length
    setInput(input.slice(0, start) + emoji + input.slice(end))
    setShowEmoji(false)
    requestAnimationFrame(() => {
      el.selectionStart = el.selectionEnd = start + emoji.length
      el.focus()
    })
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSend() }
  }

  // ── Render ───────────────────────────────────────────────────

  const canSend = !loading && !fetchError

  return (
    <div className="fixed bottom-4 right-4 w-96 h-[620px] bg-white dark:bg-gray-950 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-800 flex flex-col z-50 overflow-hidden">

      {/* Hidden inputs */}
      <input ref={fileInputRef} type="file" accept="image/*,.pdf,.doc,.docx,.txt,.xls,.xlsx" className="hidden" onChange={handleFileSelect} />

      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-gray-900 shrink-0">
        <div className="w-9 h-9 rounded-full bg-green-600 flex items-center justify-center shrink-0">
          <MessageCircle size={18} className="text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white font-semibold text-sm truncate">{contact.nome ?? 'Sem nome'}</p>
          {contact.telefone && <p className="text-gray-400 text-xs truncate">{contact.telefone}</p>}
        </div>
        {whatsappWebUrl(contact.telefone) && (
          <a
            href={whatsappWebUrl(contact.telefone)!}
            target="_blank"
            rel="noreferrer"
            title="Abrir no WhatsApp Web"
            className="text-gray-400 hover:text-green-400 transition-colors shrink-0"
          >
            <ExternalLink size={15} />
          </a>
        )}
        <button type="button" onClick={onClose} title="Fechar" aria-label="Fechar chat" className="text-gray-400 hover:text-white transition-colors shrink-0">
          <X size={18} />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-2 py-3 space-y-1 bg-[#ece5dd] dark:bg-gray-950">
        {loading && (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-gray-500 text-sm">
            <Loader2 size={20} className="animate-spin" />
            {loadingLabel}
          </div>
        )}

        {!loading && fetchError && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-4">
            {fetchError === 'chatwoot_not_configured' ? (
              <>
                <div className="w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                  <MessageCircle size={22} className="text-gray-400" />
                </div>
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Chatwoot não configurado</p>
                <p className="text-xs text-gray-500 max-w-[200px]">Configure a integração em Configurações → Integrações para usar o chat interno.</p>
                {whatsappWebUrl(contact.telefone) && (
                  <a
                    href={whatsappWebUrl(contact.telefone)!}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 mt-1 px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm rounded-xl transition-colors"
                  >
                    <ExternalLink size={14} /> Abrir no WhatsApp Web
                  </a>
                )}
              </>
            ) : (
              <>
                <p className="text-sm text-red-500">{fetchError}</p>
                <button type="button" onClick={() => void init()} className="text-xs text-blue-500 hover:underline">
                  Tentar novamente
                </button>
              </>
            )}
          </div>
        )}

        {!loading && !fetchError && messages.length === 0 && (
          <div className="flex items-center justify-center h-full text-gray-500 text-sm">
            Nenhuma mensagem ainda. Diga olá! 👋
          </div>
        )}

        {!loading && !fetchError && messages.map(msg => <MessageBubble key={msg.id} message={msg} />)}
        <div ref={bottomRef} />
      </div>

      {/* File preview bar */}
      {pendingFile && (
        <div className="px-3 py-2 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 flex items-center gap-2 shrink-0">
          {pendingPreview
            ? <img src={pendingPreview} alt="" className="h-12 w-12 object-cover rounded-lg shrink-0" />
            : <div className="h-12 w-12 bg-gray-100 dark:bg-gray-800 rounded-lg flex items-center justify-center text-[10px] text-gray-500 text-center px-1 shrink-0">{pendingFile.name.split('.').pop()?.toUpperCase()}</div>
          }
          <span className="flex-1 text-xs text-gray-600 dark:text-gray-300 truncate min-w-0">{pendingFile.name}</span>
          <button type="button" onClick={() => void handleFileSend()} disabled={sending || !conversationId}
            className="flex items-center gap-1 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs rounded-lg disabled:opacity-50 shrink-0">
            {sending ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />} Enviar
          </button>
          <button type="button" onClick={clearFile} className="p-1 text-gray-400 hover:text-red-500 shrink-0">
            <Trash2 size={14} />
          </button>
        </div>
      )}

      {/* Audio preview bar */}
      {recState === 'preview' && audioUrl && (
        <div className="px-3 py-2 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 flex items-center gap-2 shrink-0">
          <audio src={audioUrl} controls className="h-8 flex-1 min-w-0" />
          <button type="button" onClick={() => void sendAudio()} disabled={sending || !conversationId}
            className="flex items-center gap-1 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs rounded-lg disabled:opacity-50 shrink-0">
            {sending ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />} Enviar
          </button>
          <button type="button" onClick={discardAudio} className="p-1 text-gray-400 hover:text-red-500 shrink-0">
            <Trash2 size={14} />
          </button>
        </div>
      )}

      {/* Emoji picker */}
      {showEmoji && (
        <div className="absolute bottom-[68px] right-4 w-72 bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 p-2.5 z-10">
          <div className="grid grid-cols-8 gap-0.5">
            {EMOJIS.map(e => (
              <button key={e} type="button" onClick={() => insertEmoji(e)}
                className="w-8 h-8 text-lg flex items-center justify-center rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                {e}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input area */}
      <div className="px-2 py-2 bg-[#f0f2f5] dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 shrink-0">

        {/* Recording indicator */}
        {recState === 'recording' && (
          <div className="flex items-center gap-2 mb-1.5 px-1">
            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse shrink-0" />
            <span className="text-sm text-red-500 font-medium">{fmtTime(recSecs)}</span>
            <span className="text-xs text-gray-500">Gravando…</span>
            <button type="button" onClick={stopRecording}
              className="ml-auto flex items-center gap-1 px-2 py-1 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30 text-red-600 dark:text-red-400 rounded-lg text-xs">
              <StopCircle size={12} /> Parar
            </button>
            <button type="button" onClick={discardAudio}
              className="p-1 text-gray-400 hover:text-red-500">
              <Trash2 size={14} />
            </button>
          </div>
        )}

        <div className="flex items-end gap-1.5 bg-white dark:bg-gray-800 rounded-2xl px-2 py-1.5 border border-gray-200 dark:border-gray-700">
          {/* Emoji button */}
          <button type="button" onClick={() => setShowEmoji(v => !v)} title="Emojis"
            className={cn(
              'w-8 h-8 flex items-center justify-center rounded-full transition-colors shrink-0 self-end mb-0.5',
              showEmoji ? 'text-yellow-500 bg-yellow-50 dark:bg-yellow-900/30' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300',
            )}>
            <Smile size={20} />
          </button>

          {/* File attachment button */}
          <button type="button" onClick={() => fileInputRef.current?.click()} title="Anexar arquivo"
            disabled={!!pendingFile || recState !== 'idle'}
            className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors shrink-0 self-end mb-0.5 disabled:opacity-40">
            <Paperclip size={20} />
          </button>

          {/* Text area */}
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Mensagem"
            rows={1}
            disabled={!canSend || recState !== 'idle'}
            className="flex-1 resize-none max-h-28 bg-transparent text-sm py-1.5 focus:outline-none dark:text-gray-100 placeholder-gray-400 overflow-y-auto disabled:opacity-50 leading-relaxed"
            onInput={e => {
              const el = e.currentTarget
              el.style.height = 'auto'
              el.style.height = `${Math.min(el.scrollHeight, 112)}px`
            }}
          />

          {/* Send / Mic button */}
          {input.trim() ? (
            <button type="button" onClick={() => void handleSend()}
              disabled={sending || !canSend}
              className="w-9 h-9 flex items-center justify-center bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white rounded-full transition-colors shrink-0 self-end">
              {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          ) : (
            <button type="button"
              onClick={recState === 'idle' ? () => void startRecording() : stopRecording}
              disabled={recState === 'preview' || !canSend}
              title={recState === 'idle' ? 'Gravar áudio' : 'Parar gravação'}
              className={cn(
                'w-9 h-9 flex items-center justify-center rounded-full transition-colors shrink-0 self-end disabled:opacity-40',
                recState === 'recording'
                  ? 'bg-red-500 hover:bg-red-600 text-white'
                  : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300',
              )}>
              {recState === 'recording' ? <StopCircle size={20} /> : <Mic size={20} />}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── MessageBubble ──────────────────────────────────────────────

function MessageBubble({ message }: { message: Message }) {
  const isOut = message.message_type === 1
  const time  = new Date(
    message.created_at > 1e10 ? message.created_at : message.created_at * 1000,
  ).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

  const attachments = message.attachments ?? []

  return (
    <div className={cn('flex px-2', isOut ? 'justify-end' : 'justify-start')}>
      <div className={cn(
        'max-w-[82%] rounded-2xl px-3 py-2 text-sm shadow-sm',
        isOut
          ? 'bg-[#d9fdd3] dark:bg-green-800 text-gray-900 dark:text-gray-100 rounded-br-none'
          : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-bl-none',
      )}>
        {!isOut && message.sender_name && (
          <p className="text-[10px] font-bold text-green-600 dark:text-green-400 mb-0.5">{message.sender_name}</p>
        )}

        {attachments.map((att, i) => {
          const isImage = att.file_type === 'image' || /\.(jpg|jpeg|png|gif|webp)/i.test(att.data_url ?? att.file_name ?? '')
          const isAudio = att.file_type === 'audio' || /\.(mp3|ogg|webm|wav|aac)/i.test(att.file_name ?? '')
          const src = att.data_url ?? att.download_url
          return isImage ? (
            <img key={i} src={src} alt={att.file_name ?? 'imagem'} className="max-w-full rounded-xl mb-1" />
          ) : isAudio && src ? (
            <audio key={i} src={src} controls className="w-full h-8 mb-1" />
          ) : (
            <a key={i} href={src} target="_blank" rel="noreferrer"
              className="flex items-center gap-1.5 text-blue-600 dark:text-blue-400 hover:underline text-xs mb-1">
              📎 {att.file_name ?? 'arquivo'}
            </a>
          )
        })}

        {message.content && (
          <p className="whitespace-pre-wrap break-words leading-relaxed">{message.content}</p>
        )}
        <p className={cn('text-[10px] mt-0.5 text-right leading-none', isOut ? 'text-green-700 dark:text-green-300' : 'text-gray-400')}>
          {time}
        </p>
      </div>
    </div>
  )
}
