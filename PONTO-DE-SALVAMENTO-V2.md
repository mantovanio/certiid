# Ponto de Salvamento — Migração V2 (CertiID 1.0.0)

> Última atualização: 2026-05-15
> Para retomar em nova sessão de IA sem perder contexto.

---

## O que já foi feito

### 1. SQL — Estrutura V2 aplicada no Supabase

**Arquivo:** `sql/migration_v2_oficial.sql` — APLICADO (Success. No rows returned)

Cria 23 tabelas novas em ordem de dependência:
`cadastros_base` → `empresas_cliente` → `titulares_certificado` → `pontos_atendimento`
→ `pontos_atendimento_agentes` → `vendas_certificados` → `agendamentos_validacao`
→ `produtos_emitidos` → `documentos_financeiros` → `bancos` → `contas_bancarias_v2`
→ `formas_pagamento_v2` → `formas_pagamento_disponibilidade` → `plano_contas`
→ `centros_custo` → `regras_comissao` → `comissoes_lancamentos`
→ `fechamentos_agente_lotes` → `fechamentos_agente_itens`
→ `fechamentos_agente_itens_comissoes` → `ordens_pagamento`
→ `nfse_configuracoes` → `nfse_emitidas`

Extensões via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`:

**`renovacoes`** recebeu:
`venda_certificado_id`, `produto_emitido_id`, `cadastro_base_id`, `empresa_id`,
`titular_id`, `vendedor_fk_id`, `agente_registro_fk_id`, `contador_fk_id`,
`snapshot_json`, `deleted_at`, `deleted_by`, `motivo_exclusao`

**`lancamentos_financeiros`** recebeu:
`conta_bancaria_v2_id`, `plano_conta_id`, `centro_custo_id`,
`cadastro_base_id`, `venda_certificado_id`, `produto_emitido_id`, `documento_fiscal_id`

**Atenção:** `certificado_id` em `vendas_certificados` e `produtos_emitidos` é UUID plain (sem FK)
porque `public.certificados` não existia no DB quando a migration rodou.
FK a adicionar depois:

```sql
ALTER TABLE public.vendas_certificados
  ADD CONSTRAINT vendas_certificados_certificado_id_fkey
  FOREIGN KEY (certificado_id) REFERENCES public.certificados(id) ON DELETE SET NULL;

ALTER TABLE public.produtos_emitidos
  ADD CONSTRAINT produtos_emitidos_certificado_id_fkey
  FOREIGN KEY (certificado_id) REFERENCES public.certificados(id) ON DELETE SET NULL;
```

---

### 2. Segurança — supabaseAdmin

**`src/lib/supabaseAdmin.ts`** — FEITO
Era: `service_role key` hardcoded como string literal.
Agora: usa `import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY` com guard de inicialização.

**`.env`** — FEITO: `VITE_SUPABASE_SERVICE_ROLE_KEY=<valor real>`
**`.env.example`** — FEITO: `VITE_SUPABASE_SERVICE_ROLE_KEY=coloque_sua_service_role_key_aqui`

---

### 3. TypeScript — 23+ tipos V2 adicionados

**`src/types/index.ts`** — FEITO (tipos inseridos após linha ~356, seção `// V2`)

Novos tipos: `CadastroBase`, `NovoCadastroBase`, `EmpresaCliente`, `TitularCertificado`,
`PontoAtendimento`, `PontoAtendimentoAgente`, `StatusVendaCertificado`, `StatusPedidoProtocolo`,
`TipoComissao`, `TipoParceiro`, `VendaCertificado`, `NovaVendaCertificado`,
`AgendamentoValidacao`, `ProdutoEmitido`, `DocumentoFinanceiro`, `Banco`,
`ContaBancariaV2`, `FormaPagamentoV2`, `FormaPagamentoDisponibilidade`,
`PlanoContas`, `CentroCusto`, `RegraComissao`, `ComissaoLancamento`,
`FechamentoAgenteLote`, `FechamentoAgenteItem`, `FechamentoAgenteItemComissao`,
`OrdemPagamento`, `NfseConfiguracao`, `NfseEmitida`,
`RenovacaoV2Campos`, `RenovacaoV2` (= `Renovacao & RenovacaoV2Campos`),
`LancamentoV2Campos`, `LancamentoV2` (= `Lancamento & LancamentoV2Campos`)

