-- DG Brasil — 013: integrações, monitoramento judicial, exportações e importações
--
-- Nenhum segredo entra aqui. credentials_reference só aponta para onde o
-- segredo está (variável de ambiente ou secret manager do servidor).
-- O schema não depende de fornecedor: provider é texto e config é jsonb.
-- Não há campo específico de sistema de origem (nenhum "<fornecedor>_id"):
-- procedência de importação é genérica (import_job_id + linha + entidade).

create table public.integration_connections (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations (id) on delete restrict,
  provider               text not null check (btrim(provider) <> ''),
  -- Vocabulário canônico, o mesmo do front-end (IntegrationKind).
  type                   text not null check (type in ('AI_PROVIDER', 'JUDICIAL', 'STORAGE', 'EMAIL', 'WHATSAPP', 'OTHER')),
  status                 text not null default 'PENDING'
                         check (status in ('CONNECTED', 'DISCONNECTED', 'ERROR', 'PENDING')),
  status_message         text,
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
  -- Tribunais acompanhados (vazio = todos os que a fonte cobre).
  courts                    text[] not null default '{}',
  responsible_user_id       uuid references public.profiles (id) on delete restrict,
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

-- ───────────────────────────── importações (CSV/XLSX) ─────────────────────
-- Fluxo genérico, independente do sistema de origem:
--   UPLOADED → COLUMNS_DETECTED → MAPPED → VALIDATED (dry-run feito)
--   → [CONFLICTS_PENDING → VALIDATED quando resolvidos] → CONFIRMED
--   → PROCESSING → COMPLETED | FAILED.   CANCELLED de qualquer etapa antes de PROCESSING.
-- PDF/DOCX não são importação estruturada na V1.

create table public.import_jobs (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations (id) on delete restrict,
  created_by          uuid references public.profiles (id) on delete restrict,
  file_name           text not null check (btrim(file_name) <> ''),
  file_type           text not null check (file_type in ('CSV', 'XLSX')),
  sheet_name          text,  -- XLSX: aba lida
  storage_object_name text,  -- bucket imports
  -- Mesmo arquivo importado duas vezes é detectável (aviso, não bloqueio).
  file_checksum_sha256 text check (file_checksum_sha256 is null or file_checksum_sha256 ~ '^[0-9a-f]{64}$'),
  -- Cabeçalhos lidos do arquivo, na ordem: ["Nome", "CPF", ...].
  detected_columns    jsonb check (detected_columns is null or jsonb_typeof(detected_columns) = 'array'),
  status              text not null default 'UPLOADED' check (status in (
                        'UPLOADED', 'COLUMNS_DETECTED', 'MAPPED', 'VALIDATED', 'CONFLICTS_PENDING',
                        'CONFIRMED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED')),
  -- Contagens do dry-run / do processamento.
  total_rows          integer check (total_rows is null or total_rows >= 0),
  successful_rows     integer not null default 0 check (successful_rows >= 0),
  warning_rows        integer not null default 0 check (warning_rows >= 0),
  failed_rows         integer not null default 0 check (failed_rows >= 0),
  dry_run_at          timestamptz,
  confirmed_by        uuid references public.profiles (id) on delete restrict,
  confirmed_at        timestamptz,
  error_message       text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  started_at          timestamptz,
  completed_at        timestamptz,
  constraint import_jobs_confirmed_has_author check (
    status not in ('CONFIRMED', 'PROCESSING', 'COMPLETED') or (confirmed_by is not null and confirmed_at is not null)
  ),
  constraint import_jobs_validated_has_dry_run check (
    status not in ('VALIDATED', 'CONFLICTS_PENDING', 'CONFIRMED', 'PROCESSING', 'COMPLETED') or dry_run_at is not null
  )
);

create index import_jobs_status_created_idx on public.import_jobs (status, created_at);
create index import_jobs_checksum_idx on public.import_jobs (file_checksum_sha256);

create trigger import_jobs_set_updated_at
  before update on public.import_jobs
  for each row execute function private.set_updated_at();

-- Mapeamento coluna do arquivo → campo do sistema (ex.: "CPF" → client.document).
create table public.import_column_mappings (
  import_job_id uuid not null references public.import_jobs (id) on delete cascade,
  source_column text not null check (btrim(source_column) <> ''),
  -- Campo de destino genérico: entidade.campo (client.name, process.cnj...).
  target_field  text not null check (target_field ~ '^[a-z]+\.[A-Za-z][A-Za-z0-9_]{0,62}$'),
  -- Transformação simples opcional (ex.: {"date_format": "DD/MM/YYYY"}).
  transform     jsonb not null default '{}',
  created_at    timestamptz not null default now(),
  primary key (import_job_id, source_column),
  constraint import_column_mappings_target_once unique (import_job_id, target_field)
);

-- Uma linha por linha do arquivo: dry-run, relatório de erros e PROCEDÊNCIA
-- (entity_type/entity_id = o que a linha criou ou atualizou).
create table public.import_row_results (
  id            uuid primary key default gen_random_uuid(),
  import_job_id uuid not null references public.import_jobs (id) on delete cascade,
  row_number    integer not null check (row_number > 0),
  status        text not null check (status in ('VALID', 'WARNING', 'ERROR', 'IMPORTED', 'SKIPPED')),
  action        text check (action in ('CREATE', 'UPDATE', 'SKIP')),
  entity_type   text check (entity_type is null or entity_type ~ '^[a-z_]{2,63}$'),
  entity_id     uuid,
  errors        jsonb not null default '[]' check (jsonb_typeof(errors) = 'array'),
  warnings      jsonb not null default '[]' check (jsonb_typeof(warnings) = 'array'),
  -- Linha original. Pode conter dado pessoal: é apagada por
  -- private.purge_import_raw_data depois que o job termina.
  raw_data      jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint import_row_results_key unique (import_job_id, row_number),
  constraint import_row_results_imported_has_entity
    check (status <> 'IMPORTED' or (entity_type is not null and entity_id is not null))
);

create index import_row_results_entity_idx on public.import_row_results (entity_type, entity_id);

create trigger import_row_results_set_updated_at
  before update on public.import_row_results
  for each row execute function private.set_updated_at();

-- Conflitos encontrados no dry-run e como cada um foi resolvido.
--   CLIENT_DOCUMENT     CPF/CNPJ já existe (Client é canônico: nunca CREATE_NEW)
--   PROCESS_CNJ         CNJ já existe (único: nunca CREATE_NEW)
--   POSSIBLE_DUPLICATE  semelhança (nome etc.): CREATE_NEW permitido
create table public.import_conflicts (
  id                   uuid primary key default gen_random_uuid(),
  import_job_id        uuid not null references public.import_jobs (id) on delete cascade,
  row_number           integer not null check (row_number > 0),
  conflict_kind        text not null check (conflict_kind in ('CLIENT_DOCUMENT', 'PROCESS_CNJ', 'POSSIBLE_DUPLICATE')),
  existing_entity_type text not null check (existing_entity_type ~ '^[a-z_]{2,63}$'),
  existing_entity_id   uuid not null,
  resolution           text check (resolution in ('UPDATE', 'IGNORE', 'CREATE_NEW')),
  resolved_by          uuid references public.profiles (id) on delete restrict,
  resolved_at          timestamptz,
  created_at           timestamptz not null default now(),
  constraint import_conflicts_resolution_consistent
    check ((resolution is null) = (resolved_at is null)),
  constraint import_conflicts_unique_identity_never_duplicated
    check (conflict_kind = 'POSSIBLE_DUPLICATE' or resolution is distinct from 'CREATE_NEW'),
  constraint import_conflicts_key unique (import_job_id, row_number, conflict_kind)
);

create index import_conflicts_open_idx on public.import_conflicts (import_job_id) where resolution is null;

-- Transições do job e travas: só confirma sem conflito aberto; confirmado não
-- volta para edição de mapeamento.
create or replace function private.import_jobs_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'UPLOADED' then
      raise exception 'Importação nasce UPLOADED' using errcode = '23514';
    end if;
    new.created_by := coalesce(new.created_by, auth.uid());
    return new;
  end if;

  if new.status is distinct from old.status then
    if not (
         (old.status = 'UPLOADED'          and new.status in ('COLUMNS_DETECTED', 'FAILED', 'CANCELLED'))
      or (old.status = 'COLUMNS_DETECTED'  and new.status in ('MAPPED', 'FAILED', 'CANCELLED'))
      or (old.status = 'MAPPED'            and new.status in ('COLUMNS_DETECTED', 'VALIDATED', 'CONFLICTS_PENDING', 'FAILED', 'CANCELLED'))
      or (old.status = 'VALIDATED'         and new.status in ('MAPPED', 'CONFLICTS_PENDING', 'CONFIRMED', 'CANCELLED'))
      or (old.status = 'CONFLICTS_PENDING' and new.status in ('MAPPED', 'VALIDATED', 'CANCELLED'))
      or (old.status = 'CONFIRMED'         and new.status in ('PROCESSING', 'CANCELLED'))
      or (old.status = 'PROCESSING'        and new.status in ('COMPLETED', 'FAILED'))
    ) then
      raise exception 'Transição de importação inválida: % → %', old.status, new.status using errcode = '23514';
    end if;

    if new.status in ('VALIDATED', 'CONFIRMED') and exists (
      select 1 from public.import_conflicts c where c.import_job_id = new.id and c.resolution is null
    ) then
      raise exception 'Há conflitos sem resolução nesta importação' using errcode = '23514';
    end if;
    if new.status = 'CONFIRMED' then
      new.confirmed_by := coalesce(new.confirmed_by, auth.uid());
      new.confirmed_at := coalesce(new.confirmed_at, now());
    end if;
    if new.status = 'PROCESSING' then
      new.started_at := coalesce(new.started_at, now());
    end if;
    if new.status in ('COMPLETED', 'FAILED') then
      new.completed_at := coalesce(new.completed_at, now());
    end if;
  end if;
  return new;
end
$$;

create trigger import_jobs_guard
  before insert or update on public.import_jobs
  for each row execute function private.import_jobs_guard();

create or replace function private.import_conflicts_fill()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.resolution is not null and (tg_op = 'INSERT' or old.resolution is null) then
    new.resolved_at := coalesce(new.resolved_at, now());
    new.resolved_by := coalesce(new.resolved_by, auth.uid());
  end if;
  return new;
end
$$;

create trigger import_conflicts_fill
  before insert or update on public.import_conflicts
  for each row execute function private.import_conflicts_fill();

-- Apaga a linha original dos jobs encerrados há mais de p_older_than. A
-- procedência (entidade criada, erros) permanece.
create or replace function private.purge_import_raw_data(p_older_than interval default interval '30 days')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  update public.import_row_results r
     set raw_data = null
    from public.import_jobs j
   where j.id = r.import_job_id
     and r.raw_data is not null
     and j.status in ('COMPLETED', 'FAILED', 'CANCELLED')
     and coalesce(j.completed_at, j.updated_at) < now() - p_older_than;
  get diagnostics n = row_count;
  return n;
end
$$;

revoke all on function private.purge_import_raw_data(interval) from public, anon, authenticated;
grant execute on function private.purge_import_raw_data(interval) to service_role;
