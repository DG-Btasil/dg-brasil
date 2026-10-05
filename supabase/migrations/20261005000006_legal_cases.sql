-- DG Brasil — 006: caso jurídico (LegalCase)
--
-- Três conceitos de organização no caso, que NÃO se misturam:
--
--   created_by_organization_id  quem operava o sistema ao criar (auditoria);
--   partner_organization_id     parceiro operacionalmente ligado (visibilidade,
--                               pendências, comunicação). null = caso interno;
--   origin_organization_id      atribuição comercial (parceria financeira,
--                               relatórios de origem).
--
-- A RLS do parceiro usa partner_organization_id. Nunca origin_organization_id.

create table public.legal_cases (
  id                         uuid primary key default gen_random_uuid(),
  client_id                  uuid not null references public.clients (id) on delete restrict,
  legal_area_id              uuid not null references public.legal_areas (id) on delete restrict,
  case_type_id               uuid,
  title                      text not null check (btrim(title) <> ''),
  summary                    text,
  status                     text not null default 'DRAFT' check (status in (
                               'DRAFT', 'SUBMITTED', 'WAITING_DOCUMENTS', 'READY_FOR_ANALYSIS',
                               'ANALYZING', 'WAITING_REVIEW', 'ACCEPTED', 'REJECTED',
                               'IN_PROGRESS', 'CLOSED', 'ARCHIVED')),
  partner_organization_id    uuid references public.organizations (id) on delete restrict,
  origin_organization_id     uuid not null references public.organizations (id) on delete restrict,
  created_by_organization_id uuid not null references public.organizations (id) on delete restrict,
  created_by                 uuid references public.profiles (id) on delete restrict,
  assigned_lawyer_id         uuid references public.profiles (id) on delete restrict,
  submitted_at               timestamptz,
  accepted_at                timestamptz,
  rejected_at                timestamptz,
  closed_at                  timestamptz,
  rejection_reason_public    text,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  deleted_at                 timestamptz,
  -- O tipo de caso, quando informado, pertence à área do caso.
  constraint legal_cases_case_type_fkey
    foreign key (case_type_id, legal_area_id)
    references public.case_types (id, legal_area_id) on delete restrict,
  -- ACCEPTED (e o andamento que vem depois) exige advogado e data de aceite.
  constraint legal_cases_accepted_requires_lawyer check (
    status not in ('ACCEPTED', 'IN_PROGRESS')
    or (assigned_lawyer_id is not null and accepted_at is not null)
  ),
  -- REJECTED exige data e motivo público.
  constraint legal_cases_rejected_requires_reason check (
    status <> 'REJECTED'
    or (rejected_at is not null and nullif(btrim(rejection_reason_public), '') is not null)
  ),
  constraint legal_cases_closed_requires_date check (status <> 'CLOSED' or closed_at is not null),
  constraint legal_cases_submitted_requires_date check (status <> 'SUBMITTED' or submitted_at is not null)
);

create index legal_cases_client_idx          on public.legal_cases (client_id);
create index legal_cases_partner_org_idx     on public.legal_cases (partner_organization_id);
create index legal_cases_origin_org_idx      on public.legal_cases (origin_organization_id);
create index legal_cases_status_idx          on public.legal_cases (status);
create index legal_cases_assigned_lawyer_idx on public.legal_cases (assigned_lawyer_id);

create trigger legal_cases_set_updated_at
  before update on public.legal_cases
  for each row execute function private.set_updated_at();

-- Regras do caso que dependem de outras tabelas ou da sessão. Os helpers
-- private.* vêm de 015_private_auth_helpers (resolvidos na execução).
-- Sem sessão de usuário (service role / worker), as regras de papel não se
-- aplicam: o backend já autorizou. As regras de dados sempre se aplicam.
create or replace function private.legal_cases_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor    uuid := auth.uid();
  v_user_org uuid := private.current_organization_id();
  v_owner    uuid;
  v_origin   record;
