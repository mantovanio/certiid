import {
  LayoutDashboard,
  ShoppingCart,
  MessageSquare,
  RefreshCw,
  DollarSign,
  BarChart2,
  Users,
  Settings,
  LogOut,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AgencyConfig } from '@/lib/agencyConfig'

export type Page =
  | 'dashboard'
  | 'comercial'
  | 'chat'
  | 'renovacoes'
  | 'financeiro'
  | 'relatorios'
  | 'parceiros'
  | 'configuracoes'

interface Props {
  activePage:   Page
  onNavigate:   (page: Page) => void
  allowedPages?: Page[]
  onLogout?:    () => void
  agencyConfig?: AgencyConfig
  mobileOpen?:  boolean
  onMobileClose?: () => void
}

const ALL_ITEMS: { id: Page; icon: React.ComponentType<{ size?: number; className?: string }>; label: string }[] = [
  { id: 'dashboard',     icon: LayoutDashboard, label: 'Dashboard'       },
  { id: 'comercial',     icon: ShoppingCart,    label: 'Comercial'       },
  { id: 'chat',          icon: MessageSquare,   label: 'Chat ao Vivo'    },
  { id: 'renovacoes',    icon: RefreshCw,       label: 'Renovações'      },
  { id: 'financeiro',    icon: DollarSign,      label: 'Financeiro'      },
  { id: 'relatorios',    icon: BarChart2,       label: 'Relatórios'      },
  { id: 'parceiros',     icon: Users,           label: 'Parceiros'       },
  { id: 'configuracoes', icon: Settings,        label: 'Configurações'   },
]

function SidebarContent({ items, activePage, onNavigate, onLogout, agencyConfig, onMobileClose }: {
  items: { id: Page; icon: React.ComponentType<{ size?: number; className?: string }>; label: string }[]
  activePage: Page
  onNavigate: (page: Page) => void
  onLogout?: () => void
  agencyConfig?: AgencyConfig
  onMobileClose?: () => void
}) {
  return (
    <>
      <div className="flex items-center justify-between px-3 mb-3">
        {agencyConfig?.logo_interna_url?.trim() ? (
          <div className="w-10 h-10 rounded-xl bg-white border border-gray-200 dark:border-gray-800 flex items-center justify-center p-1.5 overflow-hidden">
            <img src={agencyConfig.logo_interna_url} alt={agencyConfig.nome_agencia} className="w-full h-full object-contain" />
          </div>
        ) : (
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center text-white font-bold text-xs"
            style={{ backgroundColor: agencyConfig?.cor_primaria ?? '#2563eb' }}
          >
            ID
          </div>
        )}
        {onMobileClose && (
          <button type="button" onClick={onMobileClose}
            className="md:hidden w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
            <X size={16} />
          </button>
        )}
      </div>

      <nav className="flex flex-col gap-1 flex-1 px-2">
        {items.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            onClick={() => { onNavigate(id); onMobileClose?.() }}
            title={label}
            type="button"
            className={cn(
              'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors text-sm font-medium md:justify-center md:px-0 md:py-2.5',
              activePage === id
                ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400'
                : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-700 dark:hover:text-gray-300',
            )}
          >
            <Icon size={18} className="shrink-0 md:mx-auto" />
            <span className="md:hidden">{label}</span>
          </button>
        ))}
      </nav>

      <div className="px-2 pb-2">
        <button
          type="button"
          title="Sair"
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-gray-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-500 transition-colors text-sm md:justify-center md:px-0"
          onClick={onLogout}
        >
          <LogOut size={18} className="shrink-0 md:mx-auto" />
          <span className="md:hidden">Sair</span>
        </button>
      </div>
    </>
  )
}

export default function Sidebar({ activePage, onNavigate, allowedPages, onLogout, agencyConfig, mobileOpen, onMobileClose }: Props) {
  const items = allowedPages
    ? ALL_ITEMS.filter(i => allowedPages.includes(i.id))
    : ALL_ITEMS

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-16 flex-col py-4 border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shrink-0">
        <SidebarContent items={items} activePage={activePage} onNavigate={onNavigate} onLogout={onLogout} agencyConfig={agencyConfig} />
      </aside>

      {/* Mobile drawer overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={onMobileClose} />
          <aside className="absolute left-0 top-0 bottom-0 w-64 flex flex-col py-4 bg-white dark:bg-gray-900 shadow-2xl">
            <SidebarContent items={items} activePage={activePage} onNavigate={onNavigate} onLogout={onLogout} agencyConfig={agencyConfig} onMobileClose={onMobileClose} />
          </aside>
        </div>
      )}
    </>
  )
}
