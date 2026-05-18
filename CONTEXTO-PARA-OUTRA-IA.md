# Contexto Para Continuar Com Outra IA

## Objetivo

Este arquivo resume o estado real do projeto `CertiID_1.0.0` em `15/05/2026`
para que outra IA consiga continuar o trabalho sem perder contexto.

O usuario fala apenas portugues brasileiro, e prefere orientacoes passo a passo
quando ele precisar executar algo manualmente.

---

## Estado geral

- A base oficial da `V2` ja foi implantada no projeto e salva no GitHub.
- O commit-base desta fase foi:
  - `35be2f5` - `feat: adiciona base oficial da estrutura v2`
- Depois disso, foram feitas varias melhorias locais que **ainda nao foram
  commitadas/publicadas**.

---

## O que ja esta salvo no GitHub

### 1. Migration oficial V2

Arquivo:

- `sql/migration_v2_oficial.sql`

Ja aplicada no Supabase anteriormente.

Essa migration criou a base relacional nova, incluindo:

- `cadastros_base`
- `empresas_cliente`
- `titulares_certificado`
- `pontos_atendimento`
- `pontos_atendimento_agentes`
- `vendas_certificados`
- `agendamentos_validacao`
- `produtos_emitidos`
- `documentos_financeiros`
- `bancos`
- `contas_bancarias_v2`
- `formas_pagamento_v2`
- `formas_pagamento_disponibilidade`
- `plano_contas`
- `centros_custo`
- `regras_comissao`
- `comissoes_lancamentos`
- `fechamentos_agente_lotes`
- `fechamentos_agente_itens`
- `fechamentos_agente_itens_comissoes`
- `ordens_pagamento`
- `nfse_configuracoes`
- `nfse_emitidas`

### 2. Seguranca do Supabase admin

Arquivo:

- `src/lib/supabaseAdmin.ts`

Ja foi removido o uso hardcoded da `service_role key`.
Agora o arquivo usa `import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY`.

### 3. Tipos V2

Arquivo:

- `src/types/index.ts`

Ja existem os tipos principais da V2 para cadastro, venda, agendamento,
produto emitido, financeiro, NFS-e, comissoes e renovacoes V2.

### 4. Bases iniciais de telas ja preparadas

Arquivos:

- `src/pages/Comercial.tsx`
- `src/pages/Renovacoes.tsx`
- `src/pages/Financeiro.tsx`
- `src/pages/Configuracoes.tsx`

Ja houve migracao parcial dessas telas para a estrutura nova.

---

## O que foi feito localmente e ainda nao foi publicado

Essas mudancas estao no computador local e **nao estao salvas no GitHub ainda**.

### 1. Renovações

Arquivo:

- `src/pages/Renovacoes.tsx`

Foi ajustado:

- importacao de planilha aceita `.csv`, `.xls` e `.xlsx`
- download do modelo agora gera `modelo_renovacoes.xlsx`
- templates carregam automaticamente ao abrir a tela
- escolha separada de template para `WhatsApp` e `E-mail`
- cada canal pode ter `template padrao`
- exclusao individual e em lote com `soft delete`
- coluna `Acoes` foi movida para o inicio da linha
- botoes das acoes ficaram em formato de icones com tooltip
- entrou acao de `Editar contato`

### Regras atuais de Renovacoes

- a edicao rapida nessa tela deve permitir **somente**:
  - `e-mail`
  - `telefone`
- `nome`, `CPF`, `CNPJ`, `razao social` e outros dados mestres
  **nao podem** ser alterados por essa tela
- se houver mudanca em dados mestres, isso deve acontecer no cadastro principal
  e refletir no sistema inteiro

### Permissoes definidas pelo usuario

- `usuario comum`: nunca pode alterar cadastro
- `agente_registro`: pode alterar dados de cadastro
- `admin`: pode alterar tudo
- somente `admin` pode excluir vendas/itens do sistema

Na interface de `Renovacoes`, ficou combinado:

- `admin` pode editar contato e excluir
- `agente_registro` pode editar contato
- usuario comum nao pode editar nem excluir

### 2. Comercial > Lançar Vendas

Arquivo:

- `src/pages/Comercial.tsx`

Foi evoluido localmente:

- filtros no topo por:
  - data inicial
  - data final
  - pedido
  - protocolo
  - cliente/documento
  - status
- tabela mais operacional, inspirada na referencia enviada pelo usuario
- colunas mais fortes de acompanhamento
- acoes por linha:
  - editar cliente
  - nova venda para esse cliente
  - agendar atendimento
