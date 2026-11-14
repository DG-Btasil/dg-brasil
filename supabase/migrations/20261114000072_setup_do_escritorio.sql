-- 072 · Setup do escritório: os agentes do kit (clones -dg), os scripts deles e
-- os dados de quem assina saem do computador do escritório e passam a morar no
-- DG Brasil, num lugar privado (pós-MVP, item 6; decisão de 14/11/2026).
--
-- Quem usa: SÓ a dona do escritório, que é o PRIMEIRO ADMIN do escritório
-- principal (o vínculo ADMIN ativo mais antigo; na instalação, o que o
-- bootstrap_owner_admin criou). Outro ADMIN não vê nem usa o setup.
--
--   1. bucket office-setup: privado, fechado ao navegador (como os outros).
--   2. office_setup_versions: cada pacote publicado (versão, tamanho, SHA-256,
--      qual computador publicou). Quem publica é um computador autorizado,
--      com o script apps/executor/scripts/publicar-setup.ps1.
--   3. office_setup_codes: o código de uso único que vai no arquivo baixado.
--      Vale 15 minutos e uma vez só. O arquivo esquecido na pasta Downloads, ou
--      mandado para alguém, não abre nada. Só o SHA-256 do código chega aqui.
--   4. Funções:
--      - can_use_office_setup (tela): a pessoa logada é a dona? O botão só
--        aparece para ela;
--      - dg_issue_office_setup (tela): a dona gera um código para a versão
--        mais recente;
--      - office_setup_redeem (servidor, dg_worker): troca o código pela versão
--        e marca como usado; a dona recebe um aviso no sino;
--      - executor_setup_prepare / executor_setup_publish (computador): publicar
--        uma versão nova; a dona recebe um aviso no sino.

-- ═════════════════════════════ 1. bucket ═════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('office-setup', 'office-setup', false, 52428800, array['application/zip'])
on conflict (id) do update
  set public             = false,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy dg_private_buckets_no_direct_access on storage.objects;
create policy dg_private_buckets_no_direct_access on storage.objects
  as restrictive
  for all
  to anon, authenticated
  using (bucket_id not in ('legal-documents', 'reference-materials', 'imports', 'skill-files', 'office-setup'))
  with check (bucket_id not in ('legal-documents', 'reference-materials', 'imports', 'skill-files', 'office-setup'));

-- ═════════════════════════════ 2 e 3. tabelas ════════════════════════════

