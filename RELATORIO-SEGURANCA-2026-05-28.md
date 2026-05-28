# RELATÓRIO DE AUDITORIA DE SEGURANÇA
## Sistema: CRM CertiID
**Data da auditoria:** 28/05/2026
**Metodologia:** Varredura estática de código-fonte com 5 domínios paralelos
**Normas aplicadas:** OWASP Top 10 (2021) · OWASP API Security Top 10 (2023) · CWE Top 25 (2024) · ISO/IEC 27001:2022 · NIST CSF 2.0 · LGPD Lei 13.709/2018 · Marco Civil Lei 12.965/2014 · Diretrizes ANPD

---

## CONTEXTO DO SISTEMA

- **Tipo:** CRM web (React + TypeScript + Supabase + Supabase Edge Functions)
- **Finalidade:** Gestão de clientes, leads, vendas de certificados digitais, marketplace, chat integrado (WhatsApp via Evolution API), emissão de NFS-e
- **Stack:** Vite + React 18 + TypeScript · Supabase (PostgreSQL + Auth + Storage + Edge Functions em Deno) · nginx
- **Integrações externas:** Evolution API (WhatsApp), Chatwoot, Safe2Pay, SafeWeb (AR), GISSONLINE (NFS-e SOAP), Anthropic Claude API, N8N
- **Dados pessoais tratados:** CPF, CNPJ, nome, e-mail, telefone, endereço, documentos financeiros, certificados digitais

---

## RESUMO EXECUTIVO

| Severidade | Quantidade |
|---|---|
| CRÍTICO | 14 |
| ALTO | 13 |
| MÉDIO | 14 |
| BAIXO | 4 |
| **TOTAL** | **45** |

**Score geral: CRÍTICO**
O sistema apresenta vulnerabilidades graves em múltiplas camadas: credenciais expostas, ausência de validação de webhooks, controle de acesso superficial (apenas no frontend), tabelas sem Row Level Security, e não conformidade severa com a LGPD. O sistema não está apto para operar em produção com dados pessoais reais sem as correções críticas listadas neste relatório.

---

## DOMÍNIO 1 — AUTENTICAÇÃO, AUTORIZAÇÃO E CONTROLE DE ACESSO

### [C-01] SERVICE_ROLE_KEY exposta em arquivo .env e em script Node.js
- **Severidade:** CRÍTICO
- **Norma:** CWE-798 · OWASP A02:2021 · ISO 27001 A.10
- **Arquivos:** `.env:3` e `query_db.js:17`
- **Evidência:**
  ```
  SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
  ```
  `query_db.js` lê esta chave e executa queries REST diretas ao Supabase com privilégio de service role (bypass total de RLS).
- **Risco:** Acesso irrestrito ao banco de dados ignorando todas as políticas de segurança. Token válido até 2090. Qualquer pessoa com acesso ao repositório ou ao servidor tem controle total do banco.
- **Correção:**
  1. Rotacionar imediatamente no Supabase Dashboard → Settings → API
  2. Garantir que `.env` está no `.gitignore` e nunca é commitado
  3. Usar variáveis de ambiente injetadas via CI/CD (GitHub Secrets, Portainer)
  4. Deletar ou isolar `query_db.js` fora do versionamento

---

### [C-02] Escalada de privilégio — verificação de admin apenas no frontend
- **Severidade:** CRÍTICO
- **Norma:** OWASP A01:2021 · CWE-284 · ISO 27001 A.9
- **Arquivo:** `src/pages/ChatAoVivo.tsx:433-479`
- **Evidência:**
  ```typescript
  async function saveColumn() {
    if (!columnModal) return
    // isAdmin verificado apenas para renderização — não bloqueia execução
    await supabase.from('chat_kanban_columns').update(payload).eq('id', column.id)
  }
  async function deleteColumn() {
    if (!columnModal?.column.id) return
    // sem verificação de isAdmin antes de deletar
    await supabase.from('chat_kanban_columns').delete().eq('id', column.id)
  }
  ```
- **Risco:** Usuário não-admin pode modificar ou deletar colunas do Kanban manipulando o DOM ou interceptando requisições.
- **Correção:**
  ```typescript
  async function saveColumn() {
    if (!columnModal || !isAdmin) return
    await supabase.from('chat_kanban_columns').update(payload).eq('id', column.id)
  }
  ```
  Adicionalmente, implementar RLS na tabela `chat_kanban_columns` restringindo UPDATE/DELETE a `perfil = 'admin'`.

