import { useState, useEffect } from 'react'
import { AuthProvider, useAuth } from '@/contexts/AuthContext'
import Sidebar, { type Page } from './components/Sidebar'
import Login from './pages/Login'
import UpdatePassword from './pages/UpdatePassword'
import Dashboard from './pages/Dashboard'
import Comercial from './pages/Comercial'
import ChatAoVivo from './pages/ChatAoVivo'
import Renovacoes from './pages/Renovacoes'
import Financeiro from './pages/Financeiro'
import Relatorios from './pages/Relatorios'
import Parceiros from './pages/Parceiros'
import Configuracoes from './pages/Configuracoes'
import type { PerfilAcesso, PermissaoPagina } from './types'
import { APP_VERSION } from './lib/version'
import { DEFAULT_AGENCY_CONFIG, fetchAgencyConfig } from './lib/agencyConfig'
import ClaudeChat from './components/ClaudeChat'

const PAGE_LABELS: Record<Page, string> = {
  dashboard:     'Dashboard',
  comercial:     'Comercial',
  chat:          'Chat ao Vivo',
  renovacoes:    'Renovações',
  financeiro:    'Financeiro',
  relatorios:    'Relatórios',
  parceiros:     'Parceiros',
  configuracoes: 'Configurações',
}

const PAGE_ACCESS: Record<PerfilAcesso, PermissaoPagina[]> = {
  admin:           ['dashboard', 'comercial', 'chat', 'renovacoes', 'financeiro', 'relatorios', 'parceiros', 'configuracoes'],
  agente_registro: ['dashboard', 'comercial', 'chat', 'renovacoes'],
  vendedor:        ['dashboard', 'comercial', 'parceiros', 'relatorios'],
  usuario:         ['dashboard', 'relatorios'],
}

const PERFIL_LABEL: Record<PerfilAcesso, string> = {
  admin:           'Administrador',
  agente_registro: 'Agente de Registro',
  vendedor:        'Vendedor',
  usuario:         'Usuário',
}

