-- DG Brasil — 041: Google Drive (integração documental)
--
-- O Supabase continua a fonte de verdade; o Drive é a pasta de trabalho da
-- equipe (docs/mcp/relatorio-diagnostico.md, seção 8). Quem fala com o Drive é
-- o SERVIDOR do DG Brasil (credencial só lá), nunca o computador do escritório.
--
--   1. external_folder_links: cliente → pasta do Drive pelo ID da pasta (o nome
--      é só exibição; renomear/mover não quebra). Uma pasta ativa por cliente e
--      um cliente por pasta. Ligar/desligar: ADMIN ou LAWYER, auditado.
--   2. Entrada (Drive → DG Brasil): arquivo novo na pasta ligada vira
--      documento INTERNO do cliente (versão source IMPORT). Sem duplicata:
--      (ID do arquivo, md5) é único. O que o próprio DG Brasil exportou não
--      volta como importação.
--   3. Saída (DG Brasil → Drive): versão de documento APROVADA em Revisões,
--      de cliente com pasta ligada, entra na fila de exportação
--      (external_document_exports, PENDING). O servidor envia e grava o ID do
--      arquivo criado. Nunca sobrescreve; nunca torna público.
--   4. Funções do servidor (login dg_worker), com escopo por ligação.
--
-- Pós-baseline: 001–040 não são alteradas (013 ganha colunas por ALTER).

-- ═════════════════════════════ 1. ligação cliente → pasta ════════════════

create table public.external_folder_links (
  id                   uuid primary key default gen_random_uuid(),
  provider             text not null default 'GOOGLE_DRIVE' check (provider in ('GOOGLE_DRIVE')),
  client_id            uuid not null references public.clients (id) on delete restrict,
  external_folder_id   text not null check (external_folder_id ~ '^[A-Za-z0-9_-]{10,200}$'),
  -- Só para exibir. NUNCA é chave.
  folder_name_snapshot text check (folder_name_snapshot is null or length(folder_name_snapshot) <= 300),
  last_synced_at       timestamptz,
  last_sync_error      text check (last_sync_error is null or length(last_sync_error) <= 500),
  linked_by            uuid references public.profiles (id) on delete restrict,
  linked_at            timestamptz not null default now(),
  unlinked_by          uuid references public.profiles (id) on delete restrict,
  unlinked_at          timestamptz
);

comment on table public.external_folder_links is
  'Cliente → pasta do Google Drive pelo ID da pasta. O nome é só exibição. Histórico: desligar marca unlinked_at.';

create unique index external_folder_links_folder_active on public.external_folder_links (provider, external_folder_id) where unlinked_at is null;
create unique index external_folder_links_client_active on public.external_folder_links (provider, client_id) where unlinked_at is null;
create index external_folder_links_sync_idx on public.external_folder_links (last_synced_at nulls first) where unlinked_at is null;

alter table public.external_folder_links enable row level security;
revoke all on public.external_folder_links from public, anon, authenticated, service_role;

-- ═════════════════════════════ 2. importações ════════════════════════════

create table public.external_document_imports (
  id                  uuid primary key default gen_random_uuid(),
  provider            text not null default 'GOOGLE_DRIVE' check (provider in ('GOOGLE_DRIVE')),
  folder_link_id      uuid not null references public.external_folder_links (id) on delete restrict,
  external_file_id    text not null check (external_file_id ~ '^[A-Za-z0-9_-]{10,200}$'),
  external_md5        text not null check (external_md5 ~ '^[0-9a-f]{32}$'),
  external_name       text check (external_name is null or length(external_name) <= 300),
  external_modified_at timestamptz,
  document_version_id uuid not null references public.document_versions (id) on delete restrict,
  imported_at         timestamptz not null default now(),
  constraint external_document_imports_once unique (provider, external_file_id, external_md5)
);

create index external_document_imports_link_idx on public.external_document_imports (folder_link_id, imported_at desc);

create trigger external_document_imports_append_only
  before update or delete on public.external_document_imports
  for each row execute function private.prevent_mutation();

alter table public.external_document_imports enable row level security;
revoke all on public.external_document_imports from public, anon, authenticated, service_role;

-- ═════════════════════════════ 3. exportações (013 + fila) ═══════════════

