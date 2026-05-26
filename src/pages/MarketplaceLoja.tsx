import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, ExternalLink, Loader2, ShieldCheck, Store } from 'lucide-react'
import { getEdgeFunctionUrl, supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import type { Certificado, LojaMarketplace, TabelaPreco, TabelaPrecoItem } from '@/types'

type LojaItemRow = TabelaPrecoItem & {
  certificados: Certificado | null
}

type LojaMarketplaceConfig = {
  modo_exibicao?: 'vitrine' | 'link_direto'
  item_fixo_id?: string | null
}

export default function MarketplaceLoja({ slug }: { slug?: string | null }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loja, setLoja] = useState<LojaMarketplace | null>(null)
  const [tabela, setTabela] = useState<TabelaPreco | null>(null)
  const [itens, setItens] = useState<LojaItemRow[]>([])
  const [selectedItemId, setSelectedItemId] = useState<string>('')
  const [checkoutForm, setCheckoutForm] = useState({
    nome: '',
    cpf_cnpj: '',
    email: '',
    telefone: '',
  })
  const [checkoutLoading, setCheckoutLoading] = useState(false)
  const [checkoutSuccess, setCheckoutSuccess] = useState<string | null>(null)

  function normalizeLojaConfig(configuracoes: Record<string, unknown> | null | undefined): Required<LojaMarketplaceConfig> {
    const modo = configuracoes?.modo_exibicao === 'link_direto' ? 'link_direto' : 'vitrine'
    const itemFixo = typeof configuracoes?.item_fixo_id === 'string' ? configuracoes.item_fixo_id : ''
    return { modo_exibicao: modo, item_fixo_id: itemFixo }
  }

  function resolveInitialItemId(items: LojaItemRow[], lojaData: LojaMarketplace | null) {
    if (!lojaData) return ''
    const searchParams = new URLSearchParams(window.location.search)
    const produtoParam = searchParams.get('produto') ?? ''
    const config = normalizeLojaConfig(lojaData.configuracoes)
    const idsValidos = new Set(items.map(item => item.id))
    if (produtoParam && idsValidos.has(produtoParam)) return produtoParam
    if (config.item_fixo_id && idsValidos.has(config.item_fixo_id)) return config.item_fixo_id
    return items[0]?.id ?? ''
  }

  useEffect(() => {
    let active = true

    async function fetchLoja() {
      setLoading(true)
      setError(null)

      let lojaQuery = supabase
        .from('lojas_marketplace')
        .select('*')
        .eq('ativo', true)

      if (slug) {
        lojaQuery = lojaQuery.eq('slug', slug)
      } else {
        lojaQuery = lojaQuery.eq('owner_tipo', 'institucional').order('created_at', { ascending: true }).limit(1)
      }

      const { data: lojaData, error: lojaErr } = slug
        ? await lojaQuery.maybeSingle()
        : await lojaQuery.maybeSingle()

      if (!active) return
      if (lojaErr) {
        setError(lojaErr.message)
        setLoading(false)
        return
      }
      if (!lojaData) {
        setError(slug ? 'Loja não encontrada ou indisponível no momento.' : 'Nenhuma loja institucional foi configurada ainda.')
        setLoading(false)
        return
      }

      const [tabelaRes, itensRes] = await Promise.all([
        supabase.from('tabelas_preco').select('*').eq('id', lojaData.tabela_preco_id).maybeSingle(),
        supabase
          .from('tabelas_preco_itens')
          .select('*, certificados(*)')
          .eq('tabela_preco_id', lojaData.tabela_preco_id)
          .eq('ativo', true)
          .order('created_at', { ascending: true }),
      ])

      if (!active) return

      const fetchErr = tabelaRes.error ?? itensRes.error
      if (fetchErr) {
        setError(fetchErr.message)
        setLoading(false)
        return
      }

      setLoja(lojaData as LojaMarketplace)
      setTabela((tabelaRes.data ?? null) as TabelaPreco | null)
      const itensAtivos = (itensRes.data ?? []) as unknown as LojaItemRow[]
      setItens(itensAtivos)
      setSelectedItemId(resolveInitialItemId(itensAtivos.filter(item => item.certificados?.ativo), lojaData as LojaMarketplace))
      setLoading(false)
    }

    void fetchLoja()
    return () => { active = false }
  }, [slug])

  const produtosAtivos = useMemo(
    () => itens.filter(item => item.certificados?.ativo),
    [itens]
  )
  const lojaConfig = useMemo(
    () => normalizeLojaConfig(loja?.configuracoes),
    [loja]
  )
  const modoLinkDireto = lojaConfig.modo_exibicao === 'link_direto'
  const itemSelecionado = useMemo(
    () => produtosAtivos.find(item => item.id === selectedItemId) ?? null,
    [produtosAtivos, selectedItemId]
  )

  useEffect(() => {
    if (!loja) return
    const proximoId = resolveInitialItemId(produtosAtivos, loja)
    if (proximoId && proximoId !== selectedItemId) {
      setSelectedItemId(proximoId)
      return
    }
    if (!proximoId && selectedItemId) {
      setSelectedItemId('')
    }
  }, [loja, produtosAtivos, selectedItemId])

  async function iniciarCheckout() {
    if (!itemSelecionado) {
      setError('Selecione um produto para continuar.')
      return
    }
    if (!checkoutForm.nome.trim() || !checkoutForm.cpf_cnpj.trim()) {
      setError('Informe nome e CPF/CNPJ para continuar.')
      return
    }

    setCheckoutLoading(true)
    setError(null)
    setCheckoutSuccess(null)

    try {
      const response = await fetch(getEdgeFunctionUrl('marketplace-checkout'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: slug ?? null,
          item_id: itemSelecionado.id,
          nome: checkoutForm.nome,
          cpf_cnpj: checkoutForm.cpf_cnpj,
          email: checkoutForm.email,
          telefone: checkoutForm.telefone,
        }),
      })

      const result = await response.json()
      if (!response.ok || !result.ok) {
        setError(result.error ?? 'Falha ao iniciar a compra.')
        setCheckoutLoading(false)
        return
      }

      setCheckoutSuccess('Compra iniciada com sucesso. A venda foi registrada e o agendamento ficou pendente para a próxima etapa.')
      setCheckoutForm({ nome: '', cpf_cnpj: '', email: '', telefone: '' })
      setSelectedItemId(resolveInitialItemId(produtosAtivos, loja))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro inesperado ao iniciar a compra.')
    } finally {
      setCheckoutLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[radial-gradient(circle_at_top,#e0f2fe_0%,#f8fafc_45%,#ffffff_100%)] flex items-center justify-center p-6">
        <div className="text-center">
          <Loader2 size={28} className="animate-spin text-sky-600 mx-auto" />
          <p className="text-sm text-slate-500 mt-3">Carregando a loja...</p>
        </div>
      </div>
    )
  }

  if (error || !loja || !tabela) {
    return (
      <div className="min-h-screen bg-[radial-gradient(circle_at_top,#e0f2fe_0%,#f8fafc_45%,#ffffff_100%)] flex items-center justify-center p-6">
        <div className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-8 shadow-sm text-center">
          <p className="text-lg font-semibold text-slate-800">Loja indisponível</p>
          <p className="text-sm text-slate-500 mt-2">{error ?? 'Não foi possível abrir esta loja agora.'}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#dbeafe_0%,#eff6ff_30%,#ffffff_100%)] text-slate-900">
      <header className="border-b border-sky-100 bg-white/90 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-6 py-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-sky-600 text-white flex items-center justify-center shadow-sm">
              <Store size={20} />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-sky-600 font-semibold">Marketplace CertiID</p>
              <h1 className="text-xl font-semibold">{loja.nome_loja}</h1>
            </div>
          </div>
          <div className="hidden md:flex items-center gap-2 rounded-full bg-sky-50 px-4 py-2 text-xs font-medium text-sky-700">
            <ShieldCheck size={14} />
            Tabela comercial vinculada e rastreável
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-10 space-y-10">
        <section className="grid grid-cols-1 lg:grid-cols-[1.15fr_0.85fr] gap-6 items-start">
          <div className="rounded-[28px] bg-slate-950 text-white p-8 shadow-xl shadow-slate-200/80">
            <p className="text-xs uppercase tracking-[0.26em] text-sky-300 font-semibold">Loja comercial</p>
            <h2 className="text-3xl font-semibold mt-3 leading-tight">
              Produtos da tabela <span className="text-sky-300">{tabela.nome}</span>
            </h2>
            <p className="text-sm text-slate-300 mt-4 max-w-2xl">
              Esta loja já nasce vinculada à tabela de preço correta. Isso garante rastreio comercial, controle de origem da venda e preparação para o agendamento de validação.
            </p>
            {loja.descricao && (
              <p className="text-sm text-slate-300 mt-4">{loja.descricao}</p>
            )}
          </div>

          <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-xs uppercase tracking-[0.22em] text-slate-400 font-semibold">Resumo</p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <StatCard label="Produtos ativos" value={String(produtosAtivos.length)} />
              <StatCard label="Tabela" value={tabela.nome} />
              <StatCard label="Modo" value={modoLinkDireto ? 'Link direto' : 'Escolha por lista'} />
              <StatCard label="Regra" value={modoLinkDireto ? 'Produto único' : 'Catálogo aberto'} />
            </div>
            <div className="mt-5 rounded-2xl bg-sky-50 px-4 py-3 text-xs text-sky-800">
              Esta compra já nasce vinculada à tabela correta. No site principal, a venda fica presa à tabela da matriz. Nas lojas comerciais, ela nasce presa ao canal certo.
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 xl:grid-cols-[1.2fr_0.8fr] gap-6 items-start">
          <div className="space-y-4">
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-slate-400 font-semibold">
                {modoLinkDireto ? 'Produto fixo' : 'Catálogo'}
              </p>
              <h3 className="text-2xl font-semibold mt-2">
                {modoLinkDireto ? 'Compra direcionada para este produto' : 'Escolha o certificado ideal'}
              </h3>
            </div>

            {produtosAtivos.length === 0 ? (
              <div className="rounded-[28px] border border-slate-200 bg-white p-8 text-sm text-slate-500 shadow-sm">
                Esta loja ainda não possui produtos ativos nesta tabela.
              </div>
            ) : modoLinkDireto && itemSelecionado ? (
              <article className="rounded-[28px] border border-sky-200 bg-white p-7 shadow-sm">
                <p className="text-xs uppercase tracking-[0.2em] text-sky-600 font-semibold">
                  {itemSelecionado.certificados?.categoria ?? 'Certificação digital'}
                </p>
                <h4 className="text-2xl font-semibold mt-3">{itemSelecionado.certificados?.tipo ?? 'Produto'}</h4>
                <p className="text-sm text-slate-500 mt-3">
                  {itemSelecionado.certificados?.descricao_produto ?? itemSelecionado.certificados?.descricao ?? 'Produto disponível nesta loja.'}
                </p>
                <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <StatCard
                    label="Valor"
                    value={Number(itemSelecionado.valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                  />
                  <StatCard label="Validade" value={itemSelecionado.certificados?.validade ?? '—'} />
                  <StatCard label="Tabela" value={tabela.nome} />
                </div>
                {itemSelecionado.link_safeweb?.trim() && (
                  <button
                    type="button"
                    onClick={() => window.open(itemSelecionado.link_safeweb!, '_blank', 'noopener,noreferrer')}
                    className="mt-5 inline-flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold border border-slate-200 text-slate-600 hover:bg-slate-50"
                  >
                    <ExternalLink size={15} />
                    Abrir link externo deste produto
                  </button>
                )}
              </article>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {produtosAtivos.map(item => {
                  const cert = item.certificados
                  const link = item.link_safeweb?.trim() || null
                  const ativo = selectedItemId === item.id
                  return (
                    <article key={item.id} className={cn(
                      'rounded-[28px] border bg-white p-6 shadow-sm hover:shadow-md transition-all',
                      ativo ? 'border-sky-500 ring-2 ring-sky-100' : 'border-slate-200'
                    )}>
                      <p className="text-xs uppercase tracking-[0.2em] text-sky-600 font-semibold">
                        {cert?.categoria ?? 'Certificação digital'}
                      </p>
                      <h4 className="text-xl font-semibold mt-3 min-h-[56px]">{cert?.tipo ?? 'Produto'}</h4>
                      <p className="text-sm text-slate-500 mt-2 min-h-[42px]">
                        {cert?.descricao_produto ?? cert?.descricao ?? 'Produto disponível nesta loja.'}
                      </p>
                      <div className="mt-5 flex items-center justify-between">
                        <div>
                          <p className="text-xs text-slate-400">Valor</p>
                          <p className="text-2xl font-semibold text-emerald-600">
                            {Number(item.valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-slate-400">Validade</p>
                          <p className="text-sm font-medium text-slate-700">{cert?.validade ?? '—'}</p>
                        </div>
                      </div>
                      <div className="mt-6 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setSelectedItemId(item.id)}
                          className={cn(
                            'flex-1 inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold transition-colors',
                            ativo
                              ? 'bg-sky-700 text-white'
                              : 'bg-sky-600 text-white hover:bg-sky-700'
                          )}
                        >
                          {ativo ? <CheckCircle2 size={15} /> : <Store size={15} />}
                          {ativo ? 'Produto selecionado' : 'Selecionar produto'}
                        </button>
                        {link && (
                          <button
                            type="button"
                            onClick={() => window.open(link, '_blank', 'noopener,noreferrer')}
                            className="inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold border border-slate-200 text-slate-600 hover:bg-slate-50"
                          >
                            <ExternalLink size={15} />
                          </button>
                        )}
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
          </div>

          <aside className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm xl:sticky xl:top-6">
            <p className="text-xs uppercase tracking-[0.22em] text-slate-400 font-semibold">Checkout da loja</p>
            <h3 className="text-2xl font-semibold mt-2">Iniciar compra</h3>
            <p className="text-sm text-slate-500 mt-2">
              Ao avançar, a venda já será registrada no CRM com a tabela desta loja e o agendamento ficará pendente para a próxima etapa.
            </p>

            <div className="mt-5 rounded-2xl bg-slate-50 px-4 py-3">
              <p className="text-xs text-slate-400">Produto selecionado</p>
              <p className="text-sm font-semibold text-slate-800 mt-1">
                {itemSelecionado?.certificados?.tipo ?? 'Selecione um produto ao lado'}
              </p>
              {itemSelecionado && (
                <p className="text-xs text-emerald-600 font-semibold mt-2">
                  {Number(itemSelecionado.valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                </p>
              )}
            </div>

            <div className="space-y-3 mt-5">
              <Field
                label="Nome / Razão Social *"
                value={checkoutForm.nome}
                onChange={value => setCheckoutForm(prev => ({ ...prev, nome: value }))}
              />
              <Field
                label="CPF / CNPJ *"
                value={checkoutForm.cpf_cnpj}
                onChange={value => setCheckoutForm(prev => ({ ...prev, cpf_cnpj: value }))}
              />
              <Field
                label="E-mail"
                value={checkoutForm.email}
                onChange={value => setCheckoutForm(prev => ({ ...prev, email: value }))}
                type="email"
              />
              <Field
                label="Telefone"
                value={checkoutForm.telefone}
                onChange={value => setCheckoutForm(prev => ({ ...prev, telefone: value }))}
              />
            </div>

            {error && (
              <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            {checkoutSuccess && (
              <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                {checkoutSuccess}
              </div>
            )}

            <button
              type="button"
              onClick={() => void iniciarCheckout()}
              disabled={checkoutLoading || !itemSelecionado}
              className="mt-5 w-full inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 bg-sky-600 text-white text-sm font-semibold hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {checkoutLoading ? <Loader2 size={16} className="animate-spin" /> : <Store size={16} />}
              {checkoutLoading ? 'Registrando compra...' : 'Continuar compra'}
            </button>
          </aside>
        </section>
      </main>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-slate-500">{label}</span>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="border border-slate-200 rounded-2xl px-4 py-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
      />
    </label>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 px-4 py-3">
      <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400 font-semibold">{label}</p>
      <p className="text-sm font-semibold text-slate-800 mt-2">{value}</p>
    </div>
  )
}
