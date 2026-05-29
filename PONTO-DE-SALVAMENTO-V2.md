# Ponto de Salvamento — CertiID

Última atualização: 28/05/2026 — sessão 3

## Estado atual

Sistema funcional em produção local. Smoke test executado contra banco real em 28/05/2026 — **resultado: APROVADO** (todos os 5 domínios verdes).

Módulos estáveis:

- Comercial (wizard Nova Venda reestruturado)
- Chat ao Vivo / Evolution API
- Financeiro
- Configurações (usuários com criação de loja do marketplace)
- Marketplace público (`/loja/:slug`)

---

## O que ficou pronto — Sessão 3 (28/05/2026)

### 1. Skill `/smoke-test`

Arquivo: [.claude/skills/smoke-test.md](/.claude/skills/smoke-test.md)

- Skill de validação pré-deploy em 5 domínios: RLS, Schema, Edge Functions, Dados de negócio, Regressões de UX
- Executado contra banco de produção — todos aprovados
- Tabelas verificadas: `vendas_certificados`, `leads_contabilidade`, `tabelas_preco`, `lojas_marketplace`, `lgpd_solicitacoes_exclusao`, `agendamentos`, `agendamentos_validacao`, `nfse_emitidas`

### 2. Correção de vazamento de mensagens de erro (OWASP A04)

Arquivo: [src/pages/Comercial.tsx](/src/pages/Comercial.tsx)

- Corrigidos 12 pontos em fluxos admin que expunham `error.message` diretamente ao usuário
- Todos substituídos por `traduzirErroDb(error, 'contexto')` — mensagens em português, detalhe técnico apenas no `console.error`
- Contextos corrigidos: disponibilidade, bloqueio, agente-tabela, loja-marketplace, importar-certificados, excluir-tabela, regra-tabela-matriz, importar-produtos, importar-clientes, importar-vendas, importar-clientes-leads, excluir-nfse

### 3. Redesign do wizard "Nova Venda" — produto primeiro

Arquivo: [src/pages/Comercial.tsx](/src/pages/Comercial.tsx)

**Antes:** formulário linear único com `<select>` gigante de produtos.

**Depois:** wizard em 3 etapas:

1. **Produto** — picker visual com filtros por tipo, modelo e prazo; cards agrupados por categoria (inspirado no Certifast); seleção define tabela automaticamente
2. **Cadastro** — busca/criação de cliente inline, contador/parceiro
3. **Detalhes** — tipo de emissão, pagamento, vencimento, ponto de atendimento, observações

Estado novo: `vendaWizardStep: 'produto' | 'cadastro' | 'detalhes'` e `filtrosPicker: { tipo, modelo, prazo }`.

`fecharFormVenda()` centraliza o reset de todo o estado do wizard.

Computed values adicionados:

- `todosItensDisponiveisComCert` — cruza todas as tabelas ativas com itens e certificados
- `tiposNoPicker`, `modelosNoPicker`, `prazosNoPicker` — opções dinâmicas dos filtros
- `itensFiltradosPicker` — itens filtrados para exibição no picker

Bloco de links marketplace removido do passo 3 (pertence à configuração, não ao formulário de venda).

### 4. Remoção do marketplace da aba Comercial

Arquivo: [src/pages/Comercial.tsx](/src/pages/Comercial.tsx)

Removido:

- Aba "Marketplace" (gerenciamento de lojas, links por produto, formulário create/edit)
- Botão flutuante "Links Produtos" visível em todas as abas
- 2 botões marketplace em cada linha de venda ("Abrir" e "Copiar link")
- 2 botões marketplace em "Ações rápidas"
- Estados: `lojasMarketplace`, `marketplaceOwners`, `showFormLoja`, `editingLojaId`, `formLoja`, `showLinksProdutosPanel`, `selectedLinksLojaId`
- Funções: `slugifyLoja`, `resolveLojaBaseUrl`, `buildLojaProdutoUrl`, `abrirNovaLojaMarketplace`, `editarLojaMarketplace`, `salvarLojaMarketplace`, `toggleLojaMarketplace`, `obterLinkMarketplaceDaVenda`
- Query de `lojas_marketplace` e `profiles(owners)` do `fetchCatalogo`
- Tipos/constantes: `LojaMarketplaceForm`, `LojaMarketplaceConfig`, `EMPTY_LOJA_MARKETPLACE`, `OWNER_LOJA_OPTIONS`
- Imports: `Store`, `OwnerTipoLojaMarketplace`, `LojaMarketplace`