alter table public.external_document_exports
  alter column external_file_id drop not null,
  alter column exported_at drop not null,
  alter column exported_at drop default,
  add column status         text not null default 'EXPORTED' check (status in ('PENDING', 'EXPORTED', 'FAILED', 'SKIPPED')),
  add column folder_link_id uuid references public.external_folder_links (id) on delete restrict,
  add column attempts       integer not null default 0 check (attempts >= 0),
  add column last_error     text check (last_error is null or length(last_error) <= 500),
  add column requested_at   timestamptz not null default now(),
  add constraint external_document_exports_done_has_file check (status <> 'EXPORTED' or (external_file_id is not null and exported_at is not null));

create unique index external_document_exports_once on public.external_document_exports (document_version_id, provider);
create index external_document_exports_pending_idx on public.external_document_exports (requested_at) where status = 'PENDING';

-- Aprovação em Revisões → fila de exportação (só se o cliente tem pasta ligada).
create or replace function private.reviews_queue_drive_export()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link uuid;
begin
  if new.status is distinct from 'APPROVED' or old.status = 'APPROVED' or new.document_version_id is null then
    return null;
  end if;
  select l.id into v_link
  from public.document_versions v
  join public.documents d on d.id = v.document_id and d.deleted_at is null
  join public.external_folder_links l on l.client_id = d.client_id and l.unlinked_at is null and l.provider = 'GOOGLE_DRIVE'
  where v.id = new.document_version_id;
  if v_link is null then
    return null;
  end if;
  insert into public.external_document_exports (document_version_id, provider, status, folder_link_id, requested_at)
  values (new.document_version_id, 'GOOGLE_DRIVE', 'PENDING', v_link, now())
  on conflict (document_version_id, provider) do nothing;
  return null;
end
$$;

create trigger reviews_queue_drive_export
  after update of status on public.reviews
  for each row execute function private.reviews_queue_drive_export();

-- ═════════════════════════════ 4. tela (ADMIN / LAWYER) ══════════════════

