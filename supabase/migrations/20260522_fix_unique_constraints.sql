-- Substitui índices parciais por índices únicos completos
-- (índices parciais com WHERE não funcionam com ON CONFLICT no PostgREST)

-- vendas_certificados: protocolo_numero
drop index if exists vendas_certificados_protocolo_uq;
create unique index if not exists vendas_certificados_protocolo_uq
  on vendas_certificados(protocolo_numero);

-- cadastros_base: cpf_cnpj
drop index if exists cadastros_base_cpf_cnpj_uq;
create unique index if not exists cadastros_base_cpf_cnpj_uq
  on cadastros_base(cpf_cnpj);
