# CertiID — Documentação Técnica para Desenvolvedores

> CRM para gestão de vendas e renovações de certificados digitais.  
> Site: https://certiid.mantovan.com.br  
> Repositório: https://github.com/mantovanio/certiid

---

## Sumário

1. [Stack e Arquitetura](#1-stack-e-arquitetura)
2. [Variáveis de Ambiente](#2-variáveis-de-ambiente)
3. [Banco de Dados — Tabelas e Schemas](#3-banco-de-dados--tabelas-e-schemas)
4. [Autenticação e Controle de Acesso](#4-autenticação-e-controle-de-acesso)
5. [API Supabase — Referência de Operações](#5-api-supabase--referência-de-operações)
6. [Sistema de Comunicação](#6-sistema-de-comunicação)
7. [Webhook — Chatwoot Edge Function](#7-webhook--chatwoot-edge-function)
8. [Integrações Externas](#8-integrações-externas)
9. [Tipos TypeScript](#9-tipos-typescript)
10. [Páginas e Funcionalidades](#10-páginas-e-funcionalidades)
11. [Deploy e Infraestrutura](#11-deploy-e-infraestrutura)
12. [Notas de Segurança](#12-notas-de-segurança)

---

## 1. Stack e Arquitetura

| Camada | Tecnologia |
|---|---|
| Frontend | React 19 + TypeScript 6 + Vite 8 |
| Estilização | Tailwind CSS 4 + Radix UI |
| Gráficos | Recharts 3 |
| Estado global | Redux + Redux Thunk |
| Backend | Supabase (PostgreSQL + Auth + Realtime + Edge Functions) |
| Servidor | Nginx (dentro de container Docker) |
| Orquestração | Docker Swarm |
| Reverse proxy | Traefik + Let's Encrypt (SSL automático) |
| CI/CD | GitHub Actions → SSH → VPS |

### Fluxo de dados

```
Usuário → Traefik (HTTPS) → Nginx → React SPA → Supabase Client (SDK)
                                                    ↓
                                         Supabase PostgreSQL
                                         Supabase Auth
                                         Supabase Realtime
                                         Supabase Edge Functions
```

---

## 2. Variáveis de Ambiente

### Frontend (prefixo `VITE_` — injetadas no build)

| Variável | Descrição | Exemplo |
|---|---|---|
| `VITE_SUPABASE_URL` | URL do projeto Supabase | `https://xxx.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Chave pública anônima do Supabase | `eyJhbGci...` |

> ⚠️ Variáveis `VITE_` são **baked** no bundle JavaScript em build time. Nunca coloque secrets aqui.

### GitHub Actions Secrets

| Secret | Descrição |
|---|---|
| `VPS_HOST` | IP da VPS (ex: `147.79.111.76`) |
| `VPS_USER` | Usuário SSH (ex: `root`) |
| `VPS_SSH_KEY` | Chave privada SSH em **base64** |
| `VITE_SUPABASE_URL` | Passado como build arg ao Docker |
| `VITE_SUPABASE_ANON_KEY` | Passado como build arg ao Docker |

### Supabase Edge Functions (configurar em Supabase Dashboard → Settings → Secrets)

| Variável | Descrição |
|---|---|
| `SUPABASE_URL` | URL do projeto (automático no Supabase) |
| `SUPABASE_SERVICE_ROLE_KEY` | Chave de serviço admin (automático no Supabase) |

### Arquivo `.env` na VPS (`/opt/certiid/.env`)

```env
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGci...
```

> Este arquivo **não está no git** (`.gitignore`). Recrie manualmente se a VPS for resetada.

---

## 3. Banco de Dados — Tabelas e Schemas

### 3.1 `profiles` (auth_schema.sql)

Perfil de usuário criado automaticamente via trigger no signup.

| Coluna | Tipo | Descrição |
|---|---|---|
| `id` | uuid PK | FK → `auth.users.id` |
| `nome` | text | Nome do usuário |
| `email` | text | Email |
| `perfil` | text | `admin` \| `usuario` \| `vendedor` \| `agente_registro` |
| `status` | text | `ativo` \| `inativo` |
| `created_at` | timestamptz | — |

**RLS:** Todos autenticados podem ler; usuário edita próprio; admin edita qualquer um.  
**Trigger:** `on_auth_user_created` → insere em `profiles` automaticamente após signup.

---

### 3.2 `leads_contabilidade`

Leads originados do Chatwoot/WhatsApp.

| Coluna | Tipo | Descrição |
|---|---|---|
| `id` | uuid PK | — |
| `nome_lead` | text | Nome do contato |
| `whatsapp_lead` | text | Número WhatsApp |
| `motivo_contato` | text | Assunto da conversa |
| `resumo_conversa` | text | Primeira mensagem recebida |
| `status` | text | Status do lead (ver Kanban abaixo) |
| `inicio_atendimento` | timestamptz | Início da conversa |
| `ultima_mensagem` | timestamptz | Última mensagem recebida |
| `id_conta_chatwoot` | text | ID da conta no Chatwoot |
| `id_conversa_chatwoot` | text | ID da conversa no Chatwoot |
| `id_lead_chatwoot` | text | ID do contato no Chatwoot |
| `inbox_id_chatwoot` | text | ID da inbox no Chatwoot |
| `follow_up_1/2/3` | timestamptz | Datas de follow-up |
| `data_agendamento` | timestamptz | Data de agendamento marcado |
| `id_agendamento` | text | ID externo do agendamento |
| `agendamento_criado_em` | timestamptz | — |
| `anotacoes` | text | Notas do atendente |
| `minutos_ultima_mensagem_base` | int | Minutos desde última mensagem |
| `horario_comercial` | bool | Dentro do horário comercial? |
| `created_at` | timestamptz | — |

**Status do Kanban:**

| Status | Cor | Descrição |
|---|---|---|
| `iniciou_conversa` | amarelo | Primeiro contato |
| `conversando` | azul | Em atendimento |
| `agendado` | verde | Agendamento marcado |
| `cliente` | roxo | Convertido |
| `follow_up` | laranja | Aguardando follow-up |
| `cancelou_agendamento` | vermelho | Cancelou |
| `perdido` | cinza | Lead perdido |

**Mapeamento Chatwoot → CertiID:**

| Chatwoot Status | CertiID Status |
|---|---|
| `open` | `conversando` |
| `pending` | `iniciou_conversa` |
| `resolved` | `cliente` |
| `snoozed` | `follow_up` |

---

### 3.3 `clientes_comerciais` (clientes_comerciais_schema.sql)

Cadastro de clientes para vendas.

| Coluna | Tipo | Descrição |
|---|---|---|
| `id` | uuid PK | — |
| `tipo_cliente` | text | `pessoa_fisica` \| `pessoa_juridica` |
| `cpf_cnpj` | text UNIQUE | CPF ou CNPJ |
| `nome_razao_social` | text | — |
| `nome_fantasia` | text | — |
| `email` | text | — |
| `telefone` | text | — |
| `cep` | text | — |
| `logradouro` | text | — |
| `numero` | text | — |
| `complemento` | text | — |
| `bairro` | text | — |
| `cidade` | text | — |
| `uf` | text | — |
| `inscricao_municipal` | text | — |
| `inscricao_estadual` | text | — |
| `iss_retido` | bool | ISS retido na fonte |
| `observacoes` | text | — |
| `created_at` | timestamptz | — |
| `updated_at` | timestamptz | — |

**RLS:** Todos autenticados leem; apenas admin escreve.

---

### 3.4 `vendas` (commercial_schema.sql)

Registro de vendas de certificados.

| Coluna | Tipo | Descrição |
|---|---|---|
| `id` | uuid PK | — |
| `cliente_id` | uuid | FK → `clientes_comerciais.id` |
| `certificado_id` | uuid | FK → `certificados.id` |
| `cliente` | text | Nome livre (legado) |
| `cliente_nome` | text | Nome do cliente comercial |
| `tipo_certificado` | text | Tipo do certificado |
| `tipo_venda` | text | `presencial` \| `videoconferencia` \| `online` \| `faca-se` \| `outro` |
| `canal` | text | `balcao` \| `ecommerce` \| `prepago` \| `voucher` \| `link_externo` |
| `forma_pagamento` | text | — |
| `valor` | numeric | Valor da venda |
| `status` | text | `confirmado` \| `pendente` \| `cancelado` |
| `parceiro_id` | uuid | FK → `parceiros.id` |
| `data_venda` | date | — |
| `observacoes` | text | — |
| `created_at` | timestamptz | — |

---

### 3.5 `certificados`

Catálogo de certificados disponíveis.

| Coluna | Tipo | Descrição |
|---|---|---|
| `id` | uuid PK | — |
| `tipo` | text UNIQUE | Ex: `e-CPF A1`, `e-CNPJ A3` |
| `estoque` | int | Unidades em estoque |
| `validade` | text | Ex: `1 ano`, `3 anos` |
| `ativo` | bool | — |

**Seed:** e-CPF A1/A3, e-CNPJ A1/A3, NF-e A1, SSL

---

### 3.6 `precos_certificados`

Tabela de preços por canal de venda.

| Coluna | Tipo | Descrição |
|---|---|---|
| `id` | uuid PK | — |
| `certificado_id` | uuid FK | — |
| `canal` | text | `balcao` \| `ecommerce` \| `prepago` \| `voucher` \| `link_externo` |
| `valor` | numeric | — |
| `ativo` | bool | — |

**Constraint UNIQUE:** `(certificado_id, canal)`

---

### 3.7 `faixas_comissao`

Faixas de comissão por volume de emissões.

| Coluna | Tipo | Descrição |
|---|---|---|
| `id` | uuid PK | — |
| `faixa` | text UNIQUE | Ex: `Bronze`, `Prata` |
| `min_emissoes` | int | — |
| `max_emissoes` | int | null = ilimitado |
| `percentual` | numeric | % de comissão |
| `valor_exemplo` | numeric | — |
| `ordem` | int | Ordem exibição |
| `ativo` | bool | — |

**Seed:** 4 faixas (1-50: 8%, 51-100: 10%, 101-200: 12%, 201+: 15%)

---

### 3.8 `formas_pagamento`

Métodos de pagamento disponíveis.

| Coluna | Tipo | Descrição |
|---|---|---|
| `id` | uuid PK | — |
| `nome` | text UNIQUE | Ex: `PIX`, `Boleto` |
| `ordem` | int | — |
| `ativo` | bool | — |

**Seed:** Dinheiro, Cartão Crédito, Cartão Débito, PIX, Transferência, Boleto, Pré-pago, Voucher, Link Externo

---

### 3.9 `parceiros`

Rede de parceiros/revendedores.

| Coluna | Tipo | Descrição |
|---|---|---|
| `id` | uuid PK | — |
| `nome` | text | — |
| `responsavel` | text | — |
| `telefone` | text | — |
| `email` | text | — |
| `cidade` | text | — |
| `estado` | text | — |
| `segmento` | text | `alto` \| `medio` \| `baixo` \| `inativo` |
| `status` | text | `ativo` \| `inativo` |
| `emissoes_mes` | int | Emissões no mês |
| `receita_mes` | numeric | Receita no mês |
| `desde` | date | Data início parceria |
| `created_at` | timestamptz | — |

---

### 3.10 `agendamentos`

Agenda de atendimentos.

| Coluna | Tipo | Descrição |
|---|---|---|
| `id` | uuid PK | — |
| `cliente` | text | — |
| `telefone` | text | — |
| `servico` | text | — |
| `data_hora` | timestamptz | — |
| `status` | text | `confirmado` \| `aguardando` \| `cancelado` \| `realizado` |
| `observacoes` | text | — |
| `created_at` | timestamptz | — |

---

### 3.11 `renovacoes` (renovacoes_migration.sql)

Controle de renovações de certificados vencendo.

| Coluna | Tipo | Descrição |
|---|---|---|
| `id` | uuid PK | — |
| `cliente` | text | — |
| `telefone` | text | — |
| `email` | text | — |
| `tipo_certificado` | text | — |
| `data_vencimento` | date | — |
| `dias_restantes` | int | — |
| `valor` | numeric | — |
| `prioridade` | text | `urgente` \| `media` \| `normal` |
| `status` | text | `pendente` \| `contatado` \| `convertido` \| `perdido` |
| `observacoes` | text | — |
| `pedido` | text | Número do pedido |
| `protocolo` | text | — |
| `cpf` | text | — |
| `cnpj` | text | — |
| `razao_social` | text | — |
| `agr` | text | Agente de registro |
| `vendedor` | text | — |
| `contador` | text | — |
| `renovado` | bool | Flag de renovado |
| `ultimo_lembrete` | timestamptz | Última comunicação |
| `created_at` | timestamptz | — |

**Import CSV:** Campos aceitos: `pedido, protocolo, data_vencimento, cliente, email, telefone, produto, valor, cpf, cnpj, razao_social, agr, vendedor, contador`

---

### 3.12 `links_produtos` (links_produtos_migration.sql)

Links de renovação/emissão por tipo de certificado.

| Coluna | Tipo | Descrição |
|---|---|---|
| `id` | uuid PK | — |
| `tipo_certificado` | text UNIQUE | — |
| `link_renovacao` | text | URL para renovação |
| `link_nova_emissao` | text | URL para nova emissão |
| `descricao` | text | — |
| `ativo` | bool | — |

---

### 3.13 `external_integrations` (integrations_schema.sql)

Configurações das integrações externas.

| Coluna | Tipo | Descrição |
|---|---|---|
| `id` | uuid PK | — |
| `provider` | text UNIQUE | Ver providers abaixo |
| `name` | text | — |
| `description` | text | — |
| `status` | text | `ativo` \| `pendente` \| `erro` \| `inativo` |
| `base_url` | text | URL base da API |
| `webhook_url` | text | URL do webhook de saída |
| `api_token` | text | Token/chave da API |
| `account_id` | text | ID da conta (Chatwoot) |
| `inbox_id` | text | ID da inbox (Chatwoot) |
| `sender_name` | text | Nome do remetente (Email) |
| `sender_email` | text | Email do remetente |
| `host` | text | Host SMTP |
| `port` | int | Porta SMTP |
| `username` | text | Usuário SMTP |
| `metadata` | jsonb | Dados extras |
| `last_test_at` | timestamptz | Último teste |
| `last_error` | text | Último erro |

**Providers disponíveis:** `chatwoot`, `email_smtp`, `n8n`, `gestao_ar`, `safe2pay`, `safeweb`, `supabase`

**RLS:** Apenas admin lê e escreve.

---

### 3.14 `automation_rules`

Regras de automação de comunicação.

| Coluna | Tipo | Descrição |
|---|---|---|
| `id` | uuid PK | — |
| `rule_key` | text UNIQUE | Identificador da regra |
| `label` | text | Nome legível |
| `channel` | text | `whatsapp` \| `email` \| `whatsapp_email` \| `webhook` |
| `trigger_key` | text | Evento disparador |
| `ativo` | bool | — |
| `metadata` | jsonb | Configurações extras |

**Seed — Regras padrão:**

| rule_key | Descrição |
|---|---|
| `ren30` | Lembrete de renovação 30 dias antes |
| `ren15` | Lembrete de renovação 15 dias antes |
| `ren7` | Lembrete de renovação 7 dias antes |
| `followup` | Follow-up 3 dias após contato |
| `conv` | Confirmação de pagamento |
| `expiro` | Notificação de certificado expirado |

---

### 3.15 `communication_templates`

Templates de mensagens para automação.

| Coluna | Tipo | Descrição |
|---|---|---|
| `id` | uuid PK | — |
| `template_key` | text UNIQUE | — |
| `name` | text | — |
| `channel` | text | `whatsapp` \| `email` |
| `subject` | text | Assunto (somente email) |
| `body` | text | Corpo com variáveis `{{var}}` |
| `ativo` | bool | — |

**Variáveis disponíveis nos templates:**

| Variável | Dado |
|---|---|
| `{{cliente}}` | Nome do cliente |
| `{{tipo_certificado}}` | Tipo do certificado |
| `{{dias_restantes}}` | Dias até o vencimento |
| `{{data_vencimento}}` | Data de vencimento formatada |
| `{{link_renovacao}}` | Link direto de renovação |
| `{{link_nova_emissao}}` | Link de nova emissão |
| `{{telefone}}` | Telefone do cliente |
| `{{email}}` | Email do cliente |

---

### 3.16 `communication_outbox`

Fila de mensagens a serem enviadas.

| Coluna | Tipo | Descrição |
|---|---|---|
| `id` | uuid PK | — |
| `channel` | text | `whatsapp` \| `email` \| `webhook` |
| `provider` | text | `chatwoot` \| `email_smtp` \| `n8n` |
| `to_address` | text | Destinatário |
| `subject` | text | Assunto (email) |
| `body` | text | Corpo da mensagem |
| `payload` | jsonb | Dados extras |
| `status` | text | `queued` \| `processing` \| `sent` \| `failed` \| `cancelled` |
| `error_message` | text | Erro (se houver) |
| `scheduled_for` | timestamptz | Agendamento |
| `sent_at` | timestamptz | Enviado em |
| `created_by` | uuid | FK → `auth.users.id` |

**RLS:** Autenticados inserem; apenas admin lê e atualiza.

---

## 4. Autenticação e Controle de Acesso

### Perfis de acesso

| Perfil | Dashboard | Comercial | Chat | Renovações | Financeiro | Relatórios | Parceiros | Configurações |
|---|---|---|---|---|---|---|---|---|
| `admin` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `agente_registro` | ✅ | ✅ | ✅ | ✅ | — | — | — | — |
| `vendedor` | ✅ | ✅ | — | — | — | ✅ | ✅ | — |
| `usuario` | ✅ | — | — | — | — | ✅ | — | — |

### Fluxo de autenticação

1. Login com email/senha via `supabase.auth.signInWithPassword()`
2. Sessão armazenada localmente pelo SDK
3. `onAuthStateChange` atualiza o contexto React global
4. Profile carregado da tabela `profiles` por `id = auth.uid()`
5. Rotas protegidas checam `profile.perfil` para autorização

### Recuperação de senha

1. Usuário solicita reset → `supabase.auth.resetPasswordForEmail(email)`
2. Supabase envia email com link contendo `?type=recovery`
3. Redirect URL configurada no Supabase Dashboard → Auth → URL Configuration
4. Frontend detecta o parâmetro e exibe tela de nova senha
5. `supabase.auth.updateUser({ password })` finaliza o processo

---

## 5. API Supabase — Referência de Operações

### Clientes Supabase

```typescript
// src/lib/supabase.ts — para uso no frontend
import { supabase } from '@/lib/supabase'

// Operações administrativas devem rodar apenas em Edge Functions/backend,
// nunca no bundle do frontend.
```

### Operações principais por tabela

```typescript
// Leads
supabase.from('leads_contabilidade').select('*')
supabase.from('leads_contabilidade').insert({ ... })
supabase.from('leads_contabilidade').update({ status }).eq('id', id)
supabase.from('leads_contabilidade').delete().eq('id', id)

// Vendas
supabase.from('vendas').select('*').gte('data_venda', from).lte('data_venda', to)
supabase.from('vendas').insert({ ... })

// Clientes Comerciais
supabase.from('clientes_comerciais').select('*').ilike('nome_razao_social', `%${search}%`)
supabase.from('clientes_comerciais').upsert({ cpf_cnpj, ... }, { onConflict: 'cpf_cnpj' })

// Renovações
supabase.from('renovacoes').select('*').eq('status', 'pendente')
supabase.from('renovacoes').upsert(rows, { onConflict: 'protocolo' })

// Integrações
supabase.from('external_integrations').select('*').eq('provider', 'chatwoot').single()
supabase.from('external_integrations').upsert({ provider, ... }, { onConflict: 'provider' })

// Configurações de integração
supabase.from('automation_rules').select('*').order('rule_key')
supabase.from('communication_templates').select('*').eq('ativo', true)
```

### Realtime

```typescript
// Inscrição em mudanças na tabela de leads
const channel = supabase
  .channel('leads-realtime')
  .on('postgres_changes', {
    event: '*',          // INSERT | UPDATE | DELETE | *
    schema: 'public',
    table: 'leads_contabilidade'
  }, (payload) => {
    // payload.new, payload.old, payload.eventType
  })
  .subscribe()

// Cancelar inscrição
supabase.removeChannel(channel)
```

---

## 6. Sistema de Comunicação

### Arquivo: `src/lib/communication.ts`

```typescript
// Fila uma mensagem WhatsApp via Chatwoot
await queueWhatsAppMessage({
  to: '+5511999999999',
  body: 'Olá, {{cliente}}! Seu certificado vence em {{dias_restantes}} dias.',
})

// Fila um email
await queueEmailMessage({
  to: 'cliente@email.com',
  subject: 'Renovação de Certificado',
  body: '<p>Olá, {{cliente}}...</p>',
})

// Renderiza template com variáveis
const msg = renderTemplate(template.body, {
  cliente: 'João Silva',
  dias_restantes: '7',
  data_vencimento: '20/06/2026',
  link_renovacao: 'https://...',
})
```

### Função base `queueCommunication()`

```typescript
interface QueueCommunicationParams {
  channel: 'whatsapp' | 'email' | 'webhook'
  provider: 'chatwoot' | 'email_smtp' | 'n8n'
  to: string
  body: string
  subject?: string
  payload?: Record<string, unknown>
  scheduledFor?: string  // ISO datetime, default: agora
}
```

Insere na tabela `communication_outbox`. O processamento da fila é feito por um worker externo (n8n ou similar).

---

## 7. Webhook — Chatwoot Edge Function

### URL da Edge Function

```
POST https://cvfrhfiaprdtwxxplngk.supabase.co/functions/v1/chatwoot-webhook
```

### Autenticação

**Eventos do Chatwoot (incoming):** Sem autenticação (validar IP de origem em produção).  
**Ações proxy (browser → edge function):** Bearer token da sessão Supabase.

---

### 7.1 Ações Proxy (chamadas pelo frontend)

Enviar `{ _action: 'nome_da_acao', ...params }` no body.

#### `test_connection`
Testa conexão com o Chatwoot.

```json
// Request
{
  "_action": "test_connection",
  "base_url": "https://app.chatwoot.com",
  "api_token": "seu-api-token"
}

// Response OK
{ "ok": true, "name": "Nome da conta" }

// Response Erro
{ "ok": false, "error": "Mensagem de erro" }
```

---

#### `sync_conversations`
Sincroniza conversas abertas do Chatwoot para `leads_contabilidade`.

```json
// Request
{
  "_action": "sync_conversations",
  "base_url": "https://app.chatwoot.com",
  "api_token": "seu-api-token",
  "account_id": "1"
}

// Response
{ "ok": true, "count": 42 }
```

---

#### `create_conversation`
Cria uma conversa no Chatwoot a partir de um lead.

```json
// Request
{
  "_action": "create_conversation",
  "base_url": "https://app.chatwoot.com",
  "api_token": "seu-api-token",
  "account_id": "1",
  "inbox_id": "2",
  "contact_phone": "+5511999999999",
  "contact_name": "João Silva",
  "lead_id": "uuid-do-lead"
}

// Response
{ "ok": true, "conversation_id": "123", "contact_id": "456" }
```

---

#### `get_messages`
Retorna mensagens de uma conversa.

```json
// Request
{
  "_action": "get_messages",
  "base_url": "https://app.chatwoot.com",
  "api_token": "seu-api-token",
  "account_id": "1",
  "conversation_id": "123"
}

// Response
{
  "ok": true,
  "messages": [
    {
      "id": 1,
      "content": "Olá, preciso de ajuda",
      "message_type": 0,
      "created_at": 1715000000
    }
  ]
}
```

`message_type`: `0` = cliente, `1` = agente

---

#### `send_message`
Envia uma mensagem em uma conversa.

```json
// Request
{
  "_action": "send_message",
  "base_url": "https://app.chatwoot.com",
  "api_token": "seu-api-token",
  "account_id": "1",
  "conversation_id": "123",
  "content": "Olá! Como posso ajudar?"
}

// Response
{ "ok": true, "message": { ... } }
```

---

#### `update_conversation`
Atualiza status ou label de uma conversa.

```json
// Request
{
  "_action": "update_conversation",
  "base_url": "https://app.chatwoot.com",
  "api_token": "seu-api-token",
  "account_id": "1",
  "conversation_id": "123",
  "status": "resolved",
  "label": "agendado"
}

// Response
{ "ok": true }
```

`status`: `open`, `pending`, `resolved`, `snoozed`

---

### 7.2 Eventos Incoming do Chatwoot

Configure no Chatwoot: **Settings → Integrations → Webhooks → URL acima**.

#### `conversation_created`

Cria novo lead em `leads_contabilidade`.

```json
// Payload recebido do Chatwoot
{
  "event": "conversation_created",
  "id": 123,
  "status": "open",
  "created_at": 1715000000,
  "meta": {
    "sender": {
      "id": 456,
      "name": "João Silva",
      "phone_number": "+5511999999999"
    }
  },
  "messages": [
    { "content": "Preciso renovar meu certificado", "message_type": 0 }
  ],
  "account_id": 1
}
```

---

#### `conversation_updated`

Atualiza status do lead existente.

```json
{
  "event": "conversation_updated",
  "id": 123,
  "status": "resolved",
  "meta": {
    "sender": { "name": "João", "phone_number": "+5511999999999" }
  },
  "account_id": 1
}
```

---

#### `message_created`

Atualiza timestamp da última mensagem do lead.

```json
{
  "event": "message_created",
  "conversation": { "id": 123 },
  "message_type": 0,
  "content": "Obrigado!",
  "account_id": 1
}
```

`message_type` `0` = cliente (processa); `1` = agente (ignora).

---

#### `contact_updated`

Atualiza nome e telefone do lead.

```json
{
  "event": "contact_updated",
  "id": 456,
  "name": "João Silva Atualizado",
  "phone_number": "+5511988888888"
}
```

---

## 8. Integrações Externas

### Chatwoot

| Campo | Valor |
|---|---|
| Tipo | Plataforma de atendimento ao cliente (WhatsApp, Instagram, Email) |
| API Base | Configurada na tabela `external_integrations` (provider: `chatwoot`) |
| Autenticação | `api_token` no header `api_access_token` |
| Webhook URL | URL da Edge Function acima |

### Email (SMTP)

| Campo | Configuração padrão |
|---|---|
| Host | `smtp.gmail.com` |
| Port | `587` |
| Sender Name | `AR CERTI ID` |
| Configuração | Tabela `external_integrations` (provider: `email_smtp`) |

### N8N

| Campo | Valor |
|---|---|
| Tipo | Automação de workflows |
| Uso | Processar fila `communication_outbox`, automações |
| URL | Configurada em `external_integrations` (provider: `n8n`) |
| Já instalado na VPS | Sim (stack `n8n`) |

### Gestão AR

| Campo | Valor |
|---|---|
| URL base | `https://gestaoar.com.br/ARCertiID/` |
| Uso | Plataforma principal de emissão de certificados |
| Status | Configurar credenciais em `external_integrations` |

### Safe2Pay

| Campo | Valor |
|---|---|
| Uso | Gateway de pagamentos |
| Status | Pendente configuração |

### Safeweb

| Campo | Valor |
|---|---|
| Uso | Autoridade Certificadora |
| Status | Pendente configuração |

### Evolution API

| Campo | Valor |
|---|---|
| Já instalado na VPS | Sim (stack `evolution`) |
| Uso | Alternativa ao Chatwoot para WhatsApp direto |

---

## 9. Tipos TypeScript

Todos os tipos estão em `src/types/index.ts`. Referência rápida:

```typescript
// Perfis
type PerfilAcesso = 'admin' | 'usuario' | 'vendedor' | 'agente_registro'

// Canais e tipos de venda
type CanalVenda = 'balcao' | 'ecommerce' | 'prepago' | 'voucher' | 'link_externo'
type TipoVenda = 'presencial' | 'videoconferencia' | 'online' | 'faca-se' | 'outro'
type StatusVenda = 'confirmado' | 'pendente' | 'cancelado'

// Renovações
type StatusRenovacao = 'pendente' | 'contatado' | 'convertido' | 'perdido'
type PrioridadeRenovacao = 'urgente' | 'media' | 'normal'

// Comunicação
type CommunicationChannel = 'whatsapp' | 'email' | 'webhook'
type CommunicationProvider = 'chatwoot' | 'email_smtp' | 'n8n'
type CommunicationStatus = 'queued' | 'processing' | 'sent' | 'failed' | 'cancelled'

// Integração
type IntegrationProvider = 'chatwoot' | 'email_smtp' | 'n8n' | 'gestao_ar' | 'safe2pay' | 'safeweb' | 'supabase'
type IntegrationStatus = 'ativo' | 'pendente' | 'erro' | 'inativo'

// Financeiro
type TipoLancamento = 'pagar' | 'receber'
type StatusLancamento = 'pendente' | 'pago' | 'recebido' | 'cancelado'

// Filtro de datas
type DateFilterOption = 'hoje' | 'ontem' | '7dias' | 'este_mes' | 'mes_passado' | '3meses' | 'personalizado'
```

---

## 10. Páginas e Funcionalidades

| Rota | Arquivo | Acesso | Descrição |
|---|---|---|---|
| `/login` | `Login.tsx` | Público | Login, cadastro, recuperação de senha |
| `/update-password` | `UpdatePassword.tsx` | Público | Redefinição de senha via email |
| `/` | `Dashboard.tsx` | Todos | KPIs e gráficos de leads em tempo real |
| `/comercial` | `Comercial.tsx` | Admin, Agente, Vendedor | Vendas, agenda, certificados, preços, comissões |
| `/chat` | `ChatAoVivo.tsx` | Admin, Agente | Kanban de atendimento com chat Chatwoot |
| `/renovacoes` | `Renovacoes.tsx` | Admin, Agente | Renovações, importação CSV, disparo de comunicação |
| `/financeiro` | `Financeiro.tsx` | Admin | Contas a pagar/receber, contas bancárias |
| `/relatorios` | `Relatorios.tsx` | Admin, Vendedor, Usuário | Relatórios e analytics |
| `/parceiros` | `Parceiros.tsx` | Admin, Vendedor | Gestão de parceiros |
| `/configuracoes` | `Configuracoes.tsx` | Admin | Integrações, automações, usuários |

---

## 11. Deploy e Infraestrutura

> Ver também: [DEPLOY.txt](./DEPLOY.txt)

### Ambiente de produção

| Item | Valor |
|---|---|
| VPS | `root@147.79.111.76` (Hostinger) |
| Domínio | `certiid.mantovan.com.br` |
| Repo na VPS | `/opt/certiid` |
| Stack Docker | `certiid` |
| Serviço Docker | `certiid_certiid` |
| Imagem | `certiid:latest` (build local) |
| Rede Docker | `minha_rede` (overlay, externa) |

### Comandos úteis na VPS

```bash
# Ver estado do serviço
docker service ls | grep certiid

# Ver logs
docker service logs certiid_certiid --tail 50 -f

# Redeploy manual
bash /opt/certiid/deploy.sh

# Ver containers rodando
docker ps | grep certiid
```

### Script de deploy (`deploy.sh`)

```bash
#!/bin/bash
set -e
cd /opt/certiid
git pull origin main
export $(grep -v '^#' .env | xargs)
docker build \
  --build-arg "VITE_SUPABASE_URL=$VITE_SUPABASE_URL" \
  --build-arg "VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY" \
  -t certiid:latest .
docker stack rm certiid 2>/dev/null || true
sleep 10
docker stack deploy -c docker-compose.yml certiid
```

### GitHub Actions (CI/CD)

Arquivo: `.github/workflows/deploy.yml`  
Trigger: push na branch `main`  
Sequência: Decodifica chave SSH → SSH na VPS → executa `deploy.sh`

---

## 12. Notas de Segurança

> ⚠️ **Ações pendentes para produção segura**

1. **Service Role Key** — deve existir apenas como `SUPABASE_SERVICE_ROLE_KEY` em ambiente server-side. Nunca usar prefixo `VITE_` para essa chave.

2. **Webhook sem autenticação** — O endpoint da Edge Function (`chatwoot-webhook`) não valida a origem dos eventos incoming. Adicionar verificação de IP ou HMAC signature do Chatwoot.

3. **`.env` na VPS** — O arquivo `/opt/certiid/.env` contém chaves sensíveis. Garantir permissões restritas (`chmod 600 /opt/certiid/.env`).

4. **Root SSH** — O deploy usa usuário `root`. Considerar criar um usuário dedicado com acesso restrito ao diretório `/opt/certiid`.

5. **Rotação de chaves** — Ao remover um desenvolvedor, rotacionar `VPS_SSH_KEY` no GitHub Secrets e em `~/.ssh/authorized_keys` na VPS.

---

*Documentação gerada em 13/05/2026 — CertiID v1.0.0*
