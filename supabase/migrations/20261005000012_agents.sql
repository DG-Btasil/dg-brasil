-- DG Brasil — 012: agentes, skills, teses, referências, execuções e propostas
--
-- "IA executa. Humano decide." O agente registra agent_proposals; ação sensível
-- só é aplicada depois de revisão humana aprovada (garantido por trigger).
--
-- Versões são append-only. current_version_id aponta para uma versão do PRÓPRIO
-- item (FK composta), nunca de outro.

-- ───────────────────────────── agentes ────────────────────────────────────

create table public.agents (
  id                 uuid primary key default gen_random_uuid(),
  slug               text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  name               text not null check (btrim(name) <> ''),
  description        text,
  purpose            text,
  status             text not null default 'DRAFT' check (status in ('ACTIVE', 'INACTIVE', 'DRAFT')),
  current_version_id uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz
);

create trigger agents_set_updated_at
  before update on public.agents
  for each row execute function private.set_updated_at();

create table public.agent_versions (
  id             uuid primary key default gen_random_uuid(),
  agent_id       uuid not null references public.agents (id) on delete restrict,
  version_number integer not null check (version_number > 0),
  configuration  jsonb not null default '{}',
  instructions   text not null,
  created_by     uuid references public.profiles (id) on delete restrict,
  created_at     timestamptz not null default now(),
  constraint agent_versions_number_key unique (agent_id, version_number),
  constraint agent_versions_id_agent_key unique (id, agent_id)
);

create trigger agent_versions_assign_number
  before insert on public.agent_versions
  for each row execute function private.assign_version_number('agent_id');
create trigger agent_versions_append_only
  before update or delete on public.agent_versions
  for each row execute function private.prevent_mutation();

alter table public.agents
  add constraint agents_current_version_fkey
  foreign key (current_version_id, id) references public.agent_versions (id, agent_id);

-- ───────────────────────────── skills ─────────────────────────────────────

create table public.skills (
  id                 uuid primary key default gen_random_uuid(),
  slug               text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  name               text not null check (btrim(name) <> ''),
  description        text,
  status             text not null default 'DRAFT' check (status in ('ACTIVE', 'DRAFT', 'DEPRECATED')),
  current_version_id uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz
);

create trigger skills_set_updated_at
  before update on public.skills
  for each row execute function private.set_updated_at();

create table public.skill_versions (
  id             uuid primary key default gen_random_uuid(),
  skill_id       uuid not null references public.skills (id) on delete restrict,
  version_number integer not null check (version_number > 0),
  instructions   text not null,
  configuration  jsonb not null default '{}',
  created_by     uuid references public.profiles (id) on delete restrict,
  created_at     timestamptz not null default now(),
  constraint skill_versions_number_key unique (skill_id, version_number),
  constraint skill_versions_id_skill_key unique (id, skill_id)
);

create trigger skill_versions_assign_number
  before insert on public.skill_versions
  for each row execute function private.assign_version_number('skill_id');
create trigger skill_versions_append_only
  before update or delete on public.skill_versions
  for each row execute function private.prevent_mutation();

alter table public.skills
  add constraint skills_current_version_fkey
  foreign key (current_version_id, id) references public.skill_versions (id, skill_id);

create table public.agent_skill_bindings (
  agent_id   uuid not null references public.agents (id) on delete restrict,
  skill_id   uuid not null references public.skills (id) on delete restrict,
  enabled    boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (agent_id, skill_id)
);

create index agent_skill_bindings_skill_idx on public.agent_skill_bindings (skill_id);

-- ───────────────────────────── teses ──────────────────────────────────────

create table public.legal_theses (
  id                 uuid primary key default gen_random_uuid(),
  legal_area_id      uuid not null references public.legal_areas (id) on delete restrict,
  slug               text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  title              text not null check (btrim(title) <> ''),
  description        text,
  status             text not null default 'DRAFT' check (status in ('ACTIVE', 'IN_REVIEW', 'DRAFT', 'ARCHIVED')),
  current_version_id uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz
);

create trigger legal_theses_set_updated_at
  before update on public.legal_theses
  for each row execute function private.set_updated_at();

create table public.legal_thesis_versions (
  id                   uuid primary key default gen_random_uuid(),
  legal_thesis_id      uuid not null references public.legal_theses (id) on delete restrict,
  version_number       integer not null check (version_number > 0),
  foundations          text,
  application_criteria text,
  exclusion_criteria   text,
  notes                text,
  created_by           uuid references public.profiles (id) on delete restrict,
  created_at           timestamptz not null default now(),
  constraint legal_thesis_versions_number_key unique (legal_thesis_id, version_number),
  constraint legal_thesis_versions_id_thesis_key unique (id, legal_thesis_id)
);

create trigger legal_thesis_versions_assign_number
  before insert on public.legal_thesis_versions
  for each row execute function private.assign_version_number('legal_thesis_id');
