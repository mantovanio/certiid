# Changelog

Todas as mudanças importantes do CertiID devem ser registradas neste arquivo.

O projeto usa versionamento semântico:

- `MAJOR`: mudança grande ou incompatível.
- `MINOR`: nova funcionalidade sem quebrar o sistema.
- `PATCH`: correção pequena ou ajuste sem nova funcionalidade.

## [1.4.0] - 2026-05-21

### Adicionado
- Redesenho completo do processo de vendas de certificados.
- Catálogo de certificados com novos campos: Tipo Emissão, Produto Vinculado na AC, Preço de Venda, Valor Custo AC, Valor Custo, Agrupador e Hash.
- Importação de planilha CSV/TSV para o catálogo de certificados com mapeamento automático de colunas.
- Sistema de Tabelas de Preço: múltiplas tabelas configuráveis por parceiro, tipo ou perfil, com campos de Código Voucher, percentuais de desconto e comissões.
- Itens das tabelas de preço com campos Preço de Venda, Valor Custo e Valor Repasse.
- Importação de planilha diretamente em cada tabela de preço.
- Formulário de lançamento de venda redesenhado: seleção de tabela, certificado, tipo emissão, forma de pagamento e vencimento.
- Modal "Emitir Protocolo" em 2 etapas: validação do titular (CPF + data nascimento + CNH) e preenchimento completo dos dados do certificado.
- Migrations: `20260521_catalogo_comercial.sql`, `20260521_certificados_campos.sql`, `20260521_tabelas_preco.sql`, `20260521_tabelas_preco_v2.sql`, `20260521_certificados_v2.sql`.

## [1.2.0] - 2026-05-20

### Adicionado
- Sistema de notificações automáticas pós-cadastro.
- E-mail profissional de boas-vindas para novos usuários com status de aprovação e logomarca dinâmica.
- Alerta automático via WhatsApp para o administrador sobre novos usuários pendentes.

## [1.1.0] - 2026-05-14

### Adicionado

- Configurações gerais da agência salvas no Supabase.
- Personalização da tela de login pela aba Configurações > Geral, com logomarca, textos e cores.
- Edição completa de usuários na aba Configurações > Usuários.
- Campos administrativos no perfil do usuário: vínculo, parceiro, documento, telefone, cidade e observações.
- Permissões por checkbox para definir quais áreas cada usuário pode acessar.
- Migration `sql/settings_users_permissions_migration.sql`.

### Corrigido

- Botão Salvar Alterações da aba Geral agora persiste os dados.
- Canetinha da aba Usuários deixou de editar somente o perfil e passou a editar o cadastro completo.

### Banco de Dados

- Nova tabela `app_settings`.
- Novas colunas em `profiles` para vínculos e permissões.
- Trigger de novos usuários atualizada para preencher permissões iniciais.

## [1.0.0] - 2026-05-14

### Adicionado

- Fluxo de aprovação de novos usuários.
- Novos cadastros nascem inativos e aguardam liberação do administrador.
- Manual de atualização do projeto.
- README central com links úteis.
