-- DG Brasil — 004: cliente canônico e dados acessórios
--
-- Um CPF/CNPJ = um Client, globalmente. Outro escritório trazendo a mesma
-- pessoa não cria outro Client: cria client_organization_relationships.
-- clients.origin_organization_id é a origem histórica do CADASTRO e nunca é
-- sobrescrita pela deduplicação.

create table public.clients (
  id                     uuid primary key default gen_random_uuid(),
  kind                   public.client_kind not null,
  cpf                    public.cpf_digits,
  cnpj                   public.cnpj_digits,
  origin_organization_id uuid not null references public.organizations (id) on delete restrict,
  status                 text not null default 'ACTIVE'
                         check (status in ('ACTIVE', 'INACTIVE', 'ARCHIVED')),
  created_by             uuid references public.profiles (id) on delete restrict,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  deleted_at             timestamptz,
  constraint clients_id_kind_key unique (id, kind),
  constraint clients_identifier_matches_kind check (
    (kind = 'INDIVIDUAL' and cpf is not null and cnpj is null)
    or
    (kind = 'COMPANY' and cnpj is not null and cpf is null)
  )
);

comment on column public.clients.origin_organization_id is
  'Origem comercial do CADASTRO. Não define origem de casos nem divisão financeira.';

-- Unicidade global (inclui excluídos): cliente excluído é restaurado, não recriado.
create unique index clients_cpf_key  on public.clients (cpf)  where cpf  is not null;
create unique index clients_cnpj_key on public.clients (cnpj) where cnpj is not null;
create index clients_origin_organization_idx on public.clients (origin_organization_id);

create trigger clients_set_updated_at
  before update on public.clients
  for each row execute function private.set_updated_at();

-- Regras que dependem de outras tabelas ou da sessão. Usa helpers definidos em
-- 015_private_auth_helpers (plpgsql resolve os nomes na execução).
create or replace function private.clients_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_origin record;
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
  else
    if new.kind is distinct from old.kind then
      raise exception 'O tipo do cliente (PF/PJ) não pode ser alterado' using errcode = '23514';
    end if;
    if (new.cpf is distinct from old.cpf or new.cnpj is distinct from old.cnpj)
       and auth.uid() is not null and not private.is_admin() then
      raise exception 'Somente ADMIN interno pode corrigir CPF/CNPJ' using errcode = '42501';
    end if;
  end if;

  if tg_op = 'INSERT' or new.origin_organization_id is distinct from old.origin_organization_id then
    select o.type, o.status, o.deleted_at into v_origin
    from public.organizations o where o.id = new.origin_organization_id;

    if v_origin.deleted_at is not null then
      raise exception 'Organização de origem excluída' using errcode = '23514';
    end if;
    if v_origin.type = 'PARTNER' and v_origin.status <> 'ACTIVE' then
      raise exception 'Origem só pode ser parceiro ATIVO' using errcode = '23514';
    end if;
    -- Parceiro só atribui a origem a si mesmo ou ao escritório proprietário.
    if private.is_partner_user()
       and new.origin_organization_id is distinct from private.current_partner_organization_id()
       and v_origin.type <> 'OWNER' then
      raise exception 'Parceiro só pode atribuir origem ao próprio escritório ou ao escritório proprietário'
        using errcode = '42501';
    end if;
  end if;

  return new;
end
$$;

create trigger clients_guard
  before insert or update on public.clients
  for each row execute function private.clients_guard();

-- ───────────────────────────── pessoa física ──────────────────────────────

create table public.individual_client_details (
  client_id      uuid primary key,
  client_kind    public.client_kind not null default 'INDIVIDUAL'
                 check (client_kind = 'INDIVIDUAL'),
  full_name      text not null check (btrim(full_name) <> ''),
  social_name    text,
  birth_date     date check (birth_date is null or birth_date > date '1900-01-01'),
  gender         text check (gender in ('MALE', 'FEMALE', 'OTHER')),  -- null = não informado
  nationality    text,
  naturality     text,
  marital_status text check (marital_status in ('SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED', 'SEPARATED')),
  stable_union   boolean,
  profession     text,
  rg             text,
  rg_issuer      text,
  rg_state       public.uf_code,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- Detalhe puramente dependente: acompanha a exclusão física (excepcional) do Client.
  constraint individual_client_details_client_fkey
    foreign key (client_id, client_kind)
    references public.clients (id, kind) on delete cascade
);

