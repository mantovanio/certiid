-- Campos adicionais em tabelas_preco
alter table tabelas_preco
  add column if not exists codigo_voucher           text,
  add column if not exists max_desconto_percentual  numeric(5,2)  not null default 0,
  add column if not exists max_desconto_valor       numeric(10,2) not null default 0,
  add column if not exists comissao_venda_pct       numeric(5,2)  not null default 0,
  add column if not exists comissao_gestor_pct      numeric(5,2)  not null default 0,
  add column if not exists comissao_gestor_valor    numeric(10,2) not null default 0;

-- Campos de custo e repasse em tabelas_preco_itens
alter table tabelas_preco_itens
  add column if not exists valor_custo    numeric(10,2) not null default 0,
  add column if not exists valor_repasse  numeric(10,2) not null default 0;
