# Acessos e Deploy CertiID

Documento mestre para operação futura do CertiID.

Regra principal:
- Não armazenar senha, token ou chave privada em texto puro neste repositório.
- Guardar apenas o nome do segredo, o local onde ele fica e como ele é usado.

## 1. Onde este documento vale

- Repositório principal: `https://github.com/mantovanio/certiid`
- Site principal: `https://certiid.mantovan.com.br`
- VPS: `147.79.111.76`
- Stack Docker: `certiid`
- Serviço principal: `certiid_certiid`
- Diretório do deploy na VPS: `/opt/certiid`

## 2. Acessos confirmados

### GitHub

- Repositório: `mantovanio/certiid`
- Branch oficial de publicação: `main`
- Deploy automático: GitHub Actions

Secrets usados no GitHub Actions:
- `VPS_HOST`
- `VPS_USER`
- `VPS_SSH_KEY`
- `SUPABASE_ACCESS_TOKEN`

### VPS

- Usuário de acesso: `root`
- Host: `147.79.111.76`
- Chave SSH funcional para deploy atual:
  - arquivo local: `C:\Users\manto\.ssh\certifast_github_actions`
- Chave SSH que não respondeu para esta VPS:
  - arquivo local: `C:\Users\manto\.ssh\deploy_certiid`

Script de deploy:
- `/opt/certiid/deploy.sh`

O script faz:
- `git pull origin main`
- `docker build`
- `docker stack rm certiid`
- `docker stack deploy certiid`

### Supabase

- Projeto: `cvfrhfiaprdtwxxplngk`
- Edge Functions principais:
  - `evolution-webhook`
  - `chatwoot-webhook`
  - `notify-new-user`
  - `admin-users`

Variáveis/segredos recorrentes:
- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_ACCESS_TOKEN`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_SUPABASE_ANON_KEY`

### n8n

- Ambiente ativo: `CertiID`
- URL do ambiente: `https://auto.mantovan.com.br`
- Workspace path: `workflows/CertiID`

Segredos usados pelos fluxos:
- `N8N_SHARED_SECRET`
- `N8N_INBOUND_WEBHOOK_URL`
- `EVOLUTION_WEBHOOK_SECRET`
- `WEBHOOK_SECRET_ATENDIMENTO`
- `WEBHOOK_SECRET_RENOVACAO`
- `WEBHOOK_SECRET_CERTIID`
- `CHATWOOT_WEBHOOK_SECRET`

## 3. Como publicar

### Front-end

Fluxo oficial:
1. Alterar o código.
2. `npm run build`
3. `git add`
4. `git commit`
5. `git push origin main`
6. Aguardar GitHub Actions.
7. Validar o site em `https://certiid.mantovan.com.br`

### Deploy manual na VPS

Quando for necessário forçar:
1. Entrar na VPS com a chave SSH funcional.
2. Rodar:
   - `bash /opt/certiid/deploy.sh`

### Supabase / banco

- Mudanças de schema devem ir como migration em `supabase/migrations/`.
- Depois, aplicar no Supabase SQL Editor ou no pipeline de deploy das functions, conforme a mudança.

### n8n

- Workflow como código deve seguir o contexto `C:\projetos\N8N`.
- Antes de mexer em fluxo:
  - `npx --yes n8nac env status --json`
- Depois de editar:
  - `npx --yes n8nac push <arquivo.workflow.ts> --verify`

## 4. Local certo para guardar cada coisa

### Local

- `C:\Users\manto\.ssh\`
  - chaves SSH do operador
- `C:\projetos\CRM_CertiID\.env`
  - variáveis locais do projeto
- `C:\projetos\N8N\`
  - workflows e automações do n8n

### GitHub

- Segredos de CI/CD
- Código versionado
- Workflows de deploy

### VPS

- `/opt/certiid/.env`
- `/opt/certiid/deploy.sh`
- stack Docker em execução

### Supabase

- segredos de Edge Functions
- migrations
- policies

## 5. Checklist rápido de recuperação

Se algo quebrar:
1. Confirmar se o problema é front, banco, n8n ou VPS.
2. Verificar o GitHub Actions.
3. Verificar se a chave SSH funcional é a `certifast_github_actions`.
4. Verificar se o `deploy.sh` da VPS foi executado.
5. Confirmar se a migration foi aplicada no Supabase.
6. Confirmar se as Edge Functions foram atualizadas.
7. Confirmar se o n8n está apontando para os segredos corretos.

## 6. Padrão de segurança

- Nunca commitar senha, token, API key ou service role.
- Quando for preciso registrar um segredo, registrar só:
  - nome da variável;
  - sistema onde fica;
  - arquivo/localidade de guarda;
  - finalidade.

## 7. Observação operacional

O CRM CertiID é a fonte principal do atendimento.
O Chatwoot só deve ser usado como ponte temporária de migração.
O histórico definitivo deve ficar no ledger do CRM.

