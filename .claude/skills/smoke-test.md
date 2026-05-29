---
description: Smoke test completo do CRM CertiID antes de deploy em produção. Valida RLS, integridade de schema, health das Edge Functions e pré-condições de fluxo de negócio. Cada verificação mapeia um bug real que chegou ao usuário — nenhuma nova regressão sem adicionar seu check aqui.
---

# /smoke-test — Validação Pré-Deploy CRM CertiID

## Objetivo

Executar verificações rápidas e objetivas em todas as camadas críticas do sistema antes de qualquer deploy no VPS. Ao contrário do `/security-scan` (que faz auditoria profunda de vulnerabilidades), este skill valida que **o sistema funciona corretamente para o usuário** — fluxos de negócio, permissões, mensagens em português e UX.

**Princípio central:** cada bug de UX que chegou ao usuário tem uma verificação correspondente aqui. Ao corrigir um novo bug em produção, adicione o check de detecção neste arquivo antes de fechar o PR.

---

## Pré-requisitos

- `SUPABASE_PAT`: Personal Access Token do Supabase
- `SUPABASE_PROJECT_REF`: referência do projeto Supabase
- URL base da Edge Function (ex: `https://<ref>.supabase.co/functions/v1`)

Esses valores estão documentados em `memory/reference_supabase_acesso.md`.

---

## Domínio 1 — Políticas RLS (Row Level Security)

Verifica que as políticas RLS existem e têm as permissões corretas. Ausência ou má configuração de RLS impede operações de negócio ou expõe dados indevidamente.

### 1.1 Listar todas as políticas das tabelas críticas

```sql
SELECT tablename, policyname, cmd, qual
FROM pg_policies
WHERE tablename IN (
  'vendas_certificados',
  'leads_contabilidade',
  'tabelas_preco',
  'tabelas_preco_itens',
  'lojas_marketplace',
  'agenda_online_solicitacoes',
  'lgpd_solicitacoes_exclusao'
)
ORDER BY tablename, policyname;
```

**Verificar:**

- `vendas_certificados` possui política `vendas_certificados_write` com condição `perfil IN ('admin','vendedor','agente_registro') AND status='ativo'`
- `lojas_marketplace` possui política `lojas_marketplace_public_read` (sem autenticação, permite leitura da loja pela URL pública)
- `lgpd_solicitacoes_exclusao` possui `titular_insert`, `titular_select` e `admin_all`
- Todas as tabelas críticas têm RLS habilitado

### 1.2 Verificar RLS habilitado

```sql
SELECT relname, relrowsecurity
FROM pg_class
WHERE relname IN (
  'vendas_certificados',
  'leads_contabilidade',
  'tabelas_preco',
  'lojas_marketplace',
  'lgpd_solicitacoes_exclusao'
)
AND relkind = 'r';
```

**Verificar:** `relrowsecurity = true` para todas as tabelas.

---

## Domínio 2 — Integridade de Schema

Confirma que todas as tabelas, colunas e FKs necessárias existem em produção. Migrations faltando causam crashes silenciosos.

### 2.1 Tabelas críticas existem

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN (
  'profiles',
  'vendas_certificados',
  'leads_contabilidade',
  'tabelas_preco',
  'tabelas_preco_itens',
  'pontos_atendimento',
  'formas_pagamento',
  'lojas_marketplace',
  'agendamentos',
  'agendamentos_validacao',
  'lgpd_solicitacoes_exclusao',
  'nfse_emitidas'
)
ORDER BY table_name;
```

**Verificar:** todas as 12 tabelas presentes. Qualquer ausência indica migration não aplicada.

### 2.2 FKs e colunas críticas

```sql
SELECT
  tc.table_name,
  kcu.column_name,
  ccu.table_name AS foreign_table,
  ccu.column_name AS foreign_column
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage ccu
  ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
AND tc.table_name IN ('vendas_certificados', 'lojas_links', 'agenda_online_solicitacoes')
ORDER BY tc.table_name;
```

### 2.3 Função LGPD de anonimização existe

```sql
SELECT routine_name, routine_type
FROM information_schema.routines
WHERE routine_schema = 'public'
AND routine_name = 'lgpd_anonimizar_titular';
```

**Verificar:** retorna 1 linha com `routine_type = 'FUNCTION'`.

---

## Domínio 3 — Health das Edge Functions

Valida que as Edge Functions respondem corretamente, com os códigos HTTP esperados.

### 3.1 marketplace-checkout — loja inexistente retorna 400, não 401

```bash
curl -s -o /dev/null -w "%{http_code}" \
  https://<SUPABASE_PROJECT_REF>.supabase.co/functions/v1/marketplace-checkout \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"slug":"loja-que-nao-existe","item_id":"00000000-0000-0000-0000-000000000000"}'
```

**Verificar:** resposta `{"ok":false,"error":"Loja não encontrada"}` com status 200 ou 400. Status 401 indica que a função não está pública (`--no-verify-jwt` ausente).

### 3.2 claude-proxy — sem token retorna 401

```bash
curl -s -o /dev/null -w "%{http_code}" \
  https://<SUPABASE_PROJECT_REF>.supabase.co/functions/v1/claude-proxy \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"prompt":"test"}'
