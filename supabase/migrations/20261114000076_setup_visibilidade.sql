-- 076 · Setup do escritório: "Adicionar visibilidade". Além da conta principal
-- (o primeiro ADMIN do escritório, 072), outros ADMINs do escritório principal
-- podem ver e usar o botão Setup. É reserva: se a conta principal se perder,
-- outra conta ADMIN continua com o setup e pode dar acesso a mais alguém
-- (decisão de 14/11/2026).
--
--   1. office_setup_access: quem, além da conta principal, vê o setup.
--      Só vale enquanto a pessoa for ADMIN ativa do escritório principal; se
--      deixar de ser, o acesso é apagado (gatilho), e não volta sozinho.
--   2. Funções:
--      - office_setup_user_ids: a conta principal + quem tem acesso;
--      - can_use_office_setup (refeita): passa a aceitar quem tem acesso;
--      - dg_list_office_setup_access (tela): os ADMINs do escritório e quem
--        vê o setup;
--      - dg_set_office_setup_access (tela): dar ou tirar o acesso. A conta
--        principal não perde o acesso. Todos que veem o setup são avisados
--        no sino;
--      - executor_setup_publish (refeita): o aviso de versão nova vai para
--        todos que veem o setup, não só para a conta principal.

-- ═════════════════════════════ 1. tabela ═════════════════════════════════

create table public.office_setup_access (
  organization_id uuid not null references public.organizations (id) on delete restrict,
  user_id         uuid not null references public.profiles (id) on delete restrict,
  granted_by      uuid not null references public.profiles (id) on delete restrict,
  granted_at      timestamptz not null default now(),
  primary key (organization_id, user_id)
);

comment on table public.office_setup_access is
  'Quem, além da conta principal, vê o setup do escritório (076). Só ADMIN ativo do escritório principal.';

alter table public.office_setup_access enable row level security;
revoke all on public.office_setup_access from public, anon, authenticated, service_role;
-- Leitura e escrita só pelas funções abaixo.

-- Deixou de ser ADMIN ativo (papel, status ou perfil): o acesso ao setup sai.
create or replace function private.office_setup_access_cleanup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'organization_memberships' then
    if new.role <> 'ADMIN' or new.status <> 'ACTIVE' then
      delete from public.office_setup_access a
       where a.organization_id = new.organization_id and a.user_id = new.user_id;
    end if;
  elsif not new.active then
    delete from public.office_setup_access a where a.user_id = new.id;
  end if;
  return new;
end
$$;

create trigger organization_memberships_office_setup_access
  after update of role, status on public.organization_memberships
  for each row execute function private.office_setup_access_cleanup();

create trigger profiles_office_setup_access
  after update of active on public.profiles
  for each row execute function private.office_setup_access_cleanup();

-- ═════════════════════════════ 2. funções ════════════════════════════════

-- A conta principal (072) e quem recebeu acesso, todos ADMIN ativos do escritório principal.
create or replace function private.office_setup_user_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u from private.office_owner_user_id() u where u is not null
  union
  select a.user_id
  from public.office_setup_access a
  join public.organizations o on o.id = a.organization_id
  join public.organization_memberships m on m.organization_id = a.organization_id and m.user_id = a.user_id
  join public.profiles p on p.id = a.user_id
  where o.type = 'OWNER' and o.deleted_at is null
    and m.role = 'ADMIN' and m.status = 'ACTIVE' and p.active
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
     and auth.uid() in (select private.office_setup_user_ids())
$$;

-- Tela: os ADMINs ativos do escritório principal, com quem vê o setup.
create or replace function private.dg_list_office_setup_access()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_owner uuid := private.office_owner_user_id();
begin
  if not private.can_use_office_setup() then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'user_id', x.user_id,
             'name', x.name,
             'email', x.email,
             'main', x.user_id = v_owner,
             'access', x.user_id in (select private.office_setup_user_ids()),
             'me', x.user_id = auth.uid())
           order by x.user_id = v_owner desc, x.name, x.user_id)
    from (
      select m.user_id, coalesce(nullif(btrim(p.preferred_name), ''), p.full_name) as name, lower(u.email) as email
      from public.organization_memberships m
      join public.organizations o on o.id = m.organization_id
      join public.profiles p on p.id = m.user_id
      left join auth.users u on u.id = m.user_id
      where o.type = 'OWNER' and o.deleted_at is null
        and m.role = 'ADMIN' and m.status = 'ACTIVE' and p.active
    ) x), '[]'::jsonb);
end
$$;