create or replace function private.drive_link_client_folder(p_client_id uuid, p_folder_id text, p_folder_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old   record;
  v_other uuid;
  v_id    uuid;
begin
  if auth.uid() is null or not exists (select 1 from private.current_membership()) then
    raise exception 'Sem sessão liberada' using errcode = '42501';
  end if;
  if not private.has_internal_role('ADMIN', 'LAWYER') then
    raise exception 'Somente ADMIN ou advogado liga pasta do Drive' using errcode = '42501';
  end if;
  if not exists (select 1 from public.clients c where c.id = p_client_id and c.deleted_at is null) then
    raise exception 'Cliente não encontrado' using errcode = 'P0002';
  end if;
  if p_folder_id is null or p_folder_id !~ '^[A-Za-z0-9_-]{10,200}$' then
    raise exception 'ID de pasta do Drive inválido' using errcode = '22023';
  end if;

  select l.id, l.external_folder_id into v_old
  from public.external_folder_links l
  where l.client_id = p_client_id and l.unlinked_at is null and l.provider = 'GOOGLE_DRIVE'
  for update;
  if v_old.external_folder_id = p_folder_id then
    update public.external_folder_links set folder_name_snapshot = left(nullif(btrim(p_folder_name), ''), 300) where id = v_old.id;
    return jsonb_build_object('id', v_old.id, 'changed', false);
  end if;

  select l.client_id into v_other
  from public.external_folder_links l
  where l.external_folder_id = p_folder_id and l.unlinked_at is null and l.provider = 'GOOGLE_DRIVE';
  if v_other is not null then
    raise exception 'Esta pasta já está ligada a outro cliente' using errcode = '23505';
  end if;

  if v_old.id is not null then
    update public.external_folder_links set unlinked_at = now(), unlinked_by = auth.uid() where id = v_old.id;
  end if;
  insert into public.external_folder_links (client_id, external_folder_id, folder_name_snapshot, linked_by)
  values (p_client_id, p_folder_id, left(nullif(btrim(p_folder_name), ''), 300), auth.uid())
  returning id into v_id;
  perform private.record_audit_event('DRIVE_FOLDER_LINKED', 'external_folder_links', v_id,
    jsonb_build_object('client_id', p_client_id, 'replaced', v_old.id is not null));
  return jsonb_build_object('id', v_id, 'changed', true);
end
$$;

create or replace function private.drive_unlink_client_folder(p_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null or not exists (select 1 from private.current_membership()) then
    raise exception 'Sem sessão liberada' using errcode = '42501';
  end if;
  if not private.has_internal_role('ADMIN', 'LAWYER') then
    raise exception 'Somente ADMIN ou advogado desliga pasta do Drive' using errcode = '42501';
  end if;
  update public.external_folder_links set unlinked_at = now(), unlinked_by = auth.uid()
   where client_id = p_client_id and unlinked_at is null and provider = 'GOOGLE_DRIVE'
  returning id into v_id;
  if v_id is not null then
    -- O que estava na fila para esta pasta não vai mais.
    update public.external_document_exports set status = 'SKIPPED', last_error = 'Pasta desligada'
     where folder_link_id = v_id and status = 'PENDING';
    perform private.record_audit_event('DRIVE_FOLDER_UNLINKED', 'external_folder_links', v_id,
      jsonb_build_object('client_id', p_client_id));
  end if;
  return jsonb_build_object('id', v_id, 'unlinked', v_id is not null);
end
$$;

-- Situação do Drive de um cliente (equipe interna com acesso ao cliente).
create or replace function private.get_client_drive(p_client_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_link record;
begin
  if auth.uid() is null or not exists (select 1 from private.current_membership()) then
    raise exception 'Sem sessão liberada' using errcode = '42501';
  end if;
  if not private.is_internal_user() or not private.can_access_client(p_client_id) then
    raise exception 'Cliente não encontrado' using errcode = 'P0002';
  end if;
  select l.* into v_link from public.external_folder_links l
  where l.client_id = p_client_id and l.unlinked_at is null and l.provider = 'GOOGLE_DRIVE';
  if v_link.id is null then
    return jsonb_build_object('link', null);
  end if;
  return jsonb_build_object(
    'link', jsonb_build_object(
      'id', v_link.id, 'folder_id', v_link.external_folder_id, 'folder_name', v_link.folder_name_snapshot,
      'linked_at', v_link.linked_at, 'last_synced_at', v_link.last_synced_at, 'last_sync_error', v_link.last_sync_error),
    'imports', (select count(*) from public.external_document_imports i where i.folder_link_id = v_link.id),
    'recent_imports', coalesce((select jsonb_agg(jsonb_build_object('name', x.external_name, 'at', x.imported_at,
                                       'document_version_id', x.document_version_id) order by x.imported_at desc)
                                from (select * from public.external_document_imports i where i.folder_link_id = v_link.id
                                      order by i.imported_at desc limit 10) x), '[]'::jsonb),
    'exports', jsonb_build_object(
      'pending', (select count(*) from public.external_document_exports e where e.folder_link_id = v_link.id and e.status = 'PENDING'),
      'exported', (select count(*) from public.external_document_exports e where e.folder_link_id = v_link.id and e.status = 'EXPORTED'),
      'failed', (select count(*) from public.external_document_exports e where e.folder_link_id = v_link.id and e.status = 'FAILED')));
end
$$;

-- Sugestões para ligar as pastas existentes: clientes ainda sem pasta (só
-- nome e id; o servidor casa com os nomes das pastas e um humano confirma).
create or replace function private.drive_unlinked_clients(p_limit integer default 200)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not exists (select 1 from private.current_membership()) then
    raise exception 'Sem sessão liberada' using errcode = '42501';
  end if;
  if not private.has_internal_role('ADMIN', 'LAWYER') then
    raise exception 'Somente ADMIN ou advogado' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('client_id', x.id, 'name', x.name) order by x.name)
    from (
      select c.id, coalesce(i.full_name, co.legal_name) as name
      from public.clients c
      left join public.individual_client_details i on i.client_id = c.id
      left join public.company_client_details co on co.client_id = c.id
      where c.deleted_at is null
        and not exists (select 1 from public.external_folder_links l
                        where l.client_id = c.id and l.unlinked_at is null and l.provider = 'GOOGLE_DRIVE')
      order by c.created_at desc
      limit least(greatest(coalesce(p_limit, 200), 1), 1000)
    ) x where x.name is not null), '[]'::jsonb);
end
$$;

create or replace function private.get_drive_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not exists (select 1 from private.current_membership()) then
    raise exception 'Sem sessão liberada' using errcode = '42501';
  end if;
  if not private.is_internal_user() then
    raise exception 'Somente a equipe interna' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'linked_clients', (select count(*) from public.external_folder_links l where l.unlinked_at is null),
    'imports', (select count(*) from public.external_document_imports),
    'exports_pending', (select count(*) from public.external_document_exports e where e.status = 'PENDING'),
    'exports_failed', (select count(*) from public.external_document_exports e where e.status = 'FAILED'),
    'last_sync_at', (select max(l.last_synced_at) from public.external_folder_links l where l.unlinked_at is null),
    'sync_errors', (select count(*) from public.external_folder_links l where l.unlinked_at is null and l.last_sync_error is not null));
