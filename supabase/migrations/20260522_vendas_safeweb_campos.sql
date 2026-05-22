-- Campos do relatório mensal Safeweb em vendas_certificados
alter table vendas_certificados
  add column if not exists numero_serie           text,
  add column if not exists data_inicio_validade   date,
  add column if not exists voucher_codigo         text,
  add column if not exists voucher_percentual     numeric(7,2),
  add column if not exists voucher_valor          numeric(10,2),
  add column if not exists nome_ar                text,
  add column if not exists nome_local_atendimento text,
  add column if not exists status_certificado     text,
  add column if not exists nome_parceiro_safeweb  text;

-- Índice único no protocolo para upsert via importação
create unique index if not exists vendas_certificados_protocolo_uq
  on vendas_certificados(protocolo_numero)
  where protocolo_numero is not null;

-- Índice único no cpf_cnpj de cadastros_base para upsert de clientes
create unique index if not exists cadastros_base_cpf_cnpj_uq
  on cadastros_base(cpf_cnpj)
  where cpf_cnpj is not null;
