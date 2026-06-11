# CLAUDE.md

## Projeto: CRM CertiID

CRM interno para gestão de clientes, atendimento via WhatsApp, emissão de certificados digitais e automação com IA (Clara).

### Stack
- **Frontend**: React + Vite + TypeScript + Tailwind — roda em Docker na VPS `147.79.111.76`
- **Backend**: Supabase (PostgreSQL + RLS + Edge Functions em Deno)
- **WhatsApp**: Evolution API — 3 instâncias: `atendimento`, `renovacao`, `certiid`
- **IA**: N8N + Gemini/GPT (Clara) — responde apenas nas instâncias `renovacao` e `certiid`
- **Produção**: `https://certiid.mantovan.com.br`

### Deploy

**Automático** (push para `main` dispara GitHub Actions):
- Frontend → SSH na VPS → `bash /opt/certiid/deploy.sh`
- Edge Functions → Supabase CLI (todas as funções listadas em `.github/workflows/deploy.yml`)

**Manual na VPS** (SSH direto — mais rápido):

```bash
ssh root@147.79.111.76 "bash /opt/certiid/deploy.sh"
```

Ou no servidor diretamente:

```bash
bash /opt/certiid/deploy.sh
```

**Manual Edge Functions** (do diretório local do projeto):

```bash
npx supabase login   # só na primeira vez
npx supabase functions deploy evolution-webhook --project-ref cvfrhfiaprdtwxxplngk
npx supabase functions deploy <outra-funcao>    --project-ref cvfrhfiaprdtwxxplngk
```

**Deploy completo local** (frontend + todas as Edge Functions):

```bash
ssh root@147.79.111.76 "bash /opt/certiid/deploy.sh"
npx supabase functions deploy evolution-webhook --project-ref cvfrhfiaprdtwxxplngk
```

**Se o GitHub Actions falhar no deploy da VPS** (`Permission denied (publickey)`):
- Verifique o secret `VPS_SSH_KEY` em: GitHub → repositório → Settings → Secrets → Actions
- A chave deve ser a privada do par autorizado em `root@147.79.111.76`
- Para gerar: `ssh-keygen -t ed25519` no servidor → copiar `~/.ssh/id_ed25519` como secret

**Supabase project ref**: `cvfrhfiaprdtwxxplngk`

### Edge Functions (`supabase/functions/`)

| Função | Propósito |
|--------|-----------|
| `evolution-webhook` | Recebe eventos da Evolution API, salva no CRM e encaminha para N8N (só renovacao/certiid) |
| `admin-users` | Gestão de usuários internos |
| `chatwoot-webhook` | Integração Chatwoot legado |
| `claude-proxy` | Proxy para API da Anthropic |
| `contestacao-public` | Endpoint público de contestação de assinatura |
| `marketplace-checkout` | Checkout do marketplace de lojas |
| `nfse-*` | Emissão de NFS-e (GissOnline e Nota Joseense) |
| `notify-new-user` | Notificação de novo usuário |
| `payment-webhook` | Webhook de pagamentos |

### Secrets (Supabase Edge Functions)

| Variável | Descrição |
|----------|-----------|
| `EVOLUTION_WEBHOOK_SECRET` | Token global fallback (= `evo-certiid-2026`) |
| `WEBHOOK_SECRET_ATENDIMENTO` | Token da instância atendimento |
| `WEBHOOK_SECRET_RENOVACAO` | Token da instância renovacao |
| `WEBHOOK_SECRET_CERTIID` | Token da instância certiid |
| `N8N_INBOUND_WEBHOOK_URL` | URL do webhook N8N para mensagens recebidas |
| `N8N_SHARED_SECRET` | Secret compartilhado CRM ↔ N8N |
| `SUPABASE_SECRET_KEY` | Service role key do Supabase |

### Regras de negócio importantes

- **Fila `renovacao`**: instâncias `renovacao` e `certiid` → IA Clara responde via N8N
- **Fila `atendimento`**: instância `atendimento` → somente atendimento humano, **não** encaminha para N8N
- `crm_chat_admin_view`: view principal do inbox — une conversas, clientes e agentes
- Mensagens **não** devem ser salvas em base64 no banco — usar Supabase Storage + URL
- Evitar duplicidade: `communication_events` + `crm_chat_messages` podem registrar a mesma mensagem por caminhos diferentes

### GitHub Secrets necessários

- `VPS_SSH_KEY`: chave privada SSH para acesso à VPS `147.79.111.76`
- `SUPABASE_ACCESS_TOKEN`: token pessoal do Supabase para deploy de Edge Functions

---

Behavioral guidelines to reduce common LLM coding mistakes, inspired by Andrej Karpathy's observations on LLM coding pitfalls.

## 1. Think Before Coding
**Don't assume. Don't hide confusion. Surface tradeoffs.**
- State your assumptions explicitly. If uncertain, ask the user.
- If multiple interpretations exist, present them — don't pick silently.
- Push back when warranted. If a simpler approach exists, say so.
- If something in the codebase is unclear, stop, name what is confusing, and ask for clarification.

## 2. Simplicity First
**Minimum code that solves the problem. Nothing speculative.**
- Implement only the features explicitly requested.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No complex error handling for impossible or highly unlikely scenarios.
- Keep the codebase bloat-free. If 200 lines could be 50, rewrite it.
- Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes
**Touch only what you must. Clean up only your own mess.**
- Do not "improve" adjacent code, comments, or formatting unless requested.
- Do not refactor things that are not broken.
- Match the existing style, naming conventions, and file structures exactly.
- If you notice unrelated dead code or bugs, mention them to the user — do not touch them.

## 4. Goal-Driven Execution
**Verify your work. Establish verifiable success criteria.**
- Build and run the code to verify changes.
- Check compiler/linter warnings and fix any issues introduced by your changes.
- Run tests (or create quick checks if tests are missing) to prove correctness.
- Ensure that the final solution meets all specified constraints.
