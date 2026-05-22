-- Campos adicionais ao catálogo de certificados (v2)
alter table certificados
  add column if not exists produto_vinculado_ac  text,
  add column if not exists preco_venda           numeric(10,2) not null default 0,
  add column if not exists valor_custo_ac        numeric(10,2) not null default 0,
  add column if not exists valor_custo           numeric(10,2) not null default 0,
  add column if not exists agrupador             text,
  add column if not exists hash                  text;

-- Índice para busca por hash
create unique index if not exists certificados_hash_uq
  on certificados(hash) where hash is not null;
