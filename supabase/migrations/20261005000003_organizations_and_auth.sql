-- DG Brasil — 003: organizações, perfis, vínculos, convites e aceites legais
--
-- Padrão usado em todo o schema: quando uma linha só faz sentido para um TIPO
-- de pai (configuração só de PARTNER, papel de parceiro só em org PARTNER), a
-- tabela guarda o tipo do pai e usa FK composta (id, type). A regra fica
-- declarativa: não depende de trigger e não pode ser contornada por UPDATE no pai.

-- ───────────────────────────── organizations ──────────────────────────────

create table public.organizations (
  id          uuid primary key default gen_random_uuid(),
  type        public.organization_type not null,
  name        text not null check (btrim(name) <> ''),
  legal_name  text,
  cnpj        public.cnpj_digits,
  email       text check (email is null or email = lower(btrim(email))),
  phone       text,
  status      text not null default 'ACTIVE'
              check (status in ('ACTIVE', 'INACTIVE', 'PENDING', 'SUSPENDED')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  constraint organizations_id_type_key unique (id, type)
);

comment on table public.organizations is
  'Escritório proprietário (OWNER, único) e escritórios parceiros (PARTNER).';

-- Uma única organização OWNER não excluída.
create unique index organizations_single_owner
  on public.organizations (type)
  where type = 'OWNER' and deleted_at is null;

create unique index organizations_cnpj_key
  on public.organizations (cnpj)
  where cnpj is not null and deleted_at is null;

create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function private.set_updated_at();

-- Preenche organization_type a partir de organization_id, para a FK composta
-- validar. Genérica: serve a qualquer tabela com essas duas colunas.
create or replace function private.fill_organization_type()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select o.type into new.organization_type
  from public.organizations o
  where o.id = new.organization_id;
  return new;
end
$$;

-- ───────────────────────────── partner_office_settings ────────────────────

create table public.partner_office_settings (
  organization_id            uuid primary key,
  organization_type          public.organization_type not null default 'PARTNER'
                             check (organization_type = 'PARTNER'),
  default_partner_percentage public.percentage not null,
  default_owner_percentage   public.percentage not null,
  partnership_active         boolean not null default true,
  notes                      text,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  constraint partner_office_settings_org_fkey
    foreign key (organization_id, organization_type)
    references public.organizations (id, type) on delete restrict,
  constraint partner_office_settings_split_is_100
    check (default_partner_percentage + default_owner_percentage = 100)
);

comment on table public.partner_office_settings is
  'Divisão padrão vigente para NOVOS casos. Casos aceitos guardam snapshot em case_partnership_agreements.';

create trigger partner_office_settings_set_updated_at
  before update on public.partner_office_settings
  for each row execute function private.set_updated_at();

-- ───────────────────────────── profiles ───────────────────────────────────

create table public.profiles (
  id             uuid primary key references auth.users (id) on delete restrict,
  full_name      text not null check (btrim(full_name) <> ''),
  preferred_name text,
  phone          text,
  avatar_url     text,
  oab_number     text check (oab_number is null or oab_number ~ '^[0-9A-Z]{1,10}$'),
  oab_state      public.uf_code,
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint profiles_oab_complete check ((oab_number is null) = (oab_state is null))
);

comment on table public.profiles is
  'Perfil da aplicação, 1:1 com auth.users. Usuário com histórico é inativado, nunca apagado.';

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

-- Cria o profile quando o Supabase Auth cria o usuário.
create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Usuário'
    )
  )
  on conflict (id) do nothing;
  return new;
end
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_auth_user();

-- ───────────────────────────── organization_memberships ───────────────────

create table public.organization_memberships (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  organization_type public.organization_type not null,
  user_id           uuid not null references public.profiles (id) on delete restrict,
  role              public.membership_role not null,
  status            text not null default 'ACTIVE'
                    check (status in ('INVITED', 'ACTIVE', 'SUSPENDED', 'REMOVED')),
  invited_at        timestamptz,
  joined_at         timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint organization_memberships_org_fkey
    foreign key (organization_id, organization_type)
    references public.organizations (id, type) on delete restrict,
  constraint organization_memberships_org_user_key unique (organization_id, user_id),
  -- Papel compatível com o tipo da organização.
  constraint organization_memberships_role_matches_org check (
    (organization_type = 'OWNER'   and role in ('ADMIN', 'LAWYER', 'ASSISTANT'))
    or
    (organization_type = 'PARTNER' and role in ('PARTNER_ADMIN', 'PARTNER_USER'))
  )
);

-- Uma pessoa pertence a uma única organização ativa por vez. É isso que deixa
-- o escopo da sessão sem ambiguidade (private.current_membership()).
create unique index organization_memberships_one_active_per_user
  on public.organization_memberships (user_id)
  where status = 'ACTIVE';

create index organization_memberships_org_idx
  on public.organization_memberships (organization_id);

create trigger organization_memberships_fill_org_type
  before insert or update of organization_id on public.organization_memberships
  for each row execute function private.fill_organization_type();

create or replace function private.membership_fill_joined_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'ACTIVE' and new.joined_at is null then
    new.joined_at := now();
  end if;
  return new;
end
$$;

create trigger organization_memberships_fill_joined_at
  before insert or update of status on public.organization_memberships
  for each row execute function private.membership_fill_joined_at();

create trigger organization_memberships_set_updated_at
  before update on public.organization_memberships
  for each row execute function private.set_updated_at();

-- ───────────────────────────── user_invitations ───────────────────────────

create table public.user_invitations (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  organization_type public.organization_type not null,
  email             text not null check (email = lower(btrim(email)) and email like '%_@_%'),
  role              public.membership_role not null,
  -- Somente o hash SHA-256 (hex) do token. O token em claro vai só no e-mail.
  token_hash        text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  invited_by        uuid references public.profiles (id) on delete restrict,
  expires_at        timestamptz not null,
  accepted_at       timestamptz,
  revoked_at        timestamptz,
  created_at        timestamptz not null default now(),
  constraint user_invitations_org_fkey
    foreign key (organization_id, organization_type)
    references public.organizations (id, type) on delete restrict,
  constraint user_invitations_role_matches_org check (
    (organization_type = 'OWNER'   and role in ('ADMIN', 'LAWYER', 'ASSISTANT'))
    or
    (organization_type = 'PARTNER' and role in ('PARTNER_ADMIN', 'PARTNER_USER'))
  ),
  constraint user_invitations_single_outcome check (accepted_at is null or revoked_at is null),
  constraint user_invitations_expiry_after_creation check (expires_at > created_at)
);

-- No máximo um convite pendente por e-mail em cada organização.
create unique index user_invitations_one_pending
  on public.user_invitations (organization_id, email)
  where accepted_at is null and revoked_at is null;

create trigger user_invitations_fill_org_type
  before insert or update of organization_id on public.user_invitations
  for each row execute function private.fill_organization_type();

-- ───────────────────────────── user_legal_acceptances ─────────────────────

create table public.user_legal_acceptances (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles (id) on delete restrict,
  document_type    text not null
                   check (document_type in ('TERMS_OF_USE', 'PRIVACY_POLICY', 'CONFIDENTIALITY', 'OTHER')),
  document_version text not null check (btrim(document_version) <> ''),
  accepted_at      timestamptz not null default now(),
  ip_address       inet,
  user_agent       text,
  constraint user_legal_acceptances_once_per_version
    unique (user_id, document_type, document_version)
);

create trigger user_legal_acceptances_append_only
  before update or delete on public.user_legal_acceptances
  for each row execute function private.prevent_mutation();
