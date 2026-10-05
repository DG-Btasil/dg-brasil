-- DG Brasil — 008: processos judiciais, partes, movimentações, prazos
--
-- Processo nunca substitui LegalCase: legal_case_id é obrigatório e um caso
-- pode ter vários processos. O financeiro continua ligado ao caso.

create table public.legal_processes (
  id                    uuid primary key default gen_random_uuid(),
  legal_case_id         uuid not null references public.legal_cases (id) on delete restrict,
  cnj_number            public.cnj_digits,
  technical_origin      text not null default 'MANUAL'
                        check (technical_origin in ('MANUAL', 'AGENT', 'INTEGRATION', 'IMPORT')),
  court                 text,
  court_unit            text,
  district              text,
  state                 public.uf_code,
  legal_class           text,
  subject               text,
  client_side           text check (client_side in ('PLAINTIFF', 'DEFENDANT', 'INTERESTED', 'OTHER')),
  adverse_party_summary text,
  case_value            public.money_amount,  -- dado jurídico: nunca é dividido
  currency              public.currency_code not null default 'BRL',
  status                text not null default 'PREPARING' check (status in (
                          'PRE_FILING', 'PREPARING', 'FILED', 'ACTIVE', 'WAITING_CLIENT',
                          'WAITING_DEADLINE', 'SUSPENDED', 'CLOSED', 'ARCHIVED')),
  distribution_date     date,
  operational_due_at    timestamptz,
  created_by            uuid references public.profiles (id) on delete restrict,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz,
  -- Permite FK composta (processo, caso) em prazos e revisões.
  constraint legal_processes_id_case_key unique (id, legal_case_id),
  -- Processo vindo de fonte oficial sempre tem CNJ. Sem CNJ, só em preparação manual/agente.
  constraint legal_processes_official_has_cnj check (
    technical_origin not in ('INTEGRATION', 'IMPORT') or cnj_number is not null
  )
);

comment on column public.legal_processes.case_value is
  'Valor da causa. Dado jurídico: não é honorário, não é receita e não é base de divisão de parceria.';

create unique index legal_processes_cnj_key on public.legal_processes (cnj_number) where cnj_number is not null;
create index legal_processes_case_idx on public.legal_processes (legal_case_id);

create trigger legal_processes_set_updated_at
  before update on public.legal_processes
  for each row execute function private.set_updated_at();

create or replace function private.legal_processes_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
  elsif new.legal_case_id is distinct from old.legal_case_id then
    raise exception 'Processo não muda de caso' using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger legal_processes_guard
  before insert or update on public.legal_processes
  for each row execute function private.legal_processes_guard();

-- ───────────────────────────── partes ─────────────────────────────────────

create table public.process_parties (
  id               uuid primary key default gen_random_uuid(),
  legal_process_id uuid not null references public.legal_processes (id) on delete restrict,
  party_type       text not null check (party_type in ('PLAINTIFF', 'DEFENDANT', 'INTERESTED', 'OTHER')),
  name             text not null check (btrim(name) <> ''),
  document_number  text check (document_number is null or document_number ~ '^[0-9]{11}$|^[0-9]{14}$'),
  client_id        uuid references public.clients (id) on delete restrict,
  created_at       timestamptz not null default now()
);

create index process_parties_process_idx on public.process_parties (legal_process_id);

-- ───────────────────────────── documento ↔ processo ───────────────────────

create table public.process_documents (
  legal_process_id uuid not null references public.legal_processes (id) on delete restrict,
  document_id      uuid not null references public.documents (id) on delete restrict,
  purpose          text,
  created_at       timestamptz not null default now(),
  primary key (legal_process_id, document_id)
);

create index process_documents_document_idx on public.process_documents (document_id);

create or replace function private.process_documents_same_client()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.documents d
    join public.legal_cases c on c.client_id = d.client_id
    join public.legal_processes p on p.legal_case_id = c.id
    where d.id = new.document_id and p.id = new.legal_process_id
  ) then
    raise exception 'Documento e processo pertencem a clientes diferentes' using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger process_documents_same_client
  before insert or update on public.process_documents
  for each row execute function private.process_documents_same_client();

-- ───────────────────────────── movimentações ──────────────────────────────

create table public.process_events (
  id                uuid primary key default gen_random_uuid(),
  legal_process_id  uuid not null references public.legal_processes (id) on delete restrict,
  external_provider text,
  external_id       text,
  event_type        text not null check (btrim(event_type) <> ''),
  description       text not null,
  occurred_at       timestamptz not null,
  source            text not null check (source in ('MANUAL', 'JUDICIAL_INTEGRATION', 'IMPORT', 'AGENT')),
  raw_data          jsonb,
  created_at        timestamptz not null default now()
);

create index process_events_process_occurred_idx on public.process_events (legal_process_id, occurred_at);

-- Ressincronização não duplica movimentação.
create unique index process_events_external_key
  on public.process_events (external_provider, external_id)
  where external_provider is not null and external_id is not null;

-- ───────────────────────────── prazos ─────────────────────────────────────

create table public.deadlines (
  id                  uuid primary key default gen_random_uuid(),
  legal_case_id       uuid not null references public.legal_cases (id) on delete restrict,
  legal_process_id    uuid,
  title               text not null check (btrim(title) <> ''),
  description         text,
  due_at              timestamptz not null,
  priority            text not null default 'NORMAL' check (priority in ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
  status              text not null default 'OPEN' check (status in ('OPEN', 'COMPLETED', 'CANCELLED', 'OVERDUE')),
  responsible_user_id uuid references public.profiles (id) on delete restrict,
  source              text not null default 'MANUAL' check (source in ('MANUAL', 'AGENT', 'JUDICIAL_INTEGRATION')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  completed_at        timestamptz,
  -- O processo do prazo é do mesmo caso.
  constraint deadlines_process_fkey
    foreign key (legal_process_id, legal_case_id)
    references public.legal_processes (id, legal_case_id) on delete restrict,
  constraint deadlines_completed_has_date check (status <> 'COMPLETED' or completed_at is not null)
);

create index deadlines_status_due_idx on public.deadlines (status, due_at);
create index deadlines_case_idx on public.deadlines (legal_case_id);
create index deadlines_responsible_idx on public.deadlines (responsible_user_id) where status = 'OPEN';

create trigger deadlines_set_updated_at
  before update on public.deadlines
  for each row execute function private.set_updated_at();

-- ───────────────────────────── referências externas ───────────────────────

create table public.process_external_refs (
  id               uuid primary key default gen_random_uuid(),
  legal_process_id uuid not null references public.legal_processes (id) on delete restrict,
  provider         text not null check (btrim(provider) <> ''),
  external_id      text not null check (btrim(external_id) <> ''),
  last_synced_at   timestamptz,
  metadata         jsonb not null default '{}',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint process_external_refs_key unique (provider, external_id)
);

create index process_external_refs_process_idx on public.process_external_refs (legal_process_id);

create trigger process_external_refs_set_updated_at
  before update on public.process_external_refs
  for each row execute function private.set_updated_at();
