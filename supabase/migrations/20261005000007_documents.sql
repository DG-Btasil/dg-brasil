-- DG Brasil — 007: documentos e versões
--
-- documents          = documento lógico. Sempre pertence a um Client.
-- document_versions  = arquivo concreto, imutável. Nova edição = nova linha.
-- case_documents     = vínculo N:N com casos (o mesmo arquivo serve a vários).
--
-- Aprovação pertence à VERSÃO (reviews.document_version_id): v4 nunca herda
-- a aprovação de v3. A verificação do ARQUIVO também pertence à versão
-- (document_version_verifications, append-only): versão nova nasce UNVERIFIED.

create table public.documents (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients (id) on delete restrict,
  category    public.document_category not null
              references public.document_categories (code) on delete restrict,
  title       text not null check (btrim(title) <> ''),
  description text,
  visibility  public.document_visibility not null default 'INTERNAL',
  status      text not null default 'ACTIVE' check (status in ('ACTIVE', 'ARCHIVED')),
  created_by  uuid references public.profiles (id) on delete restrict,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

comment on column public.documents.visibility is
  'INTERNAL nunca é devolvido a parceiro. PARTNER_VISIBLE só por ação explícita da equipe (ou envio do próprio parceiro).';

create index documents_client_idx on public.documents (client_id);

create trigger documents_set_updated_at
  before update on public.documents
  for each row execute function private.set_updated_at();

create or replace function private.documents_fill_created_by()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.created_by := coalesce(new.created_by, auth.uid());
  if tg_op = 'UPDATE' and new.client_id is distinct from old.client_id then
    raise exception 'O cliente de um documento não pode ser trocado' using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger documents_fill_created_by
  before insert or update on public.documents
  for each row execute function private.documents_fill_created_by();

-- ───────────────────────────── caminho no Storage ─────────────────────────
-- clients/{client_id}/documents/{document_id}/{version_id}/{filename}
-- O caminho NÃO é mecanismo de segurança (a autorização é no servidor). Ele só
-- garante que cada versão tem objeto próprio e rastreável.

create or replace function private.sanitize_filename(p_filename text)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    nullif(
      left(btrim(regexp_replace(coalesce(p_filename, ''), '[^A-Za-z0-9._-]+', '_', 'g'), '._'), 150),
      ''
    ),
    'arquivo'
  )
$$;

create or replace function private.legal_document_object_name(
  p_client_id uuid, p_document_id uuid, p_version_id uuid, p_filename text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select format('clients/%s/documents/%s/%s/%s',
                p_client_id, p_document_id, p_version_id, private.sanitize_filename(p_filename))
$$;

grant execute on function private.sanitize_filename(text) to service_role;
grant execute on function private.legal_document_object_name(uuid, uuid, uuid, text) to service_role;

-- ───────────────────────────── versões ────────────────────────────────────

create table public.document_versions (
  id                  uuid primary key default gen_random_uuid(),
  document_id         uuid not null references public.documents (id) on delete restrict,
  version_number      integer not null check (version_number > 0),
  storage_object_name text not null,
  original_filename   text,
  mime_type           text,
  file_size           bigint check (file_size is null or file_size >= 0),
  checksum_sha256     text check (checksum_sha256 is null or checksum_sha256 ~ '^[0-9a-f]{64}$'),
  source              text not null check (source in ('UPLOAD', 'AGENT', 'MANUAL_EDIT', 'IMPORT', 'EXTERNAL')),
  created_by          uuid references public.profiles (id) on delete restrict,
  created_at          timestamptz not null default now(),
  constraint document_versions_number_key unique (document_id, version_number),
  constraint document_versions_object_key unique (storage_object_name)
);

create index document_versions_document_idx on public.document_versions (document_id);

create trigger document_versions_assign_number
  before insert on public.document_versions
  for each row execute function private.assign_version_number('document_id');

create or replace function private.document_versions_validate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc    record;
  v_prefix text;
  v_rest   text;
begin
  select d.client_id, d.deleted_at into v_doc
  from public.documents d where d.id = new.document_id;

  if v_doc.deleted_at is not null then
    raise exception 'Documento excluído não recebe nova versão' using errcode = '23514';
  end if;

  v_prefix := format('clients/%s/documents/%s/%s/', v_doc.client_id, new.document_id, new.id);
  v_rest := substr(new.storage_object_name, length(v_prefix) + 1);
  if left(new.storage_object_name, length(v_prefix)) <> v_prefix
     or v_rest = '' or strpos(v_rest, '/') > 0 then
    raise exception 'storage_object_name precisa seguir %{filename}', v_prefix using errcode = '23514';
  end if;

  new.created_by := coalesce(new.created_by, auth.uid());
  return new;
end
$$;

create trigger document_versions_validate
  before insert on public.document_versions
  for each row execute function private.document_versions_validate();

-- Versões são imutáveis.
create trigger document_versions_append_only
  before update or delete on public.document_versions
  for each row execute function private.prevent_mutation();

-- ───────────────────────────── documento ↔ caso ───────────────────────────

create table public.case_documents (
  legal_case_id uuid not null references public.legal_cases (id) on delete restrict,
  document_id   uuid not null references public.documents (id) on delete restrict,
  purpose       text,
  created_at    timestamptz not null default now(),
  primary key (legal_case_id, document_id)
);

create index case_documents_document_idx on public.case_documents (document_id);

-- O documento é do mesmo Client do caso.
create or replace function private.case_documents_same_client()
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
    where d.id = new.document_id and c.id = new.legal_case_id
  ) then
    raise exception 'Documento e caso pertencem a clientes diferentes' using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger case_documents_same_client
  before insert or update on public.case_documents
  for each row execute function private.case_documents_same_client();