---

### [C-03] IDOR — modificação de leads e clientes sem verificação de propriedade
- **Severidade:** CRÍTICO
- **Norma:** OWASP A01:2021 · CWE-639 · ISO 27001 A.9
- **Arquivos:** `src/pages/ChatAoVivo.tsx:280, 296, 345` · `src/pages/Clientes.tsx:411`
- **Evidência:**
  ```typescript
  // Qualquer usuário autenticado pode alterar qualquer lead
  await supabase.from('leads_contabilidade').update({ status }).eq('id', lead.id)
  await supabase.from('leads_contabilidade').delete().eq('id', lead.id)
  await supabase.from('cadastros_base').update(payload).eq('id', clienteModal.cliente.id)
  ```
- **Risco:** Usuário conhecendo o UUID de um registro alheio pode alterá-lo ou deletá-lo. Nenhuma verificação de propriedade no backend.
- **Correção:**
  ```sql
  -- RLS em leads_contabilidade
  CREATE POLICY "owner_or_admin" ON public.leads_contabilidade
    FOR ALL USING (
      responsavel_profile_id = auth.uid()
      OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND perfil = 'admin')
    );
  ```

---

### [C-04] Tabelas críticas sem Row Level Security
- **Severidade:** CRÍTICO
- **Norma:** OWASP A01:2021 · ISO 27001 A.9
- **Tabelas afetadas:** `leads_contabilidade`, `chat_kanban_columns`, `cadastros_base`
- **Risco:** Qualquer usuário autenticado com a `anon key` pode consultar e modificar dados de todos os outros usuários via queries diretas à API REST do Supabase.
- **Correção:** Ativar RLS e criar políticas baseadas em `auth.uid()` e role do perfil em todas as tabelas que contêm dados de usuários.

---

### [C-05] Webhooks de pagamento, Evolution e Chatwoot sem validação de assinatura
- **Severidade:** CRÍTICO
- **Norma:** OWASP A07:2021 · CWE-306 · CWE-347
- **Arquivos:** `supabase/functions/payment-webhook/index.ts:79` · `supabase/functions/evolution-webhook/index.ts` · `supabase/functions/chatwoot-webhook/index.ts`
- **Evidência:**
  ```typescript
  Deno.serve(async (req: Request) => {
    // Sem validação de assinatura ou token de origem
    payload = await req.json()
    // Processa diretamente — pode marcar pagamento como concluído sem pagamento real
    await dbInsert('webhook_log', { gateway, evento, payload })
  })
  ```
- **Risco:** Atacante pode enviar payload falso para marcar vendas como pagas sem pagamento, disparar automações fraudulentas, ou criar/modificar leads via webhook forjado.
- **Correção:** Implementar validação HMAC-SHA256:
  ```typescript
  const sig = req.headers.get('X-Signature') ?? ''
  const body = await req.text()
  const key = await crypto.subtle.importKey('raw',
    new TextEncoder().encode(Deno.env.get('WEBHOOK_SECRET')!),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const expected = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  const expectedHex = Array.from(new Uint8Array(expected)).map(b => b.toString(16).padStart(2,'0')).join('')
  if (sig !== expectedHex) return json({ error: 'Assinatura inválida' }, 401)
  ```

---

### [C-06] CORS wildcard em todas as Edge Functions
- **Severidade:** CRÍTICO
- **Norma:** OWASP A05:2021 · CWE-16 · NIST CSF PR.IP-1
- **Arquivo:** `supabase/functions/_shared/security.ts:7`
- **Evidência:**
  ```typescript
  export const CORS = {
    'Access-Control-Allow-Origin': '*',  // qualquer domínio pode chamar
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
  }
  ```
- **Risco:** Qualquer site malicioso pode fazer requisições POST para `/functions/v1/admin-users`, `/marketplace-checkout`, `/payment-webhook` etc. sem restrição de origem.
- **Correção:**
  ```typescript
  export const CORS = {
    'Access-Control-Allow-Origin': 'https://seudominio.com.br',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
  }
  ```

---

