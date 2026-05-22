import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { cn } from '@/lib/utils'
import {
  AlertCircle,
  Bell,
  Calendar,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  CreditCard,
  Download,
  Edit3,
  FileText,
  List,
  Loader2,
  MapPin,
  PlusCircle,
  Receipt,
  RefreshCcw,
  Search,
  ShoppingBag,
  Tag,
  ToggleLeft,
  ToggleRight,
  Trash2,
  TrendingUp,
  Unlock,
  Upload,
  UserCheck,
  X,
  XCircle,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type {
  Agendamento,
  Certificado,
  FaixaComissao,
  FormaPagamento,
  NovaFaixaComissao,
  NovaFormaPagamento,
  NovoAgendamento,
  NovoCertificado,
  StatusAgendamento,
  CadastroBase,
  NovoCadastroBase,
  PontoAtendimento,
  StatusVendaCertificado,
  VendaCertificado,
  TabelaPreco,
  NovaTabelaPreco,
  TabelaPrecoItem,
  NovaTabelaPrecoItem,
  TabelaPrecoParticipante,
  NovaTabelaPrecoParticipante,
  TipoParticipanteTabelaPreco,
  TipoParceiro,
  PerfilAcesso,
} from '@/types'

// ── local types ────────────────────────────────────────────────
type VendaRow = VendaCertificado & {
  cadastros_base: { nome: string; cpf_cnpj: string } | null
  pontos_atendimento: { nome: string } | null
}

type LocalFormVenda = {
  cadastro_base_id: string
  empresa_id: string | null
  tipo_venda: string             // Balcão, Ecommerce, etc.
  tabela_preco_id: string
  tabela_preco_item_id: string
  certificado_id: string
  tipo_emissao: string
  forma_pagamento: string
  valor_venda: number
  data_vencimento: string
  observacoes: string | null
  contador_id: string | null     // parceiro que indicou
  ponto_atendimento_id: string
}

type ProtocoloForm = {
  cpf: string
  data_nascimento: string
  possui_cnh: boolean
  nome: string
  email: string
  ddd: string
  telefone: string
  cep: string
  logradouro: string
  numero: string
  complemento: string
  bairro: string
  cidade: string
  uf: string
  ibge: string
  cei: string
  caepf: string
  nis: string
  codigo_voucher: string
}

type ParceiroSimples = {
  id: string
  cpf_cnpj: string | null
  nome: string
  nome_fantasia: string | null
  tipo_parceiro: TipoParceiro | null
}

// ── tab definition ─────────────────────────────────────────────
type Tab = 'vendas' | 'agenda' | 'certificados' | 'tabelas' | 'comissoes' | 'pagamento'

const TABS: { id: Tab; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { id: 'vendas',       label: 'Lançar Vendas',    icon: TrendingUp  },
  { id: 'agenda',       label: 'Agenda',           icon: Calendar    },
  { id: 'certificados', label: 'Certificados',     icon: ShoppingBag },
  { id: 'tabelas',      label: 'Tabelas de Preço', icon: Tag         },
  { id: 'comissoes',    label: 'Faixas Comissão',  icon: TrendingUp  },
  { id: 'pagamento',    label: 'Forma Pagamento',  icon: CreditCard  },
]

const FALLBACK_CERTS = ['e-CPF A1', 'e-CPF A3', 'e-CNPJ A1', 'e-CNPJ A3', 'NF-e A1', 'SSL']

const STATUS_VENDA_LABEL: Record<StatusVendaCertificado, string> = {
  rascunho:     'Não Confirmada',
  vendido:      'Vendida',
  agendado:     'Agendada',
  em_validacao: 'Em Validação',
  emitido:      'Emitida',
  cancelado:    'Cancelada',
}

const TIPO_VENDA_OPTIONS = [
  { value: 'balcao',       label: 'Balcão'       },
  { value: 'ecommerce',    label: 'E-Commerce'   },
  { value: 'prepago',      label: 'Pré-pago'     },
  { value: 'voucher',      label: 'Voucher'       },
  { value: 'link_externo', label: 'Link Externo' },
]

const TIPO_PARCEIRO_OPTS: { value: TipoParceiro; label: string }[] = [
  { value: 'ar',               label: 'AR'               },
  { value: 'pa_controle_total', label: 'PA Controle Total' },
  { value: 'pa_emissor',       label: 'PA Emissor'       },
  { value: 'contador',         label: 'Contador'         },
  { value: 'vendedor',         label: 'Vendedor'         },
  { value: 'gestor',           label: 'Gestor'           },
  { value: 'ecommerce',        label: 'E-Commerce'       },
]

const PERFIL_OPTS: { value: PerfilAcesso; label: string }[] = [
  { value: 'admin',           label: 'Admin'           },
  { value: 'vendedor',        label: 'Vendedor'        },
  { value: 'agente_registro', label: 'Agente Registro' },
  { value: 'usuario',         label: 'Usuário'         },
]

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
  tipo_venda: 'balcao',
  tabela_preco_id: '',
  tabela_preco_item_id: '',
  certificado_id: '',
  tipo_emissao: 'presencial',
  forma_pagamento: '',
  valor_venda: 0,
  data_vencimento: '',
  observacoes: null,
  contador_id: null,
  ponto_atendimento_id: '',
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

const EMPTY_CERTIFICADO: NovoCertificado = {
  codigo: null, tipo: '', descricao: null, validade: '1 Ano',
  modelo: null, categoria: null, tipo_emissao_padrao: null, descricao_produto: null,
  produto_vinculado_ac: null, preco_venda: 0, valor_custo_ac: 0, valor_custo: 0,
  agrupador: null, hash: null, estoque: 0, ativo: true,
}

const EMPTY_TABELA: NovaTabelaPreco = {
  nome: '', descricao: null, codigo_voucher: null,
  max_desconto_percentual: 0, max_desconto_valor: 0,
  comissao_venda_pct: 0, comissao_gestor_pct: 0, comissao_gestor_valor: 0,
  ativo: true,
}

const EMPTY_ITEM: NovaTabelaPrecoItem = {
  tabela_preco_id: '', certificado_id: '', valor: 0, valor_custo: 0, valor_repasse: 0, link_safeweb: null, ativo: true,
}

const EMPTY_PARTICIPANTE: NovaTabelaPrecoParticipante = {
  tabela_preco_id: '', tipo_participante: 'tipo_parceiro',
  parceiro_id: null, tipo_parceiro: null, perfil: null,
}

const EMPTY_PROTOCOLO: ProtocoloForm = {
  cpf: '', data_nascimento: '', possui_cnh: true,
  nome: '', email: '', ddd: '', telefone: '',
  cep: '', logradouro: '', numero: '', complemento: '',
  bairro: '', cidade: '', uf: '', ibge: '',
  cei: '', caepf: '', nis: '', codigo_voucher: '',
}

const EMPTY_COMISSAO: NovaFaixaComissao = {
  faixa: '', min_emissoes: 1, max_emissoes: null,
  percentual: 0, valor_exemplo: null, ordem: 1, ativo: true,
}

const EMPTY_PAGAMENTO: NovaFormaPagamento = { nome: '', ordem: 1, ativo: true }

type VendaFilters = {
  filtroData:   string
  dataInicial:  string
  dataFinal:    string
  pedido:       string
  protocolo:    string
  cliente:      string
  status:       string
  pa:           string
}

const EMPTY_VENDA_FILTERS: VendaFilters = {
  filtroData:   'geral',
  dataInicial:  '',
  dataFinal:    '',
  pedido:       '',
  protocolo:    '',
  cliente:      '',
  status:       '',
  pa:           '',
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
  const [contadorSearch, setContadorSearch] = useState('')
  const [showClienteForm, setShowClienteForm] = useState(false)
  const [editingClienteId, setEditingClienteId] = useState<string | null>(null)
  const [clienteSearch, setClienteSearch]     = useState('')
  const [formCliente, setFormCliente]   = useState<NovoCadastroBase>(EMPTY_CLIENTE_BASE)
  const [salvandoV, setSalvandoV]       = useState(false)
  const [salvandoCliente, setSalvandoCliente] = useState(false)
  const [vendaFilters, setVendaFilters] = useState<VendaFilters>(EMPTY_VENDA_FILTERS)
  const [selectedIds, setSelectedIds]           = useState<Set<string>>(new Set())
  const [itensPorPagina, setItensPorPagina]     = useState(50)
  const [paginaAtual, setPaginaAtual]           = useState(1)

  // ── agenda state ─────────────────────────────────────────────
  const [agenda, setAgenda]             = useState<Agendamento[]>([])
  const [loadingA, setLoadingA]         = useState(true)
  const [showFormA, setShowFormA]       = useState(false)
  const [formA, setFormA]               = useState<NovoAgendamento>(EMPTY_AGENDA)
  const [salvandoA, setSalvandoA]       = useState(false)

  // ── catalog state ────────────────────────────────────────────
  const [certificados, setCertificados]       = useState<Certificado[]>([])
  const [tabelasPreco, setTabelasPreco]       = useState<TabelaPreco[]>([])
  const [tabelaItens, setTabelaItens]         = useState<TabelaPrecoItem[]>([])
  const [tabelaParticipantes, setTabelaParticipantes] = useState<TabelaPrecoParticipante[]>([])
  const [parceiros, setParceiros]             = useState<ParceiroSimples[]>([])
  const [comissoes, setComissoes]             = useState<FaixaComissao[]>([])
  const [pagamentos, setPagamentos]           = useState<FormaPagamento[]>([])
  const [loadingCatalogo, setLoadingCatalogo] = useState(true)
  const [catalogoErro, setCatalogoErro]       = useState<string | null>(null)
  const [salvandoCatalogo, setSalvandoCatalogo] = useState(false)
  // certificados form
  const [showFormCert, setShowFormCert]         = useState(false)
  const [editingCertId, setEditingCertId]       = useState<string | null>(null)
  const [formCert, setFormCert]                 = useState<NovoCertificado>(EMPTY_CERTIFICADO)
  const [importando, setImportando]             = useState(false)
  const importInputRef                          = useRef<HTMLInputElement>(null)
  const importItensRef                          = useRef<HTMLInputElement>(null)
  // tabelas form
  const [selectedTabelaId, setSelectedTabelaId]   = useState<string | null>(null)
  const [showFormTabela, setShowFormTabela]         = useState(false)
  const [editingTabelaId, setEditingTabelaId]       = useState<string | null>(null)
  const [formTabela, setFormTabela]                 = useState<NovaTabelaPreco>(EMPTY_TABELA)
  const [showFormItem, setShowFormItem]             = useState(false)
  const [editingItemId, setEditingItemId]           = useState<string | null>(null)
  const [formItem, setFormItem]                     = useState<NovaTabelaPrecoItem>(EMPTY_ITEM)
  const [showFormParticipante, setShowFormParticipante] = useState(false)
  const [formParticipante, setFormParticipante]         = useState<NovaTabelaPrecoParticipante>(EMPTY_PARTICIPANTE)
  // comissoes / pagamentos form
  const [showFormComissao, setShowFormComissao]   = useState(false)
  const [editingComissaoId, setEditingComissaoId] = useState<string | null>(null)
  const [formComissao, setFormComissao]           = useState<NovaFaixaComissao>(EMPTY_COMISSAO)
  const [showFormPagamento, setShowFormPagamento]   = useState(false)
  const [editingPagamentoId, setEditingPagamentoId] = useState<string | null>(null)
  const [formPagamento, setFormPagamento]           = useState<NovaFormaPagamento>(EMPTY_PAGAMENTO)
  // protocolo modal
  const [showProtocolo, setShowProtocolo]         = useState(false)
  const [protocoloVenda, setProtocoloVenda]       = useState<VendaRow | null>(null)
  const [protocoloStep, setProtocoloStep]         = useState<'validate' | 'form'>('validate')
  const [formProtocolo, setFormProtocolo]         = useState<ProtocoloForm>(EMPTY_PROTOCOLO)
  const [validandoProtocolo, setValidandoProtocolo] = useState(false)
  const [emitindoProtocolo, setEmitindoProtocolo]   = useState(false)

  // ── derived ──────────────────────────────────────────────────
  const certificadosAtivos = useMemo(() => certificados.filter(c => c.ativo), [certificados])
  const pagamentosAtivos   = useMemo(() => pagamentos.filter(p => p.ativo), [pagamentos])
  const formasPagamento    = pagamentosAtivos.length > 0 ? pagamentosAtivos.map(p => p.nome) : ['PIX', 'Cartão de Crédito', 'Dinheiro', 'Boleto']
  const certificadoById    = useMemo(() => new Map(certificados.map(c => [c.id, c])), [certificados])
  const tabelasAtivas      = useMemo(() => tabelasPreco.filter(t => t.ativo), [tabelasPreco])
  const pontosAtivos       = useMemo(() => pontos.filter(p => p.status === 'ativo'), [pontos])
  const tabelaById         = useMemo(() => new Map(tabelasPreco.map(t => [t.id, t])), [tabelasPreco])

  // itens da tabela selecionada no form de venda
  const itensTabela = useMemo(() =>
    tabelaItens.filter(i => i.tabela_preco_id === formV2.tabela_preco_id && i.ativo),
    [tabelaItens, formV2.tabela_preco_id]
  )

  // certificados disponíveis na tabela selecionada
  const certsDaTabela = useMemo(() =>
    itensTabela.map(item => {
      const cert = certificadoById.get(item.certificado_id)
      return cert ? { item, cert } : null
    }).filter(Boolean) as { item: TabelaPrecoItem; cert: Certificado }[],
    [itensTabela, certificadoById]
  )

  // parceiros filtrados para busca de contador
  const parceirosParaContador = useMemo(() => {
    const q = contadorSearch.toLowerCase()
    return q.length < 2 ? [] : parceiros.filter(p =>
      p.nome.toLowerCase().includes(q) ||
      (p.cpf_cnpj ?? '').includes(q) ||
      (p.nome_fantasia ?? '').toLowerCase().includes(q)
    ).slice(0, 10)
  }, [parceiros, contadorSearch])

  function validadeEmMeses(val: string): number | null {
    const anos = val.match(/(\d+)\s*[Aa]no/)
    if (anos) return parseInt(anos[1]) * 12
    const meses = val.match(/(\d+)\s*[Mm](?:ês|es)?/)
    if (meses) return parseInt(meses[1])
    return null
  }

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
      const dataFinalOk   = !vendaFilters.dataFinal   || criado <= new Date(`${vendaFilters.dataFinal}T23:59:59`)
      const pedido    = (v.pedido_numero ?? '').toLowerCase()
      const protocolo = (v.protocolo_numero ?? '').toLowerCase()
      const cliente   = ((v.cadastros_base as { nome?: string } | null)?.nome ?? v.nome_faturamento ?? '').toLowerCase()
      const documento = ((v.cadastros_base as { cpf_cnpj?: string } | null)?.cpf_cnpj ?? v.documento_faturamento ?? '').toLowerCase()
      const paNome    = ((v.pontos_atendimento as { nome?: string } | null)?.nome ?? '').toLowerCase()
      const termoCliente = vendaFilters.cliente.trim().toLowerCase()
      return dataInicialOk
        && dataFinalOk
        && (!vendaFilters.pedido    || pedido.includes(vendaFilters.pedido.trim().toLowerCase()))
        && (!vendaFilters.protocolo || protocolo.includes(vendaFilters.protocolo.trim().toLowerCase()))
        && (!termoCliente           || cliente.includes(termoCliente) || documento.includes(termoCliente))
        && (!vendaFilters.status    || v.status_venda === vendaFilters.status)
        && (!vendaFilters.pa        || paNome.includes(vendaFilters.pa.trim().toLowerCase()))
    })
  }, [vendasV2, vendaFilters])

  const totalFiltrado  = useMemo(() => vendasFiltradas.reduce((s, v) => s + (v.valor_venda ?? 0), 0), [vendasFiltradas])
  const totalPaginas   = Math.max(1, Math.ceil(vendasFiltradas.length / itensPorPagina))
  const vendasPaginadas = useMemo(() => {
    const start = (paginaAtual - 1) * itensPorPagina
    return vendasFiltradas.slice(start, start + itensPorPagina)
  }, [vendasFiltradas, paginaAtual, itensPorPagina])

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
    const [certsRes, tabelasRes, itensRes, partRes, comissoesRes, pagamentosRes, parcRes] = await Promise.all([
      supabase.from('certificados').select('*').order('tipo', { ascending: true }),
      supabase.from('tabelas_preco').select('*').order('nome', { ascending: true }),
      supabase.from('tabelas_preco_itens').select('*').order('created_at', { ascending: true }),
      supabase.from('tabelas_preco_participantes').select('*'),
      supabase.from('faixas_comissao').select('*').order('ordem', { ascending: true }),
      supabase.from('formas_pagamento').select('*').order('ordem', { ascending: true }),
      supabase.from('parceiros').select('id, cpf_cnpj, nome, nome_fantasia, tipo_parceiro').eq('status', 'ativo').order('nome'),
    ])
    const error = certsRes.error ?? tabelasRes.error ?? comissoesRes.error ?? pagamentosRes.error
    if (error) { setCatalogoErro(error.message); setLoadingCatalogo(false); return }
    setCertificados((certsRes.data ?? []) as Certificado[])
    setTabelasPreco((tabelasRes.data ?? []) as TabelaPreco[])
    setTabelaItens((itensRes.data ?? []) as TabelaPrecoItem[])
    setTabelaParticipantes((partRes.data ?? []) as TabelaPrecoParticipante[])
    setComissoes((comissoesRes.data ?? []) as FaixaComissao[])
    setPagamentos((pagamentosRes.data ?? []) as FormaPagamento[])
    setParceiros((parcRes.data ?? []) as ParceiroSimples[])
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

  // pre-fill protocolo CPF when client changes
  useEffect(() => {
    if (clienteSelecionado) {
      setFormProtocolo(p => ({ ...p, cpf: clienteSelecionado.cpf_cnpj }))
    }
  }, [clienteSelecionado])

  // ── V2 mutations ─────────────────────────────────────────────
  async function salvarVendaV2() {
    if (!formV2.cadastro_base_id) { alert('Selecione um cliente.'); return }
    if (!formV2.tabela_preco_id) { alert('Selecione uma tabela de venda.'); return }
    if (!formV2.certificado_id) { alert('Selecione o certificado.'); return }
    if (formV2.valor_venda <= 0) { alert('Informe o valor da venda.'); return }
    if (!currentUserId) { alert('Usuário não autenticado.'); return }
    setSalvandoV(true)

    const cli = clienteSelecionado
    const cert = certificadoById.get(formV2.certificado_id)
    const tabela = tabelaById.get(formV2.tabela_preco_id)

    const payload = {
      cadastro_base_id:        formV2.cadastro_base_id,
      empresa_id:              formV2.empresa_id,
      titular_id:              null,
      certificado_id:          formV2.certificado_id || null,
      tabela_preco_id:         formV2.tabela_preco_id || null,
      tabela_preco_item_id:    formV2.tabela_preco_item_id || null,
      tipo_produto:            cert?.tipo ?? '',
      tipo_venda:              formV2.tipo_venda,
      tipo_emissao:            formV2.tipo_emissao,
      tabela_preco:            tabela?.nome ?? null,
      forma_pagamento_id:      null,
      valor_venda:             formV2.valor_venda,
      valor_custo:             null,
      pago:                    false,
      data_pagamento:          null,
      data_vencimento:         formV2.data_vencimento || null,
      contador_id:             formV2.contador_id || null,
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
      ponto_atendimento_id:    (formV2.ponto_atendimento_id || pontosAtivos[0]?.id) ?? '',
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
      status_venda:            'vendido' as const,
      observacoes:             formV2.observacoes,
      metadata:                { forma_pagamento: formV2.forma_pagamento },
    }

    const { error } = await supabase.from('vendas_certificados').insert([payload])
    setSalvandoV(false)
    if (error) { alert('Erro: ' + error.message); return }
    setShowFormV(false)
    setFormV2({ ...EMPTY_VENDA_V2, ponto_atendimento_id: pontosAtivos[0]?.id ?? '' })
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
    setFormA({ ...EMPTY_AGENDA, servico: certificados[0]?.tipo ?? 'e-CPF A1' })
    void fetchAgenda()
  }

  async function atualizarStatusAgenda(id: string, status: StatusAgendamento) {
    await supabase.from('agendamentos').update({ status }).eq('id', id)
    setAgenda(prev => prev.map(a => a.id === id ? { ...a, status } : a))
  }

  // ── catalog mutations ────────────────────────────────────────
  function abrirNovoCertificado() { setEditingCertId(null); setFormCert({ ...EMPTY_CERTIFICADO }); setShowFormCert(true) }

  function editarCertificado(c: Certificado) {
    setEditingCertId(c.id)
    setFormCert({
      codigo: c.codigo, tipo: c.tipo, descricao: c.descricao, validade: c.validade,
      modelo: c.modelo, categoria: c.categoria, tipo_emissao_padrao: c.tipo_emissao_padrao,
      descricao_produto: c.descricao_produto, produto_vinculado_ac: c.produto_vinculado_ac,
      preco_venda: c.preco_venda, valor_custo_ac: c.valor_custo_ac, valor_custo: c.valor_custo,
      agrupador: c.agrupador, hash: c.hash, estoque: c.estoque, ativo: c.ativo,
    })
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

  async function importarPlanilha(file: File) {
    setImportando(true)
    try {
      const text = await file.text()
      const delim = text.includes('\t') ? '\t' : ','
      const lines = text.trim().split('\n').filter(l => l.trim())
      if (lines.length < 2) { alert('Planilha sem dados.'); return }
      const normalize = (h: string) =>
        h.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '_').replace(/^"|"$/g, '')
      const headers = lines[0].split(delim).map(h => normalize(h.trim()))
      const rows = lines.slice(1).map(line => {
        const vals = line.split(delim).map(v => v.trim().replace(/^"|"$/g, ''))
        const row: Record<string, string> = {}
        headers.forEach((h, i) => { row[h] = vals[i] ?? '' })
        return row
      })
      const parseNum = (v: string) => parseFloat((v ?? '').replace(/[R$\s]/g, '').replace(',', '.')) || 0
      const records = rows.filter(r => Object.values(r).some(v => v)).map(row => ({
        codigo:               row['codigo'] ? parseInt(row['codigo']) : null,
        tipo:                 row['nome'] || '',
        descricao:            row['descricao'] || null,
        validade:             row['validade'] || '',
        modelo:               row['modelo'] || null,
        categoria:            row['tipo'] || null,
        tipo_emissao_padrao:  row['tipo_emissao'] || null,
        descricao_produto:    row['descricao_do_produto'] || row['descricao_produto'] || null,
        produto_vinculado_ac: row['produto_vinculado_na_ac'] || row['produto_vinculado_ac'] || row['produto_ac'] || null,
        preco_venda:          parseNum(row['preco_de_venda'] ?? row['preco_venda'] ?? row['preco'] ?? '0'),
        valor_custo_ac:       parseNum(row['valor_custo_ac'] ?? row['custo_ac'] ?? '0'),
        valor_custo:          parseNum(row['valor_custo'] ?? row['custo'] ?? '0'),
        agrupador:            row['agrupador'] || row['agrupador_utilizado_no_e_commerce'] || null,
        hash:                 row['hash'] || null,
        estoque:              0,
        ativo:                (row['cadastrado'] ?? row['status'] ?? '').toLowerCase() === 'sim' || (row['status'] ?? '').toLowerCase() === 'ativo',
      }))
      const { data: existing } = await supabase.from('certificados').select('id, codigo')
      const existMap = new Map(
        (existing ?? []).filter(e => e.codigo != null).map(e => [e.codigo as number, e.id as string])
      )
      const toInsert = records.filter(r => r.codigo == null || !existMap.has(r.codigo))
      const toUpdate = records.filter(r => r.codigo != null && existMap.has(r.codigo!))
        .map(r => ({ ...r, id: existMap.get(r.codigo!)! }))
      const ops: Promise<{ error: { message: string } | null }>[] = []
      if (toInsert.length) ops.push(supabase.from('certificados').insert(toInsert) as any)
      for (const { id, ...p } of toUpdate) ops.push(supabase.from('certificados').update(p).eq('id', id) as any)
      const results = await Promise.all(ops)
      const err = results.find(r => r.error)
      if (err?.error) { alert('Erro: ' + err.error.message); return }
      alert(`${records.length} certificado(s) importado(s)/atualizado(s).`)
      void fetchCatalogo()
    } finally {
      setImportando(false)
    }
  }

  // ── tabelas de preço mutations ────────────────────────────────
  function abrirNovaTabela() { setEditingTabelaId(null); setFormTabela({ ...EMPTY_TABELA }); setShowFormTabela(true) }
  function editarTabela(t: TabelaPreco) {
    setEditingTabelaId(t.id)
    setFormTabela({
      nome: t.nome, descricao: t.descricao, codigo_voucher: t.codigo_voucher,
      max_desconto_percentual: t.max_desconto_percentual, max_desconto_valor: t.max_desconto_valor,
      comissao_venda_pct: t.comissao_venda_pct, comissao_gestor_pct: t.comissao_gestor_pct,
      comissao_gestor_valor: t.comissao_gestor_valor, ativo: t.ativo,
    })
    setShowFormTabela(true)
  }
  async function salvarTabela() {
    if (!formTabela.nome.trim()) return
    setSalvandoCatalogo(true)
    const payload = { ...formTabela, nome: formTabela.nome.trim() }
    const { data, error } = editingTabelaId
      ? await supabase.from('tabelas_preco').update(payload).eq('id', editingTabelaId).select().single()
      : await supabase.from('tabelas_preco').insert([payload]).select().single()
    setSalvandoCatalogo(false)
    if (error) { alert('Erro: ' + error.message); return }
    setShowFormTabela(false); setEditingTabelaId(null)
    if (!editingTabelaId && data) setSelectedTabelaId(data.id)
    void fetchCatalogo()
  }
  async function toggleTabela(t: TabelaPreco) {
    await supabase.from('tabelas_preco').update({ ativo: !t.ativo }).eq('id', t.id)
    setTabelasPreco(prev => prev.map(x => x.id === t.id ? { ...x, ativo: !x.ativo } : x))
  }

  // tabela itens
  function abrirNovoItem(tabelaId: string) {
    setEditingItemId(null)
    setFormItem({ ...EMPTY_ITEM, tabela_preco_id: tabelaId, certificado_id: certificadosAtivos[0]?.id ?? '' })
    setShowFormItem(true)
  }
  function editarItem(item: TabelaPrecoItem) {
    setEditingItemId(item.id)
    setFormItem({
      tabela_preco_id: item.tabela_preco_id, certificado_id: item.certificado_id,
      valor: item.valor, valor_custo: item.valor_custo, valor_repasse: item.valor_repasse,
      link_safeweb: item.link_safeweb, ativo: item.ativo,
    })
    setShowFormItem(true)
  }
  async function salvarItem() {
    if (!formItem.certificado_id || formItem.valor < 0) return
    setSalvandoCatalogo(true)
    const { error } = editingItemId
      ? await supabase.from('tabelas_preco_itens').update(formItem).eq('id', editingItemId)
      : await supabase.from('tabelas_preco_itens').insert([formItem])
    setSalvandoCatalogo(false)
    if (error) { alert('Erro: ' + error.message); return }
    setShowFormItem(false); setEditingItemId(null); void fetchCatalogo()
  }
  async function excluirItem(id: string) {
    if (!confirm('Remover este item da tabela?')) return
    await supabase.from('tabelas_preco_itens').delete().eq('id', id)
    setTabelaItens(prev => prev.filter(x => x.id !== id))
  }
  async function toggleItem(item: TabelaPrecoItem) {
    await supabase.from('tabelas_preco_itens').update({ ativo: !item.ativo }).eq('id', item.id)
    setTabelaItens(prev => prev.map(x => x.id === item.id ? { ...x, ativo: !x.ativo } : x))
  }

  async function importarItensTabelaFile(file: File, tabelaId: string) {
    setImportando(true)
    try {
      const text = await file.text()
      const delim = text.includes('\t') ? '\t' : ','
      const lines = text.trim().split('\n').filter(l => l.trim())
      if (lines.length < 2) { alert('Planilha sem dados.'); return }
      const normalize = (h: string) =>
        h.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '_').replace(/^"|"$/g, '').replace(/[^a-z0-9_]/g, '')
      const headers = lines[0].split(delim).map(h => normalize(h.trim()))
      const parseVal = (v: string) => parseFloat((v ?? '0').replace(/[R$\s]/g, '').replace(',', '.')) || 0
      const rows = lines.slice(1).map(line => {
        const vals = line.split(delim).map(v => v.trim().replace(/^"|"$/g, ''))
        const row: Record<string, string> = {}
        headers.forEach((h, i) => { row[h] = vals[i] ?? '' })
        return row
      })
      const certsAll = await supabase.from('certificados').select('id, codigo, tipo')
      const certByCode = new Map((certsAll.data ?? []).filter(c => c.codigo != null).map(c => [c.codigo as number, c.id as string]))
      const certByName = new Map((certsAll.data ?? []).map(c => [(c.tipo as string).toLowerCase().trim(), c.id as string]))
      const records = rows.filter(r => Object.values(r).some(v => v)).map(row => {
        const codigoRaw = row['codigo'] ?? row['cod'] ?? ''
        const nomeRaw   = (row['nome'] ?? row['produto'] ?? '').toLowerCase().trim()
        const certId = codigoRaw ? certByCode.get(parseInt(codigoRaw)) : certByName.get(nomeRaw)
        if (!certId) return null
        return {
          tabela_preco_id: tabelaId,
          certificado_id:  certId,
          valor:           parseVal(row['preco_venda'] ?? row['valor'] ?? row['preco'] ?? '0'),
          valor_custo:     parseVal(row['valor_custo'] ?? row['custo'] ?? '0'),
          valor_repasse:   parseVal(row['valor_repasse'] ?? row['repasse'] ?? '0'),
          link_safeweb:    (row['link_safeweb'] ?? row['link'] ?? '') || null,
          ativo:           true,
        }
      }).filter((r): r is NovaTabelaPrecoItem => r !== null)
      if (!records.length) { alert('Nenhum item reconhecido. Verifique as colunas: Código (ou Nome), Preço Venda, Valor Custo, Valor Repasse.'); return }
      const existing = await supabase.from('tabelas_preco_itens').select('id, certificado_id').eq('tabela_preco_id', tabelaId)
      const existMap = new Map((existing.data ?? []).map(e => [e.certificado_id as string, e.id as string]))
      const toInsert = records.filter(r => !existMap.has(r.certificado_id))
      const toUpdate = records.filter(r => existMap.has(r.certificado_id)).map(r => ({ ...r, id: existMap.get(r.certificado_id)! }))
      const ops: Promise<{ error: { message: string } | null }>[] = []
      if (toInsert.length) ops.push(supabase.from('tabelas_preco_itens').insert(toInsert) as any)
      for (const { id, ...p } of toUpdate) ops.push(supabase.from('tabelas_preco_itens').update(p).eq('id', id) as any)
      const results = await Promise.all(ops)
      const err = results.find(r => r.error)
      if (err?.error) { alert('Erro: ' + err.error.message); return }
      alert(`${records.length} produto(s) importado(s)/atualizado(s) na tabela.`)
      void fetchCatalogo()
    } finally {
      setImportando(false)
    }
  }

  // tabela participantes
  function abrirNovoParticipante(tabelaId: string) {
    setFormParticipante({ ...EMPTY_PARTICIPANTE, tabela_preco_id: tabelaId })
    setShowFormParticipante(true)
  }
  async function salvarParticipante() {
    if (!formParticipante.tabela_preco_id) return
    const payload = {
      ...formParticipante,
      parceiro_id:   formParticipante.tipo_participante === 'parceiro'      ? formParticipante.parceiro_id   : null,
      tipo_parceiro: formParticipante.tipo_participante === 'tipo_parceiro' ? formParticipante.tipo_parceiro : null,
      perfil:        formParticipante.tipo_participante === 'perfil'         ? formParticipante.perfil         : null,
    }
    setSalvandoCatalogo(true)
    const { error } = await supabase.from('tabelas_preco_participantes').insert([payload])
    setSalvandoCatalogo(false)
    if (error) { alert('Erro: ' + error.message); return }
    setShowFormParticipante(false); void fetchCatalogo()
  }
  async function excluirParticipante(id: string) {
    await supabase.from('tabelas_preco_participantes').delete().eq('id', id)
    setTabelaParticipantes(prev => prev.filter(x => x.id !== id))
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

  // ── paginação: reset ao mudar filtros ────────────────────────
  useEffect(() => { setPaginaAtual(1) }, [vendaFilters])

  // ── catalog mutations ────────────────────────────────────────
  function aplicarPresetData(preset: string) {
    const hoje = new Date()
    const fmt = (d: Date) => d.toISOString().split('T')[0]
    if (preset === 'hoje') {
      setVendaFilters(p => ({ ...p, filtroData: preset, dataInicial: fmt(hoje), dataFinal: fmt(hoje) }))
    } else if (preset === 'semana') {
      const ini = new Date(hoje); ini.setDate(hoje.getDate() - hoje.getDay())
      setVendaFilters(p => ({ ...p, filtroData: preset, dataInicial: fmt(ini), dataFinal: fmt(hoje) }))
    } else if (preset === 'mes') {
      const ini = new Date(hoje.getFullYear(), hoje.getMonth(), 1)
      setVendaFilters(p => ({ ...p, filtroData: preset, dataInicial: fmt(ini), dataFinal: fmt(hoje) }))
    } else {
      setVendaFilters(p => ({ ...p, filtroData: 'geral', dataInicial: '', dataFinal: '' }))
    }
  }

  function exportarCSV() {
    const header = ['Pedido', 'Protocolo', 'Cliente', 'Documento', 'Produto', 'Emissão', 'Tipo Venda', 'PA', 'Valor', 'Status', 'Forma Pgto', 'Data Venda', 'Observação']
    const rows = vendasFiltradas.map(v => [
      v.pedido_numero ?? '',
      v.protocolo_numero ?? '',
      ((v.cadastros_base as { nome?: string } | null)?.nome ?? v.nome_faturamento ?? ''),
      ((v.cadastros_base as { cpf_cnpj?: string } | null)?.cpf_cnpj ?? v.documento_faturamento ?? ''),
      v.tipo_produto,
      v.tipo_emissao ?? '',
      v.tipo_venda ?? '',
      ((v.pontos_atendimento as { nome?: string } | null)?.nome ?? ''),
      String(v.valor_venda ?? 0),
      STATUS_VENDA_LABEL[v.status_venda],
      ((v.metadata as { forma_pagamento?: string })?.forma_pagamento ?? ''),
      new Date(v.created_at).toLocaleDateString('pt-BR'),
      (v.observacoes ?? ''),
    ])
    const csv = [header, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = `vendas_${new Date().toLocaleDateString('pt-BR').replace(/\//g, '-')}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  async function excluirVenda(id: string) {
    if (!confirm('Excluir esta venda? Esta ação não pode ser desfeita.')) return
    await supabase.from('vendas_certificados').delete().eq('id', id)
    setVendasV2(prev => prev.filter(v => v.id !== id))
  }

  function abrirProtocolo(v: VendaRow) {
    if (v.protocolo_numero) { alert('Esta venda já possui protocolo: ' + v.protocolo_numero); return }
    const cpfComprador = (v.cadastros_base as { cpf_cnpj?: string } | null)?.cpf_cnpj ?? ''
    setProtocoloVenda(v)
    setFormProtocolo({ ...EMPTY_PROTOCOLO, cpf: cpfComprador })
    setProtocoloStep('validate')
    setShowProtocolo(true)
  }

  async function validarTitular() {
    if (!formProtocolo.cpf.trim() || !formProtocolo.data_nascimento) {
      alert('Preencha CPF e data de nascimento do titular.')
      return
    }
    setValidandoProtocolo(true)
    // Busca dados do titular já cadastrado pelo CPF
    const { data: titular } = await supabase
      .from('titulares_certificado')
      .select('*')
      .eq('cpf', formProtocolo.cpf.trim())
      .single()
    if (titular) {
      setFormProtocolo(p => ({
        ...p,
        nome:     titular.nome ?? '',
        email:    titular.email ?? '',
        telefone: titular.telefone ?? '',
      }))
    }
    setValidandoProtocolo(false)
    setProtocoloStep('form')
  }

  async function confirmarProtocolo() {
    if (!protocoloVenda) return
    if (!formProtocolo.nome.trim() || !formProtocolo.cpf.trim()) {
      alert('Preencha nome e CPF do titular.')
      return
    }
    setEmitindoProtocolo(true)

    // Upsert do titular
    const { data: titularData, error: titularErr } = await supabase
      .from('titulares_certificado')
      .upsert({
        nome:            formProtocolo.nome.trim(),
        cpf:             formProtocolo.cpf.trim(),
        email:           formProtocolo.email || null,
        telefone:        `${formProtocolo.ddd}${formProtocolo.telefone}`.trim() || null,
        data_nascimento: formProtocolo.data_nascimento || null,
        metadata:        {
          cep: formProtocolo.cep, logradouro: formProtocolo.logradouro, numero: formProtocolo.numero,
          complemento: formProtocolo.complemento, bairro: formProtocolo.bairro,
          cidade: formProtocolo.cidade, uf: formProtocolo.uf, ibge: formProtocolo.ibge,
          cei: formProtocolo.cei, caepf: formProtocolo.caepf, nis: formProtocolo.nis,
          possui_cnh: formProtocolo.possui_cnh, codigo_voucher: formProtocolo.codigo_voucher,
        },
      }, { onConflict: 'cpf' })
      .select('id')
      .single()

    if (titularErr || !titularData) {
      alert('Erro ao salvar titular: ' + (titularErr?.message ?? 'desconhecido'))
      setEmitindoProtocolo(false)
      return
    }

    // Busca link_safeweb da tabela
    const item = protocoloVenda.tabela_preco_item_id
      ? tabelaItens.find(i => i.id === protocoloVenda.tabela_preco_item_id)
      : null

    // Atualiza a venda com o titular e gera número de protocolo temporário
    const proto = `PROT${Date.now().toString().slice(-8)}`
    const { error: vendaErr } = await supabase.from('vendas_certificados').update({
      titular_id:       titularData.id,
      protocolo_numero: proto,
      protocolo_status: 'gerado',
      pedido_status:    'gerado',
      api_payload_protocolo: {
        link_safeweb: item?.link_safeweb ?? null,
        dados_titular: formProtocolo,
      },
    }).eq('id', protocoloVenda.id)

    setEmitindoProtocolo(false)
    if (vendaErr) { alert('Erro: ' + vendaErr.message); return }

    if (item?.link_safeweb) {
      // Abre o link da Safeweb em nova aba
      window.open(item.link_safeweb, '_blank')
    }

    setShowProtocolo(false)
    setVendasV2(prev => prev.map(r =>
      r.id === protocoloVenda.id ? { ...r, protocolo_numero: proto, protocolo_status: 'gerado' } : r
    ))
    alert(`Protocolo ${proto} emitido. Titular cadastrado.`)
  }

  async function liberarEmissao(v: VendaRow) {
    const { error } = await supabase.from('vendas_certificados').update({ status_venda: 'emitido' }).eq('id', v.id)
    if (error) { alert('Erro: ' + error.message); return }
    setVendasV2(prev => prev.map(r => r.id === v.id ? { ...r, status_venda: 'emitido' } : r))
  }

  function toggleSelected(id: string) {
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  function toggleAll() {
    if (selectedIds.size === vendasPaginadas.length && vendasPaginadas.length > 0)
      setSelectedIds(new Set())
    else
      setSelectedIds(new Set(vendasPaginadas.map(v => v.id)))
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
          <div className="space-y-4">

            {pontosAtivos.length === 0 && (
              <div className="flex items-center gap-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
                <AlertCircle size={16} />
                Nenhum ponto de atendimento cadastrado. Configure em <strong className="mx-1">Configurações → Pontos de Atendimento</strong>.
              </div>
            )}

            {showFormV && (
              <Panel title="Lançar Venda" onClose={() => setShowFormV(false)}>
                {/* linha 1: Tipo Venda + Cliente + Novo Cliente */}
                <div className="grid grid-cols-1 md:grid-cols-[160px_1fr_auto] gap-3 mb-3">
                  <SelectInput label="Tipo Venda" value={formV2.tipo_venda}
                    onChange={v => setFormV2(p => ({ ...p, tipo_venda: v }))}
                    options={TIPO_VENDA_OPTIONS} />
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Cliente *</label>
                    <div className="flex gap-2">
                      <input list="clientes-base-list"
                        value={clienteSelecionado ? `${clienteSelecionado.cpf_cnpj} - ${clienteSelecionado.nome}` : clienteSearch}
                        onChange={e => {
                          const v = e.target.value
                          setClienteSearch(v)
                          const match = clientes.find(c => c.nome.toLowerCase() === v.toLowerCase() || c.cpf_cnpj === v || `${c.cpf_cnpj} - ${c.nome}` === v)
                          if (match) { setFormV2(p => ({ ...p, cadastro_base_id: match.id })); setClienteSearch('') }
                          else setFormV2(p => ({ ...p, cadastro_base_id: '' }))
                        }}
                        placeholder="CPF/CNPJ ou nome do cliente"
                        className="flex-1 border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      <datalist id="clientes-base-list">
                        {clientesFiltrados.map(c => (
                          <option key={c.id} value={`${c.cpf_cnpj} - ${c.nome}`} />
                        ))}
                      </datalist>
                      {formV2.cadastro_base_id && (
                        <button type="button" title="Limpar cliente" onClick={() => { setFormV2(p => ({ ...p, cadastro_base_id: '' })); setClienteSearch('') }}
                          className="px-2 text-gray-400 hover:text-gray-600"><X size={14} /></button>
                      )}
                    </div>
                  </div>
                  <div className="flex items-end">
                    <button type="button" onClick={() => {
                      if (showClienteForm) { setShowClienteForm(false); setEditingClienteId(null); setFormCliente({ ...EMPTY_CLIENTE_BASE }) }
                      else abrirNovoCliente()
                    }}
                      className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium whitespace-nowrap">
                      {showClienteForm ? '← Fechar' : '+ Novo Cliente'}
                    </button>
                  </div>
                </div>

                {/* linha 2: Contador */}
                <div className="mb-3">
                  <label className="block text-xs text-blue-600 dark:text-blue-400 font-medium mb-1">Se for indicação de Contador/Parceiro, selecione abaixo:</label>
                  <div className="relative">
                    <input
                      value={formV2.contador_id
                        ? (() => { const p = parceiros.find(x => x.id === formV2.contador_id); return p ? `${p.cpf_cnpj ?? ''} - ${(p.tipo_parceiro ?? '').toUpperCase()} - ${p.nome}` : '' })()
                        : contadorSearch}
                      onChange={e => {
                        const v = e.target.value
                        setContadorSearch(v)
                        if (!v) setFormV2(p => ({ ...p, contador_id: null }))
                      }}
                      placeholder="Nenhum selecionado"
                      className="w-full border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    {parceirosParaContador.length > 0 && (
                      <div className="absolute z-20 left-0 right-0 top-full mt-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                        {parceirosParaContador.map(p => (
                          <button key={p.id} type="button"
                            onClick={() => { setFormV2(prev => ({ ...prev, contador_id: p.id })); setContadorSearch('') }}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800">
                            {p.cpf_cnpj ?? ''} - {(p.tipo_parceiro ?? '').toUpperCase()} - {p.nome}{p.nome_fantasia ? ` - ${p.nome_fantasia}` : ''}
                          </button>
                        ))}
                      </div>
                    )}
                    {formV2.contador_id && (
                      <button type="button" onClick={() => { setFormV2(p => ({ ...p, contador_id: null })); setContadorSearch('') }}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"><X size={14} /></button>
                    )}
                  </div>
                </div>

                {/* linha 3: Tabela de Venda */}
                <div className="mb-3">
                  <label className="block text-xs text-gray-500 mb-1">Selecione a tabela de Venda *</label>
                  <select value={formV2.tabela_preco_id}
                    onChange={e => {
                      const tid = e.target.value
                      setFormV2(p => ({ ...p, tabela_preco_id: tid, certificado_id: '', tabela_preco_item_id: '', valor_venda: 0 }))
                    }}
                    className="w-full border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">Selecione uma tabela</option>
                    {tabelasAtivas.map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}
                  </select>
                </div>

                {/* linha 4: Tipo Emissão + Certificado + Validade */}
                <div className="grid grid-cols-1 md:grid-cols-[200px_1fr_120px] gap-3 mb-3">
                  <SelectInput label="Tipo Emissão" value={formV2.tipo_emissao}
                    onChange={v => setFormV2(p => ({ ...p, tipo_emissao: v }))}
                    options={TIPO_EMISSAO_OPTIONS} />
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Certificado *</label>
                    <select value={formV2.certificado_id}
                      onChange={e => {
                        const cid = e.target.value
                        const found = certsDaTabela.find(x => x.cert.id === cid)
                        setFormV2(p => ({
                          ...p,
                          certificado_id:       cid,
                          tabela_preco_item_id: found?.item.id ?? '',
                          valor_venda:          found?.item.valor ?? 0,
                        }))
                      }}
                      disabled={!formV2.tabela_preco_id}
                      className="w-full border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50">
                      <option value="">Selecione o Certificado</option>
                      {certsDaTabela.map(({ cert, item }) => (
                        <option key={cert.id} value={cert.id}>
                          {cert.tipo}{cert.descricao ? ` - ${cert.descricao}` : ''}
                          {!item.ativo ? ' (inativo)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-gray-500">Validade (Meses)</span>
                    <input readOnly
                      value={formV2.certificado_id ? (validadeEmMeses(certificadoById.get(formV2.certificado_id)?.validade ?? '') ?? '') : ''}
                      className="border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-gray-50 dark:bg-gray-800 text-gray-500" />
                  </label>
                </div>

                {/* linha 5: Valor + Forma Pagamento + Vencimento */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-green-600 dark:text-green-400 font-medium">Valor Venda (R$) *</span>
                    <input type="number" min="0" step="0.01" value={formV2.valor_venda}
                      onChange={e => setFormV2(p => ({ ...p, valor_venda: parseFloat(e.target.value) || 0 }))}
                      className="border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </label>
                  <SelectInput label="Forma de Pagamento" value={formV2.forma_pagamento}
                    onChange={v => setFormV2(p => ({ ...p, forma_pagamento: v }))}
                    options={[{ value: '', label: 'Selecione' }, ...formasPagamento.map(n => ({ value: n, label: n }))]} />
                  <TextInput label="Vencimento" type="date" value={formV2.data_vencimento}
                    onChange={v => setFormV2(p => ({ ...p, data_vencimento: v }))} />
                </div>

                {/* linha 6: Observações */}
                <label className="flex flex-col gap-1 mb-4">
                  <span className="text-xs text-gray-500">Observações</span>
                  <textarea rows={2} value={formV2.observacoes ?? ''}
                    onChange={e => setFormV2(p => ({ ...p, observacoes: e.target.value || null }))}
                    className="border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
                </label>

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
                  disabled={!formV2.cadastro_base_id || !formV2.tabela_preco_id || !formV2.certificado_id}
                />
              </Panel>
            )}

            {/* ── PAINEL DE FILTROS ─────────────────────────── */}
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 space-y-3">
              {/* Linha 1: datas + PA + botões Agenda / Pesquisar */}
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-gray-500">Filtro data</span>
                  <select value={vendaFilters.filtroData} onChange={e => aplicarPresetData(e.target.value)}
                    className="border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[120px]">
                    <option value="geral">Geral</option>
                    <option value="hoje">Hoje</option>
                    <option value="semana">Esta semana</option>
                    <option value="mes">Este mês</option>
                  </select>
                </label>
                <TextInput label="Data Inicial" type="date" value={vendaFilters.dataInicial}
                  onChange={v => setVendaFilters(p => ({ ...p, dataInicial: v, filtroData: 'personalizado' }))} />
                <TextInput label="Data Final" type="date" value={vendaFilters.dataFinal}
                  onChange={v => setVendaFilters(p => ({ ...p, dataFinal: v, filtroData: 'personalizado' }))} />
                <TextInput label="PA/Emissor" value={vendaFilters.pa}
                  onChange={v => setVendaFilters(p => ({ ...p, pa: v }))} className="flex-1 min-w-[180px]" />
                <div className="flex gap-2 ml-auto">
                  <button type="button" onClick={() => setTab('agenda')}
                    className="flex items-center gap-1.5 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition-colors">
                    <Calendar size={14} /> Agenda
                  </button>
                  <button type="button" onClick={() => void fetchVendasV2()}
                    className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors">
                    <Search size={14} /> Pesquisar
                  </button>
                </div>
              </div>
              {/* Linha 2: Pedido, Protocolo, Cliente, Status */}
              <div className="flex flex-wrap gap-3">
                <TextInput label="Pedido" value={vendaFilters.pedido}
                  onChange={v => setVendaFilters(p => ({ ...p, pedido: v }))} className="min-w-[130px]" />
                <TextInput label="Protocolo" value={vendaFilters.protocolo}
                  onChange={v => setVendaFilters(p => ({ ...p, protocolo: v }))} className="min-w-[130px]" />
                <TextInput label="Cliente / Documento" value={vendaFilters.cliente}
                  onChange={v => setVendaFilters(p => ({ ...p, cliente: v }))} className="flex-1 min-w-[200px]" />
                <SelectInput label="Status" value={vendaFilters.status}
                  onChange={v => setVendaFilters(p => ({ ...p, status: v }))}
                  options={[{ value: '', label: 'Todos' }, ...STATUS_VENDA_V2_OPTIONS.map(s => ({ value: s, label: STATUS_VENDA_LABEL[s] }))]} />
                <div className="flex items-end">
                  <button type="button" onClick={() => setVendaFilters(EMPTY_VENDA_FILTERS)}
                    className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 border border-gray-300 dark:border-gray-700">
                    <X size={12} /> Limpar
                  </button>
                </div>
              </div>
              {/* Linha 3: botões de ação */}
              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-gray-100 dark:border-gray-800">
                <VendaActionBtn icon={FileText}   label="Emitir NFS-e"        onClick={() => alert('Integração com NFS-e em desenvolvimento.')} />
                <VendaActionBtn icon={RefreshCcw} label="Atualizar Faturas"   onClick={() => alert('Integração com faturas em desenvolvimento.')} />
                <VendaActionBtn icon={List}        label="Protocolos em Lote"  onClick={() => alert('Processamento em lote em desenvolvimento.')} />
                <VendaActionBtn icon={UserCheck}  label="Consulta CPF PSBio"  onClick={() => alert('Integração com PSBio em desenvolvimento.')} />
                <VendaActionBtn icon={Download}   label="Exportar CSV"        onClick={exportarCSV} />
                <button type="button" onClick={() => setShowFormV(v => !v)}
                  className="flex items-center gap-1.5 px-3 py-2 bg-gray-900 dark:bg-white text-white dark:text-gray-900 text-xs font-semibold rounded-lg hover:opacity-90 transition-opacity ml-auto">
                  <PlusCircle size={13} /> Nova Venda
                </button>
              </div>
            </div>

            {/* ── LEGENDA ──────────────────────────────────────── */}
            <p className="text-xs text-gray-400 dark:text-gray-500 px-1 leading-relaxed">
              (<Bell size={10} className="inline mb-0.5" />) Notifica Eventos ·
              (<ClipboardList size={10} className="inline mb-0.5" />) Emitir Protocolo ·
              (<Calendar size={10} className="inline mb-0.5" />) Agendar ·
              (<Upload size={10} className="inline mb-0.5" />) Upload Documentos ·
              (<Receipt size={10} className="inline mb-0.5" />) Fatura ·
              (<Trash2 size={10} className="inline mb-0.5" />) Excluir ·
              (<FileText size={10} className="inline mb-0.5" />) Ver NF-e ·
              (<XCircle size={10} className="inline mb-0.5" />) Cancelar NF-e ·
              (<Unlock size={10} className="inline mb-0.5" />) Liberar Emissão
            </p>

            {/* ── TABELA ───────────────────────────────────────── */}
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[1600px]">
                  <thead>
                    <tr className="bg-gray-50 dark:bg-gray-800/50 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide text-left border-b border-gray-200 dark:border-gray-800">
                      <th className="px-3 py-3 w-8">
                        <input type="checkbox"
                          checked={selectedIds.size > 0 && selectedIds.size === vendasPaginadas.length}
                          onChange={toggleAll}
                          className="rounded cursor-pointer" />
                      </th>
                      <th className="px-3 py-3">Ações</th>
                      {['Pedido','Protocolo','Tipo Emissão','Tipo Venda','Status Venda','Data Status','Forma Pagamento','Valor Venda','Produto','Doc. Cliente','Cliente','PA','Data Venda','Vendedor','Observação'].map(h => (
                        <th key={h} className="px-3 py-3 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {loadingV ? (
                      <LoadingRow colSpan={17} />
                    ) : vendasPaginadas.length === 0 ? (
                      <EmptyRow colSpan={17} label="Nenhuma venda encontrada com esses filtros." />
                    ) : vendasPaginadas.map(v => (
                      <tr key={v.id} className={cn(
                        'hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors',
                        selectedIds.has(v.id) && 'bg-blue-50 dark:bg-blue-900/10',
                      )}>
                        <td className="px-3 py-2">
                          <input type="checkbox" checked={selectedIds.has(v.id)}
                            onChange={() => toggleSelected(v.id)} className="rounded cursor-pointer" />
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-0.5">
                            <VendaIconBtn title="Notifica Eventos"  icon={Bell}          color="blue"    onClick={() => alert('Em desenvolvimento.')} />
                            <VendaIconBtn title="Emitir Protocolo"  icon={ClipboardList} color="purple"  onClick={() => abrirProtocolo(v)} />
                            <VendaIconBtn title="Agendar"           icon={Calendar}      color="emerald" onClick={() => prepararAgendamento(v)} />
                            <VendaIconBtn title="Upload Documentos" icon={Upload}        color="orange"  onClick={() => alert('Em desenvolvimento.')} />
                            <VendaIconBtn title="Fatura"            icon={Receipt}       color="teal"    onClick={() => alert('Em desenvolvimento.')} />
                            <VendaIconBtn title="Excluir"           icon={Trash2}        color="red"     onClick={() => void excluirVenda(v.id)} />
                            <VendaIconBtn title="Ver NF-e"          icon={FileText}      color="gray"    onClick={() => alert('Em desenvolvimento.')} />
                            <VendaIconBtn title="Cancelar NF-e"     icon={XCircle}       color="red"     onClick={() => alert('Em desenvolvimento.')} />
                            <VendaIconBtn title="Liberar Emissão"   icon={Unlock}        color="green"   onClick={() => void liberarEmissao(v)} />
                          </div>
                        </td>
                        <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{v.pedido_numero ?? '—'}</td>
                        <td className="px-3 py-2 text-blue-600 dark:text-blue-400 whitespace-nowrap">{v.protocolo_numero ?? '—'}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{v.tipo_emissao ? capitalize(v.tipo_emissao.replace(/_/g, ' ')) : '—'}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{v.tipo_venda ? capitalize(v.tipo_venda) : '—'}</td>
                        <td className="px-3 py-2">
                          <select
                            title="Status da venda"
                            value={v.status_venda}
                            onChange={e => atualizarStatusVendaV2(v.id, e.target.value as StatusVendaCertificado)}
                            className={cn('px-2 py-0.5 rounded-full text-xs font-medium border-0 cursor-pointer focus:outline-none whitespace-nowrap', statusVendaV2Cls(v.status_venda))}>
                            {STATUS_VENDA_V2_OPTIONS.map(s => (
                              <option key={s} value={s}>{STATUS_VENDA_LABEL[s]}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">
                          {new Date(v.updated_at).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })}
                        </td>
                        <td className="px-3 py-2 text-gray-500 whitespace-nowrap">
                          {(v.metadata as { forma_pagamento?: string })?.forma_pagamento ?? '—'}
                        </td>
                        <td className="px-3 py-2 text-right font-semibold text-green-600 dark:text-green-400 whitespace-nowrap">
                          {formatCurrency(v.valor_venda ?? 0)}
                        </td>
                        <td className="px-3 py-2 text-gray-500 max-w-[180px] truncate">{v.tipo_produto}</td>
                        <td className="px-3 py-2 text-gray-500 whitespace-nowrap">
                          {(v.cadastros_base as { cpf_cnpj?: string } | null)?.cpf_cnpj ?? v.documento_faturamento ?? '—'}
                        </td>
                        <td className="px-3 py-2 font-medium max-w-[160px] truncate">
                          {(v.cadastros_base as { nome?: string } | null)?.nome ?? v.nome_faturamento ?? '—'}
                        </td>
                        <td className="px-3 py-2 text-gray-500 whitespace-nowrap">
                          {(v.pontos_atendimento as { nome?: string } | null)?.nome ?? '—'}
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">
                          {new Date(v.created_at).toLocaleDateString('pt-BR')}
                        </td>
                        <td className="px-3 py-2 text-gray-400">—</td>
                        <td className="px-3 py-2 text-gray-500 max-w-[120px] truncate">{v.observacoes ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* ── RODAPÉ: totalizador + paginação ── */}
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/30">
                <div className="flex items-center gap-4">
                  <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                    Total: {formatCurrency(totalFiltrado)}
                  </span>
                  <span className="text-xs text-gray-400">
                    {vendasFiltradas.length === 0
                      ? 'Nenhum registro'
                      : `Exibindo ${(paginaAtual - 1) * itensPorPagina + 1}–${Math.min(paginaAtual * itensPorPagina, vendasFiltradas.length)} de ${vendasFiltradas.length}`}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5 text-xs text-gray-500">
                    <span>Itens/página:</span>
                    <select value={itensPorPagina}
                      onChange={e => { setItensPorPagina(Number(e.target.value)); setPaginaAtual(1) }}
                      className="border border-gray-300 dark:border-gray-700 rounded px-2 py-1 text-xs bg-white dark:bg-gray-800">
                      {[25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                  <div className="flex items-center gap-1">
                    <button type="button" disabled={paginaAtual === 1}
                      onClick={() => setPaginaAtual(p => p - 1)}
                      className="w-7 h-7 rounded flex items-center justify-center disabled:opacity-40 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">
                      <ChevronLeft size={14} />
                    </button>
                    <span className="text-xs text-gray-500 px-1">{paginaAtual} / {totalPaginas}</span>
                    <button type="button" disabled={paginaAtual >= totalPaginas}
                      onClick={() => setPaginaAtual(p => p + 1)}
                      className="w-7 h-7 rounded flex items-center justify-center disabled:opacity-40 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">
                      <ChevronRight size={14} />
                    </button>
                  </div>
                </div>
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
                    options={certificados.map(c => ({ value: c.tipo, label: c.tipo }))} />
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
          <div className="space-y-5">
            {/* header com dois botões */}
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-semibold text-gray-800 dark:text-gray-200">Catálogo de Certificados</h2>
              <div className="flex items-center gap-2">
                <input ref={importInputRef} type="file" accept=".csv,.tsv,.txt" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) void importarPlanilha(f); e.target.value = '' }} />
                <button type="button" onClick={() => importInputRef.current?.click()} disabled={importando}
                  className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 text-xs font-medium rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50">
                  <Upload size={13} /> {importando ? 'Importando...' : 'Importar Planilha'}
                </button>
                <button type="button" onClick={abrirNovoCertificado}
                  className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 transition-colors">
                  <PlusCircle size={14} /> Novo Certificado
                </button>
              </div>
            </div>

            {loadingCatalogo && <div className="flex items-center gap-2 text-gray-400 text-sm"><Loader2 size={16} className="animate-spin" /> Carregando...</div>}
            {catalogoErro && <div className="text-red-600 text-sm">{catalogoErro}</div>}

            {showFormCert && (
              <Panel title={editingCertId ? 'Editar Certificado' : 'Novo Certificado'} onClose={() => setShowFormCert(false)}>
                <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                  <NumberInput label="Código" value={formCert.codigo ?? 0} onChange={v => setFormCert(p => ({ ...p, codigo: v || null }))} step={1} />
                  <TextInput label="Nome *" value={formCert.tipo} onChange={v => setFormCert(p => ({ ...p, tipo: v }))} className="md:col-span-3" />
                  <TextInput label="Tipo Emissão" value={formCert.tipo_emissao_padrao ?? ''} onChange={v => setFormCert(p => ({ ...p, tipo_emissao_padrao: v || null }))} />
                  <TextInput label="Validade *" value={formCert.validade} onChange={v => setFormCert(p => ({ ...p, validade: v }))} />
                  <TextInput label="Tipo (Categoria)" value={formCert.categoria ?? ''} onChange={v => setFormCert(p => ({ ...p, categoria: v || null }))} />
                  <TextInput label="Modelo" value={formCert.modelo ?? ''} onChange={v => setFormCert(p => ({ ...p, modelo: v || null }))} />
                  <TextInput label="Agrupador (e-commerce)" value={formCert.agrupador ?? ''} onChange={v => setFormCert(p => ({ ...p, agrupador: v || null }))} className="md:col-span-2" />
                  <ActiveSelect value={formCert.ativo} onChange={v => setFormCert(p => ({ ...p, ativo: v }))} />
                  <TextInput label="Produto Vinculado na AC" value={formCert.produto_vinculado_ac ?? ''} onChange={v => setFormCert(p => ({ ...p, produto_vinculado_ac: v || null }))} className="md:col-span-3" />
                  <TextInput label="Hash" value={formCert.hash ?? ''} onChange={v => setFormCert(p => ({ ...p, hash: v || null }))} className="md:col-span-2" />
                  <NumberInput label="Preço de Venda (R$)" value={formCert.preco_venda} onChange={v => setFormCert(p => ({ ...p, preco_venda: v }))} />
                  <NumberInput label="Valor Custo AC (R$)" value={formCert.valor_custo_ac} onChange={v => setFormCert(p => ({ ...p, valor_custo_ac: v }))} />
                  <NumberInput label="Valor Custo (R$)" value={formCert.valor_custo} onChange={v => setFormCert(p => ({ ...p, valor_custo: v }))} />
                  <TextInput label="Descrição" value={formCert.descricao ?? ''} onChange={v => setFormCert(p => ({ ...p, descricao: v || null }))} className="md:col-span-6" />
                </div>
                <label className="flex flex-col gap-1 mt-3">
                  <span className="text-xs text-gray-500">Descrição do Produto</span>
                  <textarea rows={2} value={formCert.descricao_produto ?? ''} onChange={e => setFormCert(p => ({ ...p, descricao_produto: e.target.value || null }))}
                    className="border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
                </label>
                <FormActions onSave={salvarCertificado} onCancel={() => setShowFormCert(false)} saving={salvandoCatalogo} />
              </Panel>
            )}

            <DataTable headers={['Cód', 'Tipo Emissão', 'Nome', 'Validade', 'Tipo', 'Produto AC', 'Preço Venda', 'Custo AC', 'Custo', 'Status', 'Ações']}>
              {certificados.length === 0 ? (
                <EmptyRow colSpan={11} label="Nenhum certificado cadastrado. Use 'Importar Planilha' ou 'Novo Certificado'." />
              ) : certificados.map(c => (
                <tr key={c.id} className={cn('hover:bg-gray-50 dark:hover:bg-gray-800/50', !c.ativo && 'opacity-50')}>
                  <td className="px-4 py-3 text-xs text-gray-400">{c.codigo ?? '—'}</td>
                  <td className="px-4 py-3 text-xs">{c.tipo_emissao_padrao ?? '—'}</td>
                  <td className="px-4 py-3 font-medium">
                    <p className="text-sm">{c.tipo || '—'}</p>
                    {c.descricao && <p className="text-xs text-gray-400">{c.descricao}</p>}
                  </td>
                  <td className="px-4 py-3 text-sm">{c.validade || '—'}</td>
                  <td className="px-4 py-3 text-xs">{c.categoria ?? '—'}</td>
                  <td className="px-4 py-3 text-xs text-gray-400 max-w-[140px] truncate" title={c.produto_vinculado_ac ?? ''}>{c.produto_vinculado_ac ?? '—'}</td>
                  <td className="px-4 py-3 text-sm text-green-600 dark:text-green-400 font-semibold">{c.preco_venda ? formatCurrency(c.preco_venda) : '—'}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{c.valor_custo_ac ? formatCurrency(c.valor_custo_ac) : '—'}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{c.valor_custo ? formatCurrency(c.valor_custo) : '—'}</td>
                  <td className="px-4 py-3"><StatusPill active={c.ativo} /></td>
                  <td className="px-4 py-3"><RowActions active={c.ativo} onEdit={() => editarCertificado(c)} onToggle={() => toggleCertificado(c)} /></td>
                </tr>
              ))}
            </DataTable>
          </div>
        )}

        {/* ── TABELAS DE PREÇO ───────────────────────────────── */}
        {tab === 'tabelas' && (
          <div className="space-y-6">
            {loadingCatalogo && <div className="flex items-center gap-2 text-gray-400 text-sm"><Loader2 size={16} className="animate-spin" /> Carregando...</div>}
            {catalogoErro && <div className="text-red-600 text-sm">{catalogoErro}</div>}

            {/* Lista de tabelas */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-gray-800 dark:text-gray-200">Tabelas de Preço</h2>
                <button type="button" onClick={abrirNovaTabela}
                  className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700">
                  <PlusCircle size={13} /> Nova Tabela
                </button>
              </div>

              {showFormTabela && (
                <Panel title={editingTabelaId ? 'Editar Tabela' : 'Nova Tabela de Preço'} onClose={() => setShowFormTabela(false)}>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <TextInput label="Nome *" value={formTabela.nome} onChange={v => setFormTabela(p => ({ ...p, nome: v }))} className="md:col-span-2" />
                    <TextInput label="Código Voucher" value={formTabela.codigo_voucher ?? ''} onChange={v => setFormTabela(p => ({ ...p, codigo_voucher: v || null }))} />
                    <ActiveSelect value={formTabela.ativo} onChange={v => setFormTabela(p => ({ ...p, ativo: v }))} />
                    <NumberInput label="% Máx. Desconto" value={formTabela.max_desconto_percentual} onChange={v => setFormTabela(p => ({ ...p, max_desconto_percentual: v }))} />
                    <NumberInput label="Valor Máx. Desconto (R$)" value={formTabela.max_desconto_valor} onChange={v => setFormTabela(p => ({ ...p, max_desconto_valor: v }))} />
                    <NumberInput label="% Comissão Venda" value={formTabela.comissao_venda_pct} onChange={v => setFormTabela(p => ({ ...p, comissao_venda_pct: v }))} />
                    <NumberInput label="% Comissão Gestor" value={formTabela.comissao_gestor_pct} onChange={v => setFormTabela(p => ({ ...p, comissao_gestor_pct: v }))} />
                    <NumberInput label="Valor Comissão Gestor (R$)" value={formTabela.comissao_gestor_valor} onChange={v => setFormTabela(p => ({ ...p, comissao_gestor_valor: v }))} />
                    <TextInput label="Descrição" value={formTabela.descricao ?? ''} onChange={v => setFormTabela(p => ({ ...p, descricao: v || null }))} className="md:col-span-3" />
                  </div>
                  <FormActions onSave={salvarTabela} onCancel={() => setShowFormTabela(false)} saving={salvandoCatalogo} />
                </Panel>
              )}

              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {tabelasPreco.length === 0
                  ? <p className="text-sm text-gray-400 col-span-full">Nenhuma tabela cadastrada.</p>
                  : tabelasPreco.map(t => (
                    <div key={t.id} onClick={() => setSelectedTabelaId(t.id === selectedTabelaId ? null : t.id)}
                      className={cn('cursor-pointer rounded-xl border p-4 transition-all',
                        t.id === selectedTabelaId
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                          : 'border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hover:border-blue-300',
                        !t.ativo && 'opacity-50')}>
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-semibold text-sm">{t.nome}</p>
                          {t.descricao && <p className="text-xs text-gray-400 mt-0.5">{t.descricao}</p>}
                          <p className="text-xs text-gray-400 mt-1">
                            {tabelaItens.filter(i => i.tabela_preco_id === t.id).length} produto(s) ·{' '}
                            {tabelaParticipantes.filter(p => p.tabela_preco_id === t.id).length} participante(s)
                          </p>
                        </div>
                        <div onClick={e => e.stopPropagation()}>
                          <RowActions active={t.ativo} onEdit={() => editarTabela(t)} onToggle={() => toggleTabela(t)} />
                        </div>
                      </div>
                    </div>
                  ))
                }
              </div>
            </div>

            {/* Detalhe da tabela selecionada */}
            {selectedTabelaId && (() => {
              const tabela = tabelaById.get(selectedTabelaId)
              if (!tabela) return null
              const itens = tabelaItens.filter(i => i.tabela_preco_id === selectedTabelaId)
              const parts = tabelaParticipantes.filter(p => p.tabela_preco_id === selectedTabelaId)
              return (
                <div className="space-y-5 border-t border-gray-200 dark:border-gray-700 pt-5">
                  <h3 className="font-semibold text-blue-600 dark:text-blue-400">Tabela: {tabela.nome}</h3>

                  {/* Itens (certificados + preços) */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">Produtos e Preços</h4>
                      <div className="flex items-center gap-2">
                        <input ref={importItensRef} type="file" accept=".csv,.tsv,.txt" className="hidden"
                          onChange={e => { const f = e.target.files?.[0]; if (f) void importarItensTabelaFile(f, selectedTabelaId); e.target.value = '' }} />
                        <button type="button" onClick={() => importItensRef.current?.click()} disabled={importando}
                          className="flex items-center gap-1 px-2 py-1.5 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 text-xs rounded-lg hover:bg-gray-200 disabled:opacity-50">
                          <Upload size={12} /> {importando ? 'Importando...' : 'Importar Planilha'}
                        </button>
                        <button type="button" onClick={() => abrirNovoItem(selectedTabelaId)}
                          className="flex items-center gap-1 px-2 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700">
                          <PlusCircle size={12} /> Adicionar
                        </button>
                      </div>
                    </div>

                    {showFormItem && (
                      <Panel title={editingItemId ? 'Editar Item' : 'Novo Item'} onClose={() => setShowFormItem(false)}>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                          <div className="md:col-span-4">
                            <SelectInput label="Certificado *" value={formItem.certificado_id}
                              onChange={v => setFormItem(p => ({ ...p, certificado_id: v }))}
                              options={certificadosAtivos.map(c => ({ value: c.id, label: `${c.codigo ? c.codigo + ' · ' : ''}${c.tipo}${c.validade ? ' · ' + c.validade : ''}` }))} />
                          </div>
                          <NumberInput label="Preço de Venda (R$) *" value={formItem.valor} onChange={v => setFormItem(p => ({ ...p, valor: v }))} />
                          <NumberInput label="Valor Custo (R$)" value={formItem.valor_custo} onChange={v => setFormItem(p => ({ ...p, valor_custo: v }))} />
                          <NumberInput label="Valor Repasse (R$)" value={formItem.valor_repasse} onChange={v => setFormItem(p => ({ ...p, valor_repasse: v }))} />
                          <ActiveSelect value={formItem.ativo} onChange={v => setFormItem(p => ({ ...p, ativo: v }))} />
                          <TextInput label="Link Safeweb" value={formItem.link_safeweb ?? ''} onChange={v => setFormItem(p => ({ ...p, link_safeweb: v || null }))} className="md:col-span-4" />
                        </div>
                        <FormActions onSave={salvarItem} onCancel={() => setShowFormItem(false)} saving={salvandoCatalogo} />
                      </Panel>
                    )}

                    <DataTable headers={['Cód', 'Certificado', 'Validade', 'Preço Venda', 'Custo', 'Repasse', 'Status', 'Ações']}>
                      {itens.length === 0
                        ? <EmptyRow colSpan={8} label="Nenhum produto nesta tabela." />
                        : itens.map(item => {
                          const cert = certificadoById.get(item.certificado_id)
                          return (
                            <tr key={item.id} className={cn('hover:bg-gray-50 dark:hover:bg-gray-800/50', !item.ativo && 'opacity-50')}>
                              <td className="px-4 py-3 text-xs text-gray-400">{cert?.codigo ?? '—'}</td>
                              <td className="px-4 py-3 font-medium text-sm">{cert?.tipo ?? 'Cert. removido'}</td>
                              <td className="px-4 py-3 text-sm text-gray-500">{cert?.validade ?? '—'}</td>
                              <td className="px-4 py-3 text-green-600 dark:text-green-400 font-semibold">{formatCurrency(item.valor)}</td>
                              <td className="px-4 py-3 text-sm text-gray-500">{formatCurrency(item.valor_custo)}</td>
                              <td className="px-4 py-3 text-sm text-gray-500">{formatCurrency(item.valor_repasse)}</td>
                              <td className="px-4 py-3"><StatusPill active={item.ativo} /></td>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-1">
                                  <button type="button" onClick={() => editarItem(item)} title="Editar" className="p-1 text-gray-400 hover:text-blue-600"><Edit3 size={13} /></button>
                                  <button type="button" onClick={() => toggleItem(item)} title={item.ativo ? 'Inativar' : 'Ativar'} className="p-1 text-gray-400 hover:text-amber-600">
                                    {item.ativo ? <ToggleRight size={13} /> : <ToggleLeft size={13} />}
                                  </button>
                                  <button type="button" onClick={() => excluirItem(item.id)} title="Excluir" className="p-1 text-gray-400 hover:text-red-600"><Trash2 size={13} /></button>
                                </div>
                              </td>
                            </tr>
                          )
                        })
                      }
                    </DataTable>
                  </div>

                  {/* Participantes */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">Participantes (quem acessa esta tabela)</h4>
                      <button type="button" onClick={() => abrirNovoParticipante(selectedTabelaId)}
                        className="flex items-center gap-1 px-2 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700">
                        <PlusCircle size={12} /> Adicionar
                      </button>
                    </div>

                    {showFormParticipante && (
                      <Panel title="Adicionar Participante" onClose={() => setShowFormParticipante(false)}>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <SelectInput label="Tipo" value={formParticipante.tipo_participante}
                            onChange={v => setFormParticipante(p => ({ ...p, tipo_participante: v as TipoParticipanteTabelaPreco, parceiro_id: null, tipo_parceiro: null, perfil: null }))}
                            options={[
                              { value: 'parceiro',      label: 'Parceiro individual' },
                              { value: 'tipo_parceiro', label: 'Tipo de parceiro'    },
                              { value: 'perfil',        label: 'Perfil de usuário'   },
                            ]} />
                          {formParticipante.tipo_participante === 'tipo_parceiro' && (
                            <SelectInput label="Tipo de Parceiro" value={formParticipante.tipo_parceiro ?? ''}
                              onChange={v => setFormParticipante(p => ({ ...p, tipo_parceiro: v as TipoParceiro }))}
                              options={TIPO_PARCEIRO_OPTS} />
                          )}
                          {formParticipante.tipo_participante === 'perfil' && (
                            <SelectInput label="Perfil" value={formParticipante.perfil ?? ''}
                              onChange={v => setFormParticipante(p => ({ ...p, perfil: v as PerfilAcesso }))}
                              options={PERFIL_OPTS} />
                          )}
                          {formParticipante.tipo_participante === 'parceiro' && (
                            <SelectInput label="Parceiro" value={formParticipante.parceiro_id ?? ''}
                              onChange={v => setFormParticipante(p => ({ ...p, parceiro_id: v }))}
                              options={parceiros.map(p => ({ value: p.id, label: `${p.cpf_cnpj ?? ''} - ${p.nome}` }))} />
                          )}
                        </div>
                        <FormActions onSave={salvarParticipante} onCancel={() => setShowFormParticipante(false)} saving={salvandoCatalogo} />
                      </Panel>
                    )}

                    {parts.length === 0
                      ? <p className="text-sm text-gray-400">Nenhum participante cadastrado. Sem participantes todos têm acesso.</p>
                      : (
                        <div className="flex flex-wrap gap-2">
                          {parts.map(p => (
                            <div key={p.id} className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 dark:bg-gray-800 rounded-full text-xs">
                              <span>
                                {p.tipo_participante === 'tipo_parceiro' && `Tipo: ${p.tipo_parceiro}`}
                                {p.tipo_participante === 'perfil' && `Perfil: ${p.perfil}`}
                                {p.tipo_participante === 'parceiro' && (() => { const parc = parceiros.find(x => x.id === p.parceiro_id); return parc ? parc.nome : p.parceiro_id })()}
                              </span>
                              <button type="button" onClick={() => excluirParticipante(p.id)} className="text-gray-400 hover:text-red-500"><X size={11} /></button>
                            </div>
                          ))}
                        </div>
                      )
                    }
                  </div>
                </div>
              )
            })()}
          </div>
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

      {/* ── MODAL EMITIR PROTOCOLO ─────────────────────────── */}
      {showProtocolo && protocoloVenda && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            {/* header */}
            <div className="flex items-center justify-between px-6 py-4 bg-gray-800 rounded-t-2xl">
              <h2 className="text-white font-semibold">Emitir Protocolo</h2>
              <button type="button" onClick={() => setShowProtocolo(false)} className="text-gray-400 hover:text-white"><X size={18} /></button>
            </div>

            <div className="px-6 py-5 space-y-4">
              {/* info da venda */}
              <div>
                <p className="text-xs text-gray-500">Comprador:</p>
                <p className="text-blue-600 dark:text-blue-400 font-medium">
                  {(protocoloVenda.cadastros_base as { nome?: string } | null)?.nome ?? protocoloVenda.nome_faturamento ?? '—'}
                </p>
              </div>
              <div className="flex gap-8 pt-2 border-t border-gray-100 dark:border-gray-800">
                <div>
                  <p className="text-xs text-gray-500">Pedido:</p>
                  <p className="text-blue-600 font-medium">{protocoloVenda.pedido_numero ?? '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Certificado:</p>
                  <p className="text-blue-600 font-medium">
                    {protocoloVenda.certificado_id ? (certificadoById.get(protocoloVenda.certificado_id)?.tipo ?? '—') : protocoloVenda.tipo_produto}
                  </p>
                </div>
              </div>

              <div className="border-t border-gray-100 dark:border-gray-800 pt-4">
                {/* step 1: CPF + nascimento */}
                <div className="flex flex-wrap items-end gap-4">
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-gray-500">CPF do Titular:</span>
                    <input value={formProtocolo.cpf} onChange={e => setFormProtocolo(p => ({ ...p, cpf: e.target.value }))}
                      readOnly={protocoloStep === 'form'}
                      placeholder="000.000.000-00"
                      className="border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 w-40 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-gray-500">Data Nascimento:</span>
                    <input type="date" value={formProtocolo.data_nascimento} onChange={e => setFormProtocolo(p => ({ ...p, data_nascimento: e.target.value }))}
                      readOnly={protocoloStep === 'form'}
                      className="border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 w-40 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </label>
                  <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 pb-2">
                    <input type="checkbox" checked={formProtocolo.possui_cnh}
                      onChange={e => setFormProtocolo(p => ({ ...p, possui_cnh: e.target.checked }))} />
                    Possui CNH
                  </label>
                  {protocoloStep === 'validate' && (
                    <button type="button" onClick={() => void validarTitular()} disabled={validandoProtocolo}
                      className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg disabled:opacity-50">
                      <Check size={14} /> {validandoProtocolo ? 'Validando...' : 'Validar'}
                    </button>
                  )}
                </div>

                {/* step 2: dados do titular */}
                {protocoloStep === 'form' && (
                  <div className="mt-5 space-y-4">
                    <p className="text-blue-600 dark:text-blue-400 text-sm font-medium">Informe os dados para emissão do protocolo:</p>

                    <div className="grid grid-cols-1 gap-3">
                      <label className="flex flex-col gap-1">
                        <span className="text-xs text-gray-500">Nome:</span>
                        <input value={formProtocolo.nome} onChange={e => setFormProtocolo(p => ({ ...p, nome: e.target.value }))}
                          className="border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      </label>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-[1fr_80px_150px] gap-3">
                      <label className="flex flex-col gap-1">
                        <span className="text-xs text-gray-500">Email:</span>
                        <input type="email" value={formProtocolo.email} onChange={e => setFormProtocolo(p => ({ ...p, email: e.target.value }))}
                          className="border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-xs text-gray-500">DDD:</span>
                        <input value={formProtocolo.ddd} onChange={e => setFormProtocolo(p => ({ ...p, ddd: e.target.value }))} maxLength={3}
                          className="border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-xs text-gray-500">Telefone:</span>
                        <input value={formProtocolo.telefone} onChange={e => setFormProtocolo(p => ({ ...p, telefone: e.target.value }))}
                          className="border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      </label>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <label className="flex flex-col gap-1">
                        <span className="text-xs text-gray-500">CEP:</span>
                        <input value={formProtocolo.cep} onChange={e => setFormProtocolo(p => ({ ...p, cep: e.target.value }))}
                          className="border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      </label>
                      <label className="flex flex-col gap-1 md:col-span-2">
                        <span className="text-xs text-gray-500">Logradouro:</span>
                        <input value={formProtocolo.logradouro} onChange={e => setFormProtocolo(p => ({ ...p, logradouro: e.target.value }))}
                          className="border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-xs text-gray-500">Número:</span>
                        <input value={formProtocolo.numero} onChange={e => setFormProtocolo(p => ({ ...p, numero: e.target.value }))}
                          className="border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-xs text-gray-500">Complemento:</span>
                        <input value={formProtocolo.complemento} onChange={e => setFormProtocolo(p => ({ ...p, complemento: e.target.value }))}
                          className="border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-xs text-gray-500">Bairro:</span>
                        <input value={formProtocolo.bairro} onChange={e => setFormProtocolo(p => ({ ...p, bairro: e.target.value }))}
                          className="border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-xs text-gray-500">Cidade:</span>
                        <input value={formProtocolo.cidade} onChange={e => setFormProtocolo(p => ({ ...p, cidade: e.target.value }))}
                          className="border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-xs text-gray-500">UF:</span>
                        <input value={formProtocolo.uf} onChange={e => setFormProtocolo(p => ({ ...p, uf: e.target.value }))} maxLength={2}
                          className="border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-xs text-gray-500">IBGE:</span>
                        <input value={formProtocolo.ibge} onChange={e => setFormProtocolo(p => ({ ...p, ibge: e.target.value }))}
                          className="border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      </label>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <label className="flex flex-col gap-1">
                        <span className="text-xs text-gray-500">CEI:</span>
                        <input value={formProtocolo.cei} onChange={e => setFormProtocolo(p => ({ ...p, cei: e.target.value }))}
                          className="border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-xs text-gray-500">CAEPF do responsável:</span>
                        <input value={formProtocolo.caepf} onChange={e => setFormProtocolo(p => ({ ...p, caepf: e.target.value }))}
                          className="border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-xs text-gray-500">Número NIS:</span>
                        <input value={formProtocolo.nis} onChange={e => setFormProtocolo(p => ({ ...p, nis: e.target.value }))}
                          className="border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      </label>
                    </div>

                    <div>
                      <p className="text-xs text-blue-600 dark:text-blue-400 font-medium mb-2">Se possuir um voucher de desconto informe o código abaixo:</p>
                      <label className="flex flex-col gap-1">
                        <span className="text-xs text-gray-500">Código do Voucher:</span>
                        <input value={formProtocolo.codigo_voucher} onChange={e => setFormProtocolo(p => ({ ...p, codigo_voucher: e.target.value }))}
                          className="border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 w-64 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      </label>
                    </div>

                    <div className="flex items-center justify-between pt-3 border-t border-gray-100 dark:border-gray-800">
                      <button type="button" onClick={() => setShowProtocolo(false)}
                        className="flex items-center gap-2 px-4 py-2 border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 text-sm rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800">
                        <XCircle size={14} /> Cancelar
                      </button>
                      <button type="button" onClick={() => void confirmarProtocolo()} disabled={emitindoProtocolo}
                        className="flex items-center gap-2 px-5 py-2 bg-blue-700 hover:bg-blue-800 text-white text-sm font-medium rounded-lg disabled:opacity-50">
                        <ClipboardList size={14} /> {emitindoProtocolo ? 'Emitindo...' : 'Emitir Protocolo'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
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

function VendaActionBtn({ icon: Icon, label, onClick }: {
  icon: React.ComponentType<{ size?: number }>; label: string; onClick: () => void
}) {
  return (
    <button type="button" onClick={onClick}
      className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg transition-colors">
      <Icon size={12} /> {label}
    </button>
  )
}

const VENDA_ICON_COLORS = {
  blue:    'text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20',
  purple:  'text-purple-500 hover:bg-purple-50 dark:hover:bg-purple-900/20',
  emerald: 'text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/20',
  orange:  'text-orange-500 hover:bg-orange-50 dark:hover:bg-orange-900/20',
  teal:    'text-teal-500 hover:bg-teal-50 dark:hover:bg-teal-900/20',
  red:     'text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20',
  gray:    'text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800',
  green:   'text-green-500 hover:bg-green-50 dark:hover:bg-green-900/20',
} as const

function VendaIconBtn({ icon: Icon, title, onClick, color }: {
  icon: React.ComponentType<{ size?: number }>; title: string
  onClick: () => void; color: keyof typeof VENDA_ICON_COLORS
}) {
  return (
    <button type="button" title={title} onClick={onClick}
      className={cn('w-6 h-6 rounded flex items-center justify-center transition-colors', VENDA_ICON_COLORS[color])}>
      <Icon size={12} />
    </button>
  )
}
