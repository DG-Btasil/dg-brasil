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
--
-- Status segue uma máquina de estados explícita (private.case_status_transition_allowed).
-- As poucas exceções (reabrir caso encerrado, reconsiderar rejeição) só por
-- private.override_case_status: ADMIN, com motivo, auditado.

create table public.legal_cases (
  id                         uuid primary key default gen_random_uuid(),
  client_id                  uuid not null references public.clients (id) on delete restrict,
  legal_area_id              uuid not null references public.legal_areas (id) on delete restrict,
  case_type_id               uuid,
  title                      text not null check (btrim(title) <> ''),
  summary                    text,
  -- Resumo da parte contrária (ex.: "Banco Pan S.A."). As partes de cada
  -- processo ficam em process_parties.
  opposing_party             text,
  status                     text not null default 'DRAFT' check (status in (
                               'DRAFT', 'SUBMITTED', 'WAITING_DOCUMENTS', 'READY_FOR_ANALYSIS',
                               'ANALYZING', 'WAITING_REVIEW', 'ACCEPTED', 'REJECTED',
                               'IN_PROGRESS', 'CLOSED', 'ARCHIVED')),
  partner_organization_id    uuid references public.organizations (id) on delete restrict,
  origin_organization_id     uuid not null references public.organizations (id) on delete restrict,
  created_by_organization_id uuid not null references public.organizations (id) on delete restrict,
  created_by                 uuid references public.profiles (id) on delete restrict,
  assigned_lawyer_id         uuid references public.profiles (id) on delete restrict,
  -- Observações compartilhadas com o parceiro do caso (as internas ficam em
  -- legal_case_internal_details).
  partner_notes              text,
  submitted_at               timestamptz,
  accepted_at                timestamptz,
  rejected_at                timestamptz,
  closed_at                  timestamptz,
  archived_at                timestamptz,
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
  constraint legal_cases_archived_requires_date check (status <> 'ARCHIVED' or archived_at is not null),
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

-- ───────────────────────────── máquina de estados ─────────────────────────
-- Transições normais. Qualquer par fora desta lista é recusado — inclusive
-- para ADMIN. CLOSED → DRAFT, ARCHIVED → qualquer coisa, ACCEPTED → pré-aceite:
-- nunca.

create or replace function private.case_status_transition_allowed(p_from text, p_to text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_from = p_to or (p_from, p_to) in (
    ('DRAFT',              'SUBMITTED'),
    ('DRAFT',              'WAITING_DOCUMENTS'),
    ('DRAFT',              'READY_FOR_ANALYSIS'),
    ('DRAFT',              'ARCHIVED'),

    ('SUBMITTED',          'WAITING_DOCUMENTS'),
    ('SUBMITTED',          'READY_FOR_ANALYSIS'),
    ('SUBMITTED',          'ANALYZING'),
    ('SUBMITTED',          'ACCEPTED'),
    ('SUBMITTED',          'REJECTED'),
    ('SUBMITTED',          'ARCHIVED'),

    ('WAITING_DOCUMENTS',  'SUBMITTED'),
    ('WAITING_DOCUMENTS',  'READY_FOR_ANALYSIS'),
    ('WAITING_DOCUMENTS',  'ANALYZING'),
    ('WAITING_DOCUMENTS',  'ACCEPTED'),
    ('WAITING_DOCUMENTS',  'REJECTED'),
    ('WAITING_DOCUMENTS',  'ARCHIVED'),

    ('READY_FOR_ANALYSIS', 'WAITING_DOCUMENTS'),
    ('READY_FOR_ANALYSIS', 'ANALYZING'),
    ('READY_FOR_ANALYSIS', 'ACCEPTED'),
    ('READY_FOR_ANALYSIS', 'REJECTED'),
    ('READY_FOR_ANALYSIS', 'ARCHIVED'),

    ('ANALYZING',          'WAITING_DOCUMENTS'),   -- análise interrompida por falta de documento
    ('ANALYZING',          'READY_FOR_ANALYSIS'),
    ('ANALYZING',          'WAITING_REVIEW'),
    ('ANALYZING',          'ACCEPTED'),
    ('ANALYZING',          'REJECTED'),

    ('WAITING_REVIEW',     'WAITING_DOCUMENTS'),
    ('WAITING_REVIEW',     'ANALYZING'),           -- nova análise
    ('WAITING_REVIEW',     'ACCEPTED'),
    ('WAITING_REVIEW',     'REJECTED'),

    ('ACCEPTED',           'IN_PROGRESS'),
    ('ACCEPTED',           'CLOSED'),
    ('IN_PROGRESS',        'CLOSED'),

    ('REJECTED',           'ARCHIVED'),
    ('CLOSED',             'ARCHIVED')
  )
$$;

-- Exceções, só via private.override_case_status (ADMIN + motivo + auditoria).
create or replace function private.case_status_override_allowed(p_from text, p_to text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (p_from, p_to) in (
    ('CLOSED',   'IN_PROGRESS'),  -- reabrir caso encerrado
    ('REJECTED', 'SUBMITTED')     -- reconsiderar rejeição
  )
$$;

-- Status com que um caso pode NASCER. Usuário logado: rascunho, envio, triagem
-- ou caso já aceito/em andamento (cadastro de caso existente). Sem sessão de
-- usuário (backend/importação): qualquer um, respeitados os CHECKs.
create or replace function private.case_initial_status_allowed(p_status text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_status in ('DRAFT', 'SUBMITTED', 'WAITING_DOCUMENTS', 'READY_FOR_ANALYSIS', 'ACCEPTED', 'IN_PROGRESS')
$$;

-- Regras do caso que dependem de outras tabelas ou da sessão. Os helpers
-- private.* vêm de 015_private_auth_helpers (resolvidos na execução).
-- Sem sessão de usuário (service role / worker), as regras de PAPEL não se
-- aplicam: o backend já autorizou. As regras de DADOS e a máquina de estados
-- sempre se aplicam.
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
  v_override boolean := coalesce(current_setting('dg.case_status_override', true), '') = new.id::text;
  v_origin_change boolean := coalesce(current_setting('dg.case_origin_change', true), '') = new.id::text;
begin
  select o.id into v_owner
  from public.organizations o
  where o.type = 'OWNER' and o.deleted_at is null;

  if tg_op = 'INSERT' then
    new.created_by_organization_id := coalesce(new.created_by_organization_id, v_user_org);
    new.created_by := coalesce(new.created_by, v_actor);
    if v_actor is not null and not private.case_initial_status_allowed(new.status) then
      raise exception 'Caso não pode nascer em %', new.status using errcode = '23514';
    end if;
  else
    if new.created_by_organization_id is distinct from old.created_by_organization_id then
      raise exception 'created_by_organization_id é imutável' using errcode = '23514';
    end if;
    if new.client_id is distinct from old.client_id then
      raise exception 'O cliente de um caso não pode ser trocado' using errcode = '23514';
    end if;

    if new.status is distinct from old.status then
      if v_override then
        if not private.case_status_override_allowed(old.status, new.status) then
          raise exception 'Exceção de status não prevista: % → %', old.status, new.status using errcode = '23514';
        end if;
      elsif not private.case_status_transition_allowed(old.status, new.status) then
        raise exception 'Transição de caso inválida: % → %', old.status, new.status using errcode = '23514';
      end if;
    end if;

    -- Excluir (soft delete) ou restaurar caso é decisão de ADMIN.
    if new.deleted_at is distinct from old.deleted_at and v_actor is not null and not private.is_admin() then
      raise exception 'Somente ADMIN interno exclui ou restaura caso' using errcode = '42501';
    end if;
  end if;

  -- Datas de cada estado, preenchidas quando o status chega nele.
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    case new.status
      when 'SUBMITTED' then new.submitted_at := coalesce(new.submitted_at, now());
      when 'ACCEPTED'  then new.accepted_at  := coalesce(new.accepted_at, now());
      when 'IN_PROGRESS' then new.accepted_at := coalesce(new.accepted_at, now());
      when 'REJECTED'  then new.rejected_at  := coalesce(new.rejected_at, now());
      when 'CLOSED'    then new.closed_at    := coalesce(new.closed_at, now());
      when 'ARCHIVED'  then new.archived_at  := coalesce(new.archived_at, now());
      else null;
    end case;
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

    -- Depois do aceite, a origem só muda por private.change_case_origin
    -- (ADMIN, com motivo; cancela/cria o snapshot de parceria e audita).
    if tg_op = 'UPDATE' and old.accepted_at is not null and not v_origin_change then
      raise exception 'Somente ADMIN interno pode alterar a origem de um caso aceito (use change_case_origin)'
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
     and private.user_internal_role(new.assigned_lawyer_id) is distinct from 'ADMIN'
     and private.user_internal_role(new.assigned_lawyer_id) is distinct from 'LAWYER' then
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
  -- Quem aceitou o caso (o parceiro não vê).
  accepted_by               uuid references public.profiles (id) on delete restrict,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

comment on table public.legal_case_internal_details is
  'Dados internos do caso (motivo interno de rejeição, notas, quem aceitou). Nunca visível a parceiros.';

create trigger legal_case_internal_details_set_updated_at
  before update on public.legal_case_internal_details
  for each row execute function private.set_updated_at();

-- Registra quem aceitou, na mesma transação do aceite.
create or replace function private.legal_cases_record_acceptance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := coalesce(auth.uid(), nullif(current_setting('dg.actor_user_id', true), '')::uuid);
begin
  if new.status = 'ACCEPTED' and (tg_op = 'INSERT' or old.status is distinct from 'ACCEPTED') and v_actor is not null then
    insert into public.legal_case_internal_details (legal_case_id, accepted_by)
    values (new.id, v_actor)
    on conflict (legal_case_id) do update set accepted_by = excluded.accepted_by;
  end if;
  return null;
end
$$;

create trigger legal_cases_record_acceptance
  after insert or update of status on public.legal_cases
  for each row execute function private.legal_cases_record_acceptance();

-- ───────────────────────────── operações controladas ──────────────────────

-- Exceção de status (reabrir encerrado, reconsiderar rejeição): ADMIN, motivo
-- obrigatório, auditado como CASE_STATUS_OVERRIDDEN.
create or replace function private.override_case_status(
  p_case_id    uuid,
  p_new_status text,
  p_reason     text,
  p_actor      uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.resolve_actor(p_actor);
  v_old   text;
begin
  if private.user_internal_role(v_actor) is distinct from 'ADMIN' then
    raise exception 'Somente ADMIN interno aplica exceção de status' using errcode = '42501';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'Exceção de status exige motivo' using errcode = '23514';
  end if;

  select status into v_old from public.legal_cases where id = p_case_id and deleted_at is null for update;
  if not found then
    raise exception 'Caso % não existe', p_case_id using errcode = '23503';
  end if;

  perform set_config('dg.case_status_override', p_case_id::text, true);
  update public.legal_cases
     set status = p_new_status,
         closed_at = case when p_new_status = 'IN_PROGRESS' then null else closed_at end,
         rejected_at = case when p_new_status = 'SUBMITTED' then null else rejected_at end,
         rejection_reason_public = case when p_new_status = 'SUBMITTED' then null else rejection_reason_public end
   where id = p_case_id;
  perform set_config('dg.case_status_override', '', true);

  perform private.record_audit_event('CASE_STATUS_OVERRIDDEN', 'legal_cases', p_case_id,
    jsonb_build_object('from', v_old, 'to', p_new_status, 'reason', p_reason));
end
$$;

-- Troca de origem comercial. Antes do aceite: equipe interna. Depois do aceite:
-- só ADMIN, com motivo. O snapshot de parceria é cancelado/recriado pelo
-- trigger de 011 na mesma transação; o histórico financeiro não se move.
create or replace function private.change_case_origin(
  p_case_id    uuid,
  p_new_origin uuid,
  p_reason     text,
  p_actor      uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.resolve_actor(p_actor);
  v_role  public.membership_role := private.user_internal_role(v_actor);
  v_case  record;
begin
  select id, origin_organization_id, accepted_at into v_case
  from public.legal_cases where id = p_case_id and deleted_at is null for update;
  if not found then
    raise exception 'Caso % não existe', p_case_id using errcode = '23503';
  end if;

  if v_case.accepted_at is not null then
    if v_role is distinct from 'ADMIN' then
      raise exception 'Somente ADMIN interno pode alterar a origem de um caso aceito' using errcode = '42501';
    end if;
    if nullif(btrim(p_reason), '') is null then
      raise exception 'Troca de origem de caso aceito exige motivo' using errcode = '23514';
    end if;
  elsif v_role is null then
    raise exception 'Somente a equipe interna troca a origem por esta operação' using errcode = '42501';
  end if;

  if v_case.origin_organization_id = p_new_origin then
    return;  -- mesma origem: nada a fazer, nenhum snapshot novo
  end if;

  perform set_config('dg.case_origin_change', p_case_id::text, true);
  perform set_config('dg.case_origin_change_reason', coalesce(p_reason, ''), true);
  update public.legal_cases set origin_organization_id = p_new_origin where id = p_case_id;
  perform set_config('dg.case_origin_change', '', true);
  perform set_config('dg.case_origin_change_reason', '', true);
end
$$;

-- ───────────────────────────── requisitos de documentos ───────────────────
-- A pendência ("o que falta") é separada do documento lógico e da versão. Ela
-- é satisfeita por uma VERSÃO concreta (FK e validação em 007_documents).

create table public.case_document_requirements (
  id                               uuid primary key default gen_random_uuid(),
  legal_case_id                    uuid not null references public.legal_cases (id) on delete cascade,
  requirement_label                text not null check (btrim(requirement_label) <> ''),
  category                         public.document_category not null
                                   references public.document_categories (code) on delete restrict,
  required                         boolean not null default true,
  status                           text not null default 'MISSING'
                                   check (status in ('MISSING', 'REQUESTED', 'RECEIVED', 'APPROVED', 'REJECTED')),
  satisfied_by_document_version_id uuid,  -- FK em 007_documents
  requested_at                     timestamptz,
  satisfied_at                     timestamptz,
  created_at                       timestamptz not null default now(),
  updated_at                       timestamptz not null default now(),
  constraint case_document_requirements_satisfied_has_version check (
    status not in ('RECEIVED', 'APPROVED') or satisfied_by_document_version_id is not null
  )
);

create index case_document_requirements_case_idx on public.case_document_requirements (legal_case_id);

create trigger case_document_requirements_set_updated_at
  before update on public.case_document_requirements
  for each row execute function private.set_updated_at();