## DOMÍNIO 2 — EXPOSIÇÃO DE DADOS E SECRETS

### [C-07] API Key da Anthropic exposta no bundle JavaScript do frontend
- **Severidade:** CRÍTICO
- **Norma:** CWE-798 · OWASP A02:2021
- **Arquivo:** `src/components/ClaudeChat.tsx:13, 44`
- **Evidência:**
  ```typescript
  const API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY
  headers: {
    'x-api-key': API_KEY ?? '',
    'anthropic-dangerous-direct-browser-access': 'true',  // ← indica ciência do risco
  }
  ```
- **Risco:** Chave visível no bundle JS compilado e no Network tab do DevTools. Qualquer visitante pode extrair a chave e usar a cota da API sem autorização.
- **Correção:** Criar Edge Function proxy no Supabase:
  ```typescript
  // supabase/functions/claude-proxy/index.ts
  const auth = await requireAuth(req)  // valida JWT do usuário
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    headers: { 'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')! },
    body: await req.text(),
    method: 'POST',
  })
  ```

---

### [A-01] Dados pessoais registrados em logs do sistema
- **Severidade:** ALTO
- **Norma:** CWE-312 · CWE-200 · LGPD Art. 46
- **Arquivo:** `src/components/ChatPanel.tsx:438, 465`
- **Evidência:**
  ```typescript
  logger.info('ChatPanel', 'init', {
    contact_id: contact.id,
    nome: contact.nome,        // dado pessoal
    telefone: contact.telefone // dado pessoal
  })
  ```
- **Risco:** Dados pessoais armazenados em `window.__certiidLogs` (acessível via DevTools) e console. Violação de minimização LGPD.
- **Correção:** Remover campos pessoais dos logs ou mascarar: `telefone: '***-****'`

---

### [A-02] Mensagens de erro técnicas expostas ao usuário
- **Severidade:** ALTO
- **Norma:** CWE-209 · OWASP A01:2021
- **Arquivos:** `src/pages/Clientes.tsx:195, 263` · múltiplos outros
- **Evidência:**
  ```typescript
  alert(`Erro ao salvar cliente: ${error.message}`)
  console.error(error)  // stack trace visível no DevTools
  ```
- **Risco:** Mensagens técnicas podem expor nomes de tabelas, estrutura do banco, dependências e pontos de falha da arquitetura.
- **Correção:** Exibir apenas mensagem genérica ao usuário (`"Erro ao salvar. Contate o suporte."`) e logar detalhes apenas no servidor.

---

## DOMÍNIO 3 — INJEÇÃO, XSS E VALIDAÇÃO DE INPUT

### [C-08] SQL Injection via filtro `.or()` com input não sanitizado
- **Severidade:** CRÍTICO
- **Norma:** OWASP A03:2021 · CWE-89
- **Arquivo:** `src/pages/Comercial.tsx:1160`
- **Evidência:**
  ```typescript
  const like = `%${t}%`  // 't' = input direto do usuário, sem sanitização
  .or(`nome.ilike.${like},nome_fantasia.ilike.${like},cpf_cnpj.ilike.${like}`)
  ```
- **Risco:** Injeção de operadores Supabase na string do filtro (`cs.`, `sl.`, `isnull`, vírgulas etc.) pode contornar a lógica de busca e expor registros não autorizados.
- **Correção:**
  ```typescript
  const safe = t.replace(/[%_,()]/g, '\\$&').trim()
  const like = `%${safe}%`
  ```

---

### [A-03] Open Redirect e XSS via `window.open(external_url)` sem validação de protocolo
- **Severidade:** ALTO
- **Norma:** OWASP A03:2021 · CWE-79
- **Arquivo:** `src/components/ChatPanel.tsx:183, 1096`
- **Evidência:**
  ```typescript
  if (doc.external_url) return doc.external_url  // sem validação de protocolo
  window.open(url, '_blank', 'noopener,noreferrer')
  ```
- **Risco:** Se `external_url` armazenado no banco contiver `javascript:` ou `data:text/html`, executa script arbitrário no contexto da aplicação.
- **Correção:**
  ```typescript
  const parsed = new URL(url)
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('URL inválida')
  window.open(url, '_blank', 'noopener,noreferrer')
  ```

---

