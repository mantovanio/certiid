import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import * as XLSX from 'xlsx'
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
  TipoCliente,
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
type Tab = 'vendas' | 'agenda' | 'certificados' | 'tabelas' | 'comissoes' | 'pagamento' | 'importar'

const TABS: { id: Tab; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { id: 'vendas',       label: 'Lançar Vendas',    icon: TrendingUp  },
  { id: 'agenda',       label: 'Agenda',           icon: Calendar    },
  { id: 'certificados', label: 'Certificados',     icon: ShoppingBag },
  { id: 'tabelas',      label: 'Tabelas de Preço', icon: Tag         },
  { id: 'comissoes',    label: 'Faixas Comissão',  icon: TrendingUp  },
  { id: 'pagamento',    label: 'Forma Pagamento',  icon: CreditCard  },
  { id: 'importar',     label: 'Importar Safeweb', icon: Upload      },
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
  const [clienteResultados, setClienteResultados] = useState<CadastroBase[]>([])
  const [clienteBuscando, setClienteBuscando]     = useState(false)
  const [clienteDropdownOpen, setClienteDropdownOpen] = useState(false)
  const [clienteSelecionadoObj, setClienteSelecionadoObj] = useState<CadastroBase | null>(null)
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
  const [selectedCertIds, setSelectedCertIds]   = useState<Set<string>>(new Set())
  const [selectedItemIds, setSelectedItemIds]   = useState<Set<string>>(new Set())
  const clienteSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const importInputRef                          = useRef<HTMLInputElement>(null)
  const importItensRef                          = useRef<HTMLInputElement>(null)
  const importSafewebRef                        = useRef<HTMLInputElement>(null)
  const importClientesRef                       = useRef<HTMLInputElement>(null)
  const [importandoSafeweb, setImportandoSafeweb] = useState(false)
  const [importandoClientes, setImportandoClientes] = useState(false)
  const [resultSafeweb, setResultSafeweb] = useState<{ clientes: number; novos: number; atualizados: number; divergentes: number } | null>(null)
  const [resultClientes, setResultClientes] = useState<{ inseridos: number; atualizados: number } | null>(null)
  const [safewebVendas, setSafewebVendas] = useState<VendaRow[]>([])
  const [loadingSafewebVendas, setLoadingSafewebVendas] = useState(false)
  const [safewebViewerOpen, setSafewebViewerOpen] = useState(false)
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

  async function buscarClientes(term: string) {
    const t = term.trim()
    if (t.length < 3) { setClienteResultados([]); setClienteDropdownOpen(false); return }
    setClienteBuscando(true)
    const like = `%${t}%`
    const { data } = await supabase
      .from('cadastros_base')
      .select('id, nome, nome_fantasia, cpf_cnpj, telefone, cidade, uf, status')
      .or(`nome.ilike.${like},nome_fantasia.ilike.${like},cpf_cnpj.ilike.${like},telefone.ilike.${like}`)
      .order('nome', { ascending: true })
      .limit(10)
    setClienteResultados((data ?? []) as CadastroBase[])
    setClienteDropdownOpen(true)
    setClienteBuscando(false)
  }

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
    if (clienteSelecionadoObj) {
      setFormProtocolo(p => ({ ...p, cpf: clienteSelecionadoObj.cpf_cnpj }))
    }
  }, [clienteSelecionadoObj])

  // ── V2 mutations ─────────────────────────────────────────────
  async function salvarVendaV2() {
    if (!formV2.cadastro_base_id) { alert('Selecione um cliente.'); return }
    if (!formV2.tabela_preco_id) { alert('Selecione uma tabela de venda.'); return }
    if (!formV2.certificado_id) { alert('Selecione o certificado.'); return }
    if (formV2.valor_venda <= 0) { alert('Informe o valor da venda.'); return }
    if (!currentUserId) { alert('Usuário não autenticado.'); return }
    setSalvandoV(true)

    const cli = clienteSelecionadoObj
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
    setClienteSelecionadoObj(null)
    setClienteSearch('')
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
    if (data?.id) {
      setFormV2(p => ({ ...p, cadastro_base_id: data.id }))
      const { data: novo } = await supabase.from('cadastros_base').select('*').eq('id', data.id).single()
      setClienteSelecionadoObj((novo as CadastroBase) ?? null)
    }
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
    const c = clientes.find(x => x.id === cadastroId)
    setClienteSelecionadoObj(c ?? null)
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

  async function excluirCertificado(id: string) {
    if (!confirm('Excluir este certificado do catálogo? Esta ação não pode ser desfeita.')) return
    const { error } = await supabase.from('certificados').delete().eq('id', id)
    if (error) { alert('Erro: ' + error.message); return }
    setCertificados(prev => prev.filter(c => c.id !== id))
    setSelectedCertIds(prev => { const s = new Set(prev); s.delete(id); return s })
  }

  async function excluirCertificadosSelecionados() {
    if (!selectedCertIds.size) return
    if (!confirm(`Excluir ${selectedCertIds.size} certificado(s) selecionado(s)? Esta ação não pode ser desfeita.`)) return
    const ids = [...selectedCertIds]
    const { error } = await supabase.from('certificados').delete().in('id', ids)
    if (error) { alert('Erro: ' + error.message); return }
    setCertificados(prev => prev.filter(c => !selectedCertIds.has(c.id)))
    setSelectedCertIds(new Set())
  }

  function lerPlanilha(file: File): Promise<Record<string, string>[]> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = e => {
        try {
          const data = new Uint8Array(e.target!.result as ArrayBuffer)
          const wb = XLSX.read(data, { type: 'array' })
          const ws = wb.Sheets[wb.SheetNames[0]]
          const normalize = (h: string) =>
            String(h ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
          const json: Record<string, unknown>[] = XLSX.utils.sheet_to_json(ws, { defval: '' })
          const rows = json.map(r => {
            const out: Record<string, string> = {}
            Object.entries(r).forEach(([k, v]) => { out[normalize(k)] = String(v ?? '') })
            return out
          })
          resolve(rows)
        } catch (err) { reject(err) }
      }
      reader.onerror = reject
      reader.readAsArrayBuffer(file)
    })
  }

  async function importarPlanilha(file: File) {
    setImportando(true)
    try {
      const rows = await lerPlanilha(file)
      if (!rows.length) { alert('Planilha sem dados.'); return }
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
    setSelectedItemIds(prev => { const s = new Set(prev); s.delete(id); return s })
  }

  async function excluirItensSelecionados() {
    if (!selectedItemIds.size) return
    if (!confirm(`Remover ${selectedItemIds.size} produto(s) selecionado(s) da tabela?`)) return
    const ids = [...selectedItemIds]
    const { error } = await supabase.from('tabelas_preco_itens').delete().in('id', ids)
    if (error) { alert('Erro: ' + error.message); return }
    setTabelaItens(prev => prev.filter(x => !selectedItemIds.has(x.id)))
    setSelectedItemIds(new Set())
  }
  async function toggleItem(item: TabelaPrecoItem) {
    await supabase.from('tabelas_preco_itens').update({ ativo: !item.ativo }).eq('id', item.id)
    setTabelaItens(prev => prev.map(x => x.id === item.id ? { ...x, ativo: !x.ativo } : x))
  }

  async function importarItensTabelaFile(file: File, tabelaId: string) {
    setImportando(true)
    try {
      const rows = await lerPlanilha(file)
      if (!rows.length) { alert('Planilha sem dados.'); return }
      const parseVal = (v: string) => parseFloat((v ?? '0').replace(/[R$\s]/g, '').replace(',', '.')) || 0
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

  // ── importar relatório Safeweb — batimento mensal ────────────
  async function importarRelatorioSafeweb(file: File) {
    setImportandoSafeweb(true)
    setResultSafeweb(null)
    try {
      const rows = await lerPlanilha(file)
      if (!rows.length) { alert('Planilha sem dados.'); return }
      const parseNum = (v: string) => parseFloat((v ?? '').replace(/[R$\s.]/g, '').replace(',', '.')) || 0
      const cleanDoc = (v: string) => (v ?? '').replace(/\D/g, '')
      // converte DD/MM/YYYY ou DD/MM/YYYY HH:MM:SS → YYYY-MM-DD
      const parseDate = (v: string): string | null => {
        const s = (v ?? '').trim()
        if (!s) return null
        const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
        if (m) return `${m[3]}-${m[2]}-${m[1]}`
        // já está em ISO ou outro formato que o postgres aceita
        return s.split(' ')[0] || null
      }
      const BATCH = 100

      // 1. upsert clientes
      const clientePayloads = rows.map(r => {
        const doc = cleanDoc(r['documento'] ?? r['cnpj_cpf'] ?? '')
        const nome = (r['nome'] ?? r['nome_razao_social'] ?? '').trim()
        if (!doc || !nome) return null
        const tipo: TipoCliente = doc.length === 11 ? 'pessoa_fisica' : 'pessoa_juridica'
        return {
          cpf_cnpj:     doc,
          nome,
          tipo_cliente: tipo,
          tipo_cadastro: 'cliente' as const,
          email:        (r['e_mail_do_titular'] ?? r['email_do_titular'] ?? r['email'] ?? '').trim() || null,
          telefone:     (r['telefone_do_titular'] ?? r['telefone'] ?? '').trim() || null,
          iss_retido:   false,
          status:       'ativo' as const,
          metadata:     {} as Record<string, unknown>,
        }
      }).filter((x): x is NonNullable<typeof x> => x !== null)

      const clientesUniq = [...new Map(clientePayloads.map(c => [c.cpf_cnpj, c])).values()]
      for (let i = 0; i < clientesUniq.length; i += BATCH) {
        const { error } = await supabase.from('cadastros_base')
          .upsert(clientesUniq.slice(i, i + BATCH), { onConflict: 'cpf_cnpj', ignoreDuplicates: false })
        if (error) { alert('Erro ao importar clientes: ' + error.message); return }
      }

      // 2. busca IDs de clientes para vincular às vendas
      const allDocs = clientesUniq.map(c => c.cpf_cnpj)
      const { data: cadastrosData } = await supabase
        .from('cadastros_base').select('id, cpf_cnpj').in('cpf_cnpj', allDocs)
      const idByDoc = new Map((cadastrosData ?? []).map(c => [c.cpf_cnpj as string, c.id as string]))

      // 3. monta payloads de venda COM validado_safeweb = true
      const vendasPayloads = rows.map(r => {
        const protocolo = (r['protocolo'] ?? r['numero_protocolo'] ?? '').trim()
        if (!protocolo) return null
        const doc = cleanDoc(r['documento'] ?? r['cnpj_cpf'] ?? '')
        return {
          protocolo_numero:       protocolo,
          cadastro_base_id:       idByDoc.get(doc) ?? null,
          tipo_produto:           (r['produto'] ?? '').trim() || null,
          tipo_emissao:           (r['tipo_de_emissao_realizada'] ?? r['tipo_emissao'] ?? '').trim() || null,
          valor_venda:            parseNum(r['valor_do_boleto'] ?? r['valor_boleto'] ?? r['valor'] ?? '0'),
          status_venda:           'emitido' as StatusVendaCertificado,
          pago:                   true,
          validado_safeweb:       true,
          data_vencimento:        parseDate(r['data_fim_validade'] ?? r['data_vencimento'] ?? ''),
          data_inicio_validade:   parseDate(r['data_inicio_validade'] ?? r['data_inicio'] ?? ''),
          numero_serie:           (r['numero_de_serie'] ?? r['numero_serie'] ?? '').trim() || null,
          voucher_codigo:         (r['vouchercodigo'] ?? r['voucher_codigo'] ?? r['vouchercod'] ?? '').trim() || null,
          voucher_percentual:     parseNum(r['voucherpercentual'] ?? r['voucher_percentual'] ?? '0') || null,
          voucher_valor:          parseNum(r['vouchervalor'] ?? r['voucher_valor'] ?? '0') || null,
          nome_ar:                (r['nome_da_autoridade_de_registro'] ?? r['nome_ar'] ?? '').trim() || null,
          nome_local_atendimento: (r['nome_do_local_de_atendimento'] ?? r['nome_local'] ?? '').trim() || null,
          status_certificado:     (r['status_do_certificado'] ?? r['status_certificado'] ?? '').trim() || null,
          nome_parceiro_safeweb:  (r['nome_do_parceiro'] ?? r['nome_parceiro'] ?? '').trim() || null,
          observacoes:            (r['observacao'] ?? r['observacoes'] ?? '').trim() || null,
        }
      }).filter((x): x is NonNullable<typeof x> => x !== null)

      // 4. separa registros que já existem no CRM dos que são só da Safeweb
      const protocolos = vendasPayloads.map(v => v.protocolo_numero)
      const { data: existentes } = await supabase
        .from('vendas_certificados').select('protocolo_numero').in('protocolo_numero', protocolos)
      const existSet = new Set((existentes ?? []).map(e => e.protocolo_numero as string))
      const paraAtualizar = vendasPayloads.filter(v =>  existSet.has(v.protocolo_numero))
      const novos         = vendasPayloads.filter(v => !existSet.has(v.protocolo_numero)).length

      // 5. atualiza apenas os que já existem (INSERT violaria NOT NULL de vendedor_id, etc.)
      for (let i = 0; i < paraAtualizar.length; i += BATCH) {
        const batch = paraAtualizar.slice(i, i + BATCH)
        const ops = batch.map(({ protocolo_numero, ...campos }) =>
          supabase.from('vendas_certificados').update(campos).eq('protocolo_numero', protocolo_numero)
        )
        const results = await Promise.all(ops)
        const err = results.find(r => r.error)
        if (err?.error) { alert('Erro ao importar vendas: ' + err.error.message); return }
      }

      // 6. conta divergentes: vendas no CRM sem validado_safeweb que têm protocolo fora da planilha
      //    (apenas as emitidas — rascunho/agendado não contam)
      const { count: divergentes } = await supabase
        .from('vendas_certificados')
        .select('id', { count: 'exact', head: true })
        .eq('status_venda', 'emitido')
        .is('validado_safeweb', null)

      setResultSafeweb({ clientes: clientesUniq.length, novos, atualizados: paraAtualizar.length, divergentes: divergentes ?? 0 })
    } finally {
      setImportandoSafeweb(false)
    }
  }

  // ── importar clientes (formato sistema antigo) ────────────────
  async function importarClientes(file: File) {
    setImportandoClientes(true)
    setResultClientes(null)
    try {
      const rows = await lerPlanilha(file)
      if (!rows.length) { alert('Planilha sem dados.'); return }
      const cleanDoc = (v: string) => (v ?? '').replace(/\D/g, '')

      const payloads = rows.map(r => {
        const doc = cleanDoc(r['cnpj_cpf'] ?? r['cpf_cnpj'] ?? r['documento'] ?? '')
        const nome = r['nome_razao_social'] ?? r['nome'] ?? ''
        if (!doc || !nome) return null
        const tipo: TipoCliente = doc.length === 11 ? 'pessoa_fisica' : 'pessoa_juridica'
        const ddd = (r['ddd'] ?? '').replace(/\D/g, '')
        const tel = (r['telefone'] ?? '').replace(/\D/g, '')
        const telefone = ddd && tel ? `(${ddd}) ${tel}` : (tel || null)
        return {
          cpf_cnpj: doc,
          nome,
          nome_fantasia:       (r['nome_fantasia'] ?? '').trim() || null,
          tipo_cliente:        tipo,
          tipo_cadastro:       'cliente' as const,
          email:               (r['e_mail'] ?? r['email'] ?? '').trim() || null,
          telefone,
          cep:                 (r['cep'] ?? '').replace(/\D/g, '') || null,
          logradouro:          (r['endereco'] ?? r['logradouro'] ?? '').trim() || null,
          numero:              (r['numero'] ?? '').trim() || null,
          complemento:         (r['complemento'] ?? '').trim() || null,
          bairro:              (r['bairro'] ?? '').trim() || null,
          cidade:              (r['cidade'] ?? '').trim() || null,
          uf:                  (r['uf'] ?? '').trim().toUpperCase() || null,
          inscricao_estadual:  (r['ie'] ?? r['inscricao_estadual'] ?? '').trim() || null,
          inscricao_municipal: (r['im'] ?? r['inscricao_municipal'] ?? '').trim() || null,
          iss_retido: false,
          status: 'ativo' as const,
          metadata: { contador: (r['contador'] ?? '').trim() || null } as Record<string, unknown>,
        }
      }).filter((x): x is NonNullable<typeof x> => x !== null)

      // check existing to count inserts vs updates
      const docs = payloads.map(p => p.cpf_cnpj)
      const { data: existing } = await supabase.from('cadastros_base').select('cpf_cnpj').in('cpf_cnpj', docs)
      const existSet = new Set((existing ?? []).map(e => e.cpf_cnpj as string))
      const inseridos = payloads.filter(p => !existSet.has(p.cpf_cnpj)).length
      const atualizados = payloads.filter(p => existSet.has(p.cpf_cnpj)).length

      const BATCH = 100
      for (let i = 0; i < payloads.length; i += BATCH) {
        const batch = payloads.slice(i, i + BATCH)
        const { error } = await supabase.from('cadastros_base')
          .upsert(batch, { onConflict: 'cpf_cnpj', ignoreDuplicates: false })
        if (error) { alert('Erro ao importar clientes: ' + error.message); return }
      }

      setResultClientes({ inseridos, atualizados })
    } finally {
      setImportandoClientes(false)
    }
  }

  async function carregarSafewebVendas() {
    setLoadingSafewebVendas(true)
    const { data } = await supabase
      .from('vendas_certificados')
      .select('*, cadastros_base(nome, cpf_cnpj)')
      .eq('validado_safeweb', true)
      .order('data_inicio_validade', { ascending: false })
      .limit(500)
    setSafewebVendas((data ?? []) as VendaRow[])
    setLoadingSafewebVendas(false)
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
              <Panel title="Lançar Venda" onClose={() => { setShowFormV(false); setClienteSelecionadoObj(null); setClienteSearch('') }}>
                {/* linha 1: Tipo Venda + Cliente + Novo Cliente */}
                <div className="grid grid-cols-1 md:grid-cols-[160px_1fr_auto] gap-3 mb-3">
                  <SelectInput label="Tipo Venda" value={formV2.tipo_venda}
                    onChange={v => setFormV2(p => ({ ...p, tipo_venda: v }))}
                    options={TIPO_VENDA_OPTIONS} />
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Cliente *</label>
                    <div className="relative flex gap-2">
                      <div className="relative flex-1">
                        <input
                          value={formV2.cadastro_base_id && clienteSelecionadoObj
                            ? `${clienteSelecionadoObj.cpf_cnpj} · ${clienteSelecionadoObj.nome}`
                            : clienteSearch}
                          onChange={e => {
                            const v = e.target.value
                            setClienteSearch(v)
                            if (formV2.cadastro_base_id) {
                              setFormV2(p => ({ ...p, cadastro_base_id: '' }))
                              setClienteSelecionadoObj(null)
                            }
                            if (clienteSearchTimerRef.current) clearTimeout(clienteSearchTimerRef.current)
                            clienteSearchTimerRef.current = setTimeout(() => void buscarClientes(v), 300)
                          }}
                          onFocus={() => { if (clienteResultados.length > 0) setClienteDropdownOpen(true) }}
                          onBlur={() => setTimeout(() => setClienteDropdownOpen(false), 150)}
                          placeholder="Nome, CPF, CNPJ ou telefone (mín. 3 caracteres)"
                          className="w-full border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 pr-8 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                        {clienteBuscando && (
                          <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-gray-400 pointer-events-none" />
                        )}
                        {clienteDropdownOpen && clienteResultados.length > 0 && (
                          <div className="absolute z-30 left-0 right-0 top-full mt-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl max-h-64 overflow-y-auto">
                            {clienteResultados.map(c => (
                              <button key={c.id} type="button"
                                onMouseDown={e => e.preventDefault()}
                                onClick={() => {
                                  setFormV2(p => ({ ...p, cadastro_base_id: c.id }))
                                  setClienteSelecionadoObj(c)
                                  setClienteSearch('')
                                  setClienteDropdownOpen(false)
                                  setClienteResultados([])
                                }}
                                className="w-full text-left px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800 border-b border-gray-100 dark:border-gray-800 last:border-0 transition-colors">
                                <div className="flex items-center justify-between gap-3">
                                  <div className="min-w-0">
                                    <p className="text-sm font-medium truncate">{c.nome}</p>
                                    {c.nome_fantasia && <p className="text-xs text-gray-400 truncate">{c.nome_fantasia}</p>}
                                  </div>
                                  <div className="text-right shrink-0">
                                    <p className="text-xs text-gray-500 font-mono">{c.cpf_cnpj}</p>
                                    {c.telefone && <p className="text-xs text-gray-400">{c.telefone}</p>}
                                    {(c.cidade || c.uf) && <p className="text-xs text-gray-400">{[c.cidade, c.uf].filter(Boolean).join('/')}</p>}
                                  </div>
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                        {clienteDropdownOpen && !clienteBuscando && clienteResultados.length === 0 && clienteSearch.length >= 3 && (
                          <div className="absolute z-30 left-0 right-0 top-full mt-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl px-4 py-3 text-sm text-gray-400">
                            Nenhum cliente encontrado para "{clienteSearch}"
                          </div>
                        )}
                      </div>
                      {formV2.cadastro_base_id && (
                        <button type="button" title="Limpar cliente"
                          onClick={() => { setFormV2(p => ({ ...p, cadastro_base_id: '' })); setClienteSearch(''); setClienteSelecionadoObj(null) }}
                          className="px-2 text-gray-400 hover:text-gray-600">
                          <X size={14} />
                        </button>
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
                  onCancel={() => { setShowFormV(false); setClienteSelecionadoObj(null); setClienteSearch('') }}
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
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h2 className="font-semibold text-gray-800 dark:text-gray-200">Catálogo de Certificados</h2>
              <div className="flex items-center gap-2 flex-wrap">
                {selectedCertIds.size > 0 && (
                  <button type="button" onClick={excluirCertificadosSelecionados}
                    className="flex items-center gap-1.5 px-3 py-2 bg-red-600 text-white text-xs font-medium rounded-lg hover:bg-red-700 transition-colors">
                    <Trash2 size={13} /> Excluir selecionados ({selectedCertIds.size})
                  </button>
                )}
                <input ref={importInputRef} type="file" accept=".csv,.tsv,.txt,.xls,.xlsx" className="hidden"
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

            {(() => {
              const allIds = certificados.map(c => c.id)
              const allSelected = allIds.length > 0 && allIds.every(id => selectedCertIds.has(id))
              const toggleAll = () => setSelectedCertIds(allSelected ? new Set() : new Set(allIds))
              const toggleOne = (id: string) => setSelectedCertIds(prev => {
                const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s
              })
              return (
                <DataTable headers={['', 'Cód', 'Nome', 'Descrição', 'Modelo', 'Validade', 'Tipo', 'Tipo Emissão', 'Produto AC', 'Preço Venda', 'Custo AC', 'Custo', 'Status', 'Ações']}>
                  {certificados.length === 0 ? (
                    <EmptyRow colSpan={14} label="Nenhum certificado cadastrado. Use 'Importar Planilha' ou 'Novo Certificado'." />
                  ) : (
                    <>
                      <tr className="bg-gray-50 dark:bg-gray-800/50">
                        <td className="px-4 py-2" colSpan={14}>
                          <label className="flex items-center gap-2 cursor-pointer text-xs text-gray-500 select-none">
                            <input type="checkbox" checked={allSelected} onChange={toggleAll}
                              className="w-4 h-4 rounded border-gray-300 text-blue-600 cursor-pointer" />
                            {allSelected ? 'Desmarcar todos' : `Selecionar todos (${certificados.length})`}
                          </label>
                        </td>
                      </tr>
                      {certificados.map(c => (
                        <tr key={c.id} className={cn('hover:bg-gray-50 dark:hover:bg-gray-800/50', !c.ativo && 'opacity-50', selectedCertIds.has(c.id) && 'bg-blue-50 dark:bg-blue-900/10')}>
                          <td className="px-4 py-3">
                            <input type="checkbox" checked={selectedCertIds.has(c.id)} onChange={() => toggleOne(c.id)}
                              className="w-4 h-4 rounded border-gray-300 text-blue-600 cursor-pointer" />
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-400">{c.codigo ?? '—'}</td>
                          <td className="px-4 py-3 font-medium text-sm">{c.tipo || '—'}</td>
                          <td className="px-4 py-3 text-xs text-gray-500 max-w-[160px] truncate" title={c.descricao ?? ''}>{c.descricao ?? '—'}</td>
                          <td className="px-4 py-3 text-xs text-gray-500">{c.modelo ?? '—'}</td>
                          <td className="px-4 py-3 text-sm">{c.validade || '—'}</td>
                          <td className="px-4 py-3 text-xs">{c.categoria ?? '—'}</td>
                          <td className="px-4 py-3 text-xs">{c.tipo_emissao_padrao ?? '—'}</td>
                          <td className="px-4 py-3 text-xs text-gray-400 max-w-[140px] truncate" title={c.produto_vinculado_ac ?? ''}>{c.produto_vinculado_ac ?? '—'}</td>
                          <td className="px-4 py-3 text-sm font-semibold">{c.preco_venda ? <span className="text-green-600 dark:text-green-400">{formatCurrency(c.preco_venda)}</span> : <span className="text-gray-400">—</span>}</td>
                          <td className="px-4 py-3 text-sm text-gray-500">{c.valor_custo_ac ? formatCurrency(c.valor_custo_ac) : '—'}</td>
                          <td className="px-4 py-3 text-sm text-gray-500">{c.valor_custo ? formatCurrency(c.valor_custo) : '—'}</td>
                          <td className="px-4 py-3"><StatusPill active={c.ativo} /></td>
                          <td className="px-4 py-3"><RowActions active={c.ativo} onEdit={() => editarCertificado(c)} onToggle={() => toggleCertificado(c)} onDelete={() => excluirCertificado(c.id)} /></td>
                        </tr>
                      ))}
                    </>
                  )}
                </DataTable>
              )
            })()}
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
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">Produtos e Preços</h4>
                      <div className="flex items-center gap-2 flex-wrap">
                        {selectedItemIds.size > 0 && (
                          <button type="button" onClick={excluirItensSelecionados}
                            className="flex items-center gap-1 px-2 py-1.5 bg-red-600 text-white text-xs rounded-lg hover:bg-red-700">
                            <Trash2 size={12} /> Excluir selecionados ({selectedItemIds.size})
                          </button>
                        )}
                        <input ref={importItensRef} type="file" accept=".csv,.tsv,.txt,.xls,.xlsx" className="hidden"
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

                    {(() => {
                      const allItemIds = itens.map(i => i.id)
                      const allItemsSel = allItemIds.length > 0 && allItemIds.every(id => selectedItemIds.has(id))
                      const toggleAllItems = () => setSelectedItemIds(allItemsSel ? new Set() : new Set(allItemIds))
                      const toggleOneItem = (id: string) => setSelectedItemIds(prev => {
                        const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s
                      })
                      return (
                        <DataTable headers={['', 'Cód', 'Certificado', 'Validade', 'Preço Venda', 'Custo', 'Repasse', 'Status', 'Ações']}>
                          {itens.length === 0
                            ? <EmptyRow colSpan={9} label="Nenhum produto nesta tabela." />
                            : (
                              <>
                                <tr className="bg-gray-50 dark:bg-gray-800/50">
                                  <td className="px-4 py-2" colSpan={9}>
                                    <label className="flex items-center gap-2 cursor-pointer text-xs text-gray-500 select-none">
                                      <input type="checkbox" checked={allItemsSel} onChange={toggleAllItems}
                                        className="w-4 h-4 rounded border-gray-300 text-blue-600 cursor-pointer" />
                                      {allItemsSel ? 'Desmarcar todos' : `Selecionar todos (${itens.length})`}
                                    </label>
                                  </td>
                                </tr>
                                {itens.map(item => {
                                  const cert = certificadoById.get(item.certificado_id)
                                  return (
                                    <tr key={item.id} className={cn('hover:bg-gray-50 dark:hover:bg-gray-800/50', !item.ativo && 'opacity-50', selectedItemIds.has(item.id) && 'bg-blue-50 dark:bg-blue-900/10')}>
                                      <td className="px-4 py-3">
                                        <input type="checkbox" checked={selectedItemIds.has(item.id)} onChange={() => toggleOneItem(item.id)}
                                          className="w-4 h-4 rounded border-gray-300 text-blue-600 cursor-pointer" />
                                      </td>
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
                                })}
                              </>
                            )
                          }
                        </DataTable>
                      )
                    })()}
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

        {/* ── IMPORTAR ───────────────────────────────────────── */}
        {tab === 'importar' && (
          <div className="space-y-6">

            {/* Relatório Safeweb */}
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6">
              <div className="flex items-center gap-3 mb-1">
                <div className="w-9 h-9 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                  <Upload size={18} className="text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-800 dark:text-gray-100">Relatório Mensal Safeweb</h3>
                  <p className="text-xs text-gray-500">Importa clientes e vendas do relatório XLS/XLSX recebido mensalmente da Safeweb.</p>
                </div>
              </div>

              <div className="mt-4 bg-gray-50 dark:bg-gray-800 rounded-xl p-4 text-xs text-gray-500 dark:text-gray-400 space-y-1">
                <p className="font-medium text-gray-700 dark:text-gray-300">Colunas esperadas (separadas por ponto-e-vírgula ou tabela XLS):</p>
                <p>Protocolo · Nome · Documento · Produto · Tipo de Emissão Realizada · Valor do Boleto</p>
                <p>Data Inicio Validade · Data Fim Validade · Numero de Série · VoucherCodigo · VoucherPercentual · VoucherValor</p>
                <p>Nome da Autoridade de Registro · Nome do Local de Atendimento · Status do Certificado · Nome do Parceiro</p>
                <p>E-mail do Titular · Telefone do Titular</p>
              </div>

              {resultSafeweb && (
                <div className="mt-4 space-y-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-green-700 dark:text-green-400">
                    <Check size={16} /> Batimento concluído
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3 text-center">
                      <p className="text-2xl font-bold text-gray-800 dark:text-gray-100">{resultSafeweb.clientes}</p>
                      <p className="text-xs text-gray-500 mt-1">Clientes processados</p>
                    </div>
                    <div className="bg-green-50 dark:bg-green-900/20 rounded-xl p-3 text-center">
                      <p className="text-2xl font-bold text-green-700 dark:text-green-400">{resultSafeweb.atualizados}</p>
                      <p className="text-xs text-gray-500 mt-1">Batidos (já no CRM)</p>
                    </div>
                    <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-3 text-center">
                      <p className="text-2xl font-bold text-blue-700 dark:text-blue-400">{resultSafeweb.novos}</p>
                      <p className="text-xs text-gray-500 mt-1">Novos (só na Safeweb)</p>
                    </div>
                    <div className={cn('rounded-xl p-3 text-center', resultSafeweb.divergentes > 0 ? 'bg-amber-50 dark:bg-amber-900/20' : 'bg-gray-50 dark:bg-gray-800')}>
                      <p className={cn('text-2xl font-bold', resultSafeweb.divergentes > 0 ? 'text-amber-700 dark:text-amber-400' : 'text-gray-400')}>{resultSafeweb.divergentes}</p>
                      <p className="text-xs text-gray-500 mt-1">No CRM sem validação</p>
                    </div>
                  </div>
                  {resultSafeweb.divergentes > 0 && (
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      Existem <strong>{resultSafeweb.divergentes}</strong> venda(s) com status "emitido" no CRM que não foram encontradas na planilha Safeweb.
                      Acesse a aba <strong>Lançar Vendas</strong> e filtre por "Não validadas" para revisar e ajustar manualmente.
                    </p>
                  )}
                </div>
              )}

              <div className="mt-5 flex items-center gap-3">
                <input ref={importSafewebRef} type="file" accept=".xls,.xlsx,.csv,.tsv" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) void importarRelatorioSafeweb(f); e.target.value = '' }} />
                <button type="button" onClick={() => importSafewebRef.current?.click()} disabled={importandoSafeweb}
                  className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-colors">
                  {importandoSafeweb ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                  {importandoSafeweb ? 'Importando...' : 'Selecionar arquivo'}
                </button>
                <span className="text-xs text-gray-400">Suporta XLS, XLSX, CSV</span>
              </div>

              <p className="mt-4 text-xs text-amber-600 dark:text-amber-400">
                Antes de importar, aplique a migration <code className="font-mono bg-amber-50 dark:bg-amber-900/20 px-1 rounded">20260522_vendas_safeweb_campos.sql</code> no Supabase.
              </p>
            </div>

            {/* Importar Clientes (sistema antigo) */}
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6">
              <div className="flex items-center gap-3 mb-1">
                <div className="w-9 h-9 rounded-xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                  <UserCheck size={18} className="text-purple-600 dark:text-purple-400" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-800 dark:text-gray-100">Importar Base de Clientes</h3>
                  <p className="text-xs text-gray-500">Importa o cadastro de clientes exportado do sistema antigo (CSV/XLS com campos de endereço).</p>
                </div>
              </div>

              <div className="mt-4 bg-gray-50 dark:bg-gray-800 rounded-xl p-4 text-xs text-gray-500 dark:text-gray-400 space-y-1">
                <p className="font-medium text-gray-700 dark:text-gray-300">Colunas esperadas:</p>
                <p>Tipo · CNPJ/CPF · Nome/Razão Social · Nome Fantasia · E-mail · DDD · Telefone</p>
                <p>CEP · Endereço · Número · Complemento · Bairro · Cidade · UF · IE · IM · Contador</p>
              </div>

              {resultClientes && (
                <div className="mt-4 flex items-center gap-3 px-4 py-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl text-sm text-green-700 dark:text-green-400">
                  <Check size={16} />
                  <span>Importação concluída: <strong>{resultClientes.inseridos}</strong> novo(s) · <strong>{resultClientes.atualizados}</strong> atualizado(s).</span>
                </div>
              )}

              <div className="mt-5 flex items-center gap-3">
                <input ref={importClientesRef} type="file" accept=".xls,.xlsx,.csv,.tsv" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) void importarClientes(f); e.target.value = '' }} />
                <button type="button" onClick={() => importClientesRef.current?.click()} disabled={importandoClientes}
                  className="flex items-center gap-2 px-5 py-2.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-colors">
                  {importandoClientes ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                  {importandoClientes ? 'Importando...' : 'Selecionar arquivo'}
                </button>
                <span className="text-xs text-gray-400">Suporta XLS, XLSX, CSV</span>
              </div>
            </div>

            {/* Dados importados da Safeweb */}
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6">
              <div className="flex items-center justify-between gap-3 mb-1 flex-wrap">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-teal-100 dark:bg-teal-900/30 flex items-center justify-center">
                    <List size={18} className="text-teal-600 dark:text-teal-400" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-800 dark:text-gray-100">Dados Importados da Safeweb</h3>
                    <p className="text-xs text-gray-500">Visualize as vendas validadas pelo relatório Safeweb (validado_safeweb = true).</p>
                  </div>
                </div>
                <button type="button"
                  onClick={() => {
                    const next = !safewebViewerOpen
                    setSafewebViewerOpen(next)
                    if (next) void carregarSafewebVendas()
                  }}
                  className="flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium rounded-xl transition-colors">
                  {safewebViewerOpen ? 'Fechar' : 'Ver registros'}
                </button>
              </div>

              {safewebViewerOpen && (
                <div className="mt-4">
                  {loadingSafewebVendas ? (
                    <div className="flex items-center gap-2 text-gray-400 text-sm py-4"><Loader2 size={16} className="animate-spin" /> Carregando...</div>
                  ) : safewebVendas.length === 0 ? (
                    <p className="text-sm text-gray-400 py-4">Nenhum registro importado da Safeweb encontrado.</p>
                  ) : (
                    <>
                      <p className="text-xs text-gray-500 mb-3">{safewebVendas.length} registro(s) encontrado(s)</p>
                      <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800">
                        <table className="w-full text-xs min-w-[1400px]">
                          <thead>
                            <tr className="bg-gray-50 dark:bg-gray-800/50 text-gray-500 dark:text-gray-400 uppercase tracking-wide text-left border-b border-gray-200 dark:border-gray-800">
                              {['Protocolo', 'Cliente', 'CPF/CNPJ', 'Produto', 'Valor', 'Início Validade', 'Vencimento', 'Nº Série', 'Voucher', 'AR', 'Parceiro Safeweb', 'Status Cert.'].map(h => (
                                <th key={h} className="px-3 py-2 font-medium whitespace-nowrap">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                            {safewebVendas.map(v => (
                              <tr key={v.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                                <td className="px-3 py-2 font-mono text-blue-600 dark:text-blue-400 whitespace-nowrap">{v.protocolo_numero ?? '—'}</td>
                                <td className="px-3 py-2 max-w-[160px] truncate">{(v.cadastros_base as { nome?: string } | null)?.nome ?? v.nome_faturamento ?? '—'}</td>
                                <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{(v.cadastros_base as { cpf_cnpj?: string } | null)?.cpf_cnpj ?? v.documento_faturamento ?? '—'}</td>
                                <td className="px-3 py-2 text-gray-600 dark:text-gray-300 max-w-[140px] truncate">{v.tipo_produto ?? '—'}</td>
                                <td className="px-3 py-2 text-right font-semibold text-green-600 dark:text-green-400 whitespace-nowrap">{v.valor_venda ? formatCurrency(v.valor_venda) : '—'}</td>
                                <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{(v as any).data_inicio_validade ? new Date((v as any).data_inicio_validade).toLocaleDateString('pt-BR') : '—'}</td>
                                <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{v.data_vencimento ? new Date(v.data_vencimento).toLocaleDateString('pt-BR') : '—'}</td>
                                <td className="px-3 py-2 text-gray-500 font-mono max-w-[120px] truncate">{(v as any).numero_serie ?? '—'}</td>
                                <td className="px-3 py-2 text-gray-500">{(v as any).voucher_codigo ?? '—'}</td>
                                <td className="px-3 py-2 text-gray-500 max-w-[120px] truncate">{(v as any).nome_ar ?? '—'}</td>
                                <td className="px-3 py-2 text-gray-500 max-w-[120px] truncate">{(v as any).nome_parceiro_safeweb ?? '—'}</td>
                                <td className="px-3 py-2">
                                  {(v as any).status_certificado
                                    ? <span className="px-1.5 py-0.5 rounded-full bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400 whitespace-nowrap">{(v as any).status_certificado}</span>
                                    : '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

          </div>
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

function RowActions({ active, onEdit, onToggle, onDelete }: { active: boolean; onEdit: () => void; onToggle: () => void; onDelete?: () => void }) {
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
      {onDelete && (
        <button type="button" title="Excluir" onClick={onDelete}
          className="w-8 h-8 rounded-lg text-gray-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 flex items-center justify-center transition-colors">
          <Trash2 size={14} />
        </button>
      )}
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
