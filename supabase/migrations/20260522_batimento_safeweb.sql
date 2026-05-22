-- Coluna para controle de batimento com relatório Safeweb
alter table vendas_certificados
  add column if not exists validado_safeweb boolean default null;

-- Índice para filtrar facilmente divergências
create index if not exists vendas_certificados_validado_safeweb_idx
  on vendas_certificados(validado_safeweb)
  where validado_safeweb is not null;