-- ───────────────────────────── verificação do arquivo ─────────────────────
-- Conferência de UMA versão (legibilidade, autenticidade, dados conferem).
-- Append-only: verificar de novo = nova linha. Sem linha nenhuma, a versão está
-- UNVERIFIED — por isso a versão nova nunca herda a verificação da anterior.
-- Tentativa inconclusiva não vira estado: simplesmente não se registra nada e a
-- versão continua UNVERIFIED (ou se registra FAILED com a observação).

create table public.document_version_verifications (
  id                  uuid primary key default gen_random_uuid(),
  -- Ordem total dos registros (created_at empata dentro da mesma transação).
  sequence            bigint generated always as identity unique,
  document_version_id uuid not null references public.document_versions (id) on delete restrict,
  status              text not null check (status in ('VERIFIED', 'FAILED')),
  verification_source text not null check (verification_source in ('MANUAL', 'AGENT', 'SYSTEM')),
  verified_by         uuid references public.profiles (id) on delete restrict,
  agent_run_id        uuid,  -- FK em 012_agents
  notes               text,
  created_at          timestamptz not null default now(),
  constraint document_version_verifications_manual_has_user
    check (verification_source <> 'MANUAL' or verified_by is not null),
  constraint document_version_verifications_agent_has_run
    check (verification_source <> 'AGENT' or agent_run_id is not null)
);

create index document_version_verifications_version_idx
  on public.document_version_verifications (document_version_id, sequence desc);

create or replace function private.document_version_verifications_fill()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null then
    new.verified_by := coalesce(new.verified_by, auth.uid());
    if new.verified_by <> auth.uid() then
      raise exception 'Verificação só em nome do próprio usuário' using errcode = '42501';
    end if;
  end if;
  return new;
end
$$;

create trigger document_version_verifications_fill
  before insert on public.document_version_verifications
  for each row execute function private.document_version_verifications_fill();

create trigger document_version_verifications_append_only
  before update or delete on public.document_version_verifications
  for each row execute function private.prevent_mutation();

-- Situação atual da verificação, por versão (derivada, nunca gravada).
create view public.document_version_verification_status
with (security_invoker = true)
as
select
  v.id as document_version_id,
  v.document_id,
  v.version_number,
  coalesce(last.status, 'UNVERIFIED') as verification_status,
  last.created_at as verified_at,
  last.id as verification_id
from public.document_versions v
left join lateral (
  select dv.id, dv.status, dv.created_at
  from public.document_version_verifications dv
  where dv.document_version_id = v.id
  order by dv.sequence desc
  limit 1
) last on true;

comment on view public.document_version_verification_status is
  'Verificação atual de cada versão: UNVERIFIED (sem registro), VERIFIED ou FAILED (último registro).';

-- ───────────────────────────── pendência satisfeita por versão ────────────

alter table public.case_document_requirements
  add constraint case_document_requirements_version_fkey
  foreign key (satisfied_by_document_version_id) references public.document_versions (id) on delete restrict;

create index case_document_requirements_version_idx
  on public.case_document_requirements (satisfied_by_document_version_id);

-- A versão que satisfaz a pendência é de um documento do MESMO cliente do caso
-- e vinculado a ESTE caso. Uma versão de outro cliente nunca satisfaz.
create or replace function private.case_document_requirements_validate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.satisfied_by_document_version_id is not null
     and (tg_op = 'INSERT'
          or new.satisfied_by_document_version_id is distinct from old.satisfied_by_document_version_id) then
    if not exists (
      select 1
      from public.document_versions v
      join public.documents d on d.id = v.document_id and d.deleted_at is null
      join public.legal_cases c on c.id = new.legal_case_id and c.client_id = d.client_id
      join public.case_documents cd on cd.document_id = d.id and cd.legal_case_id = c.id
      where v.id = new.satisfied_by_document_version_id
    ) then
      raise exception 'A versão precisa ser de documento do mesmo cliente e vinculado a este caso'
        using errcode = '23514';
    end if;
    new.satisfied_at := coalesce(new.satisfied_at, now());
  end if;

  if tg_op = 'UPDATE' and new.legal_case_id is distinct from old.legal_case_id then
    raise exception 'Pendência não muda de caso' using errcode = '23514';
  end if;
  if new.status = 'REQUESTED' then
    new.requested_at := coalesce(new.requested_at, now());
  end if;
  return new;
end
$$;

create trigger case_document_requirements_validate
  before insert or update on public.case_document_requirements
  for each row execute function private.case_document_requirements_validate();
