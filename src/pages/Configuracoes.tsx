import { useState, useEffect, useCallback } from 'react'
import { Loader2, MapPin, Pencil, X, Check, KeyRound, UserPlus, Eye, EyeOff, MessageCircle, Mail, Webhook, Save, Send, Trash2, Plus, ToggleLeft, ToggleRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { supabase, SUPABASE_ANON_KEY } from '@/lib/supabase'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { DEFAULT_AGENCY_CONFIG, type AgencyConfig, fetchAgencyConfig } from '@/lib/agencyConfig'
import { useAuth } from '@/contexts/AuthContext'
import type {
  AutomationRule,
  CommunicationOutbox,
  ExternalIntegration,
  IntegrationProvider,
  IntegrationStatus,
  Parceiro,
  PerfilAcesso,
  PermissaoPagina,
  PontoAtendimento,
  NovoPontoAtendimento,
  Profile,
  TipoVinculoUsuario,
} from '@/types'

type Tab = 'geral' | 'integracoes' | 'automacoes' | 'usuarios' | 'pontos'

const TABS: { id: Tab; label: string }[] = [
  { id: 'geral',        label: 'Geral'                  },
  { id: 'integracoes',  label: 'Integrações'            },
  { id: 'automacoes',   label: 'Automações'             },
  { id: 'usuarios',     label: 'Usuários'               },
  { id: 'pontos',       label: 'Pontos de Atendimento'  },
]

const PERFIL_LABEL: Record<PerfilAcesso, string> = {
  admin:           'Administrador',
  agente_registro: 'Agente de Registro',
  vendedor:        'Vendedor / Parceiro',
  usuario:         'Usuário',
}

const PERFIL_COLOR: Record<PerfilAcesso, string> = {
  admin:           'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  agente_registro: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  vendedor:        'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  usuario:         'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
}

const TIPO_VINCULO_LABEL: Record<TipoVinculoUsuario, string> = {
  agente_registro: 'Agente de Registro',
  parceiro:        'Parceiro',
  vendedor:        'Vendedor',
  contador:        'Contador',
  usuario_comum:   'Usuário comum',
}

const PAGE_PERMISSIONS: { id: PermissaoPagina; label: string; description: string }[] = [
  { id: 'dashboard',     label: 'Dashboard',     description: 'Ver indicadores principais' },
  { id: 'comercial',     label: 'Comercial',     description: 'Clientes, vendas, agenda e certificados' },
  { id: 'chat',          label: 'Chat ao Vivo',  description: 'Atendimento e Kanban de conversas' },
  { id: 'renovacoes',    label: 'Renovações',    description: 'Base e campanhas de renovação' },
  { id: 'financeiro',    label: 'Financeiro',    description: 'Lançamentos, contas e pagamentos' },
  { id: 'relatorios',    label: 'Relatórios',    description: 'Análises e relatórios' },
  { id: 'parceiros',     label: 'Parceiros',     description: 'Cadastro e acompanhamento de parceiros' },
  { id: 'configuracoes', label: 'Configurações', description: 'Configurações, integrações e usuários' },
]

const DEFAULT_PERMISSIONS: Record<PerfilAcesso, PermissaoPagina[]> = {
  admin:           PAGE_PERMISSIONS.map(p => p.id),
  agente_registro: ['dashboard', 'comercial', 'chat', 'renovacoes'],
  vendedor:        ['dashboard', 'comercial', 'parceiros', 'relatorios'],
  usuario:         ['dashboard', 'relatorios'],
}

type UserEditForm = {
  nome: string
  email: string
  perfil: PerfilAcesso
  status: 'ativo' | 'inativo'
  tipo_vinculo: TipoVinculoUsuario
  parceiro_id: string
  vinculo_nome: string
  documento: string
  telefone: string
  cidade: string
  observacoes: string
  permissoes: PermissaoPagina[]
}

type ModalSenha = { userId: string; nome: string } | null
type ModalNovoUsuario = { aberto: boolean }

const PROVIDER_LABEL: Record<IntegrationProvider, string> = {
  chatwoot: 'Chatwoot / WhatsApp',
  email_smtp: 'Email SMTP',
  n8n: 'N8N Webhooks',
  gestao_ar: 'CertiID / Gestão AR',
  safe2pay: 'Safe2Pay',
  safeweb: 'Safeweb',
  supabase: 'Supabase',
}

const STATUS_LABEL: Record<IntegrationStatus, string> = {
  ativo: 'Conectado',
  pendente: 'Configurar',
  erro: 'Erro',
  inativo: 'Inativo',
}

const STATUS_CLASS: Record<IntegrationStatus, string> = {
  ativo: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  pendente: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  erro: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  inativo: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
}

function providerIcon(provider: IntegrationProvider) {
  if (provider === 'chatwoot') return MessageCircle
  if (provider === 'email_smtp') return Mail
  return Webhook
}

function automationChannelLabel(channel: AutomationRule['channel']) {
  const labels: Record<AutomationRule['channel'], string> = {
    whatsapp: 'WhatsApp',
    email: 'Email',
    whatsapp_email: 'WhatsApp + Email',
    webhook: 'Webhook',
  }
  return labels[channel]
}

function ModalOverlay({ titulo, onClose, children }: { titulo: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-sm flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800 shrink-0">
          <h3 className="font-semibold text-gray-900 dark:text-white text-sm">{titulo}</h3>
          <button type="button" onClick={onClose} title="Fechar" className="w-7 h-7 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center justify-center transition-colors">
            <X size={15} />
          </button>
        </div>
        <div className="p-6 overflow-y-auto">{children}</div>
      </div>
    </div>
  )
}

function CampoSenha({ label, value, onChange, autoFocus }: { label: string; value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  const [show, setShow] = useState(false)
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{label}</label>
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={e => onChange(e.target.value)}
          autoFocus={autoFocus}
          className="w-full border border-gray-300 dark:border-gray-700 rounded-xl px-3 py-2.5 pr-9 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Mínimo 6 caracteres"
        />
        <button type="button" onClick={() => setShow(s => !s)}
          title={show ? 'Ocultar senha' : 'Mostrar senha'}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
          {show ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      </div>
    </div>
  )
}

function AbaGeral() {
  const { profile } = useAuth()
  const isAdmin = profile?.perfil === 'admin'
  const [form, setForm] = useState<AgencyConfig>(DEFAULT_AGENCY_CONFIG)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setErro(null)
    const { data, error } = await fetchAgencyConfig()

    if (error) {
      setErro(`Erro ao carregar configurações: ${error.message}. Execute sql/settings_users_permissions_migration.sql no Supabase.`)
      setLoading(false)
      return
    }

    setForm(data)
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  function updateField<K extends keyof AgencyConfig>(key: K, value: AgencyConfig[K]) {
    setOk(false)
    setForm(prev => ({ ...prev, [key]: value }))
  }

  async function salvar() {
    if (!isAdmin) return
    setSaving(true)
    setErro(null)
    setOk(false)
    const { error } = await supabase
      .from('app_settings')
      .upsert({ key: 'agency', value: form, updated_by: profile?.id ?? null }, { onConflict: 'key' })
    setSaving(false)
    if (error) {
      setErro(`Erro ao salvar: ${error.message}`)
      return
    }
    setOk(true)
  }

  if (loading) {
    return <div className="flex items-center justify-center py-16"><Loader2 size={24} className="animate-spin text-gray-400" /></div>
  }

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <h2 className="font-semibold text-gray-800 dark:text-gray-200">Informações da Agência</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Esses dados são salvos no Supabase e podem ser usados como referência nas telas do sistema.
        </p>
      </div>
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 space-y-4">
        <ConfigInput label="Nome da Agência" value={form.nome_agencia} onChange={v => updateField('nome_agencia', v)} />
        <ConfigInput label="Responsável" value={form.responsavel} onChange={v => updateField('responsavel', v)} />
        <ConfigInput label="Telefone" value={form.telefone} onChange={v => updateField('telefone', v)} />
        <ConfigInput label="Cidade" value={form.cidade} onChange={v => updateField('cidade', v)} />
        <div className="pt-2 border-t border-gray-100 dark:border-gray-800">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Identidade visual do login</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Aqui você pode trocar separadamente a imagem do login e a imagem da parte interna do sistema.
          </p>
        </div>
        <ConfigInput
          label="URL da logomarca do login"
          value={form.logo_login_url}
          onChange={v => updateField('logo_login_url', v)}
          placeholder="https://seusite.com/logo-login.png"
        />
        <ConfigInput
          label="URL da logomarca interna"
          value={form.logo_interna_url}
          onChange={v => updateField('logo_interna_url', v)}
          placeholder="https://seusite.com/logo-interna.png"
        />
        <ConfigInput
          label="URL da logomarca antiga"
          value={form.logo_url}
          onChange={v => updateField('logo_url', v)}
          placeholder="https://seusite.com/logo.png"
        />
        <ConfigInput label="Título do login" value={form.login_titulo} onChange={v => updateField('login_titulo', v)} />
        <ConfigInput label="Subtítulo do login" value={form.login_subtitulo} onChange={v => updateField('login_subtitulo', v)} />
        <div className="grid gap-4 md:grid-cols-3">
          <ConfigInput label="Cor principal" value={form.cor_primaria} onChange={v => updateField('cor_primaria', v)} placeholder="#2563eb" />
          <ConfigInput label="Fundo inicial" value={form.fundo_inicio} onChange={v => updateField('fundo_inicio', v)} placeholder="#172554" />
          <ConfigInput label="Fundo final" value={form.fundo_fim} onChange={v => updateField('fundo_fim', v)} placeholder="#1e3a8a" />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div
            className="rounded-2xl p-5 text-white border border-white/10 shadow-inner"
            style={{ background: `linear-gradient(135deg, ${form.fundo_inicio}, ${form.fundo_fim})` }}
          >
            <p className="text-xs uppercase tracking-wide text-white/70 mb-3">Prévia do login</p>
            <div className="flex items-center gap-4">
              {form.logo_login_url.trim() ? (
                <img
                  src={form.logo_login_url}
                  alt={form.login_titulo}
                  className="w-14 h-14 rounded-2xl object-contain bg-white/10 p-2"
                />
              ) : (
                <div
                  className="w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg"
                  style={{ backgroundColor: form.cor_primaria }}
                >
                  <span className="text-lg font-bold">ID</span>
                </div>
              )}
              <div>
                <p className="text-lg font-semibold">{form.login_titulo}</p>
                <p className="text-sm text-white/80">{form.login_subtitulo}</p>
              </div>
            </div>
          </div>
          <div className="rounded-2xl p-5 border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950">
            <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-3">Prévia interna</p>
            <div className="flex items-center gap-4">
              {form.logo_interna_url.trim() ? (
                <img
                  src={form.logo_interna_url}
                  alt={form.nome_agencia}
                  className="w-14 h-14 rounded-2xl object-contain bg-gray-50 dark:bg-gray-900 p-2 border border-gray-200 dark:border-gray-800"
                />
              ) : (
                <div
                  className="w-14 h-14 rounded-2xl flex items-center justify-center text-white shadow-lg"
                  style={{ backgroundColor: form.cor_primaria }}
                >
                  <span className="text-lg font-bold">ID</span>
                </div>
              )}
              <div>
                <p className="text-lg font-semibold text-gray-900 dark:text-white">{form.nome_agencia}</p>
                <p className="text-sm text-gray-500 dark:text-gray-400">Barra lateral e topo do sistema</p>
              </div>
            </div>
          </div>
        </div>

        {erro && (
          <p className="text-xs text-red-600 dark:text-red-300 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
            {erro}
          </p>
        )}
        {ok && (
          <p className="text-xs text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg px-3 py-2">
            Configurações salvas.
          </p>
        )}

        <button type="button" onClick={salvar} disabled={!isAdmin || saving}
          className="mt-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors inline-flex items-center gap-2">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          {saving ? 'Salvando...' : 'Salvar Alterações'}
        </button>
      </div>
    </div>
  )
}

function AbaUsuarios() {
  const { profile: myProfile } = useAuth()
  const isAdmin = myProfile?.perfil === 'admin'

  const [users, setUsers]           = useState<Profile[]>([])
  const [parceiros, setParceiros]   = useState<Parceiro[]>([])
  const [loading, setLoading]       = useState(true)
  const [editingId, setEditingId]   = useState<string | null>(null)
  const [editForm, setEditForm]     = useState<UserEditForm | null>(null)
  const [saving, setSaving]         = useState(false)
  const [editErro, setEditErro]     = useState<string | null>(null)

  // Modal alterar senha
  const [modalSenha, setModalSenha]   = useState<ModalSenha>(null)
  const [novaSenha, setNovaSenha]     = useState('')
  const [confirmSenha, setConfirmSenha] = useState('')
  const [senhaErro, setSenhaErro]     = useState<string | null>(null)
  const [senhaOk, setSenhaOk]         = useState(false)
  const [salvandoSenha, setSalvandoSenha] = useState(false)

  // Modal novo usuário
  const [novoModal, setNovoModal]     = useState<ModalNovoUsuario>({ aberto: false })
  const [novoNome, setNovoNome]       = useState('')
  const [novoEmail, setNovoEmail]     = useState('')
  const [novoPerfil, setNovoPerfil]   = useState<PerfilAcesso>('usuario')
  const [novoSenhaU, setNovoSenhaU]   = useState('')
  const [criandoUser, setCriandoUser] = useState(false)
  const [criadoOk, setCriadoOk]       = useState(false)
  const [criadoErro, setCriadoErro]   = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data }, { data: parceirosData }] = await Promise.all([
      supabase.from('profiles').select('*').order('created_at', { ascending: true }),
      supabase.from('parceiros').select('*').order('nome', { ascending: true }),
    ])
    setUsers(data ?? [])
    setParceiros((parceirosData ?? []) as Parceiro[])
    setLoading(false)
  }, [])

  useEffect(() => {
    if (isAdmin) void load()
  }, [isAdmin, load])

  async function saveEdit(userId: string) {
    if (!editForm) return
    if (editForm.permissoes.length === 0) {
      setEditErro('Selecione pelo menos uma permissão.')
      return
    }
    setSaving(true)
    setEditErro(null)
    const payload = {
      nome: editForm.nome.trim(),
      email: editForm.email.trim(),
      perfil: editForm.perfil,
      status: editForm.status,
      tipo_vinculo: editForm.tipo_vinculo,
      parceiro_id: editForm.tipo_vinculo === 'parceiro' && editForm.parceiro_id ? editForm.parceiro_id : null,
      vinculo_nome: editForm.vinculo_nome.trim() || null,
      documento: editForm.documento.trim() || null,
      telefone: editForm.telefone.trim() || null,
      cidade: editForm.cidade.trim() || null,
      observacoes: editForm.observacoes.trim() || null,
      permissoes: editForm.perfil === 'admin' ? DEFAULT_PERMISSIONS.admin : editForm.permissoes,
    }
    const { error } = await supabase.from('profiles').update(payload).eq('id', userId)
    setSaving(false)
    if (error) {
      setEditErro(error.message)
      return
    }
    setEditingId(null)
    setEditForm(null)
    void load()
  }

  async function toggleStatus(u: Profile) {
    const novoStatus = u.status === 'ativo' ? 'inativo' : 'ativo'
    await supabase.from('profiles').update({ status: novoStatus }).eq('id', u.id)
    void load()
  }

  function startEdit(u: Profile) {
    setEditingId(u.id)
    setEditErro(null)
    setEditForm({
      nome: u.nome,
      email: u.email,
      perfil: u.perfil,
      status: u.status,
      tipo_vinculo: u.tipo_vinculo ?? 'usuario_comum',
      parceiro_id: u.parceiro_id ?? '',
      vinculo_nome: u.vinculo_nome ?? '',
      documento: u.documento ?? '',
      telefone: u.telefone ?? '',
      cidade: u.cidade ?? '',
      observacoes: u.observacoes ?? '',
      permissoes: u.permissoes && u.permissoes.length > 0 ? u.permissoes : DEFAULT_PERMISSIONS[u.perfil],
    })
  }

  function updateEdit<K extends keyof UserEditForm>(key: K, value: UserEditForm[K]) {
    setEditErro(null)
    setEditForm(prev => {
      if (!prev) return prev
      const next = { ...prev, [key]: value }
      if (key === 'perfil') {
        const perfil = value as PerfilAcesso
        next.permissoes = DEFAULT_PERMISSIONS[perfil]
      }
      if (key === 'tipo_vinculo' && value !== 'parceiro') {
        next.parceiro_id = ''
      }
      return next
    })
  }

  function togglePermissao(permission: PermissaoPagina) {
    setEditErro(null)
    setEditForm(prev => {
      if (!prev || prev.perfil === 'admin') return prev
      const has = prev.permissoes.includes(permission)
      const permissoes = has
        ? prev.permissoes.filter(p => p !== permission)
        : [...prev.permissoes, permission]
      return { ...prev, permissoes }
    })
  }

  function abrirModalSenha(u: Profile) {
    setModalSenha({ userId: u.id, nome: u.nome })
    setNovaSenha('')
    setConfirmSenha('')
    setSenhaErro(null)
    setSenhaOk(false)
  }

  function fecharModalSenha() {
    setModalSenha(null)
    setSenhaErro(null)
    setSenhaOk(false)
  }

  async function salvarSenha() {
    setSenhaErro(null)
    if (novaSenha.length < 6) { setSenhaErro('A senha deve ter pelo menos 6 caracteres.'); return }
    if (novaSenha !== confirmSenha) { setSenhaErro('As senhas não coincidem.'); return }
    setSalvandoSenha(true)
    const { error } = await supabaseAdmin.auth.admin.updateUserById(modalSenha!.userId, { password: novaSenha })
    setSalvandoSenha(false)
    if (error) { setSenhaErro(error.message); return }
    setSenhaOk(true)
  }

  function abrirNovoUsuario() {
    setNovoNome(''); setNovoEmail(''); setNovoPerfil('usuario'); setNovoSenhaU('')
    setCriadoOk(false); setCriadoErro(null)
    setNovoModal({ aberto: true })
  }

  async function criarUsuario(e: React.FormEvent) {
    e.preventDefault()
    setCriadoErro(null)
    if (novoSenhaU.length < 6) { setCriadoErro('Senha mínima de 6 caracteres.'); return }
    setCriandoUser(true)
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: novoEmail,
      password: novoSenhaU,
      email_confirm: true,
      user_metadata: { nome: novoNome, perfil: novoPerfil },
    })
    if (error) { setCriadoErro(error.message); setCriandoUser(false); return }
    // Garante perfil criado (trigger pode demorar)
    if (data.user) {
      await supabaseAdmin.from('profiles').upsert({
        id: data.user.id,
        nome: novoNome,
        email: novoEmail,
        perfil: novoPerfil,
        status: 'ativo',
        tipo_vinculo: novoPerfil === 'agente_registro' ? 'agente_registro' : novoPerfil === 'vendedor' ? 'vendedor' : 'usuario_comum',
        permissoes: DEFAULT_PERMISSIONS[novoPerfil],
      })
    }
    setCriandoUser(false)
    setCriadoOk(true)
    void load()
  }

  if (!isAdmin) {
    return (
      <div className="max-w-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 rounded-xl p-4 text-sm">
        O gerenciamento de usuários é exclusivo para administradores.
      </div>
    )
  }

  if (loading) {
    return <div className="flex items-center justify-center py-16"><Loader2 size={24} className="animate-spin text-gray-400" /></div>
  }

  return (
    <>
      {/* ── Modal Alterar Senha ── */}
      {modalSenha && (
        <ModalOverlay titulo={`Alterar senha — ${modalSenha.nome}`} onClose={fecharModalSenha}>
          {senhaOk ? (
            <div className="text-center space-y-3 py-2">
              <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto">
                <Check size={22} className="text-green-600 dark:text-green-400" />
              </div>
              <p className="font-semibold text-gray-900 dark:text-white">Senha alterada!</p>
              <button type="button" onClick={fecharModalSenha}
                className="text-sm text-blue-600 dark:text-blue-400 hover:underline">Fechar</button>
            </div>
          ) : (
            <div className="space-y-4">
              <CampoSenha label="Nova senha" value={novaSenha} onChange={setNovaSenha} autoFocus />
              <CampoSenha label="Confirmar senha" value={confirmSenha} onChange={setConfirmSenha} />
              {senhaErro && (
                <p className="text-xs text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
                  ⚠ {senhaErro}
                </p>
              )}
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={fecharModalSenha}
                  className="flex-1 px-4 py-2.5 text-sm rounded-xl border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                  Cancelar
                </button>
                <button type="button" onClick={salvarSenha} disabled={salvandoSenha}
                  className="flex-1 px-4 py-2.5 text-sm rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-medium transition-colors flex items-center justify-center gap-2">
                  {salvandoSenha ? <><Loader2 size={14} className="animate-spin" /> Salvando...</> : 'Salvar senha'}
                </button>
              </div>
            </div>
          )}
        </ModalOverlay>
      )}

      {/* ── Modal Novo Usuário ── */}
      {novoModal.aberto && (
        <ModalOverlay titulo="Criar novo usuário" onClose={() => setNovoModal({ aberto: false })}>
          {criadoOk ? (
            <div className="text-center space-y-3 py-2">
              <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto">
                <Check size={22} className="text-green-600 dark:text-green-400" />
              </div>
              <p className="font-semibold text-gray-900 dark:text-white">Usuário criado!</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">{novoEmail} já pode fazer login.</p>
              <button type="button" onClick={() => setNovoModal({ aberto: false })}
                className="text-sm text-blue-600 dark:text-blue-400 hover:underline">Fechar</button>
            </div>
          ) : (
            <form onSubmit={criarUsuario} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Nome completo</label>
                <input type="text" value={novoNome} onChange={e => setNovoNome(e.target.value)} required autoFocus
                  className="w-full border border-gray-300 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Email</label>
                <input type="email" value={novoEmail} onChange={e => setNovoEmail(e.target.value)} required
                  placeholder="usuario@email.com"
                  className="w-full border border-gray-300 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <CampoSenha label="Senha inicial" value={novoSenhaU} onChange={setNovoSenhaU} />
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Perfil de acesso</label>
                <select value={novoPerfil} onChange={e => setNovoPerfil(e.target.value as PerfilAcesso)}
                  title="Perfil de acesso" aria-label="Perfil de acesso"
                  className="w-full border border-gray-300 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="admin">Administrador</option>
                  <option value="agente_registro">Agente de Registro</option>
                  <option value="vendedor">Vendedor / Parceiro</option>
                  <option value="usuario">Usuário</option>
                </select>
              </div>
              {criadoErro && (
                <p className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
                  ⚠ {criadoErro}
                </p>
              )}
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => setNovoModal({ aberto: false })}
                  className="flex-1 px-4 py-2.5 text-sm rounded-xl border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                  Cancelar
                </button>
                <button type="submit" disabled={criandoUser}
                  className="flex-1 px-4 py-2.5 text-sm rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-medium transition-colors flex items-center justify-center gap-2">
                  {criandoUser ? <><Loader2 size={14} className="animate-spin" /> Criando...</> : 'Criar usuário'}
                </button>
              </div>
            </form>
          )}
        </ModalOverlay>
      )}

      {/* ── Lista de usuários ── */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-gray-800 dark:text-gray-200">Usuários do Sistema</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Novos cadastros entram como Usuário e aguardam liberação para o primeiro acesso.
            </p>
          </div>
          <button type="button" onClick={abrirNovoUsuario}
            className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg transition-colors">
            <UserPlus size={14} /> Novo usuário
          </button>
        </div>

        <div className="space-y-3">
          {users.map(u => (
            <div key={u.id} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className={cn(
                    'w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0',
                    u.perfil === 'admin' ? 'bg-purple-600' :
                    u.perfil === 'agente_registro' ? 'bg-green-600' :
                    u.perfil === 'vendedor' ? 'bg-blue-600' : 'bg-gray-500'
                  )}>
                    {u.nome.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-sm text-gray-900 dark:text-gray-100 truncate">{u.nome}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{u.email}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                  {editingId === u.id ? (
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={() => saveEdit(u.id)} disabled={saving || !editForm} title="Salvar"
                        className="w-8 h-8 rounded-lg bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 flex items-center justify-center hover:bg-green-200 transition-colors disabled:opacity-60">
                        {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                      </button>
                      <button type="button" onClick={() => { setEditingId(null); setEditForm(null); setEditErro(null) }} title="Cancelar"
                        className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-500 flex items-center justify-center hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <>
                      <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', PERFIL_COLOR[u.perfil])}>
                        {PERFIL_LABEL[u.perfil]}
                      </span>
                      <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium',
                        u.status === 'ativo'
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                          : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400')}>
                        {u.status === 'ativo' ? 'Ativo' : 'Aguardando liberação'}
                      </span>

                      {isAdmin && (
                        <div className="flex items-center gap-1">
                          <button type="button" onClick={() => startEdit(u)} title="Editar perfil"
                            className="w-7 h-7 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-600 dark:hover:text-gray-200 flex items-center justify-center transition-colors">
                            <Pencil size={13} />
                          </button>
                          <button type="button" onClick={() => abrirModalSenha(u)} title="Alterar senha"
                            className="w-7 h-7 rounded-lg text-gray-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:text-blue-600 dark:hover:text-blue-400 flex items-center justify-center transition-colors">
                            <KeyRound size={13} />
                          </button>
                          {u.id !== myProfile?.id && (
                            <button type="button" onClick={() => toggleStatus(u)}
                              className={cn('text-xs px-2 py-1 rounded-lg font-medium transition-colors',
                                u.status === 'ativo'
                                  ? 'text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20'
                                  : 'text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20')}
                              title={u.status === 'ativo' ? 'Desativar' : 'Liberar acesso'}>
                              {u.status === 'ativo' ? 'Desativar' : 'Liberar'}
                            </button>
                          )}
                        </div>
                      )}
                      {u.id === myProfile?.id && !isAdmin && (
                        <span className="text-xs text-gray-400 dark:text-gray-600 italic">você</span>
                      )}
                    </>
                  )}
                </div>
              </div>

              {editingId === u.id && editForm && (
                <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800 space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                    <ConfigInput label="Nome" value={editForm.nome} onChange={v => updateEdit('nome', v)} />
                    <ConfigInput label="Email" type="email" value={editForm.email} onChange={v => updateEdit('email', v)} />
                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-gray-500 dark:text-gray-400">Perfil de acesso</span>
                      <select value={editForm.perfil} onChange={e => updateEdit('perfil', e.target.value as PerfilAcesso)}
                        className="border border-gray-300 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500">
                        <option value="admin">Administrador</option>
                        <option value="agente_registro">Agente de Registro</option>
                        <option value="vendedor">Vendedor / Parceiro</option>
                        <option value="usuario">Usuário</option>
                      </select>
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-gray-500 dark:text-gray-400">Status</span>
                      <select value={editForm.status} onChange={e => updateEdit('status', e.target.value as 'ativo' | 'inativo')}
                        disabled={u.id === myProfile?.id}
                        className="border border-gray-300 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60">
                        <option value="ativo">Ativo</option>
                        <option value="inativo">Aguardando liberação</option>
                      </select>
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-gray-500 dark:text-gray-400">Vínculo do usuário</span>
                      <select value={editForm.tipo_vinculo} onChange={e => updateEdit('tipo_vinculo', e.target.value as TipoVinculoUsuario)}
                        className="border border-gray-300 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500">
                        {Object.entries(TIPO_VINCULO_LABEL).map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                    </label>
                    {editForm.tipo_vinculo === 'parceiro' ? (
                      <label className="flex flex-col gap-1">
                        <span className="text-xs text-gray-500 dark:text-gray-400">Parceiro vinculado</span>
                        <select value={editForm.parceiro_id} onChange={e => {
                          const parceiro = parceiros.find(p => p.id === e.target.value)
                          updateEdit('parceiro_id', e.target.value)
                          if (parceiro) updateEdit('vinculo_nome', parceiro.nome)
                        }}
                          className="border border-gray-300 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500">
                          <option value="">Selecione...</option>
                          {parceiros.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
                        </select>
                      </label>
                    ) : (
                      <ConfigInput label="Nome do vínculo" value={editForm.vinculo_nome} onChange={v => updateEdit('vinculo_nome', v)} placeholder="Nome do AR, vendedor ou contador" />
                    )}
                    <ConfigInput label="Documento" value={editForm.documento} onChange={v => updateEdit('documento', v)} placeholder="CPF, CNPJ ou código interno" />
                    <ConfigInput label="Telefone" value={editForm.telefone} onChange={v => updateEdit('telefone', v)} />
                    <ConfigInput label="Cidade" value={editForm.cidade} onChange={v => updateEdit('cidade', v)} />
                  </div>

                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-gray-500 dark:text-gray-400">Observações</span>
                    <textarea value={editForm.observacoes} onChange={e => updateEdit('observacoes', e.target.value)}
                      rows={3}
                      className="border border-gray-300 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                      placeholder="Anotações administrativas sobre este usuário" />
                  </label>

                  <div>
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <div>
                        <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">Permissões na plataforma</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">Marque o que este usuário pode acessar no menu lateral.</p>
                      </div>
                      {editForm.perfil !== 'admin' && (
                        <button type="button" onClick={() => updateEdit('permissoes', DEFAULT_PERMISSIONS[editForm.perfil])}
                          className="text-xs text-blue-600 dark:text-blue-400 hover:underline">
                          Usar padrão do perfil
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2">
                      {PAGE_PERMISSIONS.map(permission => (
                        <label key={permission.id}
                          className={cn('border rounded-xl p-3 flex items-start gap-2 text-sm transition-colors',
                            editForm.permissoes.includes(permission.id)
                              ? 'border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-900/20'
                              : 'border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900',
                            editForm.perfil === 'admin' && 'opacity-70')}>
                          <input type="checkbox"
                            checked={editForm.permissoes.includes(permission.id)}
                            disabled={editForm.perfil === 'admin'}
                            onChange={() => togglePermissao(permission.id)}
                            className="mt-0.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                          <span>
                            <span className="block text-xs font-medium text-gray-800 dark:text-gray-200">{permission.label}</span>
                            <span className="block text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{permission.description}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {editErro && (
                    <p className="text-xs text-red-600 dark:text-red-300 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
                      {editErro}
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}

          {users.length === 0 && (
            <div className="text-center py-10 text-gray-400 dark:text-gray-600">
              <p className="text-sm">Nenhum usuário cadastrado ainda.</p>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

const EDGE_FN = 'https://cvfrhfiaprdtwxxplngk.supabase.co/functions/v1/chatwoot-webhook'

async function testarChatwoot(baseUrl: string, token: string): Promise<{ ok: boolean; erro: string | null }> {
  try {
    const res = await fetch(EDGE_FN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ _action: 'test_connection', base_url: baseUrl, api_token: token }),
      signal: AbortSignal.timeout(12000),
    })
    const data = await res.json() as { ok: boolean; error?: string; name?: string }
    if (data.ok) return { ok: true, erro: null }
    return { ok: false, erro: data.error ?? 'Falha na conexão' }
  } catch {
    return { ok: false, erro: 'Sem conexão com o servidor' }
  }
}

function AbaIntegracoes() {
  const { profile } = useAuth()
  const isAdmin = profile?.perfil === 'admin'

  const [integracoes, setIntegracoes] = useState<ExternalIntegration[]>([])
  const [outbox, setOutbox] = useState<CommunicationOutbox[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [editing, setEditing] = useState<ExternalIntegration | null>(null)
  const [form, setForm] = useState<Partial<ExternalIntegration>>({})
  const [saving, setSaving] = useState(false)
  const [testando, setTestando] = useState<IntegrationProvider | null>(null)
  const [novaModal, setNovaModal] = useState(false)
  const [novaForm, setNovaForm] = useState<Partial<ExternalIntegration>>({ status: 'pendente' as IntegrationStatus })
  const [novaProvider, setNovaProvider] = useState<IntegrationProvider>('chatwoot')
  const [criando, setCriando] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<ExternalIntegration | null>(null)
  const [deletando, setDeletando] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setErro(null)
    const [integracoesRes, outboxRes] = await Promise.all([
      supabase.from('external_integrations').select('*').order('name', { ascending: true }),
      supabase.from('communication_outbox').select('*').order('created_at', { ascending: false }).limit(8),
    ])

    if (integracoesRes.error) {
      setErro(integracoesRes.error.message)
      setLoading(false)
      return
    }

    const lista = (integracoesRes.data ?? []) as ExternalIntegration[]
    setIntegracoes(lista)
    setOutbox((outboxRes.data ?? []) as CommunicationOutbox[])
    setLoading(false)

    // Verifica Chatwoot silenciosamente após carregar
    const chatwoot = lista.find(i => i.provider === 'chatwoot' && i.base_url && i.api_token)
    if (chatwoot) {
      const resultado = await testarChatwoot(chatwoot.base_url!, chatwoot.api_token!)
      const novoStatus: IntegrationStatus = resultado.ok ? 'ativo' : 'erro'
      if (novoStatus !== chatwoot.status) {
        await supabase.from('external_integrations').update({
          status: novoStatus,
          last_test_at: new Date().toISOString(),
          last_error: resultado.erro,
        }).eq('id', chatwoot.id)
        setIntegracoes(prev => prev.map(i =>
          i.id === chatwoot.id ? { ...i, status: novoStatus, last_error: resultado.erro } : i
        ))
      }
    }
  }, [])

  useEffect(() => { void load() }, [load])

  function startEdit(integracao: ExternalIntegration) {
    setEditing(integracao)
    setForm({ ...integracao })
  }

  function closeEdit() {
    setEditing(null)
    setForm({})
  }

  async function salvarIntegracao() {
    if (!editing) return
    setSaving(true)

    let statusFinal: IntegrationStatus = form.status ?? 'pendente'
    let lastError: string | null = editing.last_error ?? null
    let lastTestAt: string | null = editing.last_test_at ?? null

    if (editing.provider === 'chatwoot') {
      const baseUrl = form.base_url ?? ''
      const token = form.api_token ?? ''
      if (baseUrl && token) {
        const resultado = await testarChatwoot(baseUrl, token)
        statusFinal = resultado.ok ? 'ativo' : 'erro'
        lastError = resultado.erro
        lastTestAt = new Date().toISOString()
      } else {
        statusFinal = 'pendente'
        lastError = null
      }
    }

    const { error } = await supabase.from('external_integrations').update({
      name: form.name,
      description: form.description,
      status: statusFinal,
      base_url: form.base_url || null,
      webhook_url: form.webhook_url || null,
      api_token: form.api_token || null,
      account_id: form.account_id || null,
      inbox_id: form.inbox_id || null,
      sender_name: form.sender_name || null,
      sender_email: form.sender_email || null,
      host: form.host || null,
      port: form.port || null,
      username: form.username || null,
      last_test_at: lastTestAt,
      last_error: lastError,
    }).eq('id', editing.id)
    setSaving(false)

    if (error) {
      alert('Erro ao salvar: ' + error.message)
      return
    }

    closeEdit()
    void load()
  }

  async function registrarTeste(integracao: ExternalIntegration) {
    setTestando(integracao.provider)

    if (integracao.provider === 'chatwoot') {
      if (!integracao.base_url || !integracao.api_token || !integracao.account_id) {
        alert('Configure URL base, API Token e Account ID primeiro.')
        setTestando(null)
        return
      }
      try {
        const res = await fetch(EDGE_FN, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
          body: JSON.stringify({
            _action:    'sync_conversations',
            base_url:   integracao.base_url,
            api_token:  integracao.api_token,
            account_id: integracao.account_id,
          }),
        })
        const data = await res.json() as { ok: boolean; count?: number; error?: string }
        if (!data.ok) throw new Error(data.error ?? 'Erro desconhecido')
        alert(`${data.count ?? 0} conversa(s) sincronizada(s) com o Kanban!`)
      } catch (e) {
        alert('Erro ao sincronizar: ' + String(e))
      }
      setTestando(null)
      void load()
      return
    } else if (integracao.provider === 'email_smtp') {
      await supabase.from('communication_outbox').insert([{
        channel: 'email',
        provider: 'email_smtp',
        to_address: integracao.sender_email || integracao.username || 'teste@email.com',
        subject: 'Teste de email - AR CERTI ID',
        body: 'Mensagem de teste do CRM AR CERTI ID via SMTP.',
        payload: { integration_id: integracao.id, test: true },
      }])
    } else if (integracao.provider === 'n8n') {
      await supabase.from('communication_outbox').insert([{
        channel: 'webhook',
        provider: 'n8n',
        to_address: integracao.webhook_url || 'n8n',
        body: 'Teste de webhook N8N',
        payload: { integration_id: integracao.id, test: true },
      }])
    }

    await supabase.from('external_integrations').update({
      last_test_at: new Date().toISOString(),
      last_error: null,
    }).eq('id', integracao.id)

    setTestando(null)
    void load()
  }

  function providersDisponiveis(): IntegrationProvider[] {
    const usados = new Set(integracoes.map(i => i.provider))
    return (Object.keys(PROVIDER_LABEL) as IntegrationProvider[]).filter(p => !usados.has(p))
  }

  function abrirNovaIntegracao() {
    const disponiveis = providersDisponiveis()
    if (disponiveis.length === 0) return
    setNovaProvider(disponiveis[0])
    setNovaForm({ status: 'pendente' as IntegrationStatus })
    setNovaModal(true)
  }

  async function criarIntegracao() {
    setCriando(true)
    const { error } = await supabase.from('external_integrations').insert([{
      provider: novaProvider,
      name: PROVIDER_LABEL[novaProvider],
      description: novaForm.description ?? null,
      status: novaForm.status ?? 'pendente',
      base_url: novaForm.base_url || null,
      webhook_url: novaForm.webhook_url || null,
      api_token: novaForm.api_token || null,
      account_id: novaForm.account_id || null,
      inbox_id: novaForm.inbox_id || null,
      sender_name: novaForm.sender_name || null,
      sender_email: novaForm.sender_email || null,
      host: novaForm.host || null,
      port: novaForm.port || null,
      username: novaForm.username || null,
      metadata: {},
    }])
    setCriando(false)
    if (error) { alert('Erro ao criar: ' + error.message); return }
    setNovaModal(false)
    void load()
  }

  async function deletarIntegracao() {
    if (!confirmDelete) return
    setDeletando(true)
    const { error } = await supabase.from('external_integrations').delete().eq('id', confirmDelete.id)
    setDeletando(false)
    if (error) { alert('Erro ao remover: ' + error.message); setConfirmDelete(null); return }
    setConfirmDelete(null)
    void load()
  }

  if (loading) {
    return <div className="flex items-center justify-center py-16"><Loader2 size={24} className="animate-spin text-gray-400" /></div>
  }

  if (erro) {
    return (
      <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-lg p-4 text-sm">
        Erro ao carregar integrações: {erro}. Execute o SQL <strong>sql/integrations_schema.sql</strong> no Supabase.
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {editing && (
        <ModalOverlay titulo={`Configurar ${PROVIDER_LABEL[editing.provider]}`} onClose={closeEdit}>
          <div className="space-y-3">
            {editing.provider === 'chatwoot' ? (
              <p className="text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 rounded-lg px-3 py-2">
                Status detectado automaticamente ao salvar
              </p>
            ) : (
              <label className="flex flex-col gap-1">
                <span className="text-xs text-gray-500 dark:text-gray-400">Status</span>
                <select value={form.status ?? 'pendente'} onChange={e => setForm(p => ({ ...p, status: e.target.value as IntegrationStatus }))}
                  className="border border-gray-300 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="ativo">Conectado</option>
                  <option value="pendente">Configurar</option>
                  <option value="erro">Erro</option>
                  <option value="inativo">Inativo</option>
                </select>
              </label>
            )}

            <ConfigInput label="URL base / API" value={form.base_url ?? ''} onChange={base_url => setForm(p => ({ ...p, base_url }))} placeholder="https://chatwoot.seudominio.com" />
            <ConfigInput label="Webhook de entrada/saída" value={form.webhook_url ?? ''} onChange={webhook_url => setForm(p => ({ ...p, webhook_url }))} placeholder="https://..." />

            {editing.provider === 'chatwoot' && (
              <>
                <ConfigInput label="Account ID" value={form.account_id ?? ''} onChange={account_id => setForm(p => ({ ...p, account_id }))} />
                <ConfigInput label="Inbox ID WhatsApp" value={form.inbox_id ?? ''} onChange={inbox_id => setForm(p => ({ ...p, inbox_id }))} />
                <ConfigInput label="Access Token / API Token" type="password" value={form.api_token ?? ''} onChange={api_token => setForm(p => ({ ...p, api_token }))} />
              </>
            )}

            {editing.provider === 'email_smtp' && (
              <>
                <ConfigInput label="Servidor SMTP" value={form.host ?? ''} onChange={host => setForm(p => ({ ...p, host }))} placeholder="smtp.gmail.com" />
                <ConfigInput label="Porta" type="number" value={String(form.port ?? '')} onChange={port => setForm(p => ({ ...p, port: Number(port) || null }))} placeholder="587" />
                <ConfigInput label="Usuário SMTP" value={form.username ?? ''} onChange={username => setForm(p => ({ ...p, username }))} />
                <ConfigInput label="Senha / App Password" type="password" value={form.api_token ?? ''} onChange={api_token => setForm(p => ({ ...p, api_token }))} />
                <ConfigInput label="Nome do remetente" value={form.sender_name ?? ''} onChange={sender_name => setForm(p => ({ ...p, sender_name }))} />
                <ConfigInput label="Email do remetente" type="email" value={form.sender_email ?? ''} onChange={sender_email => setForm(p => ({ ...p, sender_email }))} />
              </>
            )}

            <div className="flex gap-2 pt-2">
              <button type="button" onClick={closeEdit}
                className="flex-1 px-4 py-2.5 text-sm rounded-xl border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800">
                Cancelar
              </button>
              <button type="button" onClick={salvarIntegracao} disabled={saving || !isAdmin}
                className="flex-1 px-4 py-2.5 text-sm rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-medium flex items-center justify-center gap-2">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Salvar
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}

      {confirmDelete && (
        <ModalOverlay titulo="Remover integração" onClose={() => setConfirmDelete(null)}>
          <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Deseja remover <strong className="text-gray-900 dark:text-white">{confirmDelete.name}</strong>?
              Todas as credenciais configuradas serão apagadas.
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setConfirmDelete(null)}
                className="flex-1 px-4 py-2.5 text-sm rounded-xl border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                Cancelar
              </button>
              <button type="button" onClick={deletarIntegracao} disabled={deletando}
                className="flex-1 px-4 py-2.5 text-sm rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-medium flex items-center justify-center gap-2 transition-colors">
                {deletando ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                Remover
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}

      {novaModal && (
        <ModalOverlay titulo="Nova Integração" onClose={() => setNovaModal(false)}>
          <div className="space-y-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-gray-500 dark:text-gray-400">Provedor</span>
              <select value={novaProvider} onChange={e => setNovaProvider(e.target.value as IntegrationProvider)}
                className="border border-gray-300 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500">
                {providersDisponiveis().map(p => (
                  <option key={p} value={p}>{PROVIDER_LABEL[p]}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-gray-500 dark:text-gray-400">Status</span>
              <select value={novaForm.status ?? 'pendente'} onChange={e => setNovaForm(f => ({ ...f, status: e.target.value as IntegrationStatus }))}
                className="border border-gray-300 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="ativo">Conectado</option>
                <option value="pendente">Configurar</option>
                <option value="inativo">Inativo</option>
              </select>
            </label>
            <ConfigInput label="URL base / API" value={novaForm.base_url ?? ''} onChange={v => setNovaForm(f => ({ ...f, base_url: v }))} placeholder="https://..." />
            <ConfigInput label="Webhook" value={novaForm.webhook_url ?? ''} onChange={v => setNovaForm(f => ({ ...f, webhook_url: v }))} placeholder="https://..." />
            {novaProvider === 'chatwoot' && (
              <>
                <ConfigInput label="Account ID" value={novaForm.account_id ?? ''} onChange={v => setNovaForm(f => ({ ...f, account_id: v }))} />
                <ConfigInput label="Inbox ID WhatsApp" value={novaForm.inbox_id ?? ''} onChange={v => setNovaForm(f => ({ ...f, inbox_id: v }))} />
                <ConfigInput label="API Token" type="password" value={novaForm.api_token ?? ''} onChange={v => setNovaForm(f => ({ ...f, api_token: v }))} />
              </>
            )}
            {novaProvider === 'email_smtp' && (
              <>
                <ConfigInput label="Servidor SMTP" value={novaForm.host ?? ''} onChange={v => setNovaForm(f => ({ ...f, host: v }))} placeholder="smtp.gmail.com" />
                <ConfigInput label="Porta" type="number" value={String(novaForm.port ?? '')} onChange={v => setNovaForm(f => ({ ...f, port: Number(v) || null }))} placeholder="587" />
                <ConfigInput label="Usuário SMTP" value={novaForm.username ?? ''} onChange={v => setNovaForm(f => ({ ...f, username: v }))} />
                <ConfigInput label="Senha / App Password" type="password" value={novaForm.api_token ?? ''} onChange={v => setNovaForm(f => ({ ...f, api_token: v }))} />
                <ConfigInput label="Nome remetente" value={novaForm.sender_name ?? ''} onChange={v => setNovaForm(f => ({ ...f, sender_name: v }))} />
                <ConfigInput label="Email remetente" type="email" value={novaForm.sender_email ?? ''} onChange={v => setNovaForm(f => ({ ...f, sender_email: v }))} />
              </>
            )}
            <div className="flex gap-2 pt-2">
              <button type="button" onClick={() => setNovaModal(false)}
                className="flex-1 px-4 py-2.5 text-sm rounded-xl border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                Cancelar
              </button>
              <button type="button" onClick={criarIntegracao} disabled={criando}
                className="flex-1 px-4 py-2.5 text-sm rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-medium flex items-center justify-center gap-2 transition-colors">
                {criando ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                Criar
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="font-semibold text-gray-800 dark:text-gray-200">Integrações Externas</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Configure Chatwoot para WhatsApp, SMTP para email e webhooks para automações.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {isAdmin && providersDisponiveis().length > 0 && (
            <button type="button" onClick={abrirNovaIntegracao}
              className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg transition-colors whitespace-nowrap">
              <Plus size={13} /> Nova integração
            </button>
          )}
          <div className="grid grid-cols-3 gap-2">
            <SummaryChip label="Conectados" value={integracoes.filter(i => i.status === 'ativo').length} tone="green" />
            <SummaryChip label="Pendentes" value={integracoes.filter(i => i.status === 'pendente').length} tone="yellow" />
            <SummaryChip label="Fila" value={outbox.length} tone="blue" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        {integracoes.map(int => {
          const Icon = providerIcon(int.provider)
          return (
            <div key={int.id} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <div className={cn(
                    'w-10 h-10 rounded-xl flex items-center justify-center shrink-0',
                    int.status === 'ativo'
                      ? 'bg-green-50 dark:bg-green-900/20'
                      : int.status === 'erro'
                        ? 'bg-red-50 dark:bg-red-900/20'
                        : 'bg-blue-50 dark:bg-blue-900/20'
                  )}>
                    <Icon size={17} className="text-blue-600 dark:text-blue-400" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-sm">{int.name}</p>
                      <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                        {PROVIDER_LABEL[int.provider]}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{int.description}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(int.base_url || int.webhook_url) && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-gray-50 dark:bg-gray-800 text-[11px] text-gray-600 dark:text-gray-300 break-all">
                          {int.base_url || int.webhook_url}
                        </span>
                      )}
                      {int.host && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-gray-50 dark:bg-gray-800 text-[11px] text-gray-600 dark:text-gray-300">
                          SMTP {int.host}{int.port ? `:${int.port}` : ''}
                        </span>
                      )}
                      {int.inbox_id && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-gray-50 dark:bg-gray-800 text-[11px] text-gray-600 dark:text-gray-300">
                          Inbox #{int.inbox_id}
                        </span>
                      )}
                    </div>
                    {int.last_test_at && (
                      <p className="text-xs text-gray-400 mt-2">Último teste: {new Date(int.last_test_at).toLocaleString('pt-BR')}</p>
                    )}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0">
                  <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', STATUS_CLASS[int.status])}>
                    {STATUS_LABEL[int.status]}
                  </span>
                  <div className="flex items-center gap-1">
                    {(['chatwoot', 'email_smtp', 'n8n'] as IntegrationProvider[]).includes(int.provider) && (
                      <button type="button" onClick={() => registrarTeste(int)} disabled={testando === int.provider}
                        title="Registrar teste na fila"
                        className="w-8 h-8 rounded-lg text-gray-400 hover:bg-green-50 dark:hover:bg-green-900/20 hover:text-green-600 dark:hover:text-green-400 flex items-center justify-center">
                        {testando === int.provider ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                      </button>
                    )}
                    <button type="button" onClick={() => startEdit(int)} title="Configurar"
                      className="w-8 h-8 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-600 dark:hover:text-gray-200 flex items-center justify-center">
                      <Pencil size={14} />
                    </button>
                    {isAdmin && (
                      <button type="button" onClick={() => setConfirmDelete(int)} title="Remover integração"
                        className="w-8 h-8 rounded-lg text-gray-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-500 dark:hover:text-red-400 flex items-center justify-center transition-colors">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Fila de Comunicação</h3>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-800/50 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide text-left">
              {['Canal', 'Destino', 'Status', 'Criado em'].map(h => <th key={h} className="px-5 py-3">{h}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {outbox.length === 0 ? (
              <tr><td colSpan={4} className="px-5 py-8 text-center text-gray-400">Nenhum envio registrado ainda.</td></tr>
            ) : outbox.map(item => (
              <tr key={item.id}>
                <td className="px-5 py-3">{item.channel}</td>
                <td className="px-5 py-3 text-gray-500">{item.to_address}</td>
                <td className="px-5 py-3">
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">{item.status}</span>
                </td>
                <td className="px-5 py-3 text-gray-400 text-xs">{new Date(item.created_at).toLocaleString('pt-BR')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function AbaAutomacoes() {
  const { profile } = useAuth()
  const isAdmin = profile?.perfil === 'admin'
  const [automacoes, setAutomacoes] = useState<AutomationRule[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [schemaPronto, setSchemaPronto] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setErro(null)
    const { data, error } = await supabase.from('automation_rules').select('*').order('created_at', { ascending: true })
    if (error) {
      const schemaMissing = error.code === '42P01' || /automation_rules/i.test(error.message)
      setSchemaPronto(!schemaMissing)
      setErro(error.message)
      setLoading(false)
      return
    }
    setSchemaPronto(true)
    setAutomacoes((data ?? []) as AutomationRule[])
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  async function toggleAutomacao(rule: AutomationRule) {
    setSavingId(rule.id)
    setAutomacoes(prev => prev.map(a => a.id === rule.id ? { ...a, ativo: !a.ativo } : a))
    const { error } = await supabase.from('automation_rules').update({ ativo: !rule.ativo }).eq('id', rule.id)
    setSavingId(null)
    if (error) {
      setAutomacoes(prev => prev.map(a => a.id === rule.id ? { ...a, ativo: rule.ativo } : a))
      alert('Erro ao atualizar automação: ' + error.message)
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-16"><Loader2 size={24} className="animate-spin text-gray-400" /></div>
  }

  if (erro) {
    return (
      <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-lg p-4 text-sm">
        Erro ao carregar automações: {erro}. Execute o SQL <strong>sql/integrations_schema.sql</strong> no Supabase.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-semibold text-gray-800 dark:text-gray-200">Regras de Automação</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Essas regras alimentam a fila de comunicação para WhatsApp, email e webhooks.
        </p>
      </div>
      {!schemaPronto && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 rounded-lg p-4 text-sm">
          O schema de automações ainda não foi aplicado no Supabase. Execute <strong>sql/integrations_schema.sql</strong> para liberar essa aba.
        </div>
      )}
      <div className="space-y-3">
        {automacoes.map(a => (
          <div key={a.id} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 flex items-center justify-between gap-4">
            <div>
              <p className="font-medium text-sm">{a.label}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Canal: {automationChannelLabel(a.channel)} · Gatilho: {a.trigger_key}
              </p>
            </div>
            <button
              type="button"
              disabled={!isAdmin || !schemaPronto || savingId === a.id}
              onClick={() => toggleAutomacao(a)}
              className={cn('relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 disabled:opacity-50',
                a.ativo ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-700')}
            >
              <span className={cn('pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200',
                a.ativo ? 'translate-x-5' : 'translate-x-0')} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

function ConfigInput({ label, value, onChange, placeholder, type = 'text' }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="border border-gray-300 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </label>
  )
}

function SummaryChip({ label, value, tone }: { label: string; value: number; tone: 'green' | 'yellow' | 'blue' }) {
  const toneClass: Record<'green' | 'yellow' | 'blue', string> = {
    green: 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400',
    yellow: 'bg-yellow-50 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400',
    blue: 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400',
  }
  return (
    <div className={cn('rounded-xl px-3 py-2 border border-gray-200 dark:border-gray-800', toneClass[tone])}>
      <p className="text-[10px] uppercase tracking-wide opacity-80">{label}</p>
      <p className="text-sm font-semibold leading-none mt-1">{value}</p>
    </div>
  )
}

// ── Aba Pontos de Atendimento ─────────────────────────────────

const EMPTY_PONTO: NovoPontoAtendimento = {
  codigo: null, nome: '', endereco: null,
  cidade: null, uf: null, status: 'ativo', metadata: {},
}

function AbaPontos() {
  const { profile } = useAuth()
  const isAdmin = profile?.perfil === 'admin'
  const [pontos, setPontos]     = useState<PontoAtendimento[]>([])
  const [loading, setLoading]   = useState(true)
  const [erro, setErro]         = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm]         = useState<NovoPontoAtendimento>(EMPTY_PONTO)
  const [saving, setSaving]     = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setErro(null)
    const { data, error } = await supabase
      .from('pontos_atendimento').select('*').order('nome', { ascending: true })
    if (error) { setErro(error.message); setLoading(false); return }
    setPontos((data ?? []) as PontoAtendimento[])
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  function abrirNovo() {
    setEditingId(null)
    setForm({ ...EMPTY_PONTO })
    setShowForm(true)
  }

  function abrirEditar(p: PontoAtendimento) {
    setEditingId(p.id)
    setForm({ codigo: p.codigo, nome: p.nome, endereco: p.endereco, cidade: p.cidade, uf: p.uf, status: p.status, metadata: p.metadata })
    setShowForm(true)
  }

  async function salvar() {
    if (!form.nome.trim()) return
    setSaving(true)
    const payload = { ...form, nome: form.nome.trim(), codigo: form.codigo?.trim() || null, endereco: form.endereco?.trim() || null, cidade: form.cidade?.trim() || null, uf: form.uf?.trim() || null }
    const { error } = editingId
      ? await supabase.from('pontos_atendimento').update(payload).eq('id', editingId)
      : await supabase.from('pontos_atendimento').insert([payload])
    setSaving(false)
    if (error) { alert('Erro: ' + error.message); return }
    setShowForm(false)
    setEditingId(null)
    setForm({ ...EMPTY_PONTO })
    void load()
  }

  async function toggleStatus(p: PontoAtendimento) {
    setTogglingId(p.id)
    const novoStatus = p.status === 'ativo' ? 'inativo' : 'ativo'
    setPontos(prev => prev.map(x => x.id === p.id ? { ...x, status: novoStatus } : x))
    const { error } = await supabase.from('pontos_atendimento').update({ status: novoStatus }).eq('id', p.id)
    setTogglingId(null)
    if (error) {
      setPontos(prev => prev.map(x => x.id === p.id ? { ...x, status: p.status } : x))
      alert('Erro: ' + error.message)
    }
  }

  if (loading) return <div className="flex items-center justify-center py-16"><Loader2 size={24} className="animate-spin text-gray-400" /></div>

  if (erro) return (
    <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-lg p-4 text-sm">
      Erro ao carregar pontos de atendimento: {erro}. Verifique se a migration V2 foi aplicada.
    </div>
  )

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-gray-800 dark:text-gray-200">Pontos de Atendimento</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Locais de emissão de certificados. Obrigatório para lançar vendas.</p>
        </div>
        {isAdmin && (
          <button type="button" onClick={abrirNovo}
            className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 transition-colors">
            <Plus size={13} /> Novo Ponto
          </button>
        )}
      </div>

      {showForm && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              {editingId ? 'Editar Ponto' : 'Novo Ponto de Atendimento'}
            </h3>
            <button type="button" title="Fechar" onClick={() => setShowForm(false)}><X size={16} className="text-gray-400" /></button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="flex flex-col gap-1">
              <span className="text-xs text-gray-500">Código</span>
              <input type="text" value={form.codigo ?? ''} onChange={e => setForm(p => ({ ...p, codigo: e.target.value || null }))}
                placeholder="ex: PA-001"
                className="border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="flex flex-col gap-1 md:col-span-2">
              <span className="text-xs text-gray-500">Nome *</span>
              <input type="text" value={form.nome} onChange={e => setForm(p => ({ ...p, nome: e.target.value }))}
                placeholder="ex: Balcão Principal"
                className="border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="flex flex-col gap-1 md:col-span-3">
              <span className="text-xs text-gray-500">Endereço</span>
              <input type="text" title="Endereço" placeholder="Rua, número, bairro" value={form.endereco ?? ''} onChange={e => setForm(p => ({ ...p, endereco: e.target.value || null }))}
                className="border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-gray-500">Cidade</span>
              <input type="text" title="Cidade" placeholder="ex: São Paulo" value={form.cidade ?? ''} onChange={e => setForm(p => ({ ...p, cidade: e.target.value || null }))}
                className="border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-gray-500">UF</span>
              <input type="text" maxLength={2} value={form.uf ?? ''} onChange={e => setForm(p => ({ ...p, uf: e.target.value.toUpperCase() || null }))}
                placeholder="SP"
                className="border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-gray-500">Status</span>
              <select title="Status do ponto de atendimento" value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value as 'ativo' | 'inativo' }))}
                className="border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="ativo">Ativo</option>
                <option value="inativo">Inativo</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button type="button" onClick={() => void salvar()} disabled={saving || !form.nome.trim()}
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              {saving ? 'Salvando…' : 'Salvar'}
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg">Cancelar</button>
          </div>
        </div>
      )}

      {pontos.length === 0 && !showForm ? (
        <div className="flex flex-col items-center justify-center py-12 text-gray-400 bg-white dark:bg-gray-900 rounded-xl border border-dashed border-gray-300 dark:border-gray-700">
          <MapPin size={32} className="mb-2 opacity-40" />
          <p className="font-medium text-sm">Nenhum ponto cadastrado</p>
          <p className="text-xs mt-1">Crie ao menos um para poder lançar vendas.</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-800/50 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide text-left">
                {['Código', 'Nome', 'Localização', 'Status', 'Ações'].map(h => (
                  <th key={h} className="px-4 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {pontos.map(p => (
                <tr key={p.id} className={cn('hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors', p.status === 'inativo' && 'opacity-50')}>
                  <td className="px-4 py-3 text-gray-400 font-mono text-xs">{p.codigo ?? '—'}</td>
                  <td className="px-4 py-3 font-medium flex items-center gap-2">
                    <MapPin size={13} className="text-blue-400 shrink-0" />
                    {p.nome}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {[p.cidade, p.uf].filter(Boolean).join(' — ') || (p.endereco ?? '—')}
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium',
                      p.status === 'ativo'
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                        : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400')}>
                      {p.status === 'ativo' ? 'Ativo' : 'Inativo'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      {isAdmin && (
                        <>
                          <button type="button" title="Editar" onClick={() => abrirEditar(p)}
                            className="w-8 h-8 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-700 dark:hover:text-gray-200 flex items-center justify-center transition-colors">
                            <Pencil size={14} />
                          </button>
                          <button type="button" title={p.status === 'ativo' ? 'Desativar' : 'Ativar'} onClick={() => void toggleStatus(p)} disabled={togglingId === p.id}
                            className={cn('w-8 h-8 rounded-lg flex items-center justify-center transition-colors',
                              p.status === 'ativo' ? 'text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20' : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800')}>
                            {togglingId === p.id ? <Loader2 size={16} className="animate-spin" /> : p.status === 'ativo' ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default function Configuracoes() {
  const [tab, setTab] = useState<Tab>('geral')

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1 px-6 py-2 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-x-auto shrink-0">
        {TABS.map(t => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)}
            className={cn('px-3 py-2 text-xs font-medium rounded-md whitespace-nowrap transition-colors',
              tab === t.id
                ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800')}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-6">

        {/* GERAL */}
        {tab === 'geral' && (
          <AbaGeral />
        )}

        {/* INTEGRAÇÕES */}
        {tab === 'integracoes' && <AbaIntegracoes />}

        {/* AUTOMAÇÕES */}
        {tab === 'automacoes' && <AbaAutomacoes />}

        {/* USUÁRIOS */}
        {tab === 'usuarios' && <AbaUsuarios />}

        {/* PONTOS DE ATENDIMENTO */}
        {tab === 'pontos' && <AbaPontos />}

      </div>
    </div>
  )
}