### [A-04] Upload de arquivo sem validação de MIME type no servidor
- **Severidade:** ALTO
- **Norma:** OWASP A04:2021 · NIST CSF PR.DS-1
- **Arquivo:** `src/components/ChatPanel.tsx:936`
- **Evidência:**
  ```typescript
  // Apenas verifica tamanho, não tipo
  if (file.size > 20 * 1024 * 1024) { alert('Arquivo muito grande'); return }
  await supabase.storage.from(bucket).upload(storagePath, file, {
    contentType: file.type || 'application/octet-stream',  // confia no navegador
  })
  ```
- **Risco:** `file.type` é fornecido pelo navegador e pode ser falsificado. Um executável `.exe` renomeado para `.pdf` passa na validação.
- **Correção:**
  ```typescript
  const ALLOWED = new Set(['image/jpeg','image/png','application/pdf','text/plain'])
  if (!ALLOWED.has(file.type)) { alert('Tipo de arquivo não permitido'); return }
  ```

---

### [A-05] URLs de servidor externo (upload/delete) usadas sem validação
- **Severidade:** ALTO
- **Norma:** OWASP A03:2021 · CWE-77
- **Arquivo:** `src/components/ChatPanel.tsx:964, 1065`
- **Evidência:**
  ```typescript
  // URL vem do banco de dados, usada diretamente em fetch()
  await fetch(documentStorageConfig.server_upload_url, { method: 'POST', body: form })
  await fetch(documentStorageConfig.server_delete_url, { method: 'POST', ... })
  ```
- **Risco:** Admin comprometido pode inserir URLs maliciosas (`http://attacker.com`) no banco, desviando uploads para servidores externos.
- **Correção:**
  ```typescript
  const url = new URL(documentStorageConfig.server_upload_url)
  if (!['https:'].includes(url.protocol)) throw new Error('URL insegura')
  ```

---

### [M-01] Ausência de validação de schema (Zod/Yup) em formulários e APIs
- **Severidade:** MÉDIO
- **Norma:** OWASP A03:2021 · NIST CSF PR.DS-1
- **Arquivo:** `supabase/functions/admin-users/index.ts:23`
- **Evidência:**
  ```typescript
  const email = String(payload.email ?? '').trim()
  if (!email || !password || !nome) return json({ error: 'Dados obrigatórios' }, 400)
  // Sem validação de formato de email, força da senha, etc.
  ```
- **Correção:** Adotar Zod para validação:
  ```typescript
  const schema = z.object({ email: z.string().email(), senha: z.string().min(8), nome: z.string().min(1) })
  const parsed = schema.safeParse(payload)
  if (!parsed.success) return json({ error: parsed.error.issues }, 400)
  ```

---

## DOMÍNIO 4 — CONFIGURAÇÃO, INFRAESTRUTURA E DEPENDÊNCIAS

### [C-09] Headers HTTP de segurança ausentes no nginx
- **Severidade:** CRÍTICO
- **Norma:** OWASP A05:2021 · ISO 27001 A.12
- **Arquivo:** `nginx.conf` — arquivo inteiro
- **Ausentes:** `Content-Security-Policy` · `X-Frame-Options` · `X-Content-Type-Options` · `Strict-Transport-Security` · `X-XSS-Protection`
- **Risco:** Vulnerável a clickjacking (iframe malicioso), XSS refletido, MIME-sniffing e downgrade de HTTPS para HTTP.
- **Correção:**
  ```nginx
  add_header X-Frame-Options "DENY" always;
  add_header X-Content-Type-Options "nosniff" always;
  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
  add_header X-XSS-Protection "1; mode=block" always;
  add_header Content-Security-Policy "default-src 'self'; connect-src 'self' https://*.supabase.co;" always;
  ```

---

### [A-06] Rate limiting ausente em endpoints sensíveis
- **Severidade:** ALTO
- **Norma:** OWASP A05:2021 · CWE-16
- **Local:** Todos os Supabase Edge Functions (admin-users, marketplace-checkout, notify-new-user)
- **Risco:** Força bruta em criação de usuários, spam de notificações, abuso de checkout. Sem limitação por IP ou token.
- **Correção:** Implementar sliding window counter por IP em cada Edge Function ou configurar `limit_req_zone` no nginx.

---

