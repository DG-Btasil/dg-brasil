-- DG Brasil — 023: endurecimento do convite (Etapa 4.1)
--
--   1. create_invitation deixa de ser chamável pelo navegador. Chamada direta
--      pela API respondia `existing_auth_user` e EMAIL_ALREADY_HAS_ACCESS a
--      qualquer ADMIN/PARTNER_ADMIN logado — um PARTNER_ADMIN conseguia
--      descobrir se um e-mail tem conta no DG Brasil (enumeração de contas).
--      Agora só a service role executa, sempre com p_actor: o servidor Next.js
--      já validou a sessão (aal2) do ator, e a AUTORIZAÇÃO continua aqui
--      (papel e escritório do ator lidos de organization_memberships).
--   2. Devolve `auth_user_id` da conta já existente (só o servidor vê), para o
--      reenvio a conta confirmada atualizar os dados do e-mail.
--   3. Nome do convidado validado no banco: só letras (inclusive acentos),
--      espaço, apóstrofo, hífen e ponto de abreviação. O nome aparece no e-mail
--      enviado em nome do escritório; sem isto, quem convida poderia escrever
--      um "nome" com endereço ou instrução de golpe (phishing com a nossa marca).
--      A mesma regra existe em apps/frontend/src/lib/auth/invite-metadata.ts.
--
-- Pós-baseline: 001–022 não são alteradas; funções são redefinidas aqui.

create or replace function private.valid_person_name(p_name text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_name is not null
     and char_length(p_name) between 2 and 120
     and p_name ~ '^[A-Za-zÀ-ÖØ-öø-ÿĀ-ž][A-Za-zÀ-ÖØ-öø-ÿĀ-ž .''’-]*[A-Za-zÀ-ÖØ-öø-ÿĀ-ž.]$'
     and p_name !~ '\.[^ ]'          -- ponto só no fim de abreviação ("Dr. João")
     and p_name !~ '[.''’-]{2}'       -- sem pontuação repetida ("--", "..")
     and p_name !~ ' [.''’-]'         -- pontuação não começa palavra
     and p_name !~ '[''’-] '          -- apóstrofo/hífen não terminam palavra
     and p_name !~ '^[^ ]{41}'        -- nenhuma "palavra" absurda (> 40 letras)
     and p_name !~ ' [^ ]{41}'
$$;

revoke all on function private.valid_person_name(text) from public, anon, authenticated, service_role;

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
  v_name       text := regexp_replace(btrim(coalesce(p_full_name, '')), '\s+', ' ', 'g');
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

  if not private.valid_person_name(v_name) then
    raise exception 'Nome inválido' using errcode = '22023';
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
    (v_org.id, v_email, v_name, p_role, p_token_hash, v_actor, now() + p_expires_in)
  returning id into v_id;

  return jsonb_build_object('invitation_id', v_id, 'organization_id', v_org.id,
                            'existing_auth_user', v_auth_user is not null,
                            'auth_user_id', v_auth_user);
end
$$;

-- Só o servidor (service role + p_actor). O navegador não chama mais.
revoke all on function private.create_invitation(text, text, public.membership_role, uuid, text, interval, uuid)
  from public, anon, authenticated;
grant execute on function private.create_invitation(text, text, public.membership_role, uuid, text, interval, uuid)
  to service_role;
revoke all on function public.create_invitation(text, text, public.membership_role, uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.create_invitation(text, text, public.membership_role, uuid, text, uuid)
  to service_role;