function AppContent() {
  const { user, profile, loading, signOut, isPasswordRecovery } = useAuth()
  const [page, setPage] = useState<Page>('dashboard')
  const [dark, setDark] = useState(() => localStorage.getItem('theme') === 'dark')
  const [agencyConfig, setAgencyConfig] = useState(DEFAULT_AGENCY_CONFIG)
  const [claudeOpen, setClaudeOpen] = useState(false)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('theme', dark ? 'dark' : 'light')
  }, [dark])

  useEffect(() => {
    let active = true

    async function loadAgencyConfig() {
      const { data } = await fetchAgencyConfig()
      if (active) setAgencyConfig(data)
    }

    void loadAgencyConfig()
    return () => { active = false }
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-950 via-gray-900 to-blue-900 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-blue-600 flex items-center justify-center animate-pulse">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <p className="text-blue-300 text-sm">Carregando...</p>
        </div>
      </div>
    )
  }

  if (!user) return <Login />

  if (isPasswordRecovery) return <UpdatePassword />

  if (!profile) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-950 via-gray-900 to-blue-900 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl shadow-2xl shadow-black/40 p-8 text-center">
          <div className="w-14 h-14 rounded-2xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl" aria-hidden="true">!</span>
          </div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Perfil aguardando configuração</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
            Não encontramos um perfil de acesso liberado para sua conta. Contate o administrador.
          </p>
          <button
            type="button"
            onClick={handleLogout}
            className="mt-6 w-full px-4 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors"
          >
            Voltar ao login
          </button>
        </div>
      </div>
    )
  }

  if (profile?.status === 'inativo') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-950 via-gray-900 to-blue-900 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl shadow-2xl shadow-black/40 p-8 text-center">
          <div className="w-14 h-14 rounded-2xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl" aria-hidden="true">!</span>
          </div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Acesso aguardando liberação</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
            Sua conta foi criada, mas o primeiro acesso precisa ser liberado pelo administrador.
          </p>
          <button
            type="button"
            onClick={handleLogout}
            className="mt-6 w-full px-4 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors"
          >
            Voltar ao login
          </button>
        </div>
      </div>
    )
  }

  const customPermissions = profile.permissoes?.filter((p): p is Page => p in PAGE_LABELS) ?? []
  const allowedPages = profile.perfil === 'admin'
    ? PAGE_ACCESS.admin
    : customPermissions.length > 0
      ? customPermissions
      : PAGE_ACCESS[profile.perfil]

  // Se a página atual não estiver disponível para o perfil, volta ao dashboard
  const activePage: Page = allowedPages.includes(page) ? page : 'dashboard'

  function handleNavigate(p: Page) {
    if (allowedPages.includes(p)) setPage(p)
  }

  async function handleLogout() {
    await signOut()
  }

  const perfilLabel = profile ? PERFIL_LABEL[profile.perfil] : ''
  const nomeDisplay = profile?.nome ?? user.email ?? 'Usuário'

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      <Sidebar
        activePage={activePage}
        onNavigate={handleNavigate}
        allowedPages={allowedPages}
        onLogout={handleLogout}
        agencyConfig={agencyConfig}
      />
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-14 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex items-center justify-between px-6 shrink-0">
          <span className="font-semibold text-blue-600 dark:text-blue-400">
            {PAGE_LABELS[activePage]}
          </span>
          <div className="flex items-center gap-3">
            <div className="text-right hidden sm:block">
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300 leading-none">{nomeDisplay}</p>
              {perfilLabel && (
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{perfilLabel} — {agencyConfig.nome_agencia}</p>
              )}
            </div>
            <span className="hidden md:inline-flex items-center rounded-full bg-gray-100 dark:bg-gray-800 px-2 py-1 text-[11px] font-medium text-gray-500 dark:text-gray-400">
              v{APP_VERSION}
            </span>
            <button
              type="button"
              onClick={() => setClaudeOpen(o => !o)}
              title="Chat com Claude"
              className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                claudeOpen
                  ? 'bg-orange-100 dark:bg-orange-900/30'
                  : 'hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              <ClaudeBadge />
            </button>
            <button
              type="button"
              onClick={() => setDark(d => !d)}
              className="w-8 h-8 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              title={dark ? 'Modo claro' : 'Modo escuro'}
            >
              {dark ? '☀️' : '🌙'}
            </button>
          </div>
        </header>
        <main className="flex-1 overflow-auto">
          {activePage === 'dashboard'     && <Dashboard />}
          {activePage === 'comercial'     && <Comercial />}
          {activePage === 'chat'          && <ChatAoVivo />}
          {activePage === 'renovacoes'    && <Renovacoes />}
          {activePage === 'financeiro'    && <Financeiro />}
          {activePage === 'relatorios'    && <Relatorios />}
          {activePage === 'parceiros'     && <Parceiros />}
          {activePage === 'configuracoes' && <Configuracoes />}
        </main>
      </div>
      {claudeOpen && <ClaudeChat onClose={() => setClaudeOpen(false)} />}
    </div>
  )
}

function ClaudeBadge() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M9.74 4.5C8.97 4.5 8.32 4.98 8.07 5.67L4.55 15.5C4.22 16.4 4.88 17.35 5.83 17.35H7.05L8.26 13.97H12.5L11.89 12.25H8.85L10.32 8.05L13.56 17.35H15.28L11.57 6.2C11.32 5.47 10.65 4.97 9.87 4.97L9.74 4.5Z"
        fill="#CC785C"
      />
      <path
        d="M14.13 4.5L17.86 14.95C18.09 15.6 18.09 16.31 17.86 16.96L17.5 18C17.25 18.7 16.59 19.16 15.83 19.16H14.72L13.5 15.67H9.26L9.87 17.35H13L14.21 20.5H16.05C17.43 20.5 18.67 19.63 19.13 18.31L19.5 17.25C19.91 16.11 19.91 14.85 19.5 13.71L15.77 3.27C15.53 2.6 14.89 2.16 14.17 2.16H12.45L14.13 4.5Z"
        fill="#CC785C"
      />
    </svg>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  )
}
