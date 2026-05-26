alter table public.nfse_configuracoes
  add column if not exists identificador text,
  add column if not exists municipio_nome text,
  add column if not exists municipio_codigo_ibge text,
  add column if not exists provedor text not null default 'municipal',
  add column if not exists ativo boolean not null default true,
  add column if not exists usa_certificado_digital boolean not null default false,
  add column if not exists observacoes text;

update public.nfse_configuracoes
set
  municipio_nome = coalesce(nullif(municipio_nome, ''), 'Configuração fiscal'),
  provedor = coalesce(nullif(provedor, ''), 'municipal')
where true;

alter table public.nfse_configuracoes
  alter column municipio_nome set default 'Configuração fiscal';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'nfse_configuracoes_provedor_check'
  ) then
    alter table public.nfse_configuracoes
      add constraint nfse_configuracoes_provedor_check
      check (provedor in ('nacional', 'gissonline', 'municipal'));
  end if;
end $$;

create unique index if not exists nfse_config_unica_por_emitente_municipio_ambiente
  on public.nfse_configuracoes (
    cnpj_emitente,
    coalesce(municipio_codigo_ibge, ''),
    ambiente
  );
