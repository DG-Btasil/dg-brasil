-- DG Brasil — 012: agentes, skills, teses, referências, execuções e propostas
--
-- "IA executa. Humano decide." O agente registra agent_proposals; ação sensível
-- só é aplicada depois de revisão humana aprovada (garantido por trigger).
--
-- Versões são append-only. current_version_id aponta para uma versão do PRÓPRIO
-- item (FK composta), nunca de outro.
--
-- Propostas que mudam a configuração estrutural do DG Brasil (agente, skill,
-- tese, referência) só são decididas por ADMIN: private.proposal_requires_admin.

-- Tipos de proposta estruturais. Inclui tipos futuros (UPDATE_THESIS,
-- UPDATE_REFERENCE e qualquer ADMIN_*), para que um tipo novo nasça protegido.
create or replace function private.proposal_requires_admin(p_type text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_type in ('UPDATE_AGENT', 'UPDATE_SKILL', 'UPDATE_THESIS', 'UPDATE_REFERENCE')
      or p_type like 'ADMIN\_%'
$$;

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

-- Skills que operacionalizam cada tese (N:N).
create table public.thesis_skill_bindings (
  legal_thesis_id uuid not null references public.legal_theses (id) on delete restrict,
  skill_id        uuid not null references public.skills (id) on delete restrict,
  enabled         boolean not null default true,
  created_at      timestamptz not null default now(),
  primary key (legal_thesis_id, skill_id)
);

create index thesis_skill_bindings_skill_idx on public.thesis_skill_bindings (skill_id);

-- Template de análise: agente principal (005), skills e teses usadas.
alter table public.analysis_templates
  add constraint analysis_templates_primary_agent_fkey
  foreign key (primary_agent_id) references public.agents (id) on delete restrict;

create table public.analysis_template_skill_bindings (
  analysis_template_id uuid not null references public.analysis_templates (id) on delete cascade,
  skill_id             uuid not null references public.skills (id) on delete restrict,
  created_at           timestamptz not null default now(),
  primary key (analysis_template_id, skill_id)
);

create table public.analysis_template_thesis_bindings (
  analysis_template_id uuid not null references public.analysis_templates (id) on delete cascade,
  legal_thesis_id      uuid not null references public.legal_theses (id) on delete restrict,
  created_at           timestamptz not null default now(),
  primary key (analysis_template_id, legal_thesis_id)
);

-- ───────────────────────────── referências ────────────────────────────────

create table public.reference_materials (
  id                 uuid primary key default gen_random_uuid(),
  type               text not null check (type in (
                       'APPROVED_PETITION', 'WRITING_EXAMPLE', 'LEGAL_REFERENCE',
                       'INTERNAL_GUIDELINE', 'DOCTRINE', 'OTHER')),
  title              text not null check (btrim(title) <> ''),
  description        text,
  legal_area_id      uuid references public.legal_areas (id) on delete restrict,
  -- Etiquetas livres de busca, normalizadas em minúsculas.
  tags               text[] not null default '{}'
                     check (cardinality(tags) <= 30 and array_to_string(tags, '|') = lower(array_to_string(tags, '|'))),
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

create index reference_materials_tags_idx on public.reference_materials using gin (tags);

create trigger reference_material_versions_assign_number
  before insert on public.reference_material_versions
  for each row execute function private.assign_version_number('reference_material_id');

-- Caminho no bucket reference-materials, no mesmo padrão dos documentos:
--   references/{reference_material_id}/{version_id}/{filename}
create or replace function private.reference_material_object_name(
  p_reference_material_id uuid, p_version_id uuid, p_filename text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select format('references/%s/%s/%s',
                p_reference_material_id, p_version_id, private.sanitize_filename(p_filename))
$$;

grant execute on function private.reference_material_object_name(uuid, uuid, text) to service_role;

create or replace function private.reference_material_versions_validate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prefix text := format('references/%s/%s/', new.reference_material_id, new.id);
  v_rest   text;
begin
  if new.storage_object_name is not null then
    v_rest := substr(new.storage_object_name, length(v_prefix) + 1);
    if left(new.storage_object_name, length(v_prefix)) <> v_prefix
       or v_rest = '' or strpos(v_rest, '/') > 0 then
      raise exception 'storage_object_name precisa seguir %{filename}', v_prefix using errcode = '23514';
    end if;
  end if;
  new.created_by := coalesce(new.created_by, auth.uid());
  return new;
end
$$;

create trigger reference_material_versions_validate
  before insert on public.reference_material_versions
  for each row execute function private.reference_material_versions_validate();
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
-- Nasce por private.request_agent_run (018), nunca por INSERT do usuário.
-- Nunca armazenar chain-of-thought nem PII em metadata: o pedido em texto do
-- usuário fica em agent_run_inputs, com acesso restrito e prazo de retenção.

create table public.agent_runs (
  id                       uuid primary key default gen_random_uuid(),
  agent_id                 uuid not null references public.agents (id) on delete restrict,
  agent_version_id         uuid not null,
  legal_case_id            uuid references public.legal_cases (id) on delete restrict,
  legal_process_id         uuid,
  status                   text not null default 'QUEUED' check (status in (
                             'QUEUED', 'RUNNING', 'WAITING_HUMAN', 'COMPLETED', 'FAILED', 'CANCELLED')),
  operation                text not null default 'EXECUTE' check (operation ~ '^[A-Z][A-Z_]{1,31}$'),
  correlation_id           uuid not null default gen_random_uuid(),
  -- Reserva pelo worker (claim atômico) e batimento enquanto executa.
  queue_msg_id             bigint,
  claimed_by               text,
  claimed_at               timestamptz,
  heartbeat_at             timestamptz,
  attempt                  integer not null default 0 check (attempt >= 0),
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
  -- Só ids, contagens e nomes de ferramentas. Conteúdo livre vai para
  -- agent_run_inputs; a chave "input" é recusada aqui de propósito.
  metadata                 jsonb not null default '{}'
                           check (jsonb_typeof(metadata) = 'object' and not (metadata ? 'input')),
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
  constraint agent_runs_running_is_claimed check (status <> 'RUNNING' or claimed_by is not null),
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

-- Máquina de estados da execução. RUNNING → RUNNING é a retomada de uma
-- reserva vencida (worker morto); RUNNING → QUEUED é nova tentativa.
create or replace function private.agent_runs_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'QUEUED' then
      raise exception 'Execução nasce QUEUED' using errcode = '23514';
    end if;
    return new;
  end if;

  if new.agent_id is distinct from old.agent_id
     or new.agent_version_id is distinct from old.agent_version_id
     or new.legal_case_id is distinct from old.legal_case_id
     or new.legal_process_id is distinct from old.legal_process_id
     or new.requested_by is distinct from old.requested_by then
    raise exception 'Identidade da execução (agente, versão, caso, solicitante) é imutável' using errcode = '23514';
  end if;

  if new.status is distinct from old.status and not (
       (old.status = 'QUEUED'        and new.status in ('RUNNING', 'FAILED', 'CANCELLED'))
    or (old.status = 'RUNNING'       and new.status in ('QUEUED', 'WAITING_HUMAN', 'COMPLETED', 'FAILED', 'CANCELLED'))
    or (old.status = 'WAITING_HUMAN' and new.status in ('COMPLETED', 'FAILED', 'CANCELLED'))
  ) then
    raise exception 'Transição de execução inválida: % → %', old.status, new.status using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger agent_runs_guard
  before insert or update on public.agent_runs
  for each row execute function private.agent_runs_guard();

-- Pedido em texto e parâmetros da execução. Pode conter dado pessoal (o
-- advogado descreve o caso): por isso fica fora de agent_runs, com RLS
-- própria e prazo de retenção (private.purge_expired_agent_run_inputs).
create table public.agent_run_inputs (
  agent_run_id uuid primary key references public.agent_runs (id) on delete cascade,
  requested_by uuid references public.profiles (id) on delete restrict,
  request_text text check (request_text is null or length(request_text) <= 20000),
  parameters   jsonb not null default '{}' check (jsonb_typeof(parameters) = 'object'),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '180 days'
);

comment on table public.agent_run_inputs is
  'Entrada livre da execução. Retenção limitada (expires_at); depois o texto é apagado e a execução continua no histórico.';

-- Apaga o conteúdo vencido (mantém a linha e o vínculo). Rodar periodicamente.
create or replace function private.purge_expired_agent_run_inputs()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  update public.agent_run_inputs
     set request_text = null, parameters = '{}'
   where expires_at < now() and (request_text is not null or parameters <> '{}');
  get diagnostics n = row_count;
  return n;
end
$$;

revoke all on function private.purge_expired_agent_run_inputs() from public, anon, authenticated;
grant execute on function private.purge_expired_agent_run_inputs() to service_role;

alter table public.legal_analyses
  add constraint legal_analyses_agent_run_fkey
  foreign key (agent_run_id) references public.agent_runs (id) on delete restrict;

-- ───────────────────────────── propostas ──────────────────────────────────

create table public.agent_proposals (
  id                    uuid primary key default gen_random_uuid(),
  agent_run_id          uuid not null references public.agent_runs (id) on delete restrict,
  legal_case_id         uuid references public.legal_cases (id) on delete restrict,
  legal_process_id      uuid,
  -- Só tipos com aplicador no worker (apps/agentes/src/aplicar.ts). Minuta de
  -- documento NÃO é proposta: vai como versão INTERNAL de documento, revisada
  -- como tal (ferramenta entregar_documento). Por isso não existe CREATE_DOCUMENT.
  proposal_type         text not null check (proposal_type in (
                          'CREATE_DEADLINE', 'REQUEST_DOCUMENT', 'UPDATE_CASE',
                          'CREATE_PROCESS', 'UPDATE_SKILL', 'UPDATE_AGENT', 'OTHER')),
  payload               jsonb not null,
  -- A mesma proposta, repetida na mesma execução (retry, agente que repete a
  -- chamada), não vira duas: (agent_run_id, idempotency_key) é único.
  idempotency_key       text not null check (idempotency_key ~ '^[A-Za-z0-9:_.-]{8,128}$'),
  -- FAILED: aprovada, mas a aplicação deu erro (visível em application_error).
  status                text not null default 'PENDING'
                        check (status in ('PENDING', 'APPROVED', 'REJECTED', 'APPLIED', 'FAILED')),
  requires_human_review boolean not null default true,
  application_error     text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  decided_at            timestamptz,
  applied_at            timestamptz,
  -- O que a aplicação produziu (rastreio e prova de efeito único).
  applied_entity_type   text,
  applied_entity_id     uuid,
  constraint agent_proposals_idempotency_key unique (agent_run_id, idempotency_key),
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

  if (new.applied_entity_type is distinct from old.applied_entity_type
      or new.applied_entity_id is distinct from old.applied_entity_id)
     and not (old.status = 'APPROVED' and new.status = 'APPLIED') then
    raise exception 'O efeito de uma proposta só se registra ao aplicá-la' using errcode = '23514';
  end if;

  return new;
end
$$;

create trigger agent_proposals_guard
  before insert or update on public.agent_proposals
  for each row execute function private.agent_proposals_guard();

alter table public.document_version_verifications
  add constraint document_version_verifications_agent_run_fkey
  foreign key (agent_run_id) references public.agent_runs (id) on delete restrict;