end
$$;

-- ═════════════════════════════ 5. servidor (dg_worker) ═══════════════════

-- Ligações a sincronizar (as mais antigas primeiro). p_client_id: só uma.
create or replace function private.drive_links_to_sync(p_limit integer default 10, p_client_id uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'client_id', x.client_id, 'folder_id', x.external_folder_id)), '[]'::jsonb)
  from (select l.* from public.external_folder_links l
        where l.unlinked_at is null and l.provider = 'GOOGLE_DRIVE' and (p_client_id is null or l.client_id = p_client_id)
        order by l.last_synced_at nulls first
        limit least(greatest(coalesce(p_limit, 10), 1), 100)) x
$$;

-- O que não deve ser importado de novo: já importado (id+md5) ou exportado pelo DG Brasil.
create or replace function private.drive_known_files(p_link_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'imported', coalesce((select jsonb_agg(i.external_file_id || ':' || i.external_md5)
                          from public.external_document_imports i where i.folder_link_id = p_link_id), '[]'::jsonb),
    'exported', coalesce((select jsonb_agg(e.external_file_id) from public.external_document_exports e
                          where e.folder_link_id = p_link_id and e.external_file_id is not null), '[]'::jsonb))
$$;

-- Importação, passo 1: ids e caminho no Storage (nada gravado ainda).
create or replace function private.drive_prepare_import(p_link_id uuid, p_filename text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client uuid;
  v_doc    uuid := gen_random_uuid();
  v_ver    uuid := gen_random_uuid();
begin
  select l.client_id into v_client from public.external_folder_links l where l.id = p_link_id and l.unlinked_at is null;
  if v_client is null then
    raise exception 'Ligação de pasta inexistente ou desligada' using errcode = 'P0002';
  end if;
  return jsonb_build_object('client_id', v_client, 'document_id', v_doc, 'document_version_id', v_ver,
    'storage_object_name', private.legal_document_object_name(v_client, v_doc, v_ver, p_filename));
end
$$;

-- Importação, passo 2: o arquivo já está no Storage. Documento INTERNO do
-- cliente, categoria OTHER (a equipe classifica), versão source IMPORT.
-- Idempotente por (ID do arquivo, md5).
create or replace function private.drive_register_import(
  p_link_id uuid, p_file_id text, p_md5 text, p_name text, p_modified_at timestamptz,
  p_document_id uuid, p_document_version_id uuid, p_storage_object_name text, p_mime_type text, p_size bigint, p_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client uuid;
  v_existing uuid;
begin
  select l.client_id into v_client from public.external_folder_links l where l.id = p_link_id and l.unlinked_at is null;
  if v_client is null then
    raise exception 'Ligação de pasta inexistente ou desligada' using errcode = 'P0002';
  end if;
  select i.document_version_id into v_existing from public.external_document_imports i
  where i.provider = 'GOOGLE_DRIVE' and i.external_file_id = p_file_id and i.external_md5 = p_md5;
  if v_existing is not null then
    return jsonb_build_object('document_version_id', v_existing, 'created', false);
  end if;
  if p_storage_object_name is distinct from private.legal_document_object_name(v_client, p_document_id, p_document_version_id, p_name) then
    raise exception 'Caminho do arquivo não corresponde a esta ligação' using errcode = '42501';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'legal-documents' and o.name = p_storage_object_name) then
    raise exception 'Arquivo ainda não chegou ao Storage' using errcode = 'P0002';
  end if;
  insert into public.documents (id, client_id, category, title, description, visibility)
  values (p_document_id, v_client, 'OTHER', left(coalesce(nullif(btrim(p_name), ''), 'Arquivo do Drive'), 200),
          'Importado do Google Drive. Classifique a categoria.', 'INTERNAL');
  insert into public.document_versions
    (id, document_id, storage_object_name, original_filename, mime_type, file_size, checksum_sha256, source)
  values (p_document_version_id, p_document_id, p_storage_object_name, p_name, p_mime_type, p_size, p_sha256, 'IMPORT');
  insert into public.external_document_imports
    (folder_link_id, external_file_id, external_md5, external_name, external_modified_at, document_version_id)
  values (p_link_id, p_file_id, p_md5, left(p_name, 300), p_modified_at, p_document_version_id);
  perform private.record_audit_event('DRIVE_FILE_IMPORTED', 'document_versions', p_document_version_id,
    jsonb_build_object('folder_link_id', p_link_id));
  return jsonb_build_object('document_version_id', p_document_version_id, 'created', true);
end
$$;

create or replace function private.drive_mark_synced(p_link_id uuid, p_error text default null)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.external_folder_links
     set last_synced_at = now(), last_sync_error = left(nullif(btrim(p_error), ''), 500)
   where id = p_link_id and unlinked_at is null
$$;

-- Exportação: pega até N pendentes (sem duas instâncias pegarem a mesma).
-- Até 5 tentativas; depois, FAILED.
create or replace function private.drive_claim_exports(p_limit integer default 5)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_out jsonb;
begin
  with c as (
    select e.id from public.external_document_exports e
    join public.external_folder_links l on l.id = e.folder_link_id and l.unlinked_at is null
    where e.status = 'PENDING' and e.attempts < 5
      and (e.exported_at is null)
    order by e.requested_at
    limit least(greatest(coalesce(p_limit, 5), 1), 20)
    for update of e skip locked
  ), u as (
    update public.external_document_exports e set attempts = e.attempts + 1
    from c where e.id = c.id
    returning e.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', u.id, 'folder_id', l.external_folder_id, 'storage_object_name', v.storage_object_name,
    'filename', coalesce(v.original_filename, d.title), 'mime_type', v.mime_type, 'title', d.title,
    'version_number', v.version_number, 'attempts', u.attempts)), '[]'::jsonb) into v_out
  from u
  join public.external_folder_links l on l.id = u.folder_link_id
  join public.document_versions v on v.id = u.document_version_id
  join public.documents d on d.id = v.document_id;
  return v_out;
