-- Adiciona campos detalhados ao catálogo de certificados
alter table certificados
  add column if not exists codigo              integer,
  add column if not exists descricao           text,
  add column if not exists modelo              text,
  add column if not exists categoria           text,
  add column if not exists tipo_emissao_padrao text,
  add column if not exists descricao_produto   text;

-- Índice único no código para suportar upsert via importação de planilha
create unique index if not exists certificados_codigo_uq
  on certificados(codigo) where codigo is not null;