### [A-07] Dependências com versões vulneráveis ou EOL
- **Severidade:** ALTO
- **Norma:** OWASP A06:2021 · ISO 27001 A.12.6
- **Arquivo:** `package.json`
- **Pacotes problemáticos:**
  - `vite@^8.0.12` — versão 8 é EOL; versão estável atual é 5.x
  - `typescript@~6.0.2` — versão 6 é beta/instável; versão estável é 5.x
  - `node-forge@1.3.1` — CVE conhecidos em parsing de certificados X.509; mínimo seguro: 1.4.0
- **Correção:** Atualizar para versões estáveis e executar `npm audit fix`.

---

### [A-08] Edge Functions usando SERVICE_ROLE_KEY em todas as operações
- **Severidade:** ALTO
- **Norma:** CWE-276 · ISO 27001 A.14
- **Arquivo:** `supabase/functions/_shared/security.ts:4-13`
- **Evidência:**
  ```typescript
  export const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  export const adminDb = createClient(SUPABASE_URL, SERVICE_KEY)
  // adminDb é usado em TODAS as operações, ignorando RLS
  ```
- **Risco:** Um bug em qualquer Edge Function expõe todos os dados do banco. RLS é completamente ignorado.
- **Correção:** Usar `ANON_KEY` + RLS para operações comuns. Reservar `SERVICE_KEY` apenas para operações que genuinamente exigem bypass administrativo.

---

### [A-09] Variáveis de ambiente não validadas na inicialização
- **Severidade:** ALTO
- **Norma:** CWE-16 · NIST CSF ID.GV-1
- **Arquivo:** `src/lib/supabase.ts:1-6`
- **Evidência:**
  ```typescript
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string  // sem validação
  export const supabase = createClient(supabaseUrl, supabaseAnonKey)  // pode iniciar com string vazia
  ```
- **Correção:**
  ```typescript
  if (!supabaseUrl?.startsWith('https://')) throw new Error('VITE_SUPABASE_URL inválida')
  if (!supabaseAnonKey?.startsWith('eyJ')) throw new Error('VITE_SUPABASE_ANON_KEY inválida')
  ```

---

### [M-02] Logging verbose com dados internos em produção
- **Severidade:** MÉDIO
- **Norma:** OWASP A09:2021 · ISO 27001 A.12.4
- **Arquivo:** `supabase/functions/payment-webhook/index.ts:151` e outros
- **Evidência:** `console.error('Erro ao buscar venda para NFS-e mock:', vendaError)` — expõe IDs de venda, valores e estrutura interna nos logs da função.
- **Correção:** Logar apenas em ambiente de desenvolvimento. Em produção, usar IDs de correlação sem dados sensíveis.

---

### [M-03] Cookies de sessão sem flags de segurança
- **Severidade:** MÉDIO
- **Norma:** OWASP A05:2021 · ISO 27001 A.14
- **Local:** Configuração do Supabase Auth / `src/contexts/AuthContext.tsx`
- **Risco:** Supabase armazena tokens de sessão em `localStorage` por padrão, tornando-os acessíveis a scripts XSS. Ausência de `SameSite`, `Secure`, `HttpOnly`.
- **Correção:** Configurar Supabase para usar cookies HTTP-only ou implementar middleware de validação no nginx.

---

## DOMÍNIO 5 — CONFORMIDADE LGPD, MARCO CIVIL E ANPD

### [C-10] Ausência de consentimento documentado na coleta de dados pessoais
- **Severidade:** CRÍTICO
- **Norma:** LGPD Art. 7, I · Art. 8 · ANPD Res. CD/ANPD nº 2/2022
- **Local:** Formulários de cadastro, checkout e leads
- **Risco:** Coleta de CPF, e-mail, telefone, dados financeiros sem comprovação de consentimento livre, informado e inequívoco. Multa ANPD até R$ 50 milhões ou 2% do faturamento.
- **Correção:**
  - Adicionar checkbox obrigatório com link para Política de Privacidade
  - Armazenar em banco: `data_consentimento TIMESTAMPTZ`, `versao_politica TEXT`, `ip_origem INET`

---

