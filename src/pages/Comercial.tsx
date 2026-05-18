import { useState, useEffect, useCallback, useMemo } from 'react'
import { cn } from '@/lib/utils'
import {
  AlertCircle,
  Calendar,
  Check,
  CreditCard,
  Edit3,
  Loader2,
  MapPin,
  PlusCircle,
  Search,
  ShoppingBag,
  Tag,
  ToggleLeft,
  ToggleRight,
  TrendingUp,
  X,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type {
  Agendamento,
  CanalVenda,
  Certificado,
  FaixaComissao,
  FormaPagamento,
  NovaFaixaComissao,
  NovaFormaPagamento,
  NovoAgendamento,
  NovoCertificado,
  NovoPrecoCertificado,
  PrecoCertificado,
  StatusAgendamento,
  CadastroBase,
  NovoCadastroBase,
  PontoAtendimento,
  StatusVendaCertificado,
  VendaCertificado,
} from '@/types'

// ── local types ────────────────────────────────────────────────
type VendaRow = VendaCertificado & {
  cadastros_base: { nome: string; cpf_cnpj: string } | null
  pontos_atendimento: { nome: string } | null
}

type LocalFormVenda = {
  cadastro_base_id: string
  empresa_id: string | null
  tipo_produto: string
  tipo_emissao: string
  forma_pagamento: string
  valor_venda: number
  valor_custo: number
  ponto_atendimento_id: string
  observacoes: string | null
}

type LocalFormTitular = {
  nome: string
  cpf: string
  email: string | null
  telefone: string | null
  data_nascimento: string | null
}

// ── tab definition ─────────────────────────────────────────────
type Tab = 'vendas' | 'agenda' | 'certificados' | 'precos' | 'comissoes' | 'pagamento'

const TABS: { id: Tab; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { id: 'vendas',       label: 'Lançar Vendas',    icon: TrendingUp  },
  { id: 'agenda',       label: 'Agenda',           icon: Calendar    },
  { id: 'certificados', label: 'Certificados',     icon: ShoppingBag },
  { id: 'precos',       label: 'Tabela de Preços', icon: Tag         },
  { id: 'comissoes',    label: 'Faixas Comissão',  icon: TrendingUp  },
  { id: 'pagamento',    label: 'Forma Pagamento',  icon: CreditCard  },
]

const FALLBACK_CERTS = ['e-CPF A1', 'e-CPF A3', 'e-CNPJ A1', 'e-CNPJ A3', 'NF-e A1', 'SSL']

const CANAL_LABEL: Record<CanalVenda, string> = {
  balcao:       'Balcão',
  ecommerce:    'E-Commerce',
  prepago:      'Pré-pago',
  voucher:      'Voucher',
  link_externo: 'Link Externo',
}

const TIPO_EMISSAO_OPTIONS = [
  { value: 'presencial',       label: 'Presencial'        },
  { value: 'videoconferencia', label: 'Videoconferência'  },
  { value: 'auto_atendimento', label: 'Auto Atendimento'  },
  { value: 'online',           label: 'Online'            },
]

const STATUS_VENDA_V2_OPTIONS: StatusVendaCertificado[] = [
  'rascunho', 'vendido', 'agendado', 'em_validacao', 'emitido', 'cancelado',
]

const EMPTY_VENDA_V2: LocalFormVenda = {
  cadastro_base_id: '',
  empresa_id: null,
  tipo_produto: 'e-CPF A1',
  tipo_emissao: 'presencial',
  forma_pagamento: 'PIX',
  valor_venda: 0,
  valor_custo: 0,
  ponto_atendimento_id: '',
  observacoes: null,
}

const EMPTY_TITULAR: LocalFormTitular = {
  nome: '',
  cpf: '',
  email: null,
  telefone: null,
  data_nascimento: null,
}

const EMPTY_CLIENTE_BASE: NovoCadastroBase = {
  tipo_cliente: 'pessoa_fisica',
  tipo_cadastro: 'cliente',
  cpf_cnpj: '',
  nome: '',
  nome_fantasia: null,
  email: null,
  telefone: null,
  cidade: null,
  logradouro: null,
  numero: null,
  complemento: null,
  bairro: null,
  uf: null,
  cep: null,
  inscricao_municipal: null,
  inscricao_estadual: null,
  iss_retido: false,
  status: 'ativo',
  metadata: {},
}

const EMPTY_AGENDA: NovoAgendamento = {
  cliente: '', telefone: null, servico: 'e-CPF A1',
  data_hora: '', status: 'aguardando', observacoes: null,
}

const EMPTY_CERTIFICADO: NovoCertificado = { tipo: '', estoque: 0, validade: '1 ano', ativo: true }

const EMPTY_PRECO: NovoPrecoCertificado = { certificado_id: '', canal: 'balcao', valor: 0, ativo: true }

const EMPTY_COMISSAO: NovaFaixaComissao = {
  faixa: '', min_emissoes: 1, max_emissoes: null,
  percentual: 0, valor_exemplo: null, ordem: 1, ativo: true,
}

const EMPTY_PAGAMENTO: NovaFormaPagamento = { nome: '', ordem: 1, ativo: true }

type VendaFilters = {
  dataInicial: string
  dataFinal: string
  pedido: string
  protocolo: string
  cliente: string
  status: string
}

const EMPTY_VENDA_FILTERS: VendaFilters = {
  dataInicial: '',
  dataFinal: '',
  pedido: '',
  protocolo: '',
  cliente: '',
  status: '',
}

export default function Comercial() {
  const [tab, setTab] = useState<Tab>('vendas')

  // ── V2 vendas state ──────────────────────────────────────────
  const [vendasV2, setVendasV2]         = useState<VendaRow[]>([])
  const [clientes, setClientes]         = useState<CadastroBase[]>([])
  const [pontos, setPontos]             = useState<PontoAtendimento[]>([])
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [loadingV, setLoadingV]         = useState(true)
  const [showFormV, setShowFormV]       = useState(false)
  const [formV2, setFormV2]             = useState<LocalFormVenda>(EMPTY_VENDA_V2)
  const [formTitular, setFormTitular]   = useState<LocalFormTitular>(EMPTY_TITULAR)
  const [showClienteForm, setShowClienteForm] = useState(false)
  const [editingClienteId, setEditingClienteId] = useState<string | null>(null)
  const [clienteSearch, setClienteSearch]     = useState('')
  const [formCliente, setFormCliente]   = useState<NovoCadastroBase>(EMPTY_CLIENTE_BASE)
  const [salvandoV, setSalvandoV]       = useState(false)
  const [salvandoCliente, setSalvandoCliente] = useState(false)
  const [vendaFilters, setVendaFilters] = useState<VendaFilters>(EMPTY_VENDA_FILTERS)

  // ── agenda state ─────────────────────────────────────────────
  const [agenda, setAgenda]             = useState<Agendamento[]>([])
  const [loadingA, setLoadingA]         = useState(true)
  const [showFormA, setShowFormA]       = useState(false)
  const [formA, setFormA]               = useState<NovoAgendamento>(EMPTY_AGENDA)
  const [salvandoA, setSalvandoA]       = useState(false)

  // ── catalog state ────────────────────────────────────────────
  const [certificados, setCertificados]       = useState<Certificado[]>([])
  const [precos, setPrecos]                   = useState<PrecoCertificado[]>([])
  const [comissoes, setComissoes]             = useState<FaixaComissao[]>([])
  const [pagamentos, setPagamentos]           = useState<FormaPagamento[]>([])
  const [loadingCatalogo, setLoadingCatalogo] = useState(true)
  const [catalogoErro, setCatalogoErro]       = useState<string | null>(null)
  const [salvandoCatalogo, setSalvandoCatalogo] = useState(false)
  const [showFormCert, setShowFormCert]         = useState(false)
  const [editingCertId, setEditingCertId]       = useState<string | null>(null)
  const [formCert, setFormCert]                 = useState<NovoCertificado>(EMPTY_CERTIFICADO)
  const [showFormPreco, setShowFormPreco]         = useState(false)
  const [editingPrecoId, setEditingPrecoId]       = useState<string | null>(null)
  const [formPreco, setFormPreco]                 = useState<NovoPrecoCertificado>(EMPTY_PRECO)
  const [showFormComissao, setShowFormComissao]   = useState(false)
  const [editingComissaoId, setEditingComissaoId] = useState<string | null>(null)
  const [formComissao, setFormComissao]           = useState<NovaFaixaComissao>(EMPTY_COMISSAO)
  const [showFormPagamento, setShowFormPagamento]   = useState(false)
  const [editingPagamentoId, setEditingPagamentoId] = useState<string | null>(null)
  const [formPagamento, setFormPagamento]           = useState<NovaFormaPagamento>(EMPTY_PAGAMENTO)

  // ── derived ──────────────────────────────────────────────────
  const certificadosAtivos = useMemo(() => certificados.filter(c => c.ativo), [certificados])
  const pagamentosAtivos   = useMemo(() => pagamentos.filter(p => p.ativo),   [pagamentos])
  const tiposCertificado   = certificadosAtivos.length > 0 ? certificadosAtivos.map(c => c.tipo) : FALLBACK_CERTS
  const formasPagamento    = pagamentosAtivos.length > 0   ? pagamentosAtivos.map(p => p.nome)   : ['PIX', 'Cartão de Crédito', 'Cartão de Débito', 'Dinheiro', 'Boleto']
  const certificadoById    = useMemo(() => new Map(certificados.map(c => [c.id, c])), [certificados])
  const certificadoOptions = useMemo(() => certificadosAtivos.map(c => ({ value: c.id, label: `${c.tipo} · ${c.validade}` })), [certificadosAtivos])
  const pontosAtivos       = useMemo(() => pontos.filter(p => p.status === 'ativo'), [pontos])

  const clienteSelecionado = useMemo(
    () => clientes.find(c => c.id === formV2.cadastro_base_id) ?? null,
    [clientes, formV2.cadastro_base_id],
  )

  const clientesFiltrados = useMemo(() => {
    const term = clienteSearch.trim().toLowerCase()
    return term
      ? clientes.filter(c => [c.nome, c.nome_fantasia, c.cpf_cnpj, c.email, c.telefone].some(v => v?.toLowerCase().includes(term)))
      : clientes
  }, [clientes, clienteSearch])

  const vendasFiltradas = useMemo(() => {
    return vendasV2.filter(v => {
      const criado = new Date(v.created_at)
      const dataInicialOk = !vendaFilters.dataInicial || criado >= new Date(`${vendaFilters.dataInicial}T00:00:00`)
      const dataFinalOk = !vendaFilters.dataFinal || criado <= new Date(`${vendaFilters.dataFinal}T23:59:59`)
      const pedido = (v.pedido_numero ?? '').toLowerCase()
      const protocolo = (v.protocolo_numero ?? '').toLowerCase()
      const cliente = (
        (v.cadastros_base as { nome?: string; cpf_cnpj?: string } | null)?.nome
        ?? v.nome_faturamento
        ?? ''
      ).toLowerCase()
      const documento = (
        (v.cadastros_base as { nome?: string; cpf_cnpj?: string } | null)?.cpf_cnpj
        ?? v.documento_faturamento
        ?? ''
      ).toLowerCase()
      const termoCliente = vendaFilters.cliente.trim().toLowerCase()
      return dataInicialOk
        && dataFinalOk
        && (!vendaFilters.pedido || pedido.includes(vendaFilters.pedido.trim().toLowerCase()))
        && (!vendaFilters.protocolo || protocolo.includes(vendaFilters.protocolo.trim().toLowerCase()))
        && (!termoCliente || cliente.includes(termoCliente) || documento.includes(termoCliente))
        && (!vendaFilters.status || v.status_venda === vendaFilters.status)
    })
  }, [vendasV2, vendaFilters])

  // ── fetch V2 ─────────────────────────────────────────────────
  const fetchVendasV2 = useCallback(async () => {
    setLoadingV(true)
    const { data } = await supabase
      .from('vendas_certificados')
      .select('*, cadastros_base(nome, cpf_cnpj), pontos_atendimento(nome)')
      .order('created_at', { ascending: false })
      .limit(50)
    setVendasV2((data ?? []) as VendaRow[])
    setLoadingV(false)
  }, [])

  const fetchClientes = useCallback(async () => {
    const { data } = await supabase
      .from('cadastros_base')
      .select('*')
      .eq('status', 'ativo')
      .order('nome', { ascending: true })
      .limit(200)
    setClientes((data ?? []) as CadastroBase[])
  }, [])

  const fetchPontos = useCallback(async () => {
    const { data } = await supabase
      .from('pontos_atendimento')
      .select('*')
      .eq('status', 'ativo')
      .order('nome', { ascending: true })
    setPontos((data ?? []) as PontoAtendimento[])
  }, [])

  const fetchAgenda = useCallback(async () => {
    setLoadingA(true)
    const hoje = new Date().toISOString().split('T')[0]
    const { data } = await supabase
      .from('agendamentos')
      .select('*')
      .gte('data_hora', hoje)
      .order('data_hora', { ascending: true })
      .limit(50)
    setAgenda((data ?? []) as Agendamento[])
    setLoadingA(false)
  }, [])

  const fetchCatalogo = useCallback(async () => {
    setLoadingCatalogo(true)
    setCatalogoErro(null)
    const [certsRes, precosRes, comissoesRes, pagamentosRes] = await Promise.all([
      supabase.from('certificados').select('*').order('tipo', { ascending: true }),
      supabase.from('precos_certificados').select('*').order('canal', { ascending: true }),
      supabase.from('faixas_comissao').select('*').order('ordem', { ascending: true }),
      supabase.from('formas_pagamento').select('*').order('ordem', { ascending: true }),
    ])
    const error = certsRes.error ?? precosRes.error ?? comissoesRes.error ?? pagamentosRes.error
    if (error) { setCatalogoErro(error.message); setLoadingCatalogo(false); return }
    setCertificados((certsRes.data ?? []) as Certificado[])
    setPrecos((precosRes.data ?? []) as PrecoCertificado[])
    setComissoes((comissoesRes.data ?? []) as FaixaComissao[])
    setPagamentos((pagamentosRes.data ?? []) as FormaPagamento[])
    setLoadingCatalogo(false)
  }, [])

  // ── effects ──────────────────────────────────────────────────
  useEffect(() => { void fetchVendasV2() }, [fetchVendasV2])
  useEffect(() => { void fetchClientes()  }, [fetchClientes])
  useEffect(() => { void fetchPontos()    }, [fetchPontos])
  useEffect(() => { void fetchAgenda()    }, [fetchAgenda])
  useEffect(() => { void fetchCatalogo()  }, [fetchCatalogo])
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setCurrentUserId(data.user?.id ?? null))
  }, [])

  useEffect(() => {
    if (pontosAtivos.length > 0 && !formV2.ponto_atendimento_id) {
      setFormV2(p => ({ ...p, ponto_atendimento_id: pontosAtivos[0].id }))
    }
  }, [pontosAtivos, formV2.ponto_atendimento_id])

  useEffect(() => {
    if (clienteSelecionado?.tipo_cliente === 'pessoa_fisica') {
      setFormTitular(p => ({ ...p, nome: clienteSelecionado.nome, cpf: clienteSelecionado.cpf_cnpj }))
    }
  }, [clienteSelecionado])

  // ── V2 mutations ─────────────────────────────────────────────
  async function salvarVendaV2() {
    if (!formV2.cadastro_base_id || !formV2.tipo_produto || formV2.valor_venda <= 0) return
    if (!formV2.ponto_atendimento_id) { alert('Selecione um ponto de atendimento.'); return }
    if (!currentUserId) { alert('Usuário não autenticado.'); return }
    if (!formTitular.cpf.trim() || !formTitular.nome.trim()) { alert('Preencha os dados do titular.'); return }
    setSalvandoV(true)

    const { data: titularData, error: titularErr } = await supabase
      .from('titulares_certificado')
      .upsert(
        {
          nome: formTitular.nome.trim(),
          cpf: formTitular.cpf.trim(),
          email: formTitular.email || null,
          telefone: formTitular.telefone || null,
          data_nascimento: formTitular.data_nascimento || null,
          metadata: {},
        },
        { onConflict: 'cpf' },
      )
      .select('id')
      .single()

    if (titularErr || !titularData) {
      alert('Erro ao salvar titular: ' + (titularErr?.message ?? 'sem dados'))
      setSalvandoV(false)
      return
    }

    const cli = clienteSelecionado
    const payload: Omit<VendaCertificado, 'id' | 'created_at' | 'updated_at'> = {
      cadastro_base_id:        formV2.cadastro_base_id,
      empresa_id:              formV2.empresa_id,
      titular_id:              titularData.id,
      certificado_id:          null,
      tipo_produto:            formV2.tipo_produto,
      tipo_venda:              null,
      tipo_emissao:            formV2.tipo_emissao,
      tabela_preco:            null,
      forma_pagamento_id:      null,
      valor_venda:             formV2.valor_venda,
      valor_custo:             formV2.valor_custo || null,
      documento_faturamento:   cli?.cpf_cnpj ?? null,
      nome_faturamento:        cli?.nome ?? null,
      email_faturamento:       cli?.email ?? null,
      telefone_faturamento:    cli?.telefone ?? null,
      logradouro:              cli?.logradouro ?? null,
      numero:                  cli?.numero ?? null,
      complemento:             cli?.complemento ?? null,
      bairro:                  cli?.bairro ?? null,
      cidade:                  cli?.cidade ?? null,
      uf:                      cli?.uf ?? null,
      cep:                     cli?.cep ?? null,
      inscricao_municipal:     cli?.inscricao_municipal ?? null,
      inscricao_estadual:      cli?.inscricao_estadual ?? null,
      iss_retido:              cli?.iss_retido ?? false,
      vendedor_id:             currentUserId,
      agente_registro_id:      null,
      contador_id:             null,
      ponto_atendimento_id:    formV2.ponto_atendimento_id,
      pedido_numero:           null,
      pedido_status:           'nao_gerado',
      protocolo_numero:        null,
      protocolo_status:        'nao_gerado',
      certificadora:           null,
      api_payload_pedido:      {},
      api_payload_protocolo:   {},
      comissao_vendedor_tipo:  null,
      comissao_vendedor_valor: null,
      comissao_agente_tipo:    null,
      comissao_agente_valor:   null,
      status_venda:            'vendido',
      observacoes:             formV2.observacoes,
      metadata:                { forma_pagamento: formV2.forma_pagamento },
    }

    const { error } = await supabase.from('vendas_certificados').insert([payload])
    setSalvandoV(false)
    if (error) { alert('Erro: ' + error.message); return }
    setShowFormV(false)
    setFormV2({ ...EMPTY_VENDA_V2, ponto_atendimento_id: pontosAtivos[0]?.id ?? '', tipo_produto: tiposCertificado[0] ?? 'e-CPF A1', forma_pagamento: formasPagamento[0] ?? 'PIX' })
    setFormTitular({ ...EMPTY_TITULAR })
    void fetchVendasV2()
  }

  async function salvarCliente() {
    if (!formCliente.cpf_cnpj.trim() || !formCliente.nome.trim()) return
    setSalvandoCliente(true)
    const payload = {
      ...formCliente,
      cpf_cnpj:     formCliente.cpf_cnpj.trim(),
      nome:         formCliente.nome.trim(),
      nome_fantasia: formCliente.nome_fantasia?.trim() || null,
      email:        formCliente.email?.trim() || null,
      telefone:     formCliente.telefone?.trim() || null,
    }
    const query = editingClienteId
      ? supabase.from('cadastros_base').update(payload).eq('id', editingClienteId).select('id').single()
      : supabase.from('cadastros_base').insert([payload]).select('id').single()
    const { data, error } = await query
    setSalvandoCliente(false)
    if (error) { alert('Erro: ' + error.message); return }
    setFormCliente({ ...EMPTY_CLIENTE_BASE })
    setShowClienteForm(false)
    setEditingClienteId(null)
    await fetchClientes()
    if (data?.id) setFormV2(p => ({ ...p, cadastro_base_id: data.id }))
  }

  function abrirNovoCliente() {
    setEditingClienteId(null)
    setFormCliente({ ...EMPTY_CLIENTE_BASE })
    setShowClienteForm(true)
  }

  function abrirEditarCliente(cadastroId: string) {
    const cliente = clientes.find(c => c.id === cadastroId)
    if (!cliente) return
    setEditingClienteId(cliente.id)
    setFormCliente({
      tipo_cliente: cliente.tipo_cliente,
      tipo_cadastro: cliente.tipo_cadastro,
      cpf_cnpj: cliente.cpf_cnpj,
      nome: cliente.nome,
      nome_fantasia: cliente.nome_fantasia,
      email: cliente.email,
      telefone: cliente.telefone,
      cidade: cliente.cidade,
      logradouro: cliente.logradouro,
      numero: cliente.numero,
      complemento: cliente.complemento,
      bairro: cliente.bairro,
      uf: cliente.uf,
      cep: cliente.cep,
      inscricao_municipal: cliente.inscricao_municipal,
      inscricao_estadual: cliente.inscricao_estadual,
      iss_retido: cliente.iss_retido,
      status: cliente.status,
      metadata: cliente.metadata ?? {},
    })
    setShowFormV(true)
    setShowClienteForm(true)
  }

  function prepararNovaVendaParaCliente(cadastroId: string) {
    setFormV2(p => ({ ...p, cadastro_base_id: cadastroId }))
    setShowFormV(true)
    setShowClienteForm(false)
  }

  function prepararAgendamento(venda: VendaRow) {
    setFormA({
      cliente: (venda.cadastros_base as { nome?: string } | null)?.nome ?? venda.nome_faturamento ?? '',
      telefone: venda.telefone_faturamento ?? null,
      servico: venda.tipo_produto,
      data_hora: '',
      status: 'aguardando',
      observacoes: venda.observacoes ?? null,
    })
    setTab('agenda')
    setShowFormA(true)
  }

  async function atualizarStatusVendaV2(id: string, status: StatusVendaCertificado) {
    await supabase.from('vendas_certificados').update({ status_venda: status }).eq('id', id)
    setVendasV2(prev => prev.map(v => v.id === id ? { ...v, status_venda: status } : v))
  }

  // ── agenda mutations ─────────────────────────────────────────
  async function salvarAgendamento() {
    if (!formA.cliente.trim() || !formA.data_hora) return
    setSalvandoA(true)
    const { error } = await supabase.from('agendamentos').insert([formA])
    setSalvandoA(false)
    if (error) { alert('Erro: ' + error.message); return }
    setShowFormA(false)
    setFormA({ ...EMPTY_AGENDA, servico: tiposCertificado[0] ?? 'e-CPF A1' })
    void fetchAgenda()
  }

  async function atualizarStatusAgenda(id: string, status: StatusAgendamento) {
    await supabase.from('agendamentos').update({ status }).eq('id', id)
    setAgenda(prev => prev.map(a => a.id === id ? { ...a, status } : a))
  }

  // ── catalog mutations ────────────────────────────────────────
  function abrirNovoCertificado() { setEditingCertId(null); setFormCert({ ...EMPTY_CERTIFICADO }); setShowFormCert(true) }

  function editarCertificado(certificado: Certificado) {
    setEditingCertId(certificado.id)
    setFormCert({ tipo: certificado.tipo, estoque: certificado.estoque, validade: certificado.validade, ativo: certificado.ativo })
    setShowFormCert(true)
  }

  async function salvarCertificado() {
    if (!formCert.tipo.trim() || !formCert.validade.trim()) return
    setSalvandoCatalogo(true)
    const payload = { ...formCert, tipo: formCert.tipo.trim(), validade: formCert.validade.trim() }
    const { error } = editingCertId
      ? await supabase.from('certificados').update(payload).eq('id', editingCertId)
      : await supabase.from('certificados').insert([payload])
    setSalvandoCatalogo(false)
    if (error) { alert('Erro: ' + error.message); return }
    setShowFormCert(false); setEditingCertId(null); setFormCert({ ...EMPTY_CERTIFICADO }); void fetchCatalogo()
  }

  async function toggleCertificado(certificado: Certificado) {
    await supabase.from('certificados').update({ ativo: !certificado.ativo }).eq('id', certificado.id)
    setCertificados(prev => prev.map(c => c.id === certificado.id ? { ...c, ativo: !c.ativo } : c))
  }

  function abrirNovoPreco() { setEditingPrecoId(null); setFormPreco({ ...EMPTY_PRECO, certificado_id: certificados[0]?.id ?? '' }); setShowFormPreco(true) }

  function editarPreco(preco: PrecoCertificado) {
    setEditingPrecoId(preco.id)
    setFormPreco({ certificado_id: preco.certificado_id, canal: preco.canal, valor: preco.valor, ativo: preco.ativo })
    setShowFormPreco(true)
  }

  async function salvarPreco() {
    if (!formPreco.certificado_id || formPreco.valor <= 0) return
    setSalvandoCatalogo(true)
    const { error } = editingPrecoId
      ? await supabase.from('precos_certificados').update(formPreco).eq('id', editingPrecoId)
      : await supabase.from('precos_certificados').insert([formPreco])
    setSalvandoCatalogo(false)
    if (error) { alert('Erro: ' + error.message); return }
    setShowFormPreco(false); setEditingPrecoId(null); setFormPreco({ ...EMPTY_PRECO }); void fetchCatalogo()
  }

  async function togglePreco(preco: PrecoCertificado) {
    await supabase.from('precos_certificados').update({ ativo: !preco.ativo }).eq('id', preco.id)
    setPrecos(prev => prev.map(p => p.id === preco.id ? { ...p, ativo: !p.ativo } : p))
  }

  function abrirNovaComissao() { setEditingComissaoId(null); setFormComissao({ ...EMPTY_COMISSAO, ordem: comissoes.length + 1 }); setShowFormComissao(true) }

  function editarComissao(comissao: FaixaComissao) {
    setEditingComissaoId(comissao.id)
    setFormComissao({ faixa: comissao.faixa, min_emissoes: comissao.min_emissoes, max_emissoes: comissao.max_emissoes, percentual: comissao.percentual, valor_exemplo: comissao.valor_exemplo, ordem: comissao.ordem, ativo: comissao.ativo })
    setShowFormComissao(true)
  }

  async function salvarComissao() {
    if (!formComissao.faixa.trim() || formComissao.percentual < 0) return
    setSalvandoCatalogo(true)
    const payload = { ...formComissao, faixa: formComissao.faixa.trim() }
    const { error } = editingComissaoId
      ? await supabase.from('faixas_comissao').update(payload).eq('id', editingComissaoId)
      : await supabase.from('faixas_comissao').insert([payload])
    setSalvandoCatalogo(false)
    if (error) { alert('Erro: ' + error.message); return }
    setShowFormComissao(false); setEditingComissaoId(null); setFormComissao({ ...EMPTY_COMISSAO }); void fetchCatalogo()
  }

  async function toggleComissao(comissao: FaixaComissao) {
    await supabase.from('faixas_comissao').update({ ativo: !comissao.ativo }).eq('id', comissao.id)
    setComissoes(prev => prev.map(c => c.id === comissao.id ? { ...c, ativo: !c.ativo } : c))
  }

  function abrirNovoPagamento() { setEditingPagamentoId(null); setFormPagamento({ ...EMPTY_PAGAMENTO, ordem: pagamentos.length + 1 }); setShowFormPagamento(true) }

  function editarPagamento(pagamento: FormaPagamento) {
    setEditingPagamentoId(pagamento.id)
    setFormPagamento({ nome: pagamento.nome, ordem: pagamento.ordem, ativo: pagamento.ativo })
    setShowFormPagamento(true)
  }

  async function salvarPagamento() {
    if (!formPagamento.nome.trim()) return
    setSalvandoCatalogo(true)
    const payload = { ...formPagamento, nome: formPagamento.nome.trim() }
    const { error } = editingPagamentoId
      ? await supabase.from('formas_pagamento').update(payload).eq('id', editingPagamentoId)
      : await supabase.from('formas_pagamento').insert([payload])
    setSalvandoCatalogo(false)
    if (error) { alert('Erro: ' + error.message); return }
    setShowFormPagamento(false); setEditingPagamentoId(null); setFormPagamento({ ...EMPTY_PAGAMENTO }); void fetchCatalogo()
  }

  async function togglePagamento(pagamento: FormaPagamento) {
    await supabase.from('formas_pagamento').update({ ativo: !pagamento.ativo }).eq('id', pagamento.id)
    setPagamentos(prev => prev.map(p => p.id === pagamento.id ? { ...p, ativo: !p.ativo } : p))
  }

  // ── render ───────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1 px-6 py-2 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-x-auto shrink-0">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" onClick={() => setTab(id)}
            className={cn('flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md whitespace-nowrap transition-colors',
              tab === id
                ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-700 dark:hover:text-gray-300')}>
            <Icon size={13} />{label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto p-6">

        {/* ── VENDAS ─────────────────────────────────────────── */}
        {tab === 'vendas' && (
          <div className="space-y-5">
            <SectionHeader title="Vendas" actionLabel="Nova Venda" onAction={() => setShowFormV(v => !v)} />

            {pontosAtivos.length === 0 && (
              <div className="flex items-center gap-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
                <AlertCircle size={16} />
                Nenhum ponto de atendimento cadastrado. Configure em <strong className="mx-1">Configurações &gt; Pontos de Atendimento</strong>.
              </div>
            )}

            {showFormV && (
              <Panel title="Registrar Venda" onClose={() => setShowFormV(false)}>
                <div className="flex items-center justify-between gap-3 mb-4">
                  <p className="text-xs text-gray-500 dark:text-gray-400">Escolha um cliente/empresa existente ou cadastre um novo antes de lançar a venda.</p>
                  <button type="button" onClick={() => {
                    if (showClienteForm) {
                      setShowClienteForm(false)
                      setEditingClienteId(null)
                      setFormCliente({ ...EMPTY_CLIENTE_BASE })
                    } else {
                      abrirNovoCliente()
                    }
                  }}
                    className="px-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 text-xs font-medium hover:bg-gray-200 dark:hover:bg-gray-700">
                    {showClienteForm ? 'Fechar cadastro' : 'Novo cliente/empresa'}
                  </button>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Cliente / Empresa</label>
                    <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2">
                      <input
                        list="clientes-base-list"
                        value={clienteSelecionado ? clienteSelecionado.nome : clienteSearch}
                        onChange={e => {
                          const v = e.target.value
                          setClienteSearch(v)
                          const match = clientes.find(c => c.nome.toLowerCase() === v.toLowerCase() || c.cpf_cnpj === v)
                          if (match) { setFormV2(p => ({ ...p, cadastro_base_id: match.id })); setClienteSearch('') }
                          else setFormV2(p => ({ ...p, cadastro_base_id: '' }))
                        }}
                        placeholder="Digite ou selecione um cliente"
                        className="w-full border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <button type="button" onClick={() => abrirNovoCliente()}
                        className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium">Novo cadastro</button>
                    </div>
                    <datalist id="clientes-base-list">
                      {clientesFiltrados.map(c => (
                        <option key={c.id} value={c.nome}>{c.cpf_cnpj}{c.nome_fantasia ? ` - ${c.nome_fantasia}` : ''}</option>
                      ))}
                    </datalist>
                  </div>

                  <SelectInput label="Ponto de Atendimento" value={formV2.ponto_atendimento_id}
                    onChange={v => setFormV2(p => ({ ...p, ponto_atendimento_id: v }))}
                    options={pontosAtivos.map(p => ({ value: p.id, label: p.nome }))} />

                  <SelectInput label="Produto / Certificado" value={formV2.tipo_produto}
                    onChange={v => setFormV2(p => ({ ...p, tipo_produto: v }))}
                    options={tiposCertificado.map(t => ({ value: t, label: t }))} />

                  <SelectInput label="Tipo de Emissão" value={formV2.tipo_emissao}
                    onChange={v => setFormV2(p => ({ ...p, tipo_emissao: v }))}
                    options={TIPO_EMISSAO_OPTIONS} />

                  <SelectInput label="Forma de Pagamento" value={formV2.forma_pagamento}
                    onChange={v => setFormV2(p => ({ ...p, forma_pagamento: v }))}
                    options={formasPagamento.map(n => ({ value: n, label: n }))} />

                  <NumberInput label="Valor Venda (R$) *" value={formV2.valor_venda}
                    onChange={v => setFormV2(p => ({ ...p, valor_venda: v }))} />
                </div>

                <div className="mt-4 rounded-xl border border-gray-200 dark:border-gray-800 p-4 bg-gray-50 dark:bg-gray-900/40">
                  <h4 className="font-semibold text-sm text-gray-700 dark:text-gray-200 mb-3">Dados do Titular do Certificado</h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <TextInput label="Nome completo *" value={formTitular.nome}
                      onChange={v => setFormTitular(p => ({ ...p, nome: v }))} className="md:col-span-2" />
                    <TextInput label="CPF *" value={formTitular.cpf}
                      onChange={v => setFormTitular(p => ({ ...p, cpf: v }))} />
                    <TextInput label="E-mail" type="email" value={formTitular.email ?? ''}
                      onChange={v => setFormTitular(p => ({ ...p, email: v || null }))} />
                    <TextInput label="Telefone" value={formTitular.telefone ?? ''}
                      onChange={v => setFormTitular(p => ({ ...p, telefone: v || null }))} />
                    <TextInput label="Data de nascimento" type="date" value={formTitular.data_nascimento ?? ''}
                      onChange={v => setFormTitular(p => ({ ...p, data_nascimento: v || null }))} />
                  </div>
                </div>

                {showClienteForm && (
                  <div className="mt-4 rounded-xl border border-gray-200 dark:border-gray-800 p-4 bg-gray-50 dark:bg-gray-900/40">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="font-semibold text-sm text-gray-700 dark:text-gray-200">
                        {editingClienteId ? 'Editar Pessoa / Empresa' : 'Cadastro de Pessoa / Empresa'}
                      </h4>
                      <button type="button" onClick={() => {
                        setShowClienteForm(false)
                        setEditingClienteId(null)
                        setFormCliente({ ...EMPTY_CLIENTE_BASE })
                      }} className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">Fechar</button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                      <SelectInput label="Tipo" value={formCliente.tipo_cliente}
                        onChange={v => setFormCliente(p => ({ ...p, tipo_cliente: v as NovoCadastroBase['tipo_cliente'] }))}
                        options={[{ value: 'pessoa_fisica', label: 'Pessoa Física' }, { value: 'pessoa_juridica', label: 'Pessoa Jurídica' }]} />
                      <TextInput label="CPF / CNPJ *" value={formCliente.cpf_cnpj}
                        onChange={v => setFormCliente(p => ({ ...p, cpf_cnpj: v }))} />
                      <TextInput label="Nome / Razão Social *" value={formCliente.nome}
                        onChange={v => setFormCliente(p => ({ ...p, nome: v }))} className="md:col-span-2" />
                      <TextInput label="Nome Fantasia" value={formCliente.nome_fantasia ?? ''}
                        onChange={v => setFormCliente(p => ({ ...p, nome_fantasia: v || null }))} className="md:col-span-2" />
                      <TextInput label="E-mail" type="email" value={formCliente.email ?? ''}
                        onChange={v => setFormCliente(p => ({ ...p, email: v || null }))} />
                      <TextInput label="Telefone" value={formCliente.telefone ?? ''}
                        onChange={v => setFormCliente(p => ({ ...p, telefone: v || null }))} />
                      <TextInput label="CEP" value={formCliente.cep ?? ''}
                        onChange={v => setFormCliente(p => ({ ...p, cep: v || null }))} />
                      <TextInput label="Cidade" value={formCliente.cidade ?? ''}
                        onChange={v => setFormCliente(p => ({ ...p, cidade: v || null }))} />
                      <TextInput label="UF" value={formCliente.uf ?? ''}
                        onChange={v => setFormCliente(p => ({ ...p, uf: v || null }))} />
                      <TextInput label="Inscrição Municipal" value={formCliente.inscricao_municipal ?? ''}
                        onChange={v => setFormCliente(p => ({ ...p, inscricao_municipal: v || null }))} />
                      <TextInput label="Inscrição Estadual" value={formCliente.inscricao_estadual ?? ''}
                        onChange={v => setFormCliente(p => ({ ...p, inscricao_estadual: v || null }))} />
                      <TextInput label="Logradouro" value={formCliente.logradouro ?? ''}
                        onChange={v => setFormCliente(p => ({ ...p, logradouro: v || null }))} className="md:col-span-2" />
                      <TextInput label="Número" value={formCliente.numero ?? ''}
                        onChange={v => setFormCliente(p => ({ ...p, numero: v || null }))} />
                      <TextInput label="Complemento" value={formCliente.complemento ?? ''}
                        onChange={v => setFormCliente(p => ({ ...p, complemento: v || null }))} className="md:col-span-2" />
                      <TextInput label="Bairro" value={formCliente.bairro ?? ''}
                        onChange={v => setFormCliente(p => ({ ...p, bairro: v || null }))} />
                      <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                        <input type="checkbox" checked={formCliente.iss_retido}
                          onChange={e => setFormCliente(p => ({ ...p, iss_retido: e.target.checked }))} />
                        ISS retido
                      </label>
                    </div>
                    <div className="mt-4 flex justify-end gap-2">
                      <button type="button" onClick={() => {
                        setShowClienteForm(false)
                        setEditingClienteId(null)
                        setFormCliente({ ...EMPTY_CLIENTE_BASE })
                      }}
                        className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm">Cancelar</button>
                      <button type="button" onClick={() => void salvarCliente()} disabled={salvandoCliente}
                        className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm disabled:opacity-50">
                        {salvandoCliente ? 'Salvando...' : editingClienteId ? 'Salvar alterações' : 'Salvar cliente'}
                      </button>
                    </div>
                  </div>
                )}

                <FormActions
                  onSave={salvarVendaV2}
                  onCancel={() => setShowFormV(false)}
                  saving={salvandoV}
                  disabled={!formV2.cadastro_base_id || pontosAtivos.length === 0}
                />
              </Panel>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-3">
              <TextInput label="Data inicial" type="date" value={vendaFilters.dataInicial}
                onChange={v => setVendaFilters(p => ({ ...p, dataInicial: v }))} />
              <TextInput label="Data final" type="date" value={vendaFilters.dataFinal}
                onChange={v => setVendaFilters(p => ({ ...p, dataFinal: v }))} />
              <TextInput label="Pedido" value={vendaFilters.pedido}
                onChange={v => setVendaFilters(p => ({ ...p, pedido: v }))} />
              <TextInput label="Protocolo" value={vendaFilters.protocolo}
                onChange={v => setVendaFilters(p => ({ ...p, protocolo: v }))} />
              <TextInput label="Cliente / Documento" value={vendaFilters.cliente}
                onChange={v => setVendaFilters(p => ({ ...p, cliente: v }))} className="xl:col-span-2" />
              <SelectInput label="Status da venda" value={vendaFilters.status}
                onChange={v => setVendaFilters(p => ({ ...p, status: v }))}
                options={[{ value: '', label: 'Todos' }, ...STATUS_VENDA_V2_OPTIONS.map(s => ({ value: s, label: capitalize(s.replace('_', ' ')) }))]} />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => void fetchVendasV2()}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800">
                <Search size={14} /> Atualizar consulta
              </button>
              <button type="button" onClick={() => setVendaFilters(EMPTY_VENDA_FILTERS)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800">
                <X size={14} /> Limpar filtros
              </button>
              <span className="text-xs text-gray-500">Mostrando {vendasFiltradas.length} venda(s) por ordem de compra.</span>
            </div>

            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
              <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[1200px]">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-800/50 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide text-left">
                    {['Ações', 'Data', 'Pedido', 'Protocolo', 'Cliente', 'Documento', 'Produto', 'Emissão', 'Ponto', 'Valor', 'Pagamento', 'Status'].map(h => (
                      <th key={h} className="px-4 py-3">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {loadingV ? (
                    <LoadingRow colSpan={12} />
                  ) : vendasFiltradas.length === 0 ? (
                    <EmptyRow colSpan={12} label="Nenhuma venda encontrada com esses filtros." />
                  ) : vendasFiltradas.map(v => (
                    <tr key={v.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button type="button" title="Editar cliente" onClick={() => abrirEditarCliente(v.cadastro_base_id)}
                            className="p-1.5 rounded-md text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20">
                            <Edit3 size={13} />
                          </button>
                          <button type="button" title="Nova venda para este cliente" onClick={() => prepararNovaVendaParaCliente(v.cadastro_base_id)}
                            className="p-1.5 rounded-md text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20">
                            <PlusCircle size={13} />
                          </button>
                          <button type="button" title="Agendar atendimento" onClick={() => prepararAgendamento(v)}
                            className="p-1.5 rounded-md text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-900/20">
                            <Calendar size={13} />
                          </button>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-500">{new Date(v.created_at).toLocaleDateString('pt-BR')}</td>
                      <td className="px-4 py-3 text-gray-500">{v.pedido_numero ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-500">{v.protocolo_numero ?? '—'}</td>
                      <td className="px-4 py-3 font-medium">
                        {(v.cadastros_base as { nome: string } | null)?.nome ?? v.nome_faturamento ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-500">
                        {(v.cadastros_base as { cpf_cnpj?: string } | null)?.cpf_cnpj ?? v.documento_faturamento ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-500">{v.tipo_produto}</td>
                      <td className="px-4 py-3 text-gray-500">{v.tipo_emissao ? capitalize(v.tipo_emissao.replace('_', ' ')) : '—'}</td>
                      <td className="px-4 py-3 text-gray-500">
                        <span className="flex items-center gap-1">
                          <MapPin size={12} />
                          {(v.pontos_atendimento as { nome: string } | null)?.nome ?? '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-semibold text-green-600 dark:text-green-400">{formatCurrency(v.valor_venda ?? 0)}</td>
                      <td className="px-4 py-3 text-gray-500">
                        {(v.metadata as { forma_pagamento?: string })?.forma_pagamento ?? '—'}
                      </td>
                      <td className="px-4 py-3">
                        <select
                          title="Status da venda"
                          value={v.status_venda}
                          onChange={e => atualizarStatusVendaV2(v.id, e.target.value as StatusVendaCertificado)}
                          className={cn('px-2 py-0.5 rounded-full text-xs font-medium border-0 cursor-pointer focus:outline-none', statusVendaV2Cls(v.status_venda))}>
                          {STATUS_VENDA_V2_OPTIONS.map(s => (
                            <option key={s} value={s}>{capitalize(s.replace('_', ' '))}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          </div>
        )}

        {/* ── AGENDA ─────────────────────────────────────────── */}
        {tab === 'agenda' && (
          <div className="space-y-5">
            <SectionHeader
              title={`Agenda - ${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}`}
              actionLabel="Novo Agendamento"
              onAction={() => setShowFormA(v => !v)}
            />

            {showFormA && (
              <Panel title="Novo Agendamento" onClose={() => setShowFormA(false)}>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <TextInput label="Cliente *" value={formA.cliente} onChange={v => setFormA(p => ({ ...p, cliente: v }))} className="col-span-2" />
                  <TextInput label="Telefone" value={formA.telefone ?? ''} onChange={v => setFormA(p => ({ ...p, telefone: v || null }))} />
                  <SelectInput label="Serviço" value={formA.servico} onChange={v => setFormA(p => ({ ...p, servico: v }))}
                    options={tiposCertificado.map(t => ({ value: t, label: t }))} />
                  <TextInput label="Data e Hora *" type="datetime-local" value={formA.data_hora} onChange={v => setFormA(p => ({ ...p, data_hora: v }))} />
                </div>
                <FormActions onSave={salvarAgendamento} onCancel={() => setShowFormA(false)} saving={salvandoA} />
              </Panel>
            )}

            {loadingA ? (
              <p className="text-gray-400 animate-pulse text-sm">Carregando...</p>
            ) : agenda.length === 0 ? (
              <p className="text-gray-400 text-sm">Nenhum agendamento encontrado.</p>
            ) : (
              <div className="space-y-2">
                {agenda.map(a => {
                  const dt = new Date(a.data_hora)
                  return (
                    <div key={a.id} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 flex items-center gap-4">
                      <div className="w-20 text-center shrink-0">
                        <span className="text-lg font-bold text-blue-600 dark:text-blue-400 block">{dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                        <span className="text-xs text-gray-400">{dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</span>
                      </div>
                      <div className="flex-1">
                        <p className="font-medium text-sm">{a.cliente}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{a.servico}{a.telefone ? ` · ${a.telefone}` : ''}</p>
                      </div>
                      <select
                        title="Status do agendamento"
                        value={a.status}
                        onChange={e => atualizarStatusAgenda(a.id, e.target.value as StatusAgendamento)}
                        className={cn('px-2 py-0.5 rounded-full text-xs font-medium border-0 cursor-pointer focus:outline-none', statusAgendaCls(a.status))}>
                        {(['confirmado', 'aguardando', 'cancelado', 'realizado'] as StatusAgendamento[]).map(s => (
                          <option key={s} value={s}>{capitalize(s)}</option>
                        ))}
                      </select>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ── CERTIFICADOS ───────────────────────────────────── */}
        {tab === 'certificados' && (
          <CatalogSection title="Estoque de Certificados" actionLabel="Novo Certificado" onAction={abrirNovoCertificado} loading={loadingCatalogo} error={catalogoErro}>
            {showFormCert && (
              <Panel title={editingCertId ? 'Editar Certificado' : 'Novo Certificado'} onClose={() => setShowFormCert(false)}>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <TextInput label="Tipo *" value={formCert.tipo} onChange={v => setFormCert(p => ({ ...p, tipo: v }))} />
                  <NumberInput label="Estoque" value={formCert.estoque} onChange={v => setFormCert(p => ({ ...p, estoque: v }))} step={1} />
                  <TextInput label="Validade *" value={formCert.validade} onChange={v => setFormCert(p => ({ ...p, validade: v }))} />
                  <ActiveSelect value={formCert.ativo} onChange={v => setFormCert(p => ({ ...p, ativo: v }))} />
                </div>
                <FormActions onSave={salvarCertificado} onCancel={() => setShowFormCert(false)} saving={salvandoCatalogo} />
              </Panel>
            )}

            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {certificados.length === 0 ? (
                <EmptyBlock label="Nenhum certificado cadastrado." />
              ) : certificados.map(c => {
                const precoRef = precos.find(p => p.certificado_id === c.id && p.canal === 'balcao' && p.ativo) ?? precos.find(p => p.certificado_id === c.id && p.ativo)
                return (
                  <div key={c.id} className={cn('bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5', !c.ativo && 'opacity-60')}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">{c.tipo}</p>
                        <p className="text-3xl font-bold mt-1">{c.estoque}</p>
                        <p className="text-xs text-gray-400 mt-1">em estoque</p>
                      </div>
                      <RowActions active={c.ativo} onEdit={() => editarCertificado(c)} onToggle={() => toggleCertificado(c)} />
                    </div>
                    <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between">
                      <span className="text-sm font-semibold text-green-600 dark:text-green-400">{precoRef ? formatCurrency(precoRef.valor) : 'Sem preço'}</span>
                      <span className="text-xs text-gray-400">{c.validade}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </CatalogSection>
        )}

        {/* ── PREÇOS ─────────────────────────────────────────── */}
        {tab === 'precos' && (
          <CatalogSection title="Tabela de Preços por Canal" actionLabel="Novo Preço" onAction={abrirNovoPreco} loading={loadingCatalogo} error={catalogoErro}>
            {showFormPreco && (
              <Panel title={editingPrecoId ? 'Editar Preço' : 'Novo Preço'} onClose={() => setShowFormPreco(false)}>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <SelectInput label="Certificado *" value={formPreco.certificado_id}
                    onChange={v => setFormPreco(p => ({ ...p, certificado_id: v }))}
                    options={certificados.map(c => ({ value: c.id, label: c.tipo }))} />
                  <SelectInput label="Canal" value={formPreco.canal}
                    onChange={v => setFormPreco(p => ({ ...p, canal: v as CanalVenda }))}
                    options={(Object.entries(CANAL_LABEL) as [CanalVenda, string][]).map(([value, label]) => ({ value, label }))} />
                  <NumberInput label="Valor (R$) *" value={formPreco.valor} onChange={v => setFormPreco(p => ({ ...p, valor: v }))} />
                  <ActiveSelect value={formPreco.ativo} onChange={v => setFormPreco(p => ({ ...p, ativo: v }))} />
                </div>
                <FormActions onSave={salvarPreco} onCancel={() => setShowFormPreco(false)} saving={salvandoCatalogo} />
              </Panel>
            )}

            <DataTable headers={['Produto', 'Canal', 'Valor', 'Status', 'Ações']}>
              {precos.length === 0 ? (
                <EmptyRow colSpan={5} label="Nenhum preço cadastrado." />
              ) : precos.map(p => (
                <tr key={p.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                  <td className="px-5 py-3 font-medium">{certificadoById.get(p.certificado_id)?.tipo ?? 'Certificado removido'}</td>
                  <td className="px-5 py-3"><CanalBadge canal={p.canal} /></td>
                  <td className="px-5 py-3 text-green-600 dark:text-green-400 font-semibold">{formatCurrency(p.valor)}</td>
                  <td className="px-5 py-3"><StatusPill active={p.ativo} /></td>
                  <td className="px-5 py-3"><RowActions active={p.ativo} onEdit={() => editarPreco(p)} onToggle={() => togglePreco(p)} /></td>
                </tr>
              ))}
            </DataTable>
          </CatalogSection>
        )}

        {/* ── COMISSÕES ──────────────────────────────────────── */}
        {tab === 'comissoes' && (
          <CatalogSection title="Faixas de Comissão" actionLabel="Nova Faixa" onAction={abrirNovaComissao} loading={loadingCatalogo} error={catalogoErro}>
            {showFormComissao && (
              <Panel title={editingComissaoId ? 'Editar Faixa' : 'Nova Faixa'} onClose={() => setShowFormComissao(false)}>
                <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
                  <TextInput label="Faixa *" value={formComissao.faixa} onChange={v => setFormComissao(p => ({ ...p, faixa: v }))} className="md:col-span-2" />
                  <NumberInput label="Mín." value={formComissao.min_emissoes} onChange={v => setFormComissao(p => ({ ...p, min_emissoes: v }))} step={1} />
                  <NumberInput label="Máx." value={formComissao.max_emissoes ?? 0} onChange={v => setFormComissao(p => ({ ...p, max_emissoes: v || null }))} step={1} />
                  <NumberInput label="% Comissão" value={formComissao.percentual} onChange={v => setFormComissao(p => ({ ...p, percentual: v }))} />
                  <ActiveSelect value={formComissao.ativo} onChange={v => setFormComissao(p => ({ ...p, ativo: v }))} />
                  <NumberInput label="Valor ex. (R$)" value={formComissao.valor_exemplo ?? 0} onChange={v => setFormComissao(p => ({ ...p, valor_exemplo: v || null }))} />
                  <NumberInput label="Ordem" value={formComissao.ordem} onChange={v => setFormComissao(p => ({ ...p, ordem: v }))} step={1} />
                </div>
                <FormActions onSave={salvarComissao} onCancel={() => setShowFormComissao(false)} saving={salvandoCatalogo} />
              </Panel>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {comissoes.length === 0 ? (
                <EmptyBlock label="Nenhuma faixa cadastrada." />
              ) : comissoes.map(c => (
                <div key={c.id} className={cn('bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5', !c.ativo && 'opacity-60')}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs text-gray-500 dark:text-gray-400">{c.faixa}</p>
                      <p className="text-4xl font-bold text-blue-600 dark:text-blue-400 mt-2">{Number(c.percentual).toLocaleString('pt-BR')}%</p>
                    </div>
                    <RowActions active={c.ativo} onEdit={() => editarComissao(c)} onToggle={() => toggleComissao(c)} />
                  </div>
                  <p className="text-xs text-gray-400 mt-2">{c.valor_exemplo ? `${formatCurrency(c.valor_exemplo)}/cert.` : 'Sem valor exemplo'}</p>
                </div>
              ))}
            </div>
          </CatalogSection>
        )}

        {/* ── PAGAMENTO ──────────────────────────────────────── */}
        {tab === 'pagamento' && (
          <CatalogSection title="Formas de Pagamento Aceitas" actionLabel="Nova Forma" onAction={abrirNovoPagamento} loading={loadingCatalogo} error={catalogoErro}>
            {showFormPagamento && (
              <Panel title={editingPagamentoId ? 'Editar Forma de Pagamento' : 'Nova Forma de Pagamento'} onClose={() => setShowFormPagamento(false)}>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <TextInput label="Nome *" value={formPagamento.nome} onChange={v => setFormPagamento(p => ({ ...p, nome: v }))} />
                  <NumberInput label="Ordem" value={formPagamento.ordem} onChange={v => setFormPagamento(p => ({ ...p, ordem: v }))} step={1} />
                  <ActiveSelect value={formPagamento.ativo} onChange={v => setFormPagamento(p => ({ ...p, ativo: v }))} />
                </div>
                <FormActions onSave={salvarPagamento} onCancel={() => setShowFormPagamento(false)} saving={salvandoCatalogo} />
              </Panel>
            )}

            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {pagamentos.length === 0 ? (
                <EmptyBlock label="Nenhuma forma cadastrada." />
              ) : pagamentos.map(p => (
                <div key={p.id} className={cn('bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 flex items-center gap-3', !p.ativo && 'opacity-60')}>
                  <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                    <CreditCard size={16} className="text-blue-600 dark:text-blue-400" />
                  </div>
                  <span className="text-sm font-medium flex-1 min-w-0 truncate">{p.nome}</span>
                  <RowActions active={p.ativo} onEdit={() => editarPagamento(p)} onToggle={() => togglePagamento(p)} />
                </div>
              ))}
            </div>
          </CatalogSection>
        )}

      </div>
    </div>
  )
}

// ── shared UI components ───────────────────────────────────────

function SectionHeader({ title, actionLabel, onAction }: { title: string; actionLabel: string; onAction: () => void }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <h2 className="font-semibold text-gray-800 dark:text-gray-200">{title}</h2>
      <button type="button" onClick={onAction}
        className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 transition-colors">
        <PlusCircle size={14} /> {actionLabel}
      </button>
    </div>
  )
}

function CatalogSection({ title, actionLabel, onAction, loading, error, children }: {
  title: string; actionLabel: string; onAction: () => void; loading: boolean; error: string | null; children: React.ReactNode
}) {
  if (loading) return <div className="flex items-center gap-2 text-gray-400 text-sm"><Loader2 size={16} className="animate-spin" /> Carregando catálogo...</div>

  if (error) {
    return (
      <div className="space-y-4">
        <SectionHeader title={title} actionLabel={actionLabel} onAction={onAction} />
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-lg p-4 text-sm">
          Erro ao carregar catálogo comercial: {error}. Execute o SQL em <strong>sql/commercial_schema.sql</strong> no Supabase.
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <SectionHeader title={title} actionLabel={actionLabel} onAction={onAction} />
      {children}
    </div>
  )
}

function Panel({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">{title}</h3>
        <button type="button" title="Fechar" onClick={onClose}><X size={16} className="text-gray-400" /></button>
      </div>
      {children}
    </div>
  )
}

function FormActions({ onSave, onCancel, saving, disabled = false }: {
  onSave: () => void; onCancel: () => void; saving: boolean; disabled?: boolean
}) {
  return (
    <div className="flex gap-2 mt-4">
      <button type="button" onClick={onSave} disabled={saving || disabled}
        className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
        {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
        {saving ? 'Salvando...' : 'Salvar'}
      </button>
      <button type="button" onClick={onCancel} className="px-4 py-2 text-sm text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg">Cancelar</button>
    </div>
  )
}

function TextInput({ label, value, onChange, type = 'text', className }: {
  label: string; value: string; onChange: (value: string) => void; type?: string; className?: string
}) {
  return (
    <label className={cn('flex flex-col gap-1', className)}>
      <span className="text-xs text-gray-500">{label}</span>
      <input type={type} value={value} onChange={e => onChange(e.target.value)}
        className="border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500" />
    </label>
  )
}

function NumberInput({ label, value, onChange, step = 0.01 }: {
  label: string; value: number; onChange: (value: number) => void; step?: number
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-gray-500">{label}</span>
      <input type="number" min="0" step={step} value={value || ''} onChange={e => onChange(parseFloat(e.target.value) || 0)}
        className="border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500" />
    </label>
  )
}

function SelectInput({ label, value, onChange, options }: {
  label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[]
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-gray-500">{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500">
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  )
}

function ActiveSelect({ value, onChange }: { value: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-gray-500">Status</span>
      <select value={value ? 'ativo' : 'inativo'} onChange={e => onChange(e.target.value === 'ativo')}
        className="border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500">
        <option value="ativo">Ativo</option>
        <option value="inativo">Inativo</option>
      </select>
    </label>
  )
}

function DataTable({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 dark:bg-gray-800/50 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide text-left">
            {headers.map(h => <th key={h} className="px-5 py-3">{h}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">{children}</tbody>
      </table>
    </div>
  )
}

function RowActions({ active, onEdit, onToggle }: { active: boolean; onEdit: () => void; onToggle: () => void }) {
  return (
    <div className="flex items-center gap-1 shrink-0">
      <button type="button" title="Editar" onClick={onEdit}
        className="w-8 h-8 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-700 dark:hover:text-gray-200 flex items-center justify-center transition-colors">
        <Edit3 size={14} />
      </button>
      <button type="button" title={active ? 'Desativar' : 'Ativar'} onClick={onToggle}
        className={cn('w-8 h-8 rounded-lg flex items-center justify-center transition-colors',
          active ? 'text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20' : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800')}>
        {active ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
      </button>
    </div>
  )
}

function StatusPill({ active }: { active: boolean }) {
  return (
    <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium',
      active ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400')}>
      {active ? 'Ativo' : 'Inativo'}
    </span>
  )
}

function LoadingRow({ colSpan }: { colSpan: number }) {
  return <tr><td colSpan={colSpan} className="px-5 py-8 text-center text-gray-400 animate-pulse">Carregando...</td></tr>
}

function EmptyRow({ colSpan, label }: { colSpan: number; label: string }) {
  return <tr><td colSpan={colSpan} className="px-5 py-8 text-center text-gray-400">{label}</td></tr>
}

function EmptyBlock({ label }: { label: string }) {
  return <div className="col-span-full text-center py-10 text-gray-400 text-sm">{label}</div>
}

function CanalBadge({ canal }: { canal: CanalVenda }) {
  const colors: Record<CanalVenda, string> = {
    balcao:       'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    ecommerce:    'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
    prepago:      'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
    voucher:      'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    link_externo: 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400',
  }
  return <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', colors[canal])}>{CANAL_LABEL[canal]}</span>
}

function statusVendaV2Cls(s: StatusVendaCertificado) {
  const m: Record<StatusVendaCertificado, string> = {
    rascunho:     'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
    vendido:      'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    agendado:     'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    em_validacao: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
    emitido:      'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400',
    cancelado:    'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  }
  return m[s]
}

function statusAgendaCls(s: StatusAgendamento) {
  const m: Record<StatusAgendamento, string> = {
    confirmado: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    aguardando: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
    realizado:  'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    cancelado:  'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  }
  return m[s]
}

function formatCurrency(value: number) {
  return Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}
