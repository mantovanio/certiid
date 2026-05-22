-- ============================================================
-- Catálogo Comercial: certificados, preços, comissões e pagamentos
-- ============================================================

-- 1. Certificados disponíveis para venda
create table if not exists certificados (
  id          uuid primary key default gen_random_uuid(),
  tipo        text not null,
  estoque     integer not null default 0,
  validade    text not null,
  ativo       boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 2. Tabela de preços por canal de venda
create table if not exists precos_certificados (
  id              uuid primary key default gen_random_uuid(),
  certificado_id  uuid not null references certificados(id) on delete cascade,
  canal           text not null check (canal in ('balcao','ecommerce','prepago','voucher','link_externo')),
  valor           numeric(10,2) not null default 0,
  ativo           boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (certificado_id, canal)
);

-- 3. Faixas de comissão por volume de emissões
create table if not exists faixas_comissao (
  id            uuid primary key default gen_random_uuid(),
  faixa         text not null,
  min_emissoes  integer not null default 0,
  max_emissoes  integer,
  percentual    numeric(5,2) not null default 0,
  valor_exemplo numeric(10,2),
  ordem         integer not null default 0,
  ativo         boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- 4. Formas de pagamento aceitas
create table if not exists formas_pagamento (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null,
  ordem       integer not null default 0,
  ativo       boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Triggers para updated_at automático
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'set_updated_at_certificados') then
    create trigger set_updated_at_certificados
      before update on certificados
      for each row execute function set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'set_updated_at_precos_certificados') then
    create trigger set_updated_at_precos_certificados
      before update on precos_certificados
      for each row execute function set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'set_updated_at_faixas_comissao') then
    create trigger set_updated_at_faixas_comissao
      before update on faixas_comissao
      for each row execute function set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'set_updated_at_formas_pagamento') then
    create trigger set_updated_at_formas_pagamento
      before update on formas_pagamento
      for each row execute function set_updated_at();
  end if;
end $$;

-- RLS: apenas usuários autenticados leem; apenas admin escreve
alter table certificados        enable row level security;
alter table precos_certificados enable row level security;
alter table faixas_comissao     enable row level security;
alter table formas_pagamento    enable row level security;

-- Leitura para qualquer usuário autenticado
create policy "leitura autenticado" on certificados
  for select using (auth.role() = 'authenticated');

create policy "leitura autenticado" on precos_certificados
  for select using (auth.role() = 'authenticated');

create policy "leitura autenticado" on faixas_comissao
  for select using (auth.role() = 'authenticated');

create policy "leitura autenticado" on formas_pagamento
  for select using (auth.role() = 'authenticated');

-- Escrita apenas para admin (verificação via profiles)
create policy "escrita admin" on certificados
  for all using (
    exists (select 1 from profiles where id = auth.uid() and perfil = 'admin')
  );

create policy "escrita admin" on precos_certificados
  for all using (
    exists (select 1 from profiles where id = auth.uid() and perfil = 'admin')
  );

create policy "escrita admin" on faixas_comissao
  for all using (
    exists (select 1 from profiles where id = auth.uid() and perfil = 'admin')
  );

create policy "escrita admin" on formas_pagamento
  for all using (
    exists (select 1 from profiles where id = auth.uid() and perfil = 'admin')
  );

-- Dados iniciais — formas de pagamento comuns
insert into formas_pagamento (nome, ordem) values
  ('Dinheiro',        1),
  ('Pix',             2),
  ('Cartão Débito',   3),
  ('Cartão Crédito',  4),
  ('Boleto',          5),
  ('Transferência',   6)
on conflict do nothing;