### [C-11] Direito ao esquecimento (exclusão de dados) não implementado
- **Severidade:** CRÍTICO
- **Norma:** LGPD Art. 18, IV
- **Local:** Toda a aplicação — funcionalidade inexistente
- **Risco:** Titular não pode solicitar exclusão de seus dados. Violação de direito fundamental com sanção automática.
- **Correção:**
  ```sql
  -- Anonimização em vez de exclusão física (preserva integridade referencial)
  UPDATE cadastros_base SET
    cpf_cnpj = 'ANON_' || md5(id::text),
    nome = 'DADO EXCLUÍDO',
    email = NULL, telefone = NULL
  WHERE id = $1;
  ```

---

### [C-12] Sem logs de auditoria de acesso e autenticação
- **Severidade:** CRÍTICO
- **Norma:** Marco Civil Art. 13-15 · LGPD Art. 46 · ISO 27001 A.12.4
- **Local:** Nenhuma tabela ou mecanismo de auditoria implementado
- **Risco:** Marco Civil exige retenção de logs por 6 meses. Sem auditoria, incidentes não podem ser investigados e a empresa não pode cumprir obrigação legal.
- **Correção:**
  ```sql
  CREATE TABLE audit_log_autenticacao (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT, ip_address INET, resultado TEXT,
    timestamp TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE TABLE audit_log_acesso (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id UUID, tabela TEXT, operacao TEXT,
    registro_id UUID, timestamp TIMESTAMPTZ DEFAULT NOW()
  );
  ```

---

### [C-13] Transferência internacional de dados sem DPA assinado
- **Severidade:** CRÍTICO
- **Norma:** LGPD Art. 33
- **Integrações identificadas:**
  - Evolution API (WhatsApp) — origem não verificada
  - Anthropic Claude API — servidores nos EUA
  - SafeWeb / SafeID — servidores não verificados
  - Supabase — projeto hospedado em região US
- **Risco:** Dados pessoais de brasileiros processados fora do Brasil sem cláusula contratual ou adequação verificada. Multa ANPD até R$ 50 milhões.
- **Correção:** Assinar Data Processing Addendum (DPA) com cada fornecedor. Documentar e publicar a lista de subprocessadores na Política de Privacidade.

---

### [C-14] Sem mecanismo de notificação de incidente de segurança (breach)
- **Severidade:** CRÍTICO
- **Norma:** LGPD Art. 48
- **Local:** Nenhuma implementação
- **Risco:** Em caso de vazamento, LGPD exige comunicação à ANPD em até 72 horas e aos titulares sem atraso injustificado. Sem processo definido = sanção automática.
- **Correção:**
  - Criar tabela `incidentes_seguranca` com campos: `data_incidente`, `descricao`, `dados_afetados[]`, `data_notificacao_anpd`, `protocolo_anpd`
  - Documentar SOP: (1) isolamento → (2) notificação DPO em 12h → (3) ANPD em 72h → (4) titulares afetados

---

### [A-10] Direitos do titular — acesso e portabilidade não implementados
- **Severidade:** ALTO
- **Norma:** LGPD Art. 18, I e V
- **Local:** Toda a aplicação — funcionalidade inexistente
- **Risco:** Titular não pode visualizar seus dados nem exportá-los em formato estruturado.
- **Correção:** Criar endpoint `/api/exportar-dados-pessoais` retornando JSON com todos os dados do usuário. Responder em até 15 dias úteis (Art. 18, §1º).

---

### [A-11] DPO/Encarregado de Dados não identificado na aplicação
- **Severidade:** ALTO
- **Norma:** LGPD Art. 41
- **Local:** Nenhuma página ou link de contato para assuntos de privacidade
- **Correção:** Publicar nome, e-mail e canal de contato do DPO na aplicação (rodapé, página de login, política de privacidade).

---

### [A-12] Sem política de retenção de dados com exclusão automática
- **Severidade:** ALTO
- **Norma:** LGPD Art. 15-16
- **Local:** Schema SQL — todas as tabelas principais
- **Evidência:** Tabelas `leads_contabilidade`, `cadastros_base` armazenam dados indefinidamente sem critério de expiração.
- **Correção:** Definir e implementar políticas de retenção:
  - Leads não convertidos → 180 dias
  - Certificados expirados → 3 anos (obrigação legal)
  - Documentos financeiros → 5 anos (obrigação fiscal)

---

## CONFORMIDADE NORMATIVA CONSOLIDADA

