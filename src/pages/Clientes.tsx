import { useState, useEffect, useCallback } from 'react'
import { Search, X, ChevronDown, ChevronUp, Loader2, RefreshCcw } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

type TipoCliente = 'pessoa_fisica' | 'pessoa_juridica'

interface Cliente {
  id: string
  tipo_cliente: TipoCliente
  cpf_cnpj: string
  nome: string
  nome_fantasia: string | null
  email: string | null
  telefone: string | null
  cidade: string | null
  uf: string | null
  status: 'ativo' | 'inativo'
  created_at: string
}

interface VendaResumida {
  id: string
  protocolo_numero: string | null
  tipo_produto: string
  valor_venda: number | null
  status_venda: string
  data_inicio_validade: string | null
  data_vencimento: string | null
  validado_safeweb: boolean | null
  created_at: string
}

interface ClienteComVendas extends Cliente {
  total_vendas: number
  valor_total: number
  ultimo_produto: string | null
  ultima_compra: string | null
}

const PAGE_SIZE = 50

function formatDoc(v: string) {
  if (v.length === 11) return v.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
  if (v.length === 14) return v.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
  return v
}

function formatCurrency(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatDate(v: string | null) {
  if (!v) return '—'
  const d = new Date(v)
  if (isNaN(d.getTime())) return v
  return d.toLocaleDateString('pt-BR')
}

export default function Clientes() {
  const [clientes, setClientes] = useState<ClienteComVendas[]>([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [filterTipo, setFilterTipo] = useState<'' | TipoCliente>('')
  const [filterStatus, setFilterStatus] = useState<'' | 'ativo' | 'inativo'>('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [vendas, setVendas] = useState<Record<string, VendaResumida[]>>({})
  const [loadingVendas, setLoadingVendas] = useState<string | null>(null)

  const fetchClientes = useCallback(async () => {
    setLoading(true)
    try {
      let q = supabase
        .from('cadastros_base')
        .select('id, tipo_cliente, cpf_cnpj, nome, nome_fantasia, email, telefone, cidade, uf, status, created_at', { count: 'exact' })
        .order('nome')
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)

      if (search) q = q.or(`nome.ilike.%${search}%,cpf_cnpj.ilike.%${search}%,nome_fantasia.ilike.%${search}%`)
      if (filterTipo)   q = q.eq('tipo_cliente', filterTipo)
      if (filterStatus) q = q.eq('status', filterStatus)

      const { data, count, error } = await q
      if (error) { console.error(error); return }

      const ids = (data ?? []).map(c => c.id as string)
      setTotal(count ?? 0)

      // busca resumo de vendas por cliente em lote
      if (ids.length === 0) { setClientes([]); return }
      const { data: vendasData } = await supabase
        .from('vendas_certificados')
        .select('cadastro_base_id, tipo_produto, valor_venda, created_at')
        .in('cadastro_base_id', ids)
        .neq('status_venda', 'cancelado')

      const vendasPorCliente = new Map<string, { count: number; valor: number; ultimo_produto: string | null; ultima: string | null }>()
      for (const v of vendasData ?? []) {
        const cid = v.cadastro_base_id as string
        const cur = vendasPorCliente.get(cid) ?? { count: 0, valor: 0, ultimo_produto: null, ultima: null }
        cur.count++
        cur.valor += (v.valor_venda as number) ?? 0
        if (!cur.ultima || (v.created_at as string) > cur.ultima) {
          cur.ultima = v.created_at as string
          cur.ultimo_produto = v.tipo_produto as string
        }
        vendasPorCliente.set(cid, cur)
      }

      setClientes((data ?? []).map(c => {
        const res = vendasPorCliente.get(c.id as string)
        return {
          ...(c as Cliente),
          total_vendas:  res?.count ?? 0,
          valor_total:   res?.valor ?? 0,
          ultimo_produto: res?.ultimo_produto ?? null,
          ultima_compra:  res?.ultima ?? null,
        }
      }))
    } finally {
      setLoading(false)
    }
  }, [page, search, filterTipo, filterStatus])

  useEffect(() => { void fetchClientes() }, [fetchClientes])

  async function toggleExpand(id: string) {
    if (expandedId === id) { setExpandedId(null); return }
    setExpandedId(id)
    if (vendas[id]) return
    setLoadingVendas(id)
    const { data } = await supabase
      .from('vendas_certificados')
      .select('id, protocolo_numero, tipo_produto, valor_venda, status_venda, data_inicio_validade, data_vencimento, validado_safeweb, created_at')
      .eq('cadastro_base_id', id)
      .order('created_at', { ascending: false })
      .limit(20)
    setVendas(prev => ({ ...prev, [id]: (data ?? []) as VendaResumida[] }))
    setLoadingVendas(null)
  }

  function applySearch() {
    setPage(0)
    setSearch(searchInput)
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="flex flex-col h-full">
      {/* toolbar */}
      <div className="px-6 py-3 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex flex-wrap items-center gap-3 shrink-0">
        <div className="flex items-center gap-2 flex-1 min-w-0 max-w-sm">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && applySearch()}
              placeholder="Nome, CPF/CNPJ..."
              className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button type="button" onClick={applySearch}
            className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition-colors">
            Buscar
          </button>
          {search && (
            <button type="button" onClick={() => { setSearch(''); setSearchInput(''); setPage(0) }}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
              <X size={14} />
            </button>
          )}
        </div>

        <select value={filterTipo} onChange={e => { setFilterTipo(e.target.value as '' | TipoCliente); setPage(0) }}
          className="text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">Todos os tipos</option>
          <option value="pessoa_fisica">Pessoa Física</option>
          <option value="pessoa_juridica">Pessoa Jurídica</option>
        </select>

        <select value={filterStatus} onChange={e => { setFilterStatus(e.target.value as '' | 'ativo' | 'inativo'); setPage(0) }}
          className="text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">Todos os status</option>
          <option value="ativo">Ativo</option>
          <option value="inativo">Inativo</option>
        </select>

        <button type="button" onClick={() => void fetchClientes()} title="Atualizar"
          className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
          <RefreshCcw size={14} />
        </button>

        <span className="text-xs text-gray-400 ml-auto">{total.toLocaleString('pt-BR')} clientes</span>
      </div>

      {/* table */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-gray-400">
            <Loader2 size={20} className="animate-spin mr-2" /> Carregando...
          </div>
        ) : clientes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400">
            <p className="font-medium">Nenhum cliente encontrado.</p>
            {search && <p className="text-sm mt-1">Tente uma busca diferente.</p>}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="bg-gray-50 dark:bg-gray-800/80 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide text-left">
                <th className="px-4 py-3 font-medium"></th>
                <th className="px-4 py-3 font-medium">Nome</th>
                <th className="px-4 py-3 font-medium">CPF / CNPJ</th>
                <th className="px-4 py-3 font-medium hidden md:table-cell">Cidade/UF</th>
                <th className="px-4 py-3 font-medium hidden lg:table-cell">Contato</th>
                <th className="px-4 py-3 font-medium text-center">Vendas</th>
                <th className="px-4 py-3 font-medium hidden md:table-cell">Último produto</th>
                <th className="px-4 py-3 font-medium text-right hidden lg:table-cell">Valor total</th>
                <th className="px-4 py-3 font-medium text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {clientes.map(c => (
                <>
                  <tr key={c.id}
                    onClick={() => void toggleExpand(c.id)}
                    className={cn('hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer transition-colors',
                      expandedId === c.id && 'bg-blue-50/50 dark:bg-blue-900/10')}>
                    <td className="px-4 py-3 text-gray-400">
                      {expandedId === c.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-800 dark:text-gray-100 truncate max-w-[200px]">{c.nome}</p>
                      {c.nome_fantasia && c.nome_fantasia !== c.nome && (
                        <p className="text-xs text-gray-400 truncate max-w-[200px]">{c.nome_fantasia}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-600 dark:text-gray-300">
                      {formatDoc(c.cpf_cnpj)}
                      <span className="ml-1.5 text-[10px] font-sans text-gray-400">
                        {c.tipo_cliente === 'pessoa_fisica' ? 'PF' : 'PJ'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 hidden md:table-cell">
                      {c.cidade ? `${c.cidade}${c.uf ? ` / ${c.uf}` : ''}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-500 hidden lg:table-cell">
                      <p className="truncate max-w-[160px]">{c.email ?? '—'}</p>
                      {c.telefone && <p className="text-xs text-gray-400">{c.telefone}</p>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={cn('text-sm font-semibold', c.total_vendas > 0 ? 'text-blue-600 dark:text-blue-400' : 'text-gray-300')}>
                        {c.total_vendas}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 hidden md:table-cell">
                      <p className="truncate max-w-[140px]">{c.ultimo_produto ?? '—'}</p>
                      {c.ultima_compra && <p className="text-xs text-gray-400">{formatDate(c.ultima_compra)}</p>}
                    </td>
                    <td className="px-4 py-3 text-right hidden lg:table-cell">
                      {c.valor_total > 0
                        ? <span className="text-green-600 dark:text-green-400 font-medium">{formatCurrency(c.valor_total)}</span>
                        : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full',
                        c.status === 'ativo'
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                          : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400')}>
                        {c.status === 'ativo' ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                  </tr>

                  {/* expanded: histórico de vendas */}
                  {expandedId === c.id && (
                    <tr key={`${c.id}-detail`} className="bg-blue-50/30 dark:bg-blue-900/5">
                      <td colSpan={9} className="px-6 pb-4 pt-2">
                        {loadingVendas === c.id ? (
                          <div className="flex items-center gap-2 text-xs text-gray-400 py-2">
                            <Loader2 size={12} className="animate-spin" /> Carregando histórico...
                          </div>
                        ) : (vendas[c.id] ?? []).length === 0 ? (
                          <p className="text-xs text-gray-400 py-2">Nenhuma venda registrada para este cliente.</p>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-gray-400 uppercase tracking-wide">
                                  <th className="py-1.5 pr-4 text-left font-medium">Protocolo</th>
                                  <th className="py-1.5 pr-4 text-left font-medium">Produto</th>
                                  <th className="py-1.5 pr-4 text-left font-medium">Valor</th>
                                  <th className="py-1.5 pr-4 text-left font-medium">Emissão</th>
                                  <th className="py-1.5 pr-4 text-left font-medium">Vencimento</th>
                                  <th className="py-1.5 pr-4 text-left font-medium">Status</th>
                                  <th className="py-1.5 text-left font-medium">Safeweb</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-blue-100 dark:divide-blue-900/20">
                                {(vendas[c.id] ?? []).map(v => (
                                  <tr key={v.id} className="text-gray-600 dark:text-gray-300">
                                    <td className="py-1.5 pr-4 font-mono">{v.protocolo_numero ?? '—'}</td>
                                    <td className="py-1.5 pr-4">{v.tipo_produto}</td>
                                    <td className="py-1.5 pr-4 font-medium text-green-600 dark:text-green-400">
                                      {v.valor_venda ? formatCurrency(v.valor_venda) : '—'}
                                    </td>
                                    <td className="py-1.5 pr-4">{formatDate(v.data_inicio_validade ?? v.created_at)}</td>
                                    <td className="py-1.5 pr-4">{formatDate(v.data_vencimento)}</td>
                                    <td className="py-1.5 pr-4">
                                      <span className={cn('px-1.5 py-0.5 rounded font-medium',
                                        v.status_venda === 'emitido' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                        : v.status_venda === 'cancelado' ? 'bg-red-100 text-red-600'
                                        : 'bg-gray-100 text-gray-500 dark:bg-gray-800')}>
                                        {v.status_venda}
                                      </span>
                                    </td>
                                    <td className="py-1.5">
                                      {v.validado_safeweb === true
                                        ? <span className="text-green-600 dark:text-green-400">✓ Validado</span>
                                        : v.validado_safeweb === false
                                          ? <span className="text-red-500">✗ Divergente</span>
                                          : <span className="text-gray-400">— Não verificado</span>}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* pagination */}
      {totalPages > 1 && (
        <div className="px-6 py-3 border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex items-center justify-between shrink-0">
          <span className="text-xs text-gray-400">
            Página {page + 1} de {totalPages} — {total.toLocaleString('pt-BR')} clientes
          </span>
          <div className="flex gap-2">
            <button type="button" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
              className="px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-700 rounded-lg disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
              Anterior
            </button>
            <button type="button" onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
              className="px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-700 rounded-lg disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
              Próxima
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
