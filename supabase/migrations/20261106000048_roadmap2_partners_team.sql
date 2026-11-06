-- DG Brasil — 048: Roadmap 2.0, bloco 5 — parceiros, convites e OABs
--
-- Pedido da Barbara (2026-11-06):
--   1. Várias OABs por pessoa ("existe OAB de mais de um lugar"): tabela
--      profile_oabs, com uma principal (espelhada em profiles.oab_* para o que
--      já lia de lá). Cada pessoa cuida das próprias OABs.
--   2. Convite com OAB: quem convida informa a OAB do advogado convidado
--      (obrigatória para advogado/usuário do parceiro, opcional para
--      administrador — regra no servidor). No aceite, ela vira OAB da pessoa.
--   3. Convidar parceiro só com o e-mail: o ADMIN cria o escritório pendente e
--      convida; no PRIMEIRO ACESSO o parceiro completa o cadastro do escritório
--      (nome, razão social, CNPJ ou CPF, telefone) e a OAB dele.
--      partner_office_settings.profile_completed_at marca o que já foi feito
--      (escritórios cadastrados pelo formulário completo já contam como feitos).
--
-- 001–047 não são alteradas.

-- ───────────────────────────── 1. OABs da pessoa ─────────────────────────

create table public.profile_oabs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete restrict,
  oab_number text not null check (oab_number ~ '^[0-9]{1,8}[A-Z]?$'),
  oab_state  public.uf_code not null,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  constraint profile_oabs_unique unique (user_id, oab_number, oab_state)
);

comment on table public.profile_oabs is
  'OABs de cada pessoa (uma por seccional). A principal é espelhada em profiles.oab_number/oab_state.';

create unique index profile_oabs_one_primary on public.profile_oabs (user_id) where is_primary;
create index profile_oabs_user_idx on public.profile_oabs (user_id);

-- Quem enxerga a OAB de quem: a própria pessoa; ADMIN interno; administrador
-- do parceiro, as das pessoas do próprio escritório.
alter table public.profile_oabs enable row level security;
create policy profile_oabs_select on public.profile_oabs for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select private.is_admin())
    or ((select private.is_partner_admin()) and exists (
          select 1 from public.organization_memberships m
           where m.user_id = profile_oabs.user_id
             and m.organization_id = (select private.current_partner_organization_id())))
  );
revoke all on public.profile_oabs from public, anon, authenticated;
grant select on public.profile_oabs to authenticated;
grant select on public.profile_oabs to service_role;

