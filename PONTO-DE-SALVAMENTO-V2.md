# Ponto de Salvamento — CertiID 1.0.0

> Última atualização: 2026-05-22
> Para retomar em nova sessão de IA sem perder contexto.

---

## Estado atual do Git

**Branch:** `main`
**Último commit publicado em produção:** `a9b50da` — fix: adiciona notificacoes faltantes no build

**Situação local:** a correção principal de segurança já está em produção. Ainda existem arquivos paralelos do ambiente do usuário fora desse pacote principal.

### Commits recentes (sessão 2026-05-22)

- `a9b50da` — fix: adiciona notificacoes faltantes no build
- `2b85214` — fix: protege service role e move acoes admin para edge function

### Commits anteriores (sessão 2026-05-18/19)

- `2e13f81` — ci: deploy automático Edge Function Supabase no GitHub Actions
- `ff0b7ae` — fix: normaliza telefone E.164 no import, edição manual e Edge Function
- `468c1da` — feat: phone E.164, template deselect, throttling, follow-up 48h, cancel alerts
- `9bc8e8f` — fix: converte data DD/MM/YYYY para YYYY-MM-DD na importação

---

## Infraestrutura de deploy

- **VPS:** `147.79.111.76` (root)
- **Domínio:** `certiid.mantovan.com.br` (sem www — sem registro DNS para www)
- **Stack:** Docker Swarm + Traefik + Let's Encrypt
- **Deploy:** push na `main` dispara GitHub Actions → SSH na VPS → `bash /opt/certiid/deploy.sh`
- **`.env` na VPS** (`/opt/certiid/.env`): manter `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY`
- **Edge Functions publicadas:** `chatwoot-webhook`, `notify-new-user`, `admin-users`
- **Produção confirmada:** frontend recompilado na VPS e site voltou ao ar após deploy manual

---

## Segurança — estado atual (2026-05-22)

### O que foi corrigido

#### 1. `service_role` removida do frontend — CORRIGIDO
- `src/lib/supabaseAdmin.ts` foi removido
- `SUPABASE_SERVICE_ROLE_KEY` agora existe apenas server-side
- arquivos ajustados: `.env.example`, `deploy.sh`, `Dockerfile`, `mcp-server/index.ts`, `query_db.js`

#### 2. Gestão admin de usuários movida para backend — CORRIGIDO
**Arquivos:**
- `supabase/functions/admin-users/index.ts`
- `src/lib/adminUsers.ts`
- `src/pages/Configuracoes.tsx`

Fluxos preservados:
- criar usuário
- trocar senha
- excluir usuário

Tudo isso agora valida sessão e perfil `admin` no backend.

#### 3. Produção atualizada — CORRIGIDO
- push realizado para `main`
- Edge Function `admin-users` confirmada online
- deploy manual na VPS concluído após correção de build

### Próxima camada de endurecimento

#### 4. Proxy `chatwoot-webhook`
Situação identificada:
- ações `_action` do proxy ainda precisavam autenticar com token real da sessão do usuário
- uso de `SUPABASE_ANON_KEY` como bearer não deve ser tratado como autenticação de usuário

Objetivo em andamento:
- exigir `access_token` real nas ações internas do proxy
- manter eventos inbound do Chatwoot funcionando normalmente

#### 5. Núcleo central de segurança — IMPLEMENTADO

Agora a arquitetura de segurança foi organizada em 3 centros:

- `src/lib/security.ts`
  - permissões padrão por perfil
  - labels de perfil
  - helpers:
    - `isAdminProfile`
    - `hasPerfil`
    - `hasPagePermission`
    - `resolveAllowedPages`

- `supabase/functions/_shared/security.ts`
  - `adminDb`
  - `json`
  - `CORS`
  - `requireAuthenticatedUser`
  - `requireAdmin`

- consumo inicial refatorado em:
  - `src/App.tsx`
  - `src/pages/Configuracoes.tsx`
  - `src/pages/ChatAoVivo.tsx`
  - `src/pages/Parceiros.tsx`
  - `src/pages/Renovacoes.tsx`
  - `supabase/functions/admin-users/index.ts`
  - `supabase/functions/chatwoot-webhook/index.ts`

---

## SQL aplicado no Supabase (acumulado)

### migration_v2_oficial.sql — APLICADO
23 tabelas V2 criadas. Ver seção detalhada no histórico abaixo.

### renovacoes_migration.sql — APLICADO (2026-05-18)
Colunas adicionadas à tabela `renovacoes`:

```sql
ALTER TABLE public.renovacoes
  ADD COLUMN IF NOT EXISTS pedido          TEXT,
  ADD COLUMN IF NOT EXISTS protocolo       TEXT,
  ADD COLUMN IF NOT EXISTS cpf             TEXT,
  ADD COLUMN IF NOT EXISTS cnpj            TEXT,
  ADD COLUMN IF NOT EXISTS razao_social    TEXT,
  ADD COLUMN IF NOT EXISTS agr             TEXT,
  ADD COLUMN IF NOT EXISTS vendedor        TEXT,
  ADD COLUMN IF NOT EXISTS contador        TEXT,
  ADD COLUMN IF NOT EXISTS renovado        BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ultimo_lembrete TIMESTAMPTZ;
```

### parceiros_gestao_v2.sql — APLICADO
Extensão da tabela `parceiros` com campos operacionais completos.

### Pendente de aplicar
- FK `certificado_id` em `vendas_certificados` e `produtos_emitidos` (aguarda tabela `certificados` no DB)
- Popular `formas_pagamento_v2` (Comercial ainda usa `formas_pagamento` antiga)

---

## Mensageria / Chat — estado atual (2026-05-18)

### O que foi implementado nesta sessão

#### 1. HTTP 422 ao criar contato no Chatwoot — CORRIGIDO
**Arquivo:** `supabase/functions/chatwoot-webhook/index.ts`
**Causa:** telefone chegava em formato `(11) 99999-9999` — Chatwoot exige E.164.
**Fix:** função `normalizePhone()` adicionada; converte `11999999999` → `+5511999999999` antes de criar/buscar contato.

#### 2. Template — seleção conflitante — CORRIGIDO
**Arquivo:** `src/pages/Renovacoes.tsx`
- **Checkbox "Padrão"** agora pode ser desmarcado (removi o bloqueio que mostrava erro)
- **Card do template** agora é clicável para selecionar/desselecionar o template para o envio atual (borda verde/azul quando selecionado); o ícone de lápis continua abrindo o editor
- Clicar duas vezes no mesmo card deseleciona (volta ao padrão do canal)

#### 3. Dosador de disparos (boas práticas Meta) — IMPLEMENTADO
**Arquivo:** `src/pages/Renovacoes.tsx`
- `bulkEnviarWhatsApp`: cada mensagem recebe `scheduled_for = now + (i × 3s)`
- `bulkEnviarEmail`: cada mensagem recebe `scheduled_for = now + (i × 1.5s)`
- `enviarMassa`: cada mensagem recebe `scheduled_for = now + (i × 3s)`
- Toast informa tempo estimado de envio (`~X min para enviar todos`)
- **Premissa:** N8N processa `communication_outbox` respeitando `scheduled_for`

#### 4. Follow-up automático 48h — IMPLEMENTADO
**Arquivo:** `src/lib/communication.ts` — nova função `queueWhatsAppFollowUp()`
**Arquivo:** `src/pages/Renovacoes.tsx` — chamada em `enviarWhatsApp()`
- Ao disparar WhatsApp individual, agenda automaticamente segunda mensagem idêntica com `scheduled_for = now + 48h`
- Payload inclui `tipo: 'renovacao_followup_auto'` e `followup_round: 1`
- **Ação necessária no N8N:** ao processar `tipo = renovacao_followup_auto`, consultar `renovacoes` pelo `renovacao_id` e **cancelar envio** se `status = 'convertido' | 'perdido'`

#### 5. Botão cancelar avisos agendados — IMPLEMENTADO
**Arquivo:** `src/pages/Renovacoes.tsx`
- Botão 🔔 em cada linha da tabela de renovações
- Deleta registros de `communication_outbox` onde `payload->>'renovacao_id' = id` AND `tipo = 'renovacao_followup_auto'` AND `scheduled_for > now`

### O que falta para o ciclo completo de mensageria

| Funcionalidade | Status | O que falta |
|---|---|---|
| Disparar mensagem inicial | ✅ Feito | — |
| Dosagem anti-ban Meta | ✅ Feito | — |
| Agendar follow-up 48h | ✅ Feito (fila) | N8N verificar status antes de enviar |
| Cancelar avisos manualmente | ✅ Feito | — |
| Repetir até responder | 🔶 Parcial | N8N: loop com nova inserção em outbox se sem resposta |
| Detectar resposta do cliente | 🔶 Infra | Webhook Chatwoot → `message_type = 0` → atualizar status renovação |
| IA classificar intenção | ❌ Pendente | Edge Function `chatwoot-webhook` chamar Claude API ao receber mensagem de entrada |
| Mover lead de coluna automaticamente | ❌ Pendente | Webhook atualiza `leads_contabilidade.status` baseado na classificação da IA |

### Arquitetura de mensageria