Mantido:

- `copiarMarketplaceLink` e `abrirMarketplaceLink` — ainda usados na aba Tabelas para o campo `link_safeweb` de cada produto
- Página pública `MarketplaceLoja.tsx` intacta

**Motivo:** loja do marketplace é atributo do vendedor — gerenciamento pertence ao cadastro do vendedor em Configurações, não solto na aba comercial.

### 5. Criação de loja do marketplace no cadastro de vendedor

Arquivo: [src/pages/Configuracoes.tsx](/src/pages/Configuracoes.tsx)

Em **Configurações → Usuários**:

**Criação:**

- Ao selecionar perfil "Vendedor / Parceiro", aparece seção azul "Loja do Marketplace (opcional)"
- Campo nome da loja; ao preencher, exibe seletor de tabela de preço
- Após criar usuário, se nome preenchido, insere automaticamente em `lojas_marketplace` com `owner_profile_id = novoUserId`
- `createAdminManagedUser()` já retornava `userId` — aproveitado sem alteração no backend

**Edição inline:**

- Quando `editForm.perfil === 'vendedor'`, aparece seção "Loja do Marketplace" abaixo das permissões
- Mostra loja existente (nome + tabela + slug) com botão "Editar loja"
- Se não tem loja: "Nenhuma loja configurada ainda" com botão "Criar loja"
- Formulário inline cria ou atualiza a loja sem recarregar a página

`AbaUsuarios` passou a carregar `tabelas_preco` e `lojas_marketplace` junto com o `load()`.

---

## O que ficou pronto — Sessão 2 (26/05/2026)

### Bloco anterior: Evolution / Chat ao Vivo / Documentos / Paginação

Ver detalhes no histórico — resumo:

- chat interno com áudio, imagem, vídeo, nota interna, transferência
- roteamento de `message_received` e `message_sent` para Chat ao Vivo
- documentos do contato em modo híbrido (Supabase Storage ou servidor próprio)
- paginação operacional em Chat, Clientes, Financeiro

### Certificados e Marketplace (sessão 2)

- Modal de edição de certificado via `createPortal` (z-index 9999)
- Campo `periodo_uso` nos certificados (ex: "4 meses", "1 ano")
- Tipo de emissão "online/vídeo/remoto" exibido como **Fast** no marketplace
- Cards do marketplace reestruturados: Nome → Descrição → badges

---

## Arquivos principais

| Arquivo | Responsabilidade |
| --- | --- |
| [src/pages/Comercial.tsx](/src/pages/Comercial.tsx) | Vendas, wizard produto-primeiro, catálogo, tabelas, comissões |
| [src/pages/Configuracoes.tsx](/src/pages/Configuracoes.tsx) | Usuários, loja do vendedor, integrações, fiscal, pagamentos |
| [src/pages/MarketplaceLoja.tsx](/src/pages/MarketplaceLoja.tsx) | Página pública de checkout do marketplace |
| [src/components/ChatPanel.tsx](/src/components/ChatPanel.tsx) | Chat ao vivo, timeline, áudio, documentos |
| [src/pages/ChatAoVivo.tsx](/src/pages/ChatAoVivo.tsx) | Container do chat, filtros, Kanban |
| [supabase/functions/evolution-webhook/index.ts](/supabase/functions/evolution-webhook/index.ts) | Webhook da Evolution API |
| [supabase/functions/marketplace-checkout/index.ts](/supabase/functions/marketplace-checkout/index.ts) | Edge Function de checkout público |
| [src/lib/communication.ts](/src/lib/communication.ts) | Envio de mensagens, comunicação automática |
| [src/lib/security.ts](/src/lib/security.ts) | Permissões, perfis, RLS helpers |
| [.claude/skills/smoke-test.md](/.claude/skills/smoke-test.md) | Skill de validação pré-deploy |