begin
  select o.id into v_owner
  from public.organizations o
  where o.type = 'OWNER' and o.deleted_at is null;

  if tg_op = 'INSERT' then
    new.created_by_organization_id := coalesce(new.created_by_organization_id, v_user_org);
    new.created_by := coalesce(new.created_by, v_actor);
    if new.status = 'SUBMITTED' and new.submitted_at is null then
      new.submitted_at := now();
    end if;
  else
    if new.created_by_organization_id is distinct from old.created_by_organization_id then
      raise exception 'created_by_organization_id é imutável' using errcode = '23514';
    end if;
    if new.client_id is distinct from old.client_id then
      raise exception 'O cliente de um caso não pode ser trocado' using errcode = '23514';
    end if;
    if new.status = 'SUBMITTED' and old.status <> 'SUBMITTED' and new.submitted_at is null then
      new.submitted_at := now();
    end if;
  end if;

  -- partner_organization_id só aponta para organização PARTNER.
  if new.partner_organization_id is not null
     and (tg_op = 'INSERT' or new.partner_organization_id is distinct from old.partner_organization_id)
     and not exists (
       select 1 from public.organizations o
       where o.id = new.partner_organization_id and o.type = 'PARTNER' and o.deleted_at is null
     ) then
    raise exception 'partner_organization_id precisa ser um escritório parceiro' using errcode = '23514';
  end if;

  -- Origem: escritório proprietário ou parceiro ATIVO.
  if tg_op = 'INSERT' or new.origin_organization_id is distinct from old.origin_organization_id then
    select o.type, o.status, o.deleted_at into v_origin
    from public.organizations o where o.id = new.origin_organization_id;

    if v_origin.deleted_at is not null
       or (v_origin.type = 'PARTNER' and v_origin.status <> 'ACTIVE') then
      raise exception 'Origem do caso precisa ser o escritório proprietário ou um parceiro ativo'
        using errcode = '23514';
    end if;

    -- Depois do aceite, só ADMIN interno altera a origem (gera CASE_ORIGIN_CHANGED).
    if tg_op = 'UPDATE' and old.accepted_at is not null
       and v_actor is not null and not private.is_admin() then
      raise exception 'Somente ADMIN interno pode alterar a origem de um caso aceito'
        using errcode = '42501';
    end if;
  end if;

  -- Usuário de parceiro: o caso é sempre do próprio escritório, e a origem é o
  -- próprio escritório ou o proprietário. Nunca outro parceiro.
  if private.is_partner_user() then
    if new.partner_organization_id is distinct from v_user_org then
      raise exception 'Parceiro só opera casos do próprio escritório' using errcode = '42501';
    end if;
    if new.origin_organization_id is distinct from v_user_org
       and new.origin_organization_id is distinct from v_owner then
      raise exception 'Parceiro só pode atribuir origem ao próprio escritório ou ao escritório proprietário'
        using errcode = '42501';
    end if;
    if tg_op = 'INSERT' and new.created_by_organization_id is distinct from v_user_org then
      raise exception 'created_by_organization_id precisa ser o escritório do usuário' using errcode = '42501';
    end if;
  end if;

  -- Advogado responsável: usuário interno ativo com papel ADMIN ou LAWYER.
  if new.assigned_lawyer_id is not null
     and (tg_op = 'INSERT' or new.assigned_lawyer_id is distinct from old.assigned_lawyer_id)
     and not exists (
       select 1
       from public.organization_memberships m
       join public.organizations o on o.id = m.organization_id
       join public.profiles p on p.id = m.user_id
       where m.user_id = new.assigned_lawyer_id
         and m.status = 'ACTIVE'
         and m.role in ('ADMIN', 'LAWYER')
         and o.type = 'OWNER' and o.deleted_at is null
         and p.active
     ) then
    raise exception 'O advogado responsável precisa ser usuário interno ativo (ADMIN ou LAWYER)'
      using errcode = '23514';
  end if;

  return new;
end
$$;

create trigger legal_cases_guard
  before insert or update on public.legal_cases
  for each row execute function private.legal_cases_guard();

-- Caso ligado a um parceiro garante o relacionamento Client ↔ parceiro, para
-- o parceiro enxergar o cadastro básico do cliente do próprio caso.
create or replace function private.legal_cases_ensure_partner_relationship()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.partner_organization_id is not null
     and (tg_op = 'INSERT' or new.partner_organization_id is distinct from old.partner_organization_id) then
    insert into public.client_organization_relationships (client_id, organization_id, created_by)
    values (new.client_id, new.partner_organization_id, auth.uid())
    on conflict (client_id, organization_id) do update
      set status = 'ACTIVE', ended_at = null
      where public.client_organization_relationships.status <> 'ACTIVE';
  end if;
  return null;
end
$$;

create trigger legal_cases_ensure_partner_relationship
  after insert or update of partner_organization_id on public.legal_cases
  for each row execute function private.legal_cases_ensure_partner_relationship();

-- ───────────────────────────── dados internos do caso ─────────────────────
-- Notas internas ficam numa tabela à parte, sem nenhuma política para parceiro.
-- RLS é por linha: se a nota estivesse em legal_cases, o parceiro que lê o caso
-- leria a nota junto.

create table public.legal_case_internal_details (
  legal_case_id             uuid primary key references public.legal_cases (id) on delete cascade,
  rejection_reason_internal text,
  internal_notes            text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

comment on table public.legal_case_internal_details is
  'Dados internos do caso (motivo interno de rejeição, notas). Nunca visível a parceiros.';

create trigger legal_case_internal_details_set_updated_at
  before update on public.legal_case_internal_details
  for each row execute function private.set_updated_at();

-- ───────────────────────────── requisitos de documentos ───────────────────

create table public.case_document_requirements (
  id                       uuid primary key default gen_random_uuid(),
  legal_case_id            uuid not null references public.legal_cases (id) on delete cascade,
  requirement_label        text not null check (btrim(requirement_label) <> ''),
  category                 public.document_category not null,
  required                 boolean not null default true,
  status                   text not null default 'MISSING'
                           check (status in ('MISSING', 'REQUESTED', 'RECEIVED', 'APPROVED', 'REJECTED')),
  satisfied_by_document_id uuid,  -- FK em 007_documents
  requested_at             timestamptz,
  satisfied_at             timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint case_document_requirements_satisfied_has_document check (
    status not in ('RECEIVED', 'APPROVED') or satisfied_by_document_id is not null
  )
);

create index case_document_requirements_case_idx on public.case_document_requirements (legal_case_id);

create trigger case_document_requirements_set_updated_at
  before update on public.case_document_requirements
  for each row execute function private.set_updated_at();
