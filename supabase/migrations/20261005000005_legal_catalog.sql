-- DG Brasil — 005: catálogo jurídico (áreas, tipos de caso, templates de análise)
--
-- Nada de tipo jurídico hardcoded no schema: novas áreas e tipos são linhas.

-- ───────────────────────────── categorias de documento ────────────────────
-- Vocabulário canônico ÚNICO de categoria (o mesmo do front-end). Documentos,
-- pendências e checklists referenciam esta tabela: categoria digitada errado
-- falha alto em vez de virar um segundo nome para o mesmo conceito.

create table public.document_categories (
  code        public.document_category primary key,
  label       text not null check (btrim(label) <> ''),
  description text,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger document_categories_set_updated_at
  before update on public.document_categories
  for each row execute function private.set_updated_at();

create table public.legal_areas (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  name        text not null check (btrim(name) <> ''),
  description text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger legal_areas_set_updated_at
  before update on public.legal_areas
  for each row execute function private.set_updated_at();

create table public.case_types (
  id            uuid primary key default gen_random_uuid(),
  legal_area_id uuid not null references public.legal_areas (id) on delete restrict,
  code          text not null check (code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  name          text not null check (btrim(name) <> ''),
  description   text,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint case_types_area_code_key unique (legal_area_id, code),
  -- Permite que legal_cases garanta, por FK, que o tipo pertence à área do caso.
  constraint case_types_id_area_key unique (id, legal_area_id)
);

create trigger case_types_set_updated_at
  before update on public.case_types
  for each row execute function private.set_updated_at();

create table public.analysis_templates (
  id               uuid primary key default gen_random_uuid(),
  legal_area_id    uuid not null references public.legal_areas (id) on delete restrict,
  name             text not null check (btrim(name) <> ''),
  description      text,
  -- Agente que executa a análise (FK em 012_agents).
  primary_agent_id uuid,
  active           boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint analysis_templates_area_name_key unique (legal_area_id, name)
);

create trigger analysis_templates_set_updated_at
  before update on public.analysis_templates
  for each row execute function private.set_updated_at();

-- Checklist de documentos do template, sem hardcode.
create table public.analysis_template_requirements (
  id                   uuid primary key default gen_random_uuid(),
  analysis_template_id uuid not null references public.analysis_templates (id) on delete cascade,
  document_category    public.document_category not null
                       references public.document_categories (code) on delete restrict,
  label                text not null check (btrim(label) <> ''),
  description          text,
  -- false = recomendado (não bloqueia a análise).
  required             boolean not null default true,
  -- null = vale para PF e PJ.
  applies_to_client_kind public.client_kind,
  sort_order           integer not null default 0,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint analysis_template_requirements_key unique (analysis_template_id, document_category, label)
);

create index analysis_template_requirements_template_idx
  on public.analysis_template_requirements (analysis_template_id, sort_order);

create trigger analysis_template_requirements_set_updated_at
  before update on public.analysis_template_requirements
  for each row execute function private.set_updated_at();

-- Campos que o template pede ao iniciar a análise (os valores ficam em
-- legal_analyses.field_values). Só definição: nada de apresentação aqui.
create table public.analysis_template_fields (
  id                   uuid primary key default gen_random_uuid(),
  analysis_template_id uuid not null references public.analysis_templates (id) on delete cascade,
  key                  text not null check (key ~ '^[a-z][a-z0-9_]{0,62}$'),
  label                text not null check (btrim(label) <> ''),
  field_type           text not null
                       check (field_type in ('text', 'textarea', 'number', 'currency', 'date', 'select', 'boolean')),
  required             boolean not null default false,
  help_text            text,
  -- Só para select: [{"value": "...", "label": "..."}].
  options              jsonb,
  sort_order           integer not null default 0,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint analysis_template_fields_key unique (analysis_template_id, key),
  constraint analysis_template_fields_options_only_for_select check (
    (field_type = 'select' and jsonb_typeof(options) = 'array')
    or (field_type <> 'select' and options is null)
  )
);

create trigger analysis_template_fields_set_updated_at
  before update on public.analysis_template_fields
  for each row execute function private.set_updated_at();