```

**Verificar:** status `401`. Status 200 sem autenticação é uma falha crítica de segurança (exposição da chave Anthropic).

### 3.3 evolution-webhook — sem token retorna 401

```bash
curl -s -o /dev/null -w "%{http_code}" \
  https://<SUPABASE_PROJECT_REF>.supabase.co/functions/v1/evolution-webhook \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Verificar:** status `401`. Webhook público permitiria injeção de mensagens falsas.

---

## Domínio 4 — Pré-condições de Fluxo de Negócio

Verifica que os dados mínimos necessários para criar uma venda existem. Formulário de venda sem dados de apoio resulta em dropdowns vazios e erro confuso para o usuário.

### 4.1 Dados de apoio presentes

```sql
SELECT
  (SELECT COUNT(*) FROM public.tabelas_preco WHERE ativo = true) AS tabelas_ativas,
  (SELECT COUNT(*) FROM public.tabelas_preco_itens WHERE ativo = true) AS itens_ativos,
  (SELECT COUNT(*) FROM public.pontos_atendimento WHERE ativo = true) AS pontos_ativos,
  (SELECT COUNT(*) FROM public.formas_pagamento WHERE ativo = true) AS formas_ativas,
  (SELECT COUNT(*) FROM public.lojas_marketplace WHERE ativo = true) AS lojas_ativas;
```

**Verificar:** todos os contadores > 0. Zero em qualquer campo indica dado de configuração faltando.

### 4.2 Ao menos um perfil admin ativo existe

```sql
SELECT COUNT(*) AS admins_ativos
FROM public.profiles
WHERE perfil = 'admin' AND status = 'ativo';
```

**Verificar:** `admins_ativos >= 1`.

### 4.3 Lojas marketplace ativas

```sql
SELECT nome, slug, ativo
FROM public.lojas_marketplace
WHERE ativo = true
ORDER BY nome;
```

**Verificar:** ao menos 1 loja ativa retornada. Sem lojas ativas = botão "Acessar Marketplace" sem destino.

---

## Domínio 5 — Verificações de Código (UX Regressions)

Garante que correções críticas de UX ainda estão presentes no código-fonte. Cada item abaixo corresponde a um bug que chegou ao usuário em produção.

### 5.1 traduzirErroDb presente (mensagens em português)

```bash
grep -n "traduzirErroDb" src/pages/Comercial.tsx | head -20
```

**Verificar:** função declarada E usada em pelo menos 5 locais. Ausência = erros em inglês para o usuário.

### 5.2 Nenhum `error.message` exposto diretamente ao usuário

```bash
grep -n "showMsg.*error\.message\|setMsg.*error\.message\|toast.*error\.message" src/pages/Comercial.tsx
```

**Verificar:** zero resultados. Qualquer match = vazamento de detalhe interno (OWASP A04).

### 5.3 Toast usa createPortal com z-index alto

```bash
grep -n "z-\[99999\]" src/pages/Comercial.tsx
```

**Verificar:** ao menos 1 resultado. Ausência = toast oculto atrás do modal.

### 5.4 Modal Nova Venda usa createPortal

```bash
grep -n "createPortal" src/pages/Comercial.tsx
```

**Verificar:** ao menos 2 resultados (modal + toast). Ausência = modal não aparece sobre outros elementos.

### 5.5 Validação de protocolo antes de window.open

```bash
grep -n "http.*https.*includes\|protocol.*http" src/pages/Comercial.tsx
```

**Verificar:** ao menos 1 resultado. Ausência = URL arbitrária pode ser aberta (OWASP A03).

### 5.6 dispararComunicacaoAutomaticaVenda em try/catch

```bash
grep -A3 "dispararComunicacaoAutomaticaVenda" src/pages/Comercial.tsx | grep -c "try\|catch"
```

**Verificar:** retorna > 0. Ausência = exceção na comunicação impede fechamento do modal.

---

## Execução

Ao invocar `/smoke-test`, execute os 5 domínios. Para Domínio 1, 2 e 4 use a Supabase Management API:

```http
POST https://api.supabase.com/v1/projects/<ref>/database/query
Authorization: Bearer <PAT>
Content-Type: application/json
{"query": "<SQL acima>"}
```

Para Domínio 3, use `curl` ou `WebFetch` com os endpoints das Edge Functions.  
Para Domínio 5, use `Grep` nas chamadas locais.

Execute em paralelo quando os domínios forem independentes.

---

## Relatório Final

Ao final, consolide os achados no formato:

```markdown
## Smoke Test — <data>

| Domínio | Status | Detalhes |
|---------|--------|----------|
| 1. RLS | ✅ OK / ❌ FALHA | ... |
| 2. Schema | ✅ OK / ❌ FALHA | ... |
| 3. Edge Functions | ✅ OK / ❌ FALHA | ... |
| 4. Dados de negócio | ✅ OK / ❌ FALHA | ... |
| 5. Código UX | ✅ OK / ❌ FALHA | ... |

**Resultado geral:** ✅ APROVADO / ❌ BLOQUEADO

Itens bloqueantes (se houver):
- ...
```

**Não faça deploy se qualquer item estiver ❌ FALHA.** Corrija primeiro, adicione o check correspondente neste arquivo, depois re-execute.