---

## Migrations relevantes (ordem de aplicação)

```text
20260525_nfse_multimunicipio.sql
20260526_evolution_integration.sql
20260526_chat_transfer_responsavel.sql
20260526_chat_lead_documentos.sql
20260526_chat_lead_documentos_storage.sql
20260523_marketplace_lojas.sql
20260523_marketplace_public_read.sql
20260523_marketplace_checkout_venda.sql
20260523_bloco4_pagamentos.sql
20260523_agenda_online_v2.sql
```

---

## Edge Functions ativas

| Função | Autenticação | Descrição |
| --- | --- | --- |
| `evolution-webhook` | JWT obrigatório | Recebe eventos da Evolution API |
| `marketplace-checkout` | Pública (`--no-verify-jwt`) | Checkout do marketplace sem login |
| `payment-webhook` | JWT obrigatório | Webhook de pagamentos |
| `admin-users` | JWT obrigatório | CRUD de usuários via admin |
| `notify-new-user` | JWT obrigatório | Notificação de novo usuário |

Legado presente (não remover sem validar):

- `chatwoot-webhook`

---

## Arquitetura do marketplace

```text
Vendedor → Configurações → Usuários → [Criar Loja]
                                           ↓
                              lojas_marketplace (owner_tipo='vendedor', owner_profile_id=userId)
                                           ↓
                              /loja/:slug  →  MarketplaceLoja.tsx  →  marketplace-checkout (Edge Function)
                                           ↓
                              vendas_certificados (loja_marketplace_id preenchido)
```

**Regra de acesso:**

- Admin vê e edita todas as lojas via Configurações
- Vendedor vê/edita apenas sua própria loja via Configurações
- Público acessa a loja pela URL sem autenticação

---

## Pontos pendentes ou sensíveis

### Chat / mídia

- imagem e vídeo recebidos tratados — validar visualmente em fluxo real
- salvar mídia recebida direto no contato ainda pode melhorar (botão por bolha)
- editar/apagar mensagem enviada: não implementado (depende de suporte real da Evolution)

### Documentos do contato

- se bucket não existir, upload falha
- se policies RLS não existirem, erro de acesso
- modo "Servidor próprio" ainda depende de endpoint externo

### Marketplace — próximos blocos naturais

- **Modo `link_direto`** na loja: escolha do produto fixo ao editar a loja em Configurações (campo `item_fixo_id` + select de produto da tabela)
- **Link de compartilhamento** para o vendedor: exibir a URL da loja na seção de edição para copiar/compartilhar
- **Comissão automática** por loja: vendas originadas do marketplace já gravam `loja_marketplace_id`, mas o cálculo de comissão ainda não lê esse campo

### Fiscal / NFS-e

- emissão unitária estável
- emissão em lote via UI pronta
- cancelamento fiscal não implementado (depende de homologação municipal)

---

## Validação contínua

```powershell
npx tsc --noEmit   # zero erros
npm run build      # build limpo
```

Smoke test:

```text
/smoke-test   # valida RLS, schema, Edge Functions, dados de negócio e regressões de UX
```

Último smoke test: 28/05/2026 — **APROVADO** (todos os 5 domínios).

---

## Branch atual

`main` — commits entregues em 28/05/2026:

- `db74dcf` refactor: remove marketplace tab do Comercial
- `a72437a` feat: loja do marketplace no cadastro de vendedor
- `6c33c36` chore: assets, smoke-test e ajustes marketplace
