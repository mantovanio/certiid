# Finalizacao CRM CertiID

## Status final

O front do CRM CertiID foi ajustado, publicado e validado na VPS. O deploy subiu com sucesso e a aplicacao publica voltou a responder normalmente em `https://certiid.mantovan.com.br`.

## O que foi concluido

### 1. Selecao explicita do canal de envio no chat

O composer do chat agora deixa claro por qual numero a mensagem sera enviada.

O que mudou:
- o canal de resposta passou a ser exibido de forma visivel;
- os canais disponiveis aparecem como botoes de selecao;
- a escolha fica presa a conversa aberta;
- ao trocar de conversa, o sistema volta a sugerir o canal correto pela `whatsapp_instance` e pela fila.

Arquivo principal:
- `src/pages/ChatInboxCRM.tsx`

Commit:
- `5f16661` - `fix: explicita escolha do canal de envio no chat`

### 1.1. Assinatura das mensagens enviadas

As mensagens humanas enviadas pelo CRM agora saem com assinatura do usuario que esta respondendo.

Regra aplicada:
- o texto enviado para o WhatsApp recebe a assinatura `— Nome do usuario`;
- o nome vem do usuario logado no CRM;
- o mesmo nome tambem fica preservado no historico interno.

Arquivo principal:
- `supabase/functions/evolution-webhook/index.ts`

### 2. Restauracao da view de follow-up

A view que os workflows do n8n esperavam voltou a existir no projeto do CRM.

Arquivo criado:
- `supabase/migrations/20260616_crm_customers_followup_view.sql`

Commit:
- `7071820` - `fix: restaura view de follow-up do CRM`

Essa migration recompõe a `crm_customers_followup_view` com:
- `document_key`
- `telefone_principal`
- `contato_status`
- `follow_up_1`
- `follow_up_2`
- `follow_up_3`
- `crm_chat_conversation_id`
- `crm_conversation_id`
- `crm_contact_id`
- `whatsapp_instance`
- `numero_receptor`
- `ultima_interacao_em`
- `minutos_ultima_mensagem_base`

## Deploy realizado

O deploy oficial do projeto foi executado na VPS com a chave correta.

Resultado:
- build concluida com sucesso;
- stack `certiid_certiid` voltou com `1/1`;
- o HTML da SPA responde em `https://certiid.mantovan.com.br`;
- o bundle principal do front responde com `HTTP 200`.

## Validacoes feitas

- build local passou com `npm run build`;
- deploy remoto concluiu sem erro;
- pagina inicial da aplicacao respondeu normalmente;
- bundle principal carregou corretamente;
- logs da stack indicam nginx pronto para servir a aplicacao.

## Observacoes importantes

- O worktree do projeto ja tinha outras alteracoes pendentes que nao foram mexidas.
- O frontend entregue aqui foi focado em:
  - envio de mensagens;
  - escolha do canal de envio;
  - estabilidade da conversa;
  - restauracao da base dos follow-ups.
- O resto do sistema continua dependendo da sincronizacao do banco e dos workflows do n8n para refletir as conversas em tempo real.

## Proxima etapa recomendada

Se quiser continuar a evolucao, os proximos alvos naturais sao:
- validar entrada/saida em tempo real com as duas contas WhatsApp;
- garantir que o histórico esteja completo no canvas do CRM;
- checar reabertura automatica de conversas encerradas;
- confirmar que os follow-ups de 20 min e 24 h voltaram a executar sem erro.