create table public.office_setup_versions (
  id                       uuid primary key default gen_random_uuid(),
  organization_id          uuid not null references public.organizations (id) on delete restrict,
  version                  text not null check (version ~ '^[0-9]{4}\.[0-9]{2}\.[0-9]{2}-[0-9]{6}$'),
  storage_object_name      text not null unique,
  size_bytes               bigint not null check (size_bytes > 0 and size_bytes <= 52428800),
  checksum_sha256          text not null check (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  status                   text not null default 'UPLOADING' check (status in ('UPLOADING', 'READY')),
  published_by_executor_id uuid not null references public.executors (id) on delete restrict,
  created_at               timestamptz not null default now(),
  published_at             timestamptz,
  constraint office_setup_versions_ready check ((status = 'READY') = (published_at is not null)),
  constraint office_setup_versions_unique unique (organization_id, version)
);

comment on table public.office_setup_versions is
  'Pacotes do setup do escritório (072): agentes do kit, scripts e dados de quem assina. O arquivo fica no bucket privado office-setup.';

create index office_setup_versions_ready_idx
  on public.office_setup_versions (organization_id, published_at desc) where status = 'READY';

create table public.office_setup_codes (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete restrict,
  setup_version_id uuid not null references public.office_setup_versions (id) on delete restrict,
  -- SHA-256 (hex) do código. O código em si só existe no arquivo baixado.
  code_hash        text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  issued_by        uuid not null references public.profiles (id) on delete restrict,
  issued_at        timestamptz not null default now(),
  expires_at       timestamptz not null,
  used_at          timestamptz,
  constraint office_setup_codes_window check (expires_at > issued_at)
);

comment on table public.office_setup_codes is
  'Código de uso único do setup (072): 15 minutos, uma vez. Só o hash.';

alter table public.office_setup_versions enable row level security;
alter table public.office_setup_codes enable row level security;
revoke all on public.office_setup_versions from public, anon, authenticated, service_role;
revoke all on public.office_setup_codes from public, anon, authenticated, service_role;
-- Leitura e escrita só pelas funções abaixo.

-- ═════════════════════════════ 4. funções ════════════════════════════════

-- A dona do escritório: o vínculo ADMIN ativo mais antigo da organização OWNER.
create or replace function private.office_owner_user_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.user_id
  from public.organization_memberships m
  join public.organizations o on o.id = m.organization_id
  join public.profiles p on p.id = m.user_id
  where o.type = 'OWNER' and o.deleted_at is null
    and m.role = 'ADMIN' and m.status = 'ACTIVE' and p.active
  order by m.created_at, m.id
  limit 1
$$;

create or replace function private.can_use_office_setup()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
     and exists (select 1 from private.current_membership())
     and private.is_admin()
     and auth.uid() = private.office_owner_user_id()
$$;

-- Tela: a dona pede o setup. Devolve só a versão e a validade do código.
create or replace function private.dg_issue_office_setup(p_code_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org     uuid;
  v_version public.office_setup_versions;
  v_id      uuid;
  v_expires timestamptz := now() + interval '15 minutes';
begin
  if not private.can_use_office_setup() then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  if p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Código inválido' using errcode = '22023';
  end if;
  v_org := private.current_organization_id();
  select * into v_version from public.office_setup_versions v
   where v.organization_id = v_org and v.status = 'READY'
   order by v.published_at desc, v.id desc
   limit 1;
  if v_version.id is null then
    raise exception 'O setup ainda não foi publicado' using errcode = '22023';
  end if;

  insert into public.office_setup_codes (organization_id, setup_version_id, code_hash, issued_by, expires_at)
  values (v_org, v_version.id, p_code_hash, auth.uid(), v_expires)
  returning id into v_id;
  perform private.record_audit_event('OFFICE_SETUP_ISSUED', 'office_setup_codes', v_id,
    jsonb_build_object('version', v_version.version));
  return jsonb_build_object('version', v_version.version, 'expires_at', v_expires);
end
$$;

-- Servidor (dg_worker): o arquivo baixado troca o código pela versão. Uso único.
create or replace function private.office_setup_redeem(p_code_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code    public.office_setup_codes;
  v_version public.office_setup_versions;
begin
  select * into v_code from public.office_setup_codes c where c.code_hash = p_code_hash for update;
  if v_code.id is null or v_code.used_at is not null or v_code.expires_at <= now() then
    raise exception 'Este setup venceu ou já foi usado. Baixe outro em Sua conta e sessões' using errcode = '42501';
  end if;
  select * into v_version from public.office_setup_versions v where v.id = v_code.setup_version_id;
  update public.office_setup_codes set used_at = now() where id = v_code.id;

  perform private.record_audit_event('OFFICE_SETUP_REDEEMED', 'office_setup_codes', v_code.id,
    jsonb_build_object('version', v_version.version));
  perform private.notify(v_code.issued_by, 'SECURITY_NOTICE', 'Setup instalado',
    'O setup do DG Brasil (versão ' || v_version.version || ') foi baixado agora por um computador. Se não foi você, troque a senha.',
    'INFO', 'office_setup_redeemed:' || v_code.id::text);
  return jsonb_build_object(
    'version', v_version.version,
    'storage_object_name', v_version.storage_object_name,
    'size_bytes', v_version.size_bytes,
    'checksum_sha256', v_version.checksum_sha256);
end
$$;

-- Computador: reserva uma versão nova e o caminho dela no bucket.
create or replace function private.executor_setup_prepare(p_token_hash text, p_size bigint, p_checksum text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exec    public.executors;
  v_version text := to_char(now() at time zone 'America/Sao_Paulo', 'YYYY.MM.DD-HH24MISS');
  v_name    text;
  v_id      uuid;
begin
  v_exec := private.executor_require(p_token_hash, 'jobs.claim');
  if p_size is null or p_size <= 0 or p_size > 52428800 then
    raise exception 'O pacote do setup tem de ter até 50 MB' using errcode = '22023';
  end if;
  if p_checksum is null or p_checksum !~ '^[0-9a-f]{64}$' then
    raise exception 'SHA-256 do pacote inválido' using errcode = '22023';
  end if;
  v_name := v_exec.organization_id::text || '/' || v_version || '.zip';
  insert into public.office_setup_versions
    (organization_id, version, storage_object_name, size_bytes, checksum_sha256, published_by_executor_id)
  values (v_exec.organization_id, v_version, v_name, p_size, p_checksum, v_exec.id)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'version', v_version, 'storage_object_name', v_name);
end
$$;

-- Computador: depois de enviar o arquivo, publica a versão. A dona é avisada.
create or replace function private.executor_setup_publish(p_token_hash text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exec    public.executors;
  v_version public.office_setup_versions;
begin
  v_exec := private.executor_require(p_token_hash, 'jobs.claim');
  select * into v_version from public.office_setup_versions v
   where v.id = p_id and v.organization_id = v_exec.organization_id
   for update;
  if v_version.id is null or v_version.published_by_executor_id <> v_exec.id then
    raise exception 'Versão do setup não encontrada' using errcode = 'P0002';
  end if;
  if v_version.status = 'READY' then
    return jsonb_build_object('id', v_version.id, 'version', v_version.version, 'already_published', true);
  end if;
  if not exists (select 1 from storage.objects o
                 where o.bucket_id = 'office-setup' and o.name = v_version.storage_object_name) then
    raise exception 'O arquivo do setup não chegou ao DG Brasil. Envie de novo' using errcode = '22023';
  end if;
  update public.office_setup_versions set status = 'READY', published_at = now() where id = v_version.id;
  perform private.record_audit_event('OFFICE_SETUP_PUBLISHED', 'office_setup_versions', v_version.id,
    jsonb_build_object('version', v_version.version, 'executor', v_exec.name));
  perform private.notify(private.office_owner_user_id(), 'SECURITY_NOTICE', 'Setup atualizado',
    'Uma versão nova do setup do DG Brasil (' || v_version.version || ') foi publicada pelo ' || v_exec.name || '.',
    'INFO', 'office_setup_published:' || v_version.id::text);
  return jsonb_build_object('id', v_version.id, 'version', v_version.version, 'already_published', false);
end
$$;

-- ═════════════════════════════ grants ════════════════════════════════════

revoke all on function private.office_owner_user_id() from public, anon, authenticated, service_role;
revoke all on function private.can_use_office_setup() from public, anon, authenticated, service_role;
revoke all on function private.dg_issue_office_setup(text) from public, anon, authenticated, service_role;
revoke all on function private.office_setup_redeem(text) from public, anon, authenticated, service_role;
revoke all on function private.executor_setup_prepare(text, bigint, text) from public, anon, authenticated, service_role;
revoke all on function private.executor_setup_publish(text, uuid) from public, anon, authenticated, service_role;

-- Tela (usuário logado; cada função confere se é a dona).
grant execute on function private.can_use_office_setup() to authenticated;
grant execute on function private.dg_issue_office_setup(text) to authenticated;

create or replace function public.can_use_office_setup()
returns boolean language sql stable security invoker set search_path = ''
as $$ select private.can_use_office_setup() $$;

create or replace function public.dg_issue_office_setup(p_code_hash text)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.dg_issue_office_setup(p_code_hash) $$;

revoke all on function public.can_use_office_setup() from public, anon, service_role;
revoke all on function public.dg_issue_office_setup(text) from public, anon, service_role;
grant execute on function public.can_use_office_setup() to authenticated;
grant execute on function public.dg_issue_office_setup(text) to authenticated;

-- Servidor do DG Brasil (login dg_worker): a troca do código e as portas do computador.
grant execute on function private.office_setup_redeem(text) to dg_worker;
grant execute on function private.executor_setup_prepare(text, bigint, text) to dg_worker;
grant execute on function private.executor_setup_publish(text, uuid) to dg_worker;