---

### 4. Tela Comercial

**`src/pages/Comercial.tsx`** — FEITO

Aba "Lançar Vendas" migrada de `vendas`/`clientes_comerciais` para:
- `vendas_certificados` (tabela central V2)
- `cadastros_base` (campo `nome`, não mais `nome_razao_social`)
- `titulares_certificado` (upsert com `onConflict: 'cpf'`)
- `pontos_atendimento` (obrigatório; exibe alerta amarelo se tabela vazia)

Snapshot de faturamento copiado do `cadastros_base` no momento da venda.
`forma_pagamento` armazenada em `metadata.forma_pagamento` (texto, sem FK).
Status da venda: 6 valores novos (`rascunho`, `vendido`, `agendado`, `em_validacao`, `emitido`, `cancelado`).

Abas Agenda, Certificados, Preços, Comissões e Pagamento: **inalteradas** (tabelas V1).

---

### 5. Tela Renovações

**`src/pages/Renovacoes.tsx`** — FEITO

- Tipo `Renovacao` → `RenovacaoV2` em: estado `lista`, `listaRef`, e funções
  `tplValues`, `criarLeadKanban`, `marcarRenovado`, `marcarNaoRenovado`,
  `enviarWhatsApp`, `enviarEmail`, `CSV_FIELDS`
- Query `fetchRenovacoes` com `.is('deleted_at', null)` (respeita soft delete)
- Mapeamento `enriched` inclui todos os 12 campos V2 novos (null/`{}` por padrão)
- Lógica existente intacta: CSV import, bulk WhatsApp/e-mail, templates, automação, kanban

**Atualizações locais de 2026-05-15 — AINDA NÃO COMMITADAS/PUBLICADAS**

- Importação de planilhas agora aceita `.csv`, `.xls` e `.xlsx`
- Download do modelo de importação agora gera `modelo_renovacoes.xlsx`
- Templates:
  - carregam automaticamente ao abrir a tela
  - podem ser escolhidos separadamente para envio de `WhatsApp` e `E-mail`
  - cada canal tem `template padrão`
  - a interface mostra qual template está em uso no envio
- Exclusão:
  - exclusão individual e em lote via `soft delete`
  - `deleted_at`, `deleted_by` e `motivo_exclusao`
- Tabela:
  - coluna `Ações` movida para o início da linha
  - ações trocadas para ícones com `tooltip`
- Novo botão `Editar contato`
  - abre modal direto da fila de renovações
  - **regra nova**: só permite alterar `e-mail` e `telefone`
  - nome, CPF, CNPJ e demais dados estruturais **não podem** ser alterados por essa tela
- Permissões aplicadas na interface:
  - `admin`: pode editar contato e excluir registros
  - `agente_registro`: pode editar contato
  - `usuario comum`: não pode editar cadastro nem excluir

**Observação importante de regra de negócio**

- Alterações de `nome`, `CPF`, `CNPJ`, `razão social` e outros dados mestres devem acontecer no **cadastro principal**, para refletirem no sistema inteiro.

---

### 6. Tela Financeiro

**`src/pages/Financeiro.tsx`** — FEITO

- Tipo `Lancamento` → `LancamentoV2` no estado `lancs` e no cast `setLancs`
- `NovoLancamento` mantido (formulário ainda usa campos base de `Lancamento`)
- Lógica existente intacta: filtros, totais, update de status

---

### 7. Pontos de Atendimento em Configurações

**`src/pages/Configuracoes.tsx`** — FEITO

Nova aba "Pontos de Atendimento" adicionada:
- Lista todos os registros com toggle ativo/inativo
- Formulário criar/editar: código, nome*, endereço, cidade, UF, status
- Somente admin vê botões de edição (segue padrão das outras abas)
- Estado vazio exibe orientação para criar o primeiro registro
- Resolve a pendência de infraestrutura #1 sem SQL manual

### Telas sem alterações necessárias

- `Dashboard.tsx` — lê `leads_contabilidade` (intacta)
- `Relatorios.tsx` — dados mock/estáticos, sem queries ao Supabase
- `Parceiros.tsx` — lê `parceiros` (intacta)

---

### 8. Tela Comercial — atualização operacional local