-- Espelho da principal em profiles (o que já lia profiles.oab_* continua certo).
create or replace function private.profile_oabs_sync_primary(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v record;
begin
  select o.oab_number, o.oab_state into v from public.profile_oabs o
   where o.user_id = p_user order by o.is_primary desc, o.created_at limit 1;
  update public.profiles set oab_number = v.oab_number, oab_state = v.oab_state
   where id = p_user and (oab_number is distinct from v.oab_number or oab_state is distinct from v.oab_state);
end
$$;

-- Normaliza e grava uma OAB para a pessoa (primeira = principal).
create or replace function private.add_profile_oab(p_user uuid, p_number text, p_state text, p_primary boolean default false)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_number text := upper(regexp_replace(coalesce(p_number, ''), '[^0-9A-Za-z]', '', 'g'));
  v_state  text := upper(btrim(coalesce(p_state, '')));
  v_id     uuid;
  v_first  boolean;
begin
  if v_number !~ '^[0-9]{1,8}[A-Z]?$' then
    raise exception 'Número da OAB inválido (só números, com letra no fim se houver)' using errcode = '22023';
  end if;
  if v_state !~ '^[A-Z]{2}$' then
    raise exception 'Informe a UF da OAB' using errcode = '22023';
  end if;
  v_first := not exists (select 1 from public.profile_oabs o where o.user_id = p_user);
  insert into public.profile_oabs (user_id, oab_number, oab_state, is_primary)
  values (p_user, v_number, v_state::public.uf_code, v_first)
  on conflict (user_id, oab_number, oab_state) do update set oab_number = excluded.oab_number
  returning id into v_id;
  if coalesce(p_primary, false) and not v_first then
    update public.profile_oabs set is_primary = (id = v_id) where user_id = p_user;
  end if;
  perform private.profile_oabs_sync_primary(p_user);
  perform private.record_audit_event('PROFILE_OAB_ADDED', 'profiles', p_user,
    jsonb_build_object('oab_state', v_state));
  return v_id;
end
$$;

-- OABs que já existiam no perfil viram a principal.
insert into public.profile_oabs (user_id, oab_number, oab_state, is_primary)
select p.id, upper(regexp_replace(p.oab_number, '[^0-9A-Za-z]', '', 'g')), p.oab_state, true
from public.profiles p
where p.oab_number is not null and p.oab_state is not null
  and upper(regexp_replace(p.oab_number, '[^0-9A-Za-z]', '', 'g')) ~ '^[0-9]{1,8}[A-Z]?$'
on conflict do nothing;

create or replace function public.add_my_oab(p_number text, p_state text, p_primary boolean default false)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sem sessão' using errcode = '42501';
  end if;
  return private.add_profile_oab(auth.uid(), p_number, p_state, p_primary);
end
$$;

create or replace function public.remove_my_oab(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_was_primary boolean;
begin
  delete from public.profile_oabs where id = p_id and user_id = auth.uid() returning is_primary into v_was_primary;
  if v_was_primary is null then
    raise exception 'OAB não encontrada' using errcode = '42501';
  end if;
  if v_was_primary then
    update public.profile_oabs set is_primary = true
     where id = (select o.id from public.profile_oabs o where o.user_id = auth.uid() order by o.created_at limit 1);
  end if;
  perform private.profile_oabs_sync_primary(auth.uid());
  perform private.record_audit_event('PROFILE_OAB_REMOVED', 'profiles', auth.uid(), '{}');
end
$$;

create or replace function public.set_my_primary_oab(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profile_oabs o where o.id = p_id and o.user_id = auth.uid()) then
    raise exception 'OAB não encontrada' using errcode = '42501';
  end if;
  update public.profile_oabs set is_primary = (id = p_id) where user_id = auth.uid();
  perform private.profile_oabs_sync_primary(auth.uid());
end
$$;

-- ───────────────────────────── 2. OAB no convite ─────────────────────────

alter table public.user_invitations
  add column oab_number text check (oab_number is null or oab_number ~ '^[0-9]{1,8}[A-Z]?$'),
  add column oab_state  public.uf_code,
  add constraint user_invitations_oab_complete check ((oab_number is null) = (oab_state is null));

comment on column public.user_invitations.oab_number is
  'OAB informada por quem convidou (advogado convidado). No aceite vira OAB da pessoa (profile_oabs).';

-- Só o servidor (service role) grava a OAB do convite, logo depois de criá-lo.
create or replace function public.set_invitation_oab(p_invitation_id uuid, p_number text, p_state text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_number text := nullif(upper(regexp_replace(coalesce(p_number, ''), '[^0-9A-Za-z]', '', 'g')), '');
  v_state  text := nullif(upper(btrim(coalesce(p_state, ''))), '');
begin
  update public.user_invitations
     set oab_number = v_number, oab_state = v_state::public.uf_code
   where id = p_invitation_id and accepted_at is null and revoked_at is null;
end
$$;

-- No aceite, a OAB do convite vira OAB da pessoa que aceitou.
create or replace function private.user_invitations_oab_on_accept()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.accepted_at is not null and old.accepted_at is null and new.oab_number is not null and auth.uid() is not null then
    perform private.add_profile_oab(auth.uid(), new.oab_number, new.oab_state, false);
  end if;
  return null;
end
$$;

create trigger user_invitations_oab_on_accept
  after update of accepted_at on public.user_invitations
  for each row execute function private.user_invitations_oab_on_accept();

-- ───────────────────────────── 3. cadastro do parceiro no 1º acesso ──────

alter table public.organizations
  add column cpf public.cpf_digits;

comment on column public.organizations.cpf is
  'Escritório parceiro de advogado(a) sem CNPJ: CPF do titular. Ou CNPJ, ou CPF.';

-- Padrão "agora": quem cadastra pelo formulário completo (ADMIN) já completou.
-- Só o convite por e-mail deixa nulo (create_partner_invite_office).
alter table public.partner_office_settings
  add column profile_completed_at timestamptz default now();

comment on column public.partner_office_settings.profile_completed_at is
  'Quando o próprio parceiro completou o cadastro do escritório no primeiro acesso. Nulo = convite só com e-mail, cadastro a completar.';

-- Escritórios já existentes foram cadastrados completos pelo ADMIN.
update public.partner_office_settings set profile_completed_at = coalesce(activated_at, created_at);

-- Convite de parceiro só com o e-mail: escritório pendente, com o cadastro a
-- completar pelo próprio parceiro. O convite em si sai pelo servidor
-- (create_invitation, service role), logo depois.
create or replace function public.create_partner_invite_office(p_contact text, p_partner_percentage numeric default 50)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id  uuid;
  v_pct numeric := coalesce(p_partner_percentage, 50);
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'Somente ADMIN interno convida parceiro' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_contact, '')), '') is null then
    raise exception 'Informe o contato do parceiro' using errcode = '22023';
  end if;
  if v_pct < 0 or v_pct > 100 then
    raise exception 'Percentual do parceiro entre 0 e 100' using errcode = '22023';
  end if;
  v_id := private.create_partner_office(
    jsonb_build_object('name', left('Convite: ' || btrim(p_contact), 200)),
    jsonb_build_object('default_partner_percentage', v_pct, 'default_owner_percentage', 100 - v_pct));
  update public.partner_office_settings set profile_completed_at = null where organization_id = v_id;
  return v_id;
