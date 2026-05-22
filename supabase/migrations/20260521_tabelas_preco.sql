-- ============================================================
-- Tabelas de preço configuráveis por parceiro / grupo
-- ============================================================

create table if not exists tabelas_preco (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null,
  descricao   text,
  ativo       boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Quem participa de cada tabela (individual, tipo ou perfil)
create table if not exists tabelas_preco_participantes (
  id                uuid primary key default gen_random_uuid(),
  tabela_preco_id   uuid not null references tabelas_preco(id) on delete cascade,
  tipo_participante text not null check (tipo_participante in ('parceiro', 'tipo_parceiro', 'perfil')),
  parceiro_id       uuid,     -- preenchido quando tipo_participante = 'parceiro'
  tipo_parceiro     text,     -- preenchido quando tipo_participante = 'tipo_parceiro'
  perfil            text,     -- preenchido quando tipo_participante = 'perfil'
  created_at        timestamptz not null default now()
);

-- Itens: certificado + preço + link Safeweb por tabela
create table if not exists tabelas_preco_itens (
  id               uuid primary key default gen_random_uuid(),
  tabela_preco_id  uuid not null references tabelas_preco(id) on delete cascade,
  certificado_id   uuid not null references certificados(id) on delete cascade,
  valor            numeric(10,2) not null default 0,
  link_safeweb     text,
  ativo            boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (tabela_preco_id, certificado_id)
);

-- Novos campos nas vendas_certificados
do $$ begin
  alter table vendas_certificados
    add column if not exists tabela_preco_id      uuid references tabelas_preco(id),
    add column if not exists tabela_preco_item_id uuid references tabelas_preco_itens(id),
    add column if not exists pago                 boolean not null default false,
    add column if not exists data_pagamento       timestamptz,
    add column if not exists data_vencimento      date,
    add column if not exists contador_id          uuid;
exception when undefined_table then null;
end $$;

-- titular_id pode ser null até a emissão do protocolo
do $$ begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'vendas_certificados'
      and column_name = 'titular_id'
      and is_nullable = 'NO'
  ) then
    alter table vendas_certificados alter column titular_id drop not null;
  end if;
exception when others then null;
end $$;

-- Triggers de updated_at
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'set_updated_at_tabelas_preco') then
    create trigger set_updated_at_tabelas_preco
      before update on tabelas_preco
      for each row execute function set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'set_updated_at_tabelas_preco_itens') then
    create trigger set_updated_at_tabelas_preco_itens
      before update on tabelas_preco_itens
      for each row execute function set_updated_at();
  end if;
end $$;

-- RLS
alter table tabelas_preco               enable row level security;
alter table tabelas_preco_participantes enable row level security;
alter table tabelas_preco_itens         enable row level security;

create policy "leitura autenticado" on tabelas_preco
  for select using (auth.role() = 'authenticated');
create policy "leitura autenticado" on tabelas_preco_participantes
  for select using (auth.role() = 'authenticated');
create policy "leitura autenticado" on tabelas_preco_itens
  for select using (auth.role() = 'authenticated');

create policy "escrita admin" on tabelas_preco for all using (
  exists (select 1 from profiles where id = auth.uid() and perfil = 'admin')
);
create policy "escrita admin" on tabelas_preco_participantes for all using (
  exists (select 1 from profiles where id = auth.uid() and perfil = 'admin')
);
create policy "escrita admin" on tabelas_preco_itens for all using (
  exists (select 1 from profiles where id = auth.uid() and perfil = 'admin')
);
