-- DG Brasil — 013: integrações, monitoramento judicial, exportações e importações
--
-- Nenhum segredo entra aqui. credentials_reference só aponta para onde o
-- segredo está (variável de ambiente ou secret manager do servidor).
-- O schema não depende de fornecedor: provider é texto e config é jsonb.

create table public.integration_connections (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations (id) on delete restrict,
  provider               text not null check (btrim(provider) <> ''),
  type                   text not null check (type in ('CLAUDE', 'JUDICIAL', 'GOOGLE_DRIVE', 'OTHER')),
  status                 text not null default 'PENDING'
                         check (status in ('CONNECTED', 'DISCONNECTED', 'ERROR', 'PENDING')),
  external_account_label text,
  -- Ex.: env://ANTHROPIC_API_KEY, vault://dg-brasil/judicial. Formato fechado para
  -- impedir que uma chave seja colada aqui por engano.
  credentials_reference  text check (
    credentials_reference is null
    or credentials_reference ~ '^(env|vault|secret)://[A-Za-z0-9_./-]{1,200}$'
  ),
  config                 jsonb not null default '{}',
  last_sync_at           timestamptz,
  created_by             uuid references public.profiles (id) on delete restrict,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index integration_connections_org_idx on public.integration_connections (organization_id, type);

create trigger integration_connections_set_updated_at
  before update on public.integration_connections
  for each row execute function private.set_updated_at();

create table public.judicial_monitors (
  id                        uuid primary key default gen_random_uuid(),
  integration_connection_id uuid not null references public.integration_connections (id) on delete restrict,
  oab_number                text not null check (oab_number ~ '^[0-9A-Z]{1,10}$'),
  oab_state                 public.uf_code not null,
  active                    boolean not null default true,
  last_checked_at           timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint judicial_monitors_key unique (integration_connection_id, oab_number, oab_state)
);

create trigger judicial_monitors_set_updated_at
  before update on public.judicial_monitors
  for each row execute function private.set_updated_at();

-- Supabase Storage é canônico; o Drive é só destino. Sem sincronização reversa na V1.
create table public.external_document_exports (
  id                  uuid primary key default gen_random_uuid(),
  document_version_id uuid not null references public.document_versions (id) on delete restrict,
  provider            text not null check (btrim(provider) <> ''),
  external_file_id    text not null,
  external_path       text,
  exported_by         uuid references public.profiles (id) on delete restrict,
  exported_at         timestamptz not null default now()
);

create index external_document_exports_version_idx on public.external_document_exports (document_version_id);

-- ───────────────────────────── importações ────────────────────────────────

create table public.import_jobs (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations (id) on delete restrict,
  created_by          uuid references public.profiles (id) on delete restrict,
  file_name           text not null,
  file_type           text not null check (file_type in ('CSV', 'XLSX', 'JSON', 'OTHER')),
  storage_object_name text,  -- bucket imports
  status              text not null default 'UPLOADED' check (status in (
                        'UPLOADED', 'MAPPING', 'VALIDATING', 'READY', 'PROCESSING',
                        'COMPLETED', 'FAILED', 'CANCELLED')),
  total_rows          integer check (total_rows is null or total_rows >= 0),
  successful_rows     integer not null default 0 check (successful_rows >= 0),
  warning_rows        integer not null default 0 check (warning_rows >= 0),
  failed_rows         integer not null default 0 check (failed_rows >= 0),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  started_at          timestamptz,
  completed_at        timestamptz
);

create index import_jobs_status_created_idx on public.import_jobs (status, created_at);

create trigger import_jobs_set_updated_at
  before update on public.import_jobs
  for each row execute function private.set_updated_at();

-- Uma linha por linha do arquivo: permite dry-run e relatório de erros.
create table public.import_row_results (
  id            uuid primary key default gen_random_uuid(),
  import_job_id uuid not null references public.import_jobs (id) on delete cascade,
  row_number    integer not null check (row_number > 0),
  status        text not null check (status in ('VALID', 'WARNING', 'ERROR', 'IMPORTED', 'SKIPPED')),
  entity_type   text,
  entity_id     uuid,
  errors        jsonb not null default '[]',
  warnings      jsonb not null default '[]',
  raw_data      jsonb,
  created_at    timestamptz not null default now(),
  constraint import_row_results_key unique (import_job_id, row_number)
);