- o formulario de cliente passou a permitir reaproveitamento para edicao
- o campo `Valor Custo` foi removido da interface da tela de venda

### 3. Parceiros

Arquivos:

- `src/pages/Parceiros.tsx`
- `src/types/index.ts`
- `sql/parceiros_gestao_v2.sql`

Foi iniciado um bloco novo e mais robusto de gestao de parceiros.

O objetivo dessa tela passou a ser:

- cadastrar parceiro com dados completos
- editar parceiro existente
- gerir bloqueios de venda/emissao
- gerir preferencias de mensageria
- vincular gestores
- vincular dados bancarios
- vincular centro de custo
- melhorar busca e gestao dos parceiros criados

Campos novos considerados:

- codigo do parceiro
- documento CPF/CNPJ
- razao social/nome
- nome fantasia
- id local de atendimento
- senha e email de acesso
- contatos adicionais
- endereco completo
- token
- inscricoes municipal e estadual
- tipo do parceiro
- datas de ativacao/desativacao
- bloqueio de vendas e emissao de protocolo
- preferencias de mensageria
- gestores 1 a 5
- dados bancarios
- chave pix
- centro de custo

Importante:

- o SQL `sql/parceiros_gestao_v2.sql` **ja foi executado no Supabase**
  durante esta sessao, com retorno do usuario: `feito`

---

## Dependencia nova adicionada localmente

Arquivos:

- `package.json`
- `package-lock.json`

Foi adicionada a dependencia:

- `xlsx`

Ela foi usada para suportar importacao/exportacao de planilhas na tela
de `Renovacoes`.

---

## O que ainda falta construir

Mesmo com a base V2 pronta, a operacao ainda nao esta concluida ponta a ponta.

Faltam, entre outros pontos:

- publicar as mudancas locais de `Renovacoes`, `Comercial` e `Parceiros`
- terminar a tela operacional de `Lançar Vendas`
- criar uma consulta mais forte de clientes/vendas dentro do fluxo comercial
- terminar a padronizacao de permissoes nas outras telas
- concluir a gestao de parceiros com todos os comportamentos esperados
- ligar totalmente formas de pagamento por parceiro/canal
- evoluir financeiro V2 na interface
- concluir NFS-e ponta a ponta
- concluir pagamentos mensais de agentes por API externa

---

## Estado atual do git no momento deste contexto

Arquivos alterados localmente:

- `PONTO-DE-SALVAMENTO-V2.md`
- `package.json`
- `package-lock.json`
- `src/pages/Comercial.tsx`
- `src/pages/Parceiros.tsx`
- `src/pages/Renovacoes.tsx`
- `src/types/index.ts`
- `sql/parceiros_gestao_v2.sql`

Arquivos locais que normalmente nao devem entrar no commit:

- `.claude/`
- `.vscode/`

---

## Arquivos que a proxima IA deve ler primeiro

1. `PONTO-DE-SALVAMENTO-V2.md`
2. `CONTEXTO-PARA-OUTRA-IA.md`
3. `src/pages/Renovacoes.tsx`
4. `src/pages/Comercial.tsx`
5. `src/pages/Parceiros.tsx`
6. `src/types/index.ts`
7. `sql/parceiros_gestao_v2.sql`
8. `sql/migration_v2_oficial.sql`

---

## Regras de negocio muito importantes

### Cadastros

- alteracoes de `nome`, `CPF`, `CNPJ`, `razao social` e outros dados mestres
  devem refletir no sistema inteiro
- portanto, esses dados precisam ser tratados como cadastro principal

### Permissoes

- usuario comum nao altera cadastro
- agente de registro pode alterar cadastro
- somente admin pode excluir vendas colocadas no sistema
- admin pode alterar tudo

### Renovações

- nessa tela, ajuste rapido deve ser apenas de contato
- `email` e `telefone` sao os campos permitidos na edicao rapida

### Comercial

- o usuario quer a tela `Comercial > Lançar Vendas` com carater mais
  operacional, parecida com a referencia visual enviada
- ele quer fila de vendas por ordem de compra, filtros fortes e acoes por linha

### Parceiros

- o usuario quer fazer gestao completa dos parceiros criados
- nao e apenas um cadastro simples
- a tela precisa permitir manutencao operacional real

---

## Orientacao para a proxima IA

Quando precisar passar tarefas manuais ao usuario:

- passar uma por vez
- esperar ele concluir
- so depois enviar a proxima

O usuario esta aprendendo e deve ser tratado como aprendiz, com orientacoes
claras e sem assumir conhecimento tecnico avancado.