end
$$;

create or replace function private.drive_mark_export(p_export_id uuid, p_file_id text, p_error text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_file_id is not null then
    update public.external_document_exports
       set status = 'EXPORTED', external_file_id = p_file_id, exported_at = now(), last_error = null
     where id = p_export_id and status = 'PENDING';
  else
    update public.external_document_exports
       set status = case when attempts >= 5 then 'FAILED' else 'PENDING' end,
           last_error = left(coalesce(p_error, 'Falha ao enviar ao Drive'), 500)
     where id = p_export_id and status = 'PENDING';
  end if;
end
$$;

-- ═════════════════════════════ 6. grants ═════════════════════════════════

do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname in ('reviews_queue_drive_export', 'drive_link_client_folder', 'drive_unlink_client_folder',
                        'get_client_drive', 'drive_unlinked_clients', 'get_drive_summary', 'drive_links_to_sync',
                        'drive_known_files', 'drive_prepare_import', 'drive_register_import', 'drive_mark_synced',
                        'drive_claim_exports', 'drive_mark_export')
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
  end loop;
end
$$;

grant execute on function private.drive_link_client_folder(uuid, text, text) to authenticated;
grant execute on function private.drive_unlink_client_folder(uuid) to authenticated;
grant execute on function private.get_client_drive(uuid) to authenticated;
grant execute on function private.drive_unlinked_clients(integer) to authenticated;
grant execute on function private.get_drive_summary() to authenticated;

create or replace function public.drive_link_client_folder(p_client_id uuid, p_folder_id text, p_folder_name text)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.drive_link_client_folder(p_client_id, p_folder_id, p_folder_name) $$;
create or replace function public.drive_unlink_client_folder(p_client_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.drive_unlink_client_folder(p_client_id) $$;
create or replace function public.get_client_drive(p_client_id uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.get_client_drive(p_client_id) $$;
create or replace function public.drive_unlinked_clients(p_limit integer default 200)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.drive_unlinked_clients(p_limit) $$;
create or replace function public.get_drive_summary()
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.get_drive_summary() $$;

do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('drive_link_client_folder', 'drive_unlink_client_folder', 'get_client_drive',
                        'drive_unlinked_clients', 'get_drive_summary')
  loop
    execute format('revoke all on function %s from public, anon, service_role', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end
$$;

grant execute on function private.drive_links_to_sync(integer, uuid) to dg_worker;
grant execute on function private.drive_known_files(uuid) to dg_worker;
grant execute on function private.drive_prepare_import(uuid, text) to dg_worker;
grant execute on function private.drive_register_import(uuid, text, text, text, timestamptz, uuid, uuid, text, text, bigint, text) to dg_worker;
grant execute on function private.drive_mark_synced(uuid, text) to dg_worker;
grant execute on function private.drive_claim_exports(integer) to dg_worker;
grant execute on function private.drive_mark_export(uuid, text, text) to dg_worker;