create trigger legal_thesis_versions_append_only
  before update or delete on public.legal_thesis_versions
  for each row execute function private.prevent_mutation();

alter table public.legal_theses
  add constraint legal_theses_current_version_fkey
  foreign key (current_version_id, id) references public.legal_thesis_versions (id, legal_thesis_id);

create table public.agent_thesis_bindings (
  agent_id        uuid not null references public.agents (id) on delete restrict,
  legal_thesis_id uuid not null references public.legal_theses (id) on delete restrict,
  enabled         boolean not null default true,
  created_at      timestamptz not null default now(),
  primary key (agent_id, legal_thesis_id)
);

create index agent_thesis_bindings_thesis_idx on public.agent_thesis_bindings (legal_thesis_id);

-- ───────────────────────────── referências ────────────────────────────────

create table public.reference_materials (
  id                 uuid primary key default gen_random_uuid(),
  type               text not null check (type in (
                       'APPROVED_PETITION', 'WRITING_EXAMPLE', 'LEGAL_REFERENCE',
                       'INTERNAL_GUIDELINE', 'DOCTRINE', 'OTHER')),
  title              text not null check (btrim(title) <> ''),
  description        text,
  legal_area_id      uuid references public.legal_areas (id) on delete restrict,
  status             text not null default 'ACTIVE' check (status in ('ACTIVE', 'DRAFT', 'ARCHIVED')),
  current_version_id uuid,
  created_by         uuid references public.profiles (id) on delete restrict,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz
);

create trigger reference_materials_set_updated_at
  before update on public.reference_materials
  for each row execute function private.set_updated_at();

create table public.reference_material_versions (
  id                    uuid primary key default gen_random_uuid(),
  reference_material_id uuid not null references public.reference_materials (id) on delete restrict,
  version_number        integer not null check (version_number > 0),
  storage_object_name   text,  -- bucket reference-materials
  content_text          text,
  metadata              jsonb not null default '{}',
  created_by            uuid references public.profiles (id) on delete restrict,
  created_at            timestamptz not null default now(),
  constraint reference_material_versions_number_key unique (reference_material_id, version_number),
  constraint reference_material_versions_id_ref_key unique (id, reference_material_id),
  constraint reference_material_versions_has_content
    check (storage_object_name is not null or content_text is not null)
);

create trigger reference_material_versions_assign_number
  before insert on public.reference_material_versions
  for each row execute function private.assign_version_number('reference_material_id');
create trigger reference_material_versions_append_only
  before update or delete on public.reference_material_versions
  for each row execute function private.prevent_mutation();

alter table public.reference_materials
  add constraint reference_materials_current_version_fkey
  foreign key (current_version_id, id)
  references public.reference_material_versions (id, reference_material_id);

create table public.agent_reference_bindings (
  agent_id              uuid not null references public.agents (id) on delete restrict,
  reference_material_id uuid not null references public.reference_materials (id) on delete restrict,
  enabled               boolean not null default true,
  created_at            timestamptz not null default now(),
  primary key (agent_id, reference_material_id)
);

create table public.skill_reference_bindings (
  skill_id              uuid not null references public.skills (id) on delete restrict,
  reference_material_id uuid not null references public.reference_materials (id) on delete restrict,
  enabled               boolean not null default true,
  created_at            timestamptz not null default now(),
  primary key (skill_id, reference_material_id)
);

create table public.thesis_reference_bindings (
  legal_thesis_id       uuid not null references public.legal_theses (id) on delete restrict,
  reference_material_id uuid not null references public.reference_materials (id) on delete restrict,
  enabled               boolean not null default true,
  created_at            timestamptz not null default now(),
  primary key (legal_thesis_id, reference_material_id)
);

-- ───────────────────────────── execuções ──────────────────────────────────
-- Registro persistente do domínio. A fila (pgmq, 018) só transporta o id.
-- Nunca armazenar chain-of-thought nem PII em metadata.

create table public.agent_runs (
  id                       uuid primary key default gen_random_uuid(),
  agent_id                 uuid not null references public.agents (id) on delete restrict,
  agent_version_id         uuid not null,
  legal_case_id            uuid references public.legal_cases (id) on delete restrict,
  legal_process_id         uuid,
  status                   text not null default 'QUEUED' check (status in (
                             'QUEUED', 'RUNNING', 'WAITING_HUMAN', 'COMPLETED', 'FAILED', 'CANCELLED')),
  provider                 text not null default 'ANTHROPIC',
  model                    text,
  requested_by             uuid references public.profiles (id) on delete restrict,
  started_at               timestamptz,
  completed_at             timestamptz,
  input_tokens             bigint check (input_tokens is null or input_tokens >= 0),
  output_tokens            bigint check (output_tokens is null or output_tokens >= 0),
  -- Custo de API: centavos de dólar por execução, por isso 6 casas decimais.
  estimated_cost           numeric(14,6) check (estimated_cost is null or estimated_cost >= 0),
  estimated_cost_currency  public.currency_code not null default 'USD',
  error_code               text,
  error_message            text,
  metadata                 jsonb not null default '{}',
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  -- A versão executada é deste agente.
  constraint agent_runs_version_fkey
    foreign key (agent_version_id, agent_id)
    references public.agent_versions (id, agent_id) on delete restrict,
  constraint agent_runs_process_fkey
    foreign key (legal_process_id, legal_case_id)
    references public.legal_processes (id, legal_case_id) on delete restrict,
  constraint agent_runs_running_has_start check (status <> 'RUNNING' or started_at is not null),
  constraint agent_runs_finished_has_end check (
    status not in ('COMPLETED', 'FAILED') or completed_at is not null
  )
);