-- Tela: dar (p_access = true) ou tirar (false) o acesso ao setup.
create or replace function private.dg_set_office_setup_access(p_user_id uuid, p_access boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org     uuid;
  v_name    text;
  v_actor   text;
  v_changed integer;
  v_id      uuid := gen_random_uuid();
  v_user    uuid;
begin
  if not private.can_use_office_setup() then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  if p_user_id is null or p_access is null then
    raise exception 'Pedido inválido' using errcode = '22023';
  end if;
  v_org := private.current_organization_id();

  select coalesce(nullif(btrim(p.preferred_name), ''), p.full_name) into v_name
  from public.organization_memberships m
  join public.organizations o on o.id = m.organization_id
  join public.profiles p on p.id = m.user_id
  where m.organization_id = v_org and m.user_id = p_user_id
    and o.type = 'OWNER' and m.role = 'ADMIN' and m.status = 'ACTIVE' and p.active;
  if v_name is null then
    raise exception 'Só um administrador ativo do escritório pode ver o setup' using errcode = '22023';
  end if;
  if p_user_id = private.office_owner_user_id() then
    raise exception 'A conta principal sempre vê o setup' using errcode = '22023';
  end if;

  if p_access then
    insert into public.office_setup_access (organization_id, user_id, granted_by)
    values (v_org, p_user_id, auth.uid())
    on conflict (organization_id, user_id) do nothing;
  else
    delete from public.office_setup_access a where a.organization_id = v_org and a.user_id = p_user_id;
  end if;
  get diagnostics v_changed = row_count;
  if v_changed = 0 then
    return jsonb_build_object('user_id', p_user_id, 'access', p_access, 'changed', false);
  end if;

  select coalesce(nullif(btrim(p.preferred_name), ''), p.full_name) into v_actor from public.profiles p where p.id = auth.uid();
  perform private.record_audit_event(
    case when p_access then 'OFFICE_SETUP_ACCESS_GRANTED' else 'OFFICE_SETUP_ACCESS_REVOKED' end,
    'office_setup_access', p_user_id, jsonb_build_object('user', v_name));

  -- Todos que veem o setup agora (e quem acabou de perder) ficam sabendo.
  for v_user in
    select x from private.office_setup_user_ids() x
    union
    select p_user_id
  loop
    perform private.notify(v_user, 'SECURITY_NOTICE',
      case when p_access then 'Acesso ao setup' else 'Acesso ao setup retirado' end,
      case
        when v_user = p_user_id and p_access then v_actor || ' deu a você acesso ao setup do DG Brasil.'
        when v_user = p_user_id then v_actor || ' tirou o seu acesso ao setup do DG Brasil.'
        when p_access then v_actor || ' deu acesso ao setup do DG Brasil para ' || v_name || '.'
        else v_actor || ' tirou o acesso de ' || v_name || ' ao setup do DG Brasil.'
      end,
      'INFO', 'office_setup_access:' || v_id::text);
  end loop;
  return jsonb_build_object('user_id', p_user_id, 'access', p_access, 'changed', true);
end
$$;

-- 072 refeita: o aviso de versão nova vai para todos que veem o setup.
create or replace function private.executor_setup_publish(p_token_hash text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exec    public.executors;
  v_version public.office_setup_versions;
  v_user    uuid;
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
  for v_user in select x from private.office_setup_user_ids() x loop
    perform private.notify(v_user, 'SECURITY_NOTICE', 'Setup atualizado',
      'Uma versão nova do setup do DG Brasil (' || v_version.version || ') foi publicada pelo ' || v_exec.name || '.',
      'INFO', 'office_setup_published:' || v_version.id::text);
  end loop;
  return jsonb_build_object('id', v_version.id, 'version', v_version.version, 'already_published', false);
end
$$;

-- ═════════════════════════════ grants ════════════════════════════════════

revoke all on function private.office_setup_access_cleanup() from public, anon, authenticated, service_role;
revoke all on function private.office_setup_user_ids() from public, anon, authenticated, service_role;
revoke all on function private.dg_list_office_setup_access() from public, anon, authenticated, service_role;
revoke all on function private.dg_set_office_setup_access(uuid, boolean) from public, anon, authenticated, service_role;

grant execute on function private.dg_list_office_setup_access() to authenticated;
grant execute on function private.dg_set_office_setup_access(uuid, boolean) to authenticated;

create or replace function public.dg_list_office_setup_access()
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.dg_list_office_setup_access() $$;

create or replace function public.dg_set_office_setup_access(p_user_id uuid, p_access boolean)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.dg_set_office_setup_access(p_user_id, p_access) $$;

revoke all on function public.dg_list_office_setup_access() from public, anon, service_role;
revoke all on function public.dg_set_office_setup_access(uuid, boolean) from public, anon, service_role;
grant execute on function public.dg_list_office_setup_access() to authenticated;
grant execute on function public.dg_set_office_setup_access(uuid, boolean) to authenticated;