```
Renovacoes.tsx
  ├── enviarWhatsApp() → communication_outbox (scheduled_for = agora)
  │                   → communication_outbox (scheduled_for = +48h, tipo=followup_auto)
  ├── bulkEnviarWhatsApp() → communication_outbox × N (espaçados 3s)
  └── enviarMassa() → communication_outbox × N (espaçados 3s)

N8N Worker
  └── lê communication_outbox WHERE scheduled_for <= now
      ├── envia via Chatwoot/WhatsApp
      ├── se tipo=followup_auto → verifica renovacao.status antes de enviar
      └── marca registro como processado

Chatwoot Webhook → supabase/functions/chatwoot-webhook/index.ts
  └── message_created (message_type=0 = cliente respondeu)
      → atualizar renovacao.status = 'contatado' (TODO: + Claude API)
      → mover lead no Kanban
```

---

## Telas — estado por arquivo

### src/pages/Renovacoes.tsx
- Tipo `RenovacaoV2` com 12 campos V2
- Importação de planilha: `.csv`, `.xls`, `.xlsx`
- Conversão automática de data `DD/MM/YYYY` → `YYYY-MM-DD` (`parseBrDate`)
- Soft delete individual e em lote (`deleted_at`, `deleted_by`, `motivo_exclusao`)
- Templates: seleção por card (clique) ou dropdown; checkbox Padrão pode ser desmarcado
- Disparos: individuais (WhatsApp + email), bulk (selecionados), massa (todos elegíveis)
- Dosador: 3s entre mensagens WhatsApp; 1.5s entre emails
- Follow-up 48h automático no envio individual
- Botão cancelar avisos por renovação

### src/pages/Comercial.tsx
- Aba Vendas migrada para `vendas_certificados` + `cadastros_base` + `titulares_certificado` + `pontos_atendimento`
- Filtros operacionais: data, pedido, protocolo, cliente/doc, status
- Transformação incompleta — ainda não está no nível final da referência

### src/pages/Parceiros.tsx
- Gestão V2 iniciada com formulário completo (acesso, contatos, endereço, token, bancário, etc.)
- SQL de apoio em `sql/parceiros_gestao_v2.sql` já aplicado

### src/pages/Financeiro.tsx
- Tipo `LancamentoV2` aplicado; lógica existente intacta

### src/pages/Configuracoes.tsx
- Aba "Pontos de Atendimento" adicionada (criar/editar/ativar)

### src/components/ChatPanel.tsx
- Cria conversa no Chatwoot ao abrir lead sem `id_conversa_chatwoot`
- Realtime via `communication_events`
- **Nota:** telefone agora é normalizado pelo Edge Function antes de chegar ao Chatwoot

### src/lib/communication.ts
- `queueWhatsAppMessage()`, `queueEmailMessage()`, `queueChatwootConversationAction()`
- `queueWhatsAppFollowUp()` — novo: agenda mensagem com delay configurável (padrão 48h)
- `renderTemplate()` — substitui variáveis `{{...}}`

### supabase/functions/chatwoot-webhook/index.ts
- `normalizePhone()` — normaliza para E.164 antes de criar/buscar contato no Chatwoot
- Proxy: `create_conversation`, `get_messages`, `send_message`
- Webhook: sincroniza eventos Chatwoot → `leads_contabilidade` e `communication_events`

---

## Regras de segurança permanentes

- `SUPABASE_SERVICE_ROLE_KEY` nunca pode usar prefixo `VITE_` nem entrar no bundle
- operacoes admin devem passar por Edge Function/backend dedicado
- Campos sensíveis de `nfse_configuracoes` nunca no frontend
- Edge Functions leem `SERVICE_ROLE_KEY` via `Deno.env.get()`

---

## Pendências de infraestrutura

1. **FK `certificado_id`** — adicionar após confirmar tabela `certificados` no DB
2. **`formas_pagamento_v2`** — popular catálogo (Comercial ainda usa tabela antiga)
3. **DNS `www`** — adicionar registro A `www.certiid → 147.79.111.76` se quiser suporte ao `www`
4. **N8N — follow-up condicional** — worker deve checar `renovacao.status` antes de disparar `tipo=renovacao_followup_auto`
5. **Edge Function deploy** — após commitar `chatwoot-webhook/index.ts`, fazer `supabase functions deploy chatwoot-webhook` na VPS

---

## Para retomar

1. Verificar arquivos locais não commitados (lista acima)
2. Confirmar se Edge Function foi redeploy após correção do `normalizePhone`
3. Próximos blocos: IA de conversa no webhook, lógica "repetir até responder" no N8N, finalizar Comercial