create index agent_runs_status_created_idx on public.agent_runs (status, created_at);
create index agent_runs_agent_idx on public.agent_runs (agent_id, created_at desc);
create index agent_runs_case_idx on public.agent_runs (legal_case_id);

create trigger agent_runs_set_updated_at
  before update on public.agent_runs
  for each row execute function private.set_updated_at();

alter table public.legal_analyses
  add constraint legal_analyses_agent_run_fkey
  foreign key (agent_run_id) references public.agent_runs (id) on delete restrict;

-- ───────────────────────────── propostas ──────────────────────────────────

create table public.agent_proposals (
  id                    uuid primary key default gen_random_uuid(),
  agent_run_id          uuid not null references public.agent_runs (id) on delete restrict,
  legal_case_id         uuid references public.legal_cases (id) on delete restrict,
  legal_process_id      uuid,
  proposal_type         text not null check (proposal_type in (
                          'CREATE_DOCUMENT', 'CREATE_DEADLINE', 'REQUEST_DOCUMENT', 'UPDATE_CASE',
                          'CREATE_PROCESS', 'UPDATE_SKILL', 'UPDATE_AGENT', 'OTHER')),
  payload               jsonb not null,
  -- FAILED: aprovada, mas a aplicação deu erro (visível em application_error).
  status                text not null default 'PENDING'
                        check (status in ('PENDING', 'APPROVED', 'REJECTED', 'APPLIED', 'FAILED')),
  requires_human_review boolean not null default true,
  application_error     text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  decided_at            timestamptz,
  applied_at            timestamptz,
  constraint agent_proposals_process_fkey
    foreign key (legal_process_id, legal_case_id)
    references public.legal_processes (id, legal_case_id) on delete restrict
);

create index agent_proposals_status_idx on public.agent_proposals (status, created_at);
create index agent_proposals_run_idx on public.agent_proposals (agent_run_id);
create index agent_proposals_case_idx on public.agent_proposals (legal_case_id);

create trigger agent_proposals_set_updated_at
  before update on public.agent_proposals
  for each row execute function private.set_updated_at();

alter table public.reviews
  add constraint reviews_agent_proposal_fkey
  foreign key (agent_proposal_id) references public.agent_proposals (id) on delete restrict;

-- Máquina de estados da proposta. Proposta que exige revisão humana só é
-- aprovada se existir revisão APPROVED apontando para ela.
create or replace function private.agent_proposals_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'PENDING' then
      raise exception 'Proposta nasce PENDING' using errcode = '23514';
    end if;
    return new;
  end if;

  if old.requires_human_review and not new.requires_human_review then
    raise exception 'requires_human_review não pode ser desligado' using errcode = '42501';
  end if;
  if new.payload is distinct from old.payload and old.status <> 'PENDING' then
    raise exception 'Payload de proposta decidida não muda' using errcode = '23514';
  end if;

  if new.status is distinct from old.status then
    if not (
         (old.status = 'PENDING'  and new.status in ('APPROVED', 'REJECTED'))
      or (old.status = 'APPROVED' and new.status in ('APPLIED', 'FAILED'))
      or (old.status = 'FAILED'   and new.status = 'APPROVED')  -- nova tentativa
    ) then
      raise exception 'Transição de proposta inválida: % → %', old.status, new.status
        using errcode = '23514';
    end if;

    if new.status = 'APPROVED' and new.requires_human_review and not exists (
      select 1 from public.reviews r
      where r.agent_proposal_id = new.id and r.status = 'APPROVED'
    ) then
      raise exception 'Proposta exige revisão humana aprovada antes de ser aprovada'
        using errcode = '42501';
    end if;

    if new.status in ('APPROVED', 'REJECTED') then
      new.decided_at := coalesce(new.decided_at, now());
    end if;
    if new.status = 'APPLIED' then
      new.applied_at := coalesce(new.applied_at, now());
      new.application_error := null;
    end if;
  end if;

  return new;
end
$$;

create trigger agent_proposals_guard
  before insert or update on public.agent_proposals
  for each row execute function private.agent_proposals_guard();
