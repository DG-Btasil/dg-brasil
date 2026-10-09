-- DG Brasil — 022: Auth da aplicação (Etapa 4.1)
--
--   1. MFA obrigatório também no BANCO. Sessão só com senha (aal1) não lê nem
--      escreve dado de domínio: a RLS inteira passa por
--      private.current_membership(), que agora exige aal2 no JWT; as operações
--      controladas (resolve_actor) também. Sem isto, quem tem só a senha usaria
--      o próprio token direto na API do Supabase e pularia o MFA da aplicação.
--      O que precisa funcionar ANTES do MFA continua funcionando: ver a própria
--      identidade (get_my_session_context), aceitar convite e aceitar termos.
--   2. Contexto de sessão numa chamada (perfil, vínculo, organização, termos).
--   3. Convites: autorização no banco (ADMIN; PARTNER_ADMIN só no próprio
--      escritório e só papéis de parceiro), aceite atômico e idempotente.
--      O Supabase Auth cuida da credencial/link; user_invitations cuida do
--      negócio (quem convidou, organização, papel, validade, status). O token
--      cujo hash fica aqui é só a REFERÊNCIA do convite no link — sozinho não
--      autentica ninguém (o aceite exige sessão do mesmo e-mail).
--   4. Gestão de usuários: papel, vínculo e perfil, com proteção do último ADMIN
--      e sem auto-alteração; o escritório OWNER não pode ser suspenso/excluído.
--   5. Auditoria do aceite de termos e dos eventos administrativos de Auth.
--
-- Pós-baseline: 001–021 não são alteradas; funções são redefinidas aqui.

-- ───────────────────────────── 1. MFA no banco ────────────────────────────

create or replace function private.session_is_mfa_verified()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
$$;

grant execute on function private.session_is_mfa_verified() to authenticated, service_role;

create or replace function private.current_membership()
returns table (
  membership_id     uuid,
  organization_id   uuid,
  organization_type public.organization_type,
  role              public.membership_role
)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, m.organization_id, o.type, m.role
  from public.organization_memberships m
  join public.organizations o on o.id = m.organization_id
  join public.profiles p on p.id = m.user_id
  where m.user_id = auth.uid()
    and m.status = 'ACTIVE'
    and o.status = 'ACTIVE'
    and o.deleted_at is null
    and p.active
    and private.session_is_mfa_verified()
  limit 1
$$;

create or replace function private.resolve_actor(p_actor uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is not null then
    if not private.session_is_mfa_verified() then
      raise exception 'Verificação em duas etapas obrigatória' using errcode = '42501';
    end if;
    if p_actor is not null and p_actor <> v_uid then
      raise exception 'Operação só em nome do próprio usuário' using errcode = '42501';
    end if;
    return v_uid;
  end if;

  if p_actor is null then
    raise exception 'Operação sem usuário: o backend precisa informar quem está agindo' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_actor and p.active) then
    raise exception 'Usuário % não existe ou está inativo', p_actor using errcode = '42501';
  end if;
  perform set_config('dg.actor_user_id', p_actor::text, true);
  return p_actor;
end
$$;