end
$$;

-- Situação do convite para a tela do primeiro acesso (só para o próprio
-- convidado: o e-mail da sessão tem de ser o do convite).
create or replace function public.get_invitation_context(p_token_hash text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_email text;
  v record;
begin
  if auth.uid() is null then
    return jsonb_build_object('status', 'INVALID');
  end if;
  select lower(u.email) into v_email from auth.users u where u.id = auth.uid();
  select i.role, i.full_name, i.oab_number, i.oab_state, i.organization_id, i.accepted_at, i.revoked_at, i.expires_at,
         o.type as org_type, o.name as org_name, o.status as org_status, s.profile_completed_at
    into v
  from public.user_invitations i
  join public.organizations o on o.id = i.organization_id
  left join public.partner_office_settings s on s.organization_id = o.id
  where i.token_hash = p_token_hash and i.email = v_email;
  if not found then
    return jsonb_build_object('status', 'INVALID');
  end if;
  return jsonb_build_object(
    'status', case when v.revoked_at is not null then 'REVOKED' when v.accepted_at is not null then 'ACCEPTED'
                   when v.expires_at < now() then 'EXPIRED' else 'PENDING' end,
    'role', v.role,
    'full_name', v.full_name,
    'oab_number', v.oab_number,
    'oab_state', v.oab_state,
    'organization_type', v.org_type,
    'organization_name', v.org_name,
    'needs_office_profile', v.org_type = 'PARTNER' and v.role = 'PARTNER_ADMIN' and v.profile_completed_at is null);
end
$$;

-- O administrador do parceiro completa o cadastro do próprio escritório (uma
-- vez; depois, alterações são com o escritório principal, como antes).
create or replace function public.complete_partner_office_profile(p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org     uuid;
  v_name    text := btrim(coalesce(p ->> 'name', ''));
  v_doc     text := regexp_replace(coalesce(p ->> 'document', ''), '\D', '', 'g');
  v_phone   text := nullif(regexp_replace(coalesce(p ->> 'phone', ''), '\D', '', 'g'), '');
  v_resp    text := nullif(btrim(coalesce(p ->> 'responsible_name', '')), '');
  v_oab     text := nullif(upper(regexp_replace(coalesce(p ->> 'oab_number', ''), '[^0-9A-Za-z]', '', 'g')), '');
  v_oab_uf  text := nullif(upper(btrim(coalesce(p ->> 'oab_state', ''))), '');
begin
  select m.organization_id into v_org
  from public.organization_memberships m
  join public.organizations o on o.id = m.organization_id and o.type = 'PARTNER'
  join public.partner_office_settings s on s.organization_id = o.id
  where m.user_id = auth.uid() and m.status = 'ACTIVE' and m.role = 'PARTNER_ADMIN'
    and s.profile_completed_at is null
  limit 1;
  if v_org is null then
    raise exception 'Cadastro do escritório já foi completado ou não é seu' using errcode = '42501';
  end if;
  if v_name = '' then
    raise exception 'Informe o nome do escritório' using errcode = '22023';
  end if;
  if length(v_doc) not in (11, 14) then
    raise exception 'Informe o CNPJ (14 dígitos) ou o CPF (11 dígitos)' using errcode = '22023';
  end if;
  if v_phone is null or length(v_phone) not between 10 and 11 then
    raise exception 'Informe o telefone com DDD' using errcode = '22023';
  end if;
  if (v_oab is null) <> (v_oab_uf is null) then
    raise exception 'Informe número e UF da OAB' using errcode = '22023';
  end if;

  update public.organizations o set
    name       = v_name,
    legal_name = nullif(btrim(coalesce(p ->> 'legal_name', '')), ''),
    cnpj       = case when length(v_doc) = 14 then v_doc end,
    cpf        = case when length(v_doc) = 11 then v_doc end,
    phone      = v_phone,
    email      = coalesce(nullif(lower(btrim(coalesce(p ->> 'email', ''))), ''), o.email)
  where o.id = v_org;

  update public.partner_office_settings s set
    profile_completed_at   = now(),
    responsible_name       = coalesce(v_resp, s.responsible_name),
    responsible_oab_number = coalesce(v_oab, s.responsible_oab_number),
    responsible_oab_state  = coalesce(v_oab_uf::public.uf_code, s.responsible_oab_state)
  where s.organization_id = v_org;

  if v_oab is not null then
    perform private.add_profile_oab(auth.uid(), v_oab, v_oab_uf, true);
  end if;
  perform private.record_audit_event('PARTNER_PROFILE_COMPLETED', 'organizations', v_org, '{}');
end
$$;

-- ───────────────────────────── grants ────────────────────────────────────

revoke all on function public.add_my_oab(text, text, boolean) from public, anon;
revoke all on function public.remove_my_oab(uuid) from public, anon;
revoke all on function public.set_my_primary_oab(uuid) from public, anon;
revoke all on function public.get_invitation_context(text) from public, anon;
revoke all on function public.complete_partner_office_profile(jsonb) from public, anon;
revoke all on function public.create_partner_invite_office(text, numeric) from public, anon;
grant execute on function public.create_partner_invite_office(text, numeric) to authenticated;
revoke all on function public.set_invitation_oab(uuid, text, text) from public, anon, authenticated;
grant execute on function public.add_my_oab(text, text, boolean) to authenticated;
grant execute on function public.remove_my_oab(uuid) to authenticated;
grant execute on function public.set_my_primary_oab(uuid) to authenticated;
grant execute on function public.get_invitation_context(text) to authenticated;
grant execute on function public.complete_partner_office_profile(jsonb) to authenticated;
grant execute on function public.set_invitation_oab(uuid, text, text) to service_role;

revoke all on function private.add_profile_oab(uuid, text, text, boolean) from public, anon, authenticated;
revoke all on function private.profile_oabs_sync_primary(uuid) from public, anon, authenticated;
revoke all on function private.user_invitations_oab_on_accept() from public, anon, authenticated;
