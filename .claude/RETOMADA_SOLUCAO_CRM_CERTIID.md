# Retomada da solução CRM CertiID

## Direção definida

- O CRM CertiID é o sistema principal de atendimento.
- O Chatwoot fica apenas como ponte temporária de migração, sem ser a origem da operação.
- O histórico precisa morar no ledger do CRM:
  - `crm_chat_conversations`
  - `crm_chat_messages`
  - `communication_events`

## O que foi ajustado neste ciclo

- Adicionado backfill do histórico do Chatwoot para o CRM em:
  - `supabase/migrations/20260617_atendimento_inbox_backfill_chatwoot.sql`
- Melhorado o compositor de mensagem no painel para:
  - manter o campo de texto utilizável após enviar;
  - preservar o foco do cursor;
  - mostrar a mensagem enviada de forma imediata com item temporário.
- Reduzido o reload duplicado do realtime para eventos de evolução, diminuindo flicker.

## Próximo passo lógico

- Aplicar a migration no Supabase.
- Validar se o webhook do Chatwoot continua espelhando para o CRM enquanto a migração não termina.
- Testar:
  - recebimento de mensagem;
  - envio pelo CRM;
  - histórico completo da conversa;
  - anexos e áudio;
  - assinatura do remetente.

