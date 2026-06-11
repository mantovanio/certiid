# Fechamento do Inbox CRM CertiID

## O que foi feito no projeto
- O menu `Chat` agora abre a nova central administrativa baseada em `crm_chat_admin_view`.
- A tela nova foi criada em `src/pages/ChatInboxCRM.tsx`.
- O hook de notificacoes foi migrado do modelo antigo `leads_contabilidade` para o inbox novo.
- A Edge Function `supabase/functions/evolution-webhook/index.ts` foi ajustada para gravar no inbox novo em paralelo ao legado.
- Foram salvos SQLs operacionais para estrutura, escrita, realtime e backfill.

## Arquivos principais alterados
- `src/App.tsx`
- `src/pages/ChatInboxCRM.tsx`
- `src/hooks/useNotifications.ts`
- `supabase/functions/evolution-webhook/index.ts`

## SQLs para executar no Supabase
1. `sql/01_atendimento_inbox_kanban.sql`
2. `sql/02_atendimento_inbox_write_policies.sql`
3. `sql/03_atendimento_inbox_realtime.sql`
4. `sql/04_atendimento_inbox_backfill.sql`
   Use apenas se quiser popular o painel imediatamente com contatos que ja estao em `crm_customers`.

## Fluxo esperado apos isso
1. A mensagem entra pela Evolution.
2. A Edge Function `evolution-webhook` grava em:
   - `communication_events`
   - `crm_chat_conversations`
   - `crm_chat_messages`
   - `crm_customers` quando precisar criar/atualizar contato
3. A mensagem recebida segue para o webhook do n8n:
   - `https://auto.mantovan.com.br/webhook/crm-certiid/inbound`
4. O n8n processa pela Clara.
5. A resposta pode voltar por `send_message_by_instance`.
6. O CRM passa a mostrar:
   - fila atendimento
   - fila renovacao
   - agente humano ou IA
   - historico da conversa
   - status do Kanban

## O que validar depois de executar os SQLs
- Existe registro em `crm_chat_conversations` apos uma nova mensagem real.
- Existe registro em `crm_chat_messages` apos uma nova mensagem real.
- O painel `Chat` mostra a conversa sem precisar atualizar manualmente.
- O botao de assumir humano funciona.
- O botao de atribuir agente funciona.
- As notificacoes do topo passam a apontar para conversas reais do inbox.

## Build validado
- `npm run build` executado com sucesso.

## Ponto pendente fora do build frontend
- Nao consegui rodar `deno check` localmente porque o `deno` nao esta instalado neste ambiente.
- A Edge Function foi revisada e ajustada, mas a validacao final dela deve ser feita no deploy/teste do Supabase.