**`src/pages/Comercial.tsx`** — PARCIALMENTE FEITO NO LOCAL, AINDA NÃO COMMITADO/PUBLICADO

Evolução da aba `Lançar Vendas` para ficar mais próxima do fluxo operacional desejado:

- filtros no topo por:
  - `data inicial`
  - `data final`
  - `pedido`
  - `protocolo`
  - `cliente/documento`
  - `status`
- tabela operacional com colunas:
  - `ações`
  - `data`
  - `pedido`
  - `protocolo`
  - `cliente`
  - `documento`
  - `produto`
  - `emissão`
  - `ponto`
  - `valor`
  - `pagamento`
  - `status`
- ações por linha:
  - `editar cliente`
  - `nova venda para esse cliente`
  - `agendar atendimento`
- edição de cliente reutiliza o formulário já existente dentro da tela
- campo `Valor Custo` foi removido da interface de `Registrar Venda`

**Observação**

- A tela ainda não está no nível final da referência enviada pelo usuário. Ela foi só o primeiro bloco da transformação operacional.

---

## O que falta fazer

### Pendências imediatas de interface

**Renovações**
- padronizar melhor a experiência de template para o usuário final
- decidir se a escolha do template ficará só em seletor superior ou também por ação individual
- validar se o modal de `Editar contato` ficará apenas para `email/telefone` ou se depois haverá atalho para abrir o cadastro mestre

**Comercial**
- continuar a transformação da aba `Lançar Vendas` para ficar mais próxima da referência operacional
- incluir mais ações por linha se necessário
- ligar melhor a consulta operacional com pedido, protocolo e agenda

**Permissões**
- hoje a regra foi aplicada na interface de `Renovações`
- ainda falta propagar a mesma lógica para outras telas operacionais
  - usuário comum não altera cadastro
  - agente de registro pode alterar cadastro
  - somente admin exclui vendas ou altera tudo

### Pendências de infraestrutura

**1. Ponto de atendimento** — criar via Configurações > Pontos de Atendimento (já disponível na UI).

**2. FK `certificado_id`** — adicionar após confirmar `certificados` no DB (SQL acima, seção 1).

**3. `formas_pagamento_v2`** — tabela nova está vazia.
Comercial ainda usa a antiga `formas_pagamento`. Migrar catálogo quando conveniente.

**4. Dependência nova instalada localmente**
- `xlsx` adicionada em `package.json` / `package-lock.json`
- ainda não commitada neste ponto de salvamento

---

## Tabelas V1 que ainda existem (convivem sem conflito)

`vendas`, `clientes_comerciais`, `agendamentos`, `certificados`, `precos_certificados`,
`faixas_comissao`, `formas_pagamento`, `renovacoes`, `lancamentos_financeiros`, `parceiros`

Remoção é opcional e pode ser feita em etapa futura.

---

## Regras de segurança a manter

- `VITE_SUPABASE_SERVICE_ROLE_KEY` nunca hardcoded — sempre via `.env` (gitignored)
- `supabaseAdmin` bypassa RLS — usar somente em operações admin; nunca expor a usuários comuns
- Campos sensíveis de `nfse_configuracoes` (senhas, chaves API) nunca no frontend

---

## Estado atual do Git no momento deste salvamento

**Arquivos alterados localmente e ainda não publicados**

- `src/pages/Renovacoes.tsx`
- `src/pages/Comercial.tsx`
- `src/pages/Parceiros.tsx`
- `src/types/index.ts`
- `package.json`
- `package-lock.json`
- `sql/parceiros_gestao_v2.sql`

### Bloco novo em andamento: Parceiros

Foi iniciado localmente um novo bloco de gestão em `Parceiros`, com:

- formulário muito mais completo de cadastro
- possibilidade de editar parceiros existentes
- busca por código, documento, razão social e cidade
- campos operacionais de:
  - acesso
  - contatos adicionais
  - endereço
  - token
  - inscrições
  - bloqueios
  - mensageria
  - gestores
  - dados bancários
  - centro de custo

**SQL de apoio**

- `sql/parceiros_gestao_v2.sql`

**Situação**

- esse SQL já foi executado no Supabase nesta sessão, com retorno do usuário:
  `feito`

**Arquivos locais que não devem entrar no commit por padrão**

- `.claude/`
- `.vscode/`