create trigger individual_client_details_set_updated_at
  before update on public.individual_client_details
  for each row execute function private.set_updated_at();

-- ───────────────────────────── pessoa jurídica ────────────────────────────

create table public.company_client_details (
  client_id           uuid primary key,
  client_kind         public.client_kind not null default 'COMPANY'
                      check (client_kind = 'COMPANY'),
  legal_name          text not null check (btrim(legal_name) <> ''),
  trade_name          text,
  registration_status text,
  opening_date        date,
  legal_nature        text,
  main_cnae           text check (main_cnae is null or main_cnae ~ '^[0-9]{7}$'),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint company_client_details_client_fkey
    foreign key (client_id, client_kind)
    references public.clients (id, kind) on delete cascade
);

create trigger company_client_details_set_updated_at
  before update on public.company_client_details
  for each row execute function private.set_updated_at();

create table public.company_representatives (
  id                     uuid primary key default gen_random_uuid(),
  client_id              uuid not null,
  client_kind            public.client_kind not null default 'COMPANY'
                         check (client_kind = 'COMPANY'),
  full_name              text not null check (btrim(full_name) <> ''),
  cpf                    public.cpf_digits,
  role_title             text,
  email                  text check (email is null or email = lower(btrim(email))),
  phone                  text,
  primary_representative boolean not null default false,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint company_representatives_client_fkey
    foreign key (client_id, client_kind)
    references public.clients (id, kind) on delete cascade
);

create index company_representatives_client_idx on public.company_representatives (client_id);
create unique index company_representatives_one_primary
  on public.company_representatives (client_id) where primary_representative;

create trigger company_representatives_set_updated_at
  before update on public.company_representatives
  for each row execute function private.set_updated_at();

-- ───────────────────────────── contatos ───────────────────────────────────

create table public.client_contacts (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients (id) on delete cascade,
  type        text not null check (type in ('EMAIL', 'PHONE', 'WHATSAPP', 'OTHER')),
  value       text not null check (btrim(value) <> ''),
  is_primary  boolean not null default false,
  verified_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index client_contacts_client_idx on public.client_contacts (client_id);
create unique index client_contacts_one_primary_per_type
  on public.client_contacts (client_id, type) where is_primary;

create trigger client_contacts_set_updated_at
  before update on public.client_contacts
  for each row execute function private.set_updated_at();

-- ───────────────────────────── endereços ──────────────────────────────────

create table public.client_addresses (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references public.clients (id) on delete cascade,
  type         text not null default 'RESIDENTIAL'
               check (type in ('RESIDENTIAL', 'COMMERCIAL', 'MAILING', 'OTHER')),
  postal_code  text check (postal_code is null or postal_code ~ '^[0-9]{8}$'),
  street       text,
  number       text,
  complement   text,
  neighborhood text,
  city         text,
  state        public.uf_code,
  country      char(2) not null default 'BR' check (country ~ '^[A-Z]{2}$'),
  is_primary   boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index client_addresses_client_idx on public.client_addresses (client_id);
create unique index client_addresses_one_primary
  on public.client_addresses (client_id) where is_primary;

create trigger client_addresses_set_updated_at
  before update on public.client_addresses
  for each row execute function private.set_updated_at();

-- ───────────────────────────── cliente ↔ organização ──────────────────────
-- É esta tabela que libera ao parceiro o cadastro básico do Client. O registro
-- canônico sozinho não dá acesso a nada.

create table public.client_organization_relationships (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references public.clients (id) on delete restrict,
  organization_id uuid not null references public.organizations (id) on delete restrict,
  status          text not null default 'ACTIVE' check (status in ('ACTIVE', 'ENDED')),
  created_by      uuid references public.profiles (id) on delete restrict,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  ended_at        timestamptz,
  constraint client_organization_relationships_key unique (client_id, organization_id),
  constraint client_organization_relationships_ended_consistent
    check ((status = 'ENDED') = (ended_at is not null))
);

create index client_organization_relationships_org_idx
  on public.client_organization_relationships (organization_id);
create index client_organization_relationships_client_idx
  on public.client_organization_relationships (client_id);

create trigger client_organization_relationships_set_updated_at
  before update on public.client_organization_relationships
  for each row execute function private.set_updated_at();