| Norma | Status | Achados Principais |
|---|---|---|
| OWASP Top 10 (2021) | ❌ Falhou | C-01 a C-09, A-01 a A-09 |
| OWASP API Security (2023) | ❌ Falhou | C-05, C-06, A-06 |
| CWE Top 25 (2024) | ❌ Falhou | C-01, C-07, C-08 |
| ISO/IEC 27001:2022 | ⚠ Parcial | C-01, C-09, A-07, A-08 |
| NIST CSF 2.0 | ⚠ Parcial | C-06, A-06 |
| LGPD Lei 13.709/2018 | ❌ Crítico | C-10 a C-14, A-10 a A-12 |
| Marco Civil Lei 12.965/2014 | ❌ Falhou | C-12 |
| Diretrizes ANPD | ❌ Falhou | C-10, C-11, C-14 |

---

## PLANO DE REMEDIAÇÃO PRIORIZADO

### Semana 1 — Crítico Imediato (antes de qualquer deploy)
1. **[C-01]** Rotacionar `SUPABASE_SERVICE_ROLE_KEY` e `VITE_SUPABASE_ANON_KEY` no Supabase Dashboard
2. **[C-07]** Mover chamada Anthropic para Edge Function proxy — remover chave do frontend
3. **[C-05]** Implementar validação HMAC-SHA256 nos webhooks de pagamento, Evolution e Chatwoot
4. **[C-06]** Restringir CORS para o domínio específico da aplicação

### Semana 2 — Segurança da Aplicação
5. **[C-04]** Ativar RLS em `leads_contabilidade`, `chat_kanban_columns`, `cadastros_base`
6. **[C-02]** Adicionar verificações `isAdmin` server-side nas operações privilegiadas
7. **[C-08]** Sanitizar input do filtro de busca em `Comercial.tsx`
8. **[C-09]** Adicionar headers de segurança no `nginx.conf`
9. **[A-04]** Validar MIME type no upload de arquivos

### Semanas 3-4 — Conformidade LGPD
10. **[C-10]** Adicionar consentimento obrigatório nos formulários com armazenamento de prova
11. **[C-12]** Criar tabelas de auditoria de autenticação e acesso
12. **[C-11]** Implementar fluxo de exclusão/anonimização de dados
13. **[A-11]** Publicar DPO e Política de Privacidade na aplicação

### Mês 2 — Hardening
14. **[A-06]** Rate limiting em endpoints sensíveis
15. **[A-12]** Política de retenção com exclusão automática
16. **[C-13]** Assinar DPA com fornecedores externos
17. **[C-14]** SOP de notificação de incidentes
18. **[A-07]** Atualizar dependências vulneráveis
19. **[A-08]** Refatorar Edge Functions para usar `anon key` + RLS quando possível

---

## INVENTÁRIO DE ARQUIVOS COM VULNERABILIDADES

| Arquivo | Achados |
|---|---|
| `.env` | C-01 |
| `query_db.js` | C-01 |
| `src/components/ClaudeChat.tsx` | C-07 |
| `src/components/ChatPanel.tsx` | A-01, A-03, A-04, A-05, M-01 |
| `src/pages/ChatAoVivo.tsx` | C-02, C-03 |
| `src/pages/Clientes.tsx` | C-03, A-02 |
| `src/pages/Comercial.tsx` | C-08 |
| `src/lib/supabase.ts` | A-09 |
| `src/contexts/AuthContext.tsx` | M-03 |
| `supabase/functions/_shared/security.ts` | C-06, A-08 |
| `supabase/functions/payment-webhook/index.ts` | C-05, M-02 |
| `supabase/functions/evolution-webhook/index.ts` | C-05 |
| `supabase/functions/chatwoot-webhook/index.ts` | C-05 |
| `supabase/functions/notify-new-user/index.ts` | C-05 |
| `supabase/functions/admin-users/index.ts` | M-01 |
| `supabase/functions/marketplace-checkout/index.ts` | C-06, A-06 |
| `nginx.conf` | C-09 |
| `package.json` | A-07 |
| Schema SQL (migrations) | C-04, C-10 a C-14, A-12 |

---

*Gerado por varredura automatizada de segurança com 5 agentes paralelos em 28/05/2026.*
*Metodologia: análise estática de código-fonte — não substitui pentest com execução dinâmica.*