-- get_agent_run_summaries resolvia o papel por user_internal_role(auth.uid()):
-- passa a exigir MFA como o resto.
create or replace function private.get_agent_run_summaries(
  p_legal_case_id uuid default null,
  p_limit         integer default 50
)
returns table (
  id               uuid,
  agent_id         uuid,
  agent_slug       text,
  agent_name       text,
  legal_case_id    uuid,
  legal_process_id uuid,
  status           text,
  operation        text,
  requested_by     uuid,
  attempt          integer,
  error_code       text,
  created_at       timestamptz,
  started_at       timestamptz,
  completed_at     timestamptz,
  proposal_count   bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role public.membership_role;
begin
  if auth.uid() is null then
    raise exception 'Sem sessão' using errcode = '42501';
  end if;
  if not private.session_is_mfa_verified() then
    raise exception 'Verificação em duas etapas obrigatória' using errcode = '42501';
  end if;
  v_role := private.user_internal_role(auth.uid());
  if v_role is null or v_role not in ('ADMIN', 'LAWYER') then
    raise exception 'Execuções de agente são visíveis só a ADMIN e LAWYER' using errcode = '42501';
  end if;
  if p_legal_case_id is not null and not private.can_access_case(p_legal_case_id) then
    raise exception 'Sem acesso a este caso' using errcode = '42501';
  end if;

  return query
  select r.id, r.agent_id, a.slug, a.name, r.legal_case_id, r.legal_process_id, r.status, r.operation,
         r.requested_by, r.attempt, r.error_code, r.created_at, r.started_at, r.completed_at,
         (select count(*) from public.agent_proposals p where p.agent_run_id = r.id)
  from public.agent_runs r
  join public.agents a on a.id = r.agent_id
  where (p_legal_case_id is null or r.legal_case_id = p_legal_case_id)
    and (v_role = 'ADMIN'
         or (r.legal_case_id is not null and private.can_access_case(r.legal_case_id)))
  order by r.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
end
$$;

-- Notificações eram "as próprias" sem passar pelos helpers: passam a exigir MFA.
drop policy notifications_select_own on public.notifications;
drop policy notifications_update_own on public.notifications;
create policy notifications_select_own on public.notifications for select to authenticated
  using (user_id = (select auth.uid()) and (select private.session_is_mfa_verified()));
create policy notifications_update_own on public.notifications for update to authenticated
  using (user_id = (select auth.uid()) and (select private.session_is_mfa_verified()))
  with check (user_id = (select auth.uid()) and (select private.session_is_mfa_verified()));

-- ───────────────────────────── 2. contexto de sessão ──────────────────────
-- Uma chamada resolve a identidade da aplicação. Funciona antes do MFA e com
-- conta inativa (para a aplicação mostrar a tela certa) e só devolve dados do
-- PRÓPRIO usuário. O vínculo devolvido é o ativo; sem ativo, o mais recente
-- (para explicar por que não há acesso).

create or replace function public.get_my_session_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_ctx jsonb;
begin
  if v_uid is null then
    return null;
  end if;

  select jsonb_build_object(
    'user_id', v_uid,
    'email', u.email,
    'profile', (select jsonb_build_object('full_name', p.full_name, 'preferred_name', p.preferred_name,
                                          'job_title', p.job_title, 'active', p.active)
                from public.profiles p where p.id = v_uid),
    'membership', (select jsonb_build_object('id', m.id, 'role', m.role, 'status', m.status,
                                             'organization', jsonb_build_object(
                                               'id', o.id, 'type', o.type, 'name', o.name,
                                               'status', o.status, 'deleted', o.deleted_at is not null))
                   from public.organization_memberships m
                   join public.organizations o on o.id = m.organization_id
                   where m.user_id = v_uid
                   order by (m.status = 'ACTIVE') desc, m.updated_at desc
                   limit 1),
    'legal_acceptances', coalesce((select jsonb_agg(jsonb_build_object(
                                     'document_type', a.document_type, 'document_version', a.document_version))
                                   from public.user_legal_acceptances a where a.user_id = v_uid), '[]'::jsonb),
    'aal', coalesce(auth.jwt() ->> 'aal', 'aal1')
  ) into v_ctx
  from auth.users u
  where u.id = v_uid;

  return v_ctx;
end
$$;

revoke all on function public.get_my_session_context() from public, anon;
grant execute on function public.get_my_session_context() to authenticated;

-- ───────────────────────────── 3. convites ────────────────────────────────

-- Cria (ou reemite) um convite. Quem pode:
--   ADMIN          qualquer papel; papel interno → organização OWNER;
--                  papel de parceiro → organização PARTNER existente.
--   PARTNER_ADMIN  só PARTNER_ADMIN/PARTNER_USER e só no PRÓPRIO escritório.
--   demais         ninguém.
-- Reemitir para o mesmo e-mail na mesma organização revoga o convite pendente
-- anterior. E-mail que já tem acesso ativo não é convidado de novo.
create or replace function private.create_invitation(
  p_email           text,
  p_full_name       text,
  p_role            public.membership_role,
  p_organization_id uuid,
  p_token_hash      text,
  p_expires_in      interval default interval '7 days',
  p_actor           uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor      uuid := private.resolve_actor(p_actor);
  v_actor_role public.membership_role;
  v_actor_org  uuid;
  v_org        record;
  v_email      text := lower(btrim(p_email));
  v_auth_user  uuid;
  v_id         uuid;
begin
  select m.role, m.organization_id into v_actor_role, v_actor_org
  from public.organization_memberships m
  join public.organizations o on o.id = m.organization_id and o.status = 'ACTIVE' and o.deleted_at is null
  join public.profiles p on p.id = m.user_id and p.active
  where m.user_id = v_actor and m.status = 'ACTIVE';

  if v_actor_role = 'ADMIN' then
    if p_role in ('ADMIN', 'LAWYER', 'ASSISTANT') then
      select id, type, status into v_org from public.organizations
      where type = 'OWNER' and deleted_at is null;
      if p_organization_id is not null and p_organization_id <> v_org.id then
        raise exception 'Papel interno só no escritório proprietário' using errcode = '42501';
      end if;
    else
      select id, type, status into v_org from public.organizations
      where id = p_organization_id and type = 'PARTNER' and deleted_at is null;
      if v_org.id is null then
        raise exception 'Escritório parceiro inválido' using errcode = '42501';
      end if;
    end if;
  elsif v_actor_role = 'PARTNER_ADMIN' then
    if p_role not in ('PARTNER_ADMIN', 'PARTNER_USER') then
      raise exception 'Administrador do parceiro só convida usuários do parceiro' using errcode = '42501';
    end if;
    if p_organization_id is not null and p_organization_id <> v_actor_org then
      raise exception 'Convite só para o próprio escritório' using errcode = '42501';
    end if;
    select id, type, status into v_org from public.organizations where id = v_actor_org;
  else
    raise exception 'Sem permissão para convidar' using errcode = '42501';
  end if;

  if v_org.status in ('SUSPENDED', 'INACTIVE') then
    raise exception 'Escritório sem acesso ativo' using errcode = '23514';
  end if;

  select u.id into v_auth_user from auth.users u where lower(u.email) = v_email;
  if v_auth_user is not null and exists (
    select 1 from public.organization_memberships m where m.user_id = v_auth_user and m.status = 'ACTIVE'
  ) then
    raise exception 'EMAIL_ALREADY_HAS_ACCESS' using errcode = '23505';
  end if;

  update public.user_invitations
     set revoked_at = now()
   where organization_id = v_org.id and email = v_email
     and accepted_at is null and revoked_at is null;

  insert into public.user_invitations
    (organization_id, email, full_name, role, token_hash, invited_by, expires_at)
  values
    (v_org.id, v_email, nullif(btrim(p_full_name), ''), p_role, p_token_hash, v_actor, now() + p_expires_in)
  returning id into v_id;

  return jsonb_build_object('invitation_id', v_id, 'organization_id', v_org.id,
                            'existing_auth_user', v_auth_user is not null);
end
$$;

create or replace function private.revoke_invitation(p_invitation_id uuid, p_actor uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor      uuid := private.resolve_actor(p_actor);
  v_actor_role public.membership_role;
  v_actor_org  uuid;
  v_inv        record;
begin
  select m.role, m.organization_id into v_actor_role, v_actor_org
  from public.organization_memberships m
  join public.profiles p on p.id = m.user_id and p.active
  where m.user_id = v_actor and m.status = 'ACTIVE';

  select id, organization_id, accepted_at, revoked_at into v_inv
  from public.user_invitations where id = p_invitation_id for update;

  if v_inv.id is null
     or not (v_actor_role = 'ADMIN' or (v_actor_role = 'PARTNER_ADMIN' and v_inv.organization_id = v_actor_org)) then
    raise exception 'Convite não encontrado' using errcode = '42501';
  end if;
  if v_inv.accepted_at is not null then
    raise exception 'Convite já aceito' using errcode = '23514';
  end if;
  if v_inv.revoked_at is null then
    update public.user_invitations set revoked_at = now() where id = p_invitation_id;
  end if;
end
$$;

-- Aceite do convite pelo próprio convidado, depois que o link do Supabase Auth
-- provou o e-mail. Atômico e idempotente: repetir não cria segundo vínculo.
-- Não exige MFA (o MFA vem depois, no primeiro acesso). Devolve um status:
--   ACCEPTED | ALREADY_ACCEPTED | INVALID | REVOKED | EXPIRED | CONFLICT
create or replace function private.accept_invitation(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
  v_inv   record;
  v_org   record;
begin
  if v_uid is null then
    raise exception 'Sem sessão' using errcode = '42501';
  end if;
  select lower(u.email) into v_email from auth.users u where u.id = v_uid;

  select i.* into v_inv from public.user_invitations i where i.token_hash = p_token_hash for update;
  if v_inv.id is null or v_inv.email <> v_email then
    return jsonb_build_object('status', 'INVALID');
  end if;

  if v_inv.accepted_at is not null then
    if exists (select 1 from public.organization_memberships m
               where m.user_id = v_uid and m.organization_id = v_inv.organization_id) then
      return jsonb_build_object('status', 'ALREADY_ACCEPTED', 'role', v_inv.role);
    end if;
    return jsonb_build_object('status', 'INVALID');
  end if;
  if v_inv.revoked_at is not null then
    return jsonb_build_object('status', 'REVOKED');
  end if;
  if v_inv.expires_at < now() then
    return jsonb_build_object('status', 'EXPIRED');
  end if;

  if exists (select 1 from public.organization_memberships m
             where m.user_id = v_uid and m.status = 'ACTIVE' and m.organization_id <> v_inv.organization_id) then
    return jsonb_build_object('status', 'CONFLICT');
  end if;

  -- Perfil nasce no trigger do Auth; garantia para usuários antigos.
  insert into public.profiles (id, full_name)
  values (v_uid, coalesce(v_inv.full_name, split_part(v_email, '@', 1)))
  on conflict (id) do nothing;

  insert into public.organization_memberships (organization_id, user_id, role, status, invited_at)
  values (v_inv.organization_id, v_uid, v_inv.role, 'ACTIVE', v_inv.created_at)
  on conflict (organization_id, user_id) do update
    set role = excluded.role, status = 'ACTIVE', invited_at = excluded.invited_at;

  update public.user_invitations set accepted_at = now() where id = v_inv.id;

  -- Primeiro administrador do parceiro ativa o escritório pendente.
  select id, type, status into v_org from public.organizations where id = v_inv.organization_id;
  if v_org.type = 'PARTNER' and v_org.status = 'PENDING' and v_inv.role = 'PARTNER_ADMIN' then
    update public.organizations set status = 'ACTIVE' where id = v_org.id;
    update public.partner_office_settings set activated_at = coalesce(activated_at, now())
     where organization_id = v_org.id;
  end if;

  return jsonb_build_object('status', 'ACCEPTED', 'role', v_inv.role, 'organization_type', v_org.type);
end
$$;

-- ───────────────────────────── 4. gestão de usuários ──────────────────────

-- Quem administra qual vínculo: ADMIN qualquer; PARTNER_ADMIN só do próprio
-- escritório. Ninguém altera o próprio vínculo/perfil por aqui.
create or replace function private.assert_can_manage_membership(p_actor uuid, p_membership_id uuid)
returns public.organization_memberships
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_role public.membership_role;
  v_actor_org  uuid;
  v_target     public.organization_memberships;
begin
  select m.role, m.organization_id into v_actor_role, v_actor_org
  from public.organization_memberships m
  join public.profiles p on p.id = m.user_id and p.active
  join public.organizations o on o.id = m.organization_id and o.status = 'ACTIVE'
  where m.user_id = p_actor and m.status = 'ACTIVE';

  select m.* into v_target
  from public.organization_memberships m where m.id = p_membership_id for update;

  if v_target.id is null
     or not (v_actor_role = 'ADMIN'
             or (v_actor_role = 'PARTNER_ADMIN' and v_target.organization_id = v_actor_org)) then
    raise exception 'Usuário não encontrado' using errcode = '42501';
  end if;
  if v_target.user_id = p_actor then
    raise exception 'Você não pode alterar o próprio acesso' using errcode = '42501';
  end if;
  return v_target;
end
$$;

-- Último ADMIN ativo (perfil ativo, vínculo ativo) não sai.
create or replace function private.assert_not_last_admin(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.user_internal_role(p_user_id) = 'ADMIN' and (
    select count(*) from public.organization_memberships m
    join public.profiles p on p.id = m.user_id and p.active
    join public.organizations o on o.id = m.organization_id and o.type = 'OWNER'
    where m.role = 'ADMIN' and m.status = 'ACTIVE'
  ) <= 1 then
    raise exception 'Não é possível remover o último administrador ativo' using errcode = '23514';
  end if;
end
$$;

create or replace function private.set_membership_role(
  p_membership_id uuid, p_role public.membership_role, p_actor uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := private.resolve_actor(p_actor);
  v_target public.organization_memberships;
begin
  v_target := private.assert_can_manage_membership(v_actor, p_membership_id);
  if private.user_internal_role(v_actor) is distinct from 'ADMIN' and p_role not in ('PARTNER_ADMIN', 'PARTNER_USER') then
    raise exception 'Papel não permitido' using errcode = '42501';
  end if;
  if v_target.role = 'ADMIN' and p_role <> 'ADMIN' and v_target.status = 'ACTIVE' then
    perform private.assert_not_last_admin(v_target.user_id);
  end if;
  update public.organization_memberships set role = p_role where id = p_membership_id;
end
$$;

create or replace function private.set_membership_status(
  p_membership_id uuid, p_status text, p_actor uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := private.resolve_actor(p_actor);
  v_target public.organization_memberships;
begin
  if p_status not in ('ACTIVE', 'SUSPENDED', 'REMOVED') then
    raise exception 'Status inválido' using errcode = '22023';
  end if;
  v_target := private.assert_can_manage_membership(v_actor, p_membership_id);
  if v_target.role = 'ADMIN' and v_target.status = 'ACTIVE' and p_status <> 'ACTIVE' then
    perform private.assert_not_last_admin(v_target.user_id);
  end if;
  update public.organization_memberships set status = p_status where id = p_membership_id;
end
$$;

-- Perfil é a PESSOA no sistema: só ADMIN interno ativa/inativa.
create or replace function private.set_profile_active(p_user_id uuid, p_active boolean, p_actor uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.resolve_actor(p_actor);
begin
  if private.user_internal_role(v_actor) is distinct from 'ADMIN' then
    raise exception 'Somente ADMIN interno ativa ou inativa usuários' using errcode = '42501';
  end if;
  if p_user_id = v_actor then
    raise exception 'Você não pode alterar o próprio acesso' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'Usuário não encontrado' using errcode = '42501';
  end if;
  if not p_active then
    perform private.assert_not_last_admin(p_user_id);
  end if;
  update public.profiles set active = p_active where id = p_user_id;
end
$$;

-- Equipe de uma organização, com e-mail e situação de primeiro acesso/MFA.
-- ADMIN: qualquer organização (padrão: OWNER). PARTNER_ADMIN: só a própria.
create or replace function private.get_team_members(p_organization_id uuid default null, p_actor uuid default null)
returns table (
  membership_id     uuid,
  user_id           uuid,
  full_name         text,
  email             text,
  role              public.membership_role,
  membership_status text,
  profile_active    boolean,
  organization_id   uuid,
  organization_name text,
  mfa_enabled       boolean,
  last_sign_in_at   timestamptz,
  joined_at         timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor      uuid := private.resolve_actor(p_actor);
  v_actor_role public.membership_role;
  v_actor_org  uuid;
  v_org        uuid;
begin
  select m.role, m.organization_id into v_actor_role, v_actor_org
  from public.organization_memberships m
  join public.profiles p on p.id = m.user_id and p.active
  where m.user_id = v_actor and m.status = 'ACTIVE';

  if v_actor_role = 'ADMIN' then
    v_org := coalesce(p_organization_id, (select id from public.organizations where type = 'OWNER' and deleted_at is null));
  elsif v_actor_role = 'PARTNER_ADMIN' and (p_organization_id is null or p_organization_id = v_actor_org) then
    v_org := v_actor_org;
  else
    raise exception 'Sem permissão para ver a equipe' using errcode = '42501';
  end if;

  return query
  select m.id, m.user_id, p.full_name, u.email::text, m.role, m.status, p.active, o.id, o.name,
         exists (select 1 from auth.mfa_factors f where f.user_id = m.user_id and f.status = 'verified'),
         u.last_sign_in_at, m.joined_at
  from public.organization_memberships m
  join public.organizations o on o.id = m.organization_id
  join public.profiles p on p.id = m.user_id
  join auth.users u on u.id = m.user_id
  where m.organization_id = v_org
  order by p.full_name;
end
$$;

-- Eventos administrativos de Auth que o banco não enxerga (reset de MFA).
-- Só pela service role, em nome de um ADMIN já autorizado pelo servidor.
create or replace function private.record_auth_event(
  p_action text, p_target_user uuid, p_metadata jsonb default '{}', p_actor uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.resolve_actor(p_actor);
begin
  if p_action not in ('MFA_RESET_REQUESTED', 'MFA_RESET_COMPLETED') then
    raise exception 'Evento de Auth não permitido: %', p_action using errcode = '22023';
  end if;
  if private.user_internal_role(v_actor) is distinct from 'ADMIN' then
    raise exception 'Somente ADMIN interno' using errcode = '42501';
  end if;
  return private.record_audit_event(p_action, 'profiles', p_target_user, coalesce(p_metadata, '{}'));
end
$$;

-- ───────────────────────────── 5. OWNER e auditoria de termos ─────────────

-- O escritório proprietário não é suspenso, inativado, excluído nem vira
-- parceiro. (O índice único já impede um segundo OWNER.)
create or replace function private.organizations_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.type is distinct from old.type then
    raise exception 'O tipo da organização não muda' using errcode = '23514';
  end if;
  if old.type = 'OWNER' and (new.status <> 'ACTIVE' or new.deleted_at is not null) then
    raise exception 'O escritório proprietário não pode ser suspenso, inativado nem excluído' using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger organizations_guard
  before update on public.organizations
  for each row execute function private.organizations_guard();

create or replace function private.audit_legal_acceptance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.record_audit_event('LEGAL_TERMS_ACCEPTED', 'profiles', new.user_id,
    jsonb_build_object('document_type', new.document_type, 'document_version', new.document_version));
  return null;
end
$$;

create trigger user_legal_acceptances_audit
  after insert on public.user_legal_acceptances
  for each row execute function private.audit_legal_acceptance();

-- ───────────────────────────── RPCs públicas e grants ─────────────────────

create or replace function public.create_invitation(
  p_email text, p_full_name text, p_role public.membership_role, p_organization_id uuid,
  p_token_hash text, p_actor uuid default null
)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.create_invitation(p_email, p_full_name, p_role, p_organization_id, p_token_hash, interval '7 days', p_actor) $$;

create or replace function public.revoke_invitation(p_invitation_id uuid, p_actor uuid default null)
returns void language sql security invoker set search_path = ''
as $$ select private.revoke_invitation(p_invitation_id, p_actor) $$;

create or replace function public.accept_invitation(p_token_hash text)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.accept_invitation(p_token_hash) $$;

create or replace function public.set_membership_role(p_membership_id uuid, p_role public.membership_role, p_actor uuid default null)
returns void language sql security invoker set search_path = ''
as $$ select private.set_membership_role(p_membership_id, p_role, p_actor) $$;

create or replace function public.set_membership_status(p_membership_id uuid, p_status text, p_actor uuid default null)
returns void language sql security invoker set search_path = ''
as $$ select private.set_membership_status(p_membership_id, p_status, p_actor) $$;

create or replace function public.set_profile_active(p_user_id uuid, p_active boolean, p_actor uuid default null)
returns void language sql security invoker set search_path = ''
as $$ select private.set_profile_active(p_user_id, p_active, p_actor) $$;

create or replace function public.record_auth_event(
  p_action text, p_target_user uuid, p_metadata jsonb default '{}', p_actor uuid default null
)
returns uuid language sql security invoker set search_path = ''
as $$ select private.record_auth_event(p_action, p_target_user, p_metadata, p_actor) $$;

create or replace function public.get_team_members(p_organization_id uuid default null, p_actor uuid default null)
returns table (
  membership_id uuid, user_id uuid, full_name text, email text, role public.membership_role,
  membership_status text, profile_active boolean, organization_id uuid, organization_name text,
  mfa_enabled boolean, last_sign_in_at timestamptz, joined_at timestamptz
)
language sql stable security invoker set search_path = ''
as $$ select * from private.get_team_members(p_organization_id, p_actor) $$;

do $$
declare
  f text;
begin
  -- Funções internas: ninguém executa direto.
  foreach f in array array[
    'private.assert_can_manage_membership(uuid, uuid)',
    'private.assert_not_last_admin(uuid)']
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
  end loop;

  -- Operações do usuário (JWT, com MFA) e do backend (service role + ator).
  foreach f in array array[
    'private.create_invitation(text, text, public.membership_role, uuid, text, interval, uuid)',
    'private.revoke_invitation(uuid, uuid)',
    'private.set_membership_role(uuid, public.membership_role, uuid)',
    'private.set_membership_status(uuid, text, uuid)',
    'private.set_profile_active(uuid, boolean, uuid)',
    'private.get_team_members(uuid, uuid)',
    'public.create_invitation(text, text, public.membership_role, uuid, text, uuid)',
    'public.revoke_invitation(uuid, uuid)',
    'public.set_membership_role(uuid, public.membership_role, uuid)',
    'public.set_membership_status(uuid, text, uuid)',
    'public.set_profile_active(uuid, boolean, uuid)',
    'public.get_team_members(uuid, uuid)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;

  -- Aceite: só o próprio convidado logado.
  foreach f in array array['private.accept_invitation(text)', 'public.accept_invitation(text)'] loop
    execute format('revoke all on function %s from public, anon, service_role', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;

  -- Evento de Auth: só a service role (o servidor já autorizou o ADMIN).
  foreach f in array array['private.record_auth_event(text, uuid, jsonb, uuid)', 'public.record_auth_event(text, uuid, jsonb, uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end
$$;
