-- 079 · Cadastro pessoal: etapa obrigatória "Complete seu cadastro" e a tela
-- "Meu perfil" (decisão de 17/11/2026).
--
-- Ninguém se cadastra no DG Brasil: as pessoas são convidadas. Faltava um
-- lugar para a pessoa conferir e completar os PRÓPRIOS dados. Quem não entra
-- por convite (a primeira administradora, promovida por bootstrap_owner_admin)
-- ficava com o nome tirado do e-mail.
--
--   1. profiles ganha gender, birth_date, office_city, office_state e
--      profile_completed_at (nulo = cadastro pendente);
--   2. complete_my_profile(p jsonb): a pessoa grava os próprios dados; a
--      primeira gravação marca o cadastro como concluído;
--   3. get_my_session_context() (038) ganha profile.completed. É por essa
--      chave que o painel manda a pessoa para a etapa, a cada requisição.
--
-- Contas que já existem ficam com profile_completed_at nulo DE PROPÓSITO:
-- todo mundo passa pela tela uma vez. Não há preenchimento retroativo.
--
-- LGPD (minimização): só o que tem finalidade. Gênero: tratamento correto da
-- pessoa nos textos. Data de nascimento: aviso de aniversário à equipe (função
-- futura). Os dois são opcionais. Nada de CPF, endereço ou documento pessoal.
--
-- As colunas novas NÃO entram no grant de UPDATE direto de `authenticated`
-- (016): só mudam por complete_my_profile, que valida tudo. Assim ninguém
-- grava data absurda nem apaga a cidade depois de concluir o cadastro.

-- ═════════════════════════════ 1. colunas ════════════════════════════════

alter table public.profiles
  add column gender               text,
  add column birth_date           date,
  add column office_city          text,
  add column office_state         public.uf_code,
  add column profile_completed_at timestamptz;

alter table public.profiles
  add constraint profiles_gender_known
    check (gender is null or gender in ('FEMALE', 'MALE', 'OTHER', 'UNDISCLOSED')),
  add constraint profiles_birth_date_plausible
    check (birth_date is null or birth_date >= date '1900-01-01'),
  add constraint profiles_office_city_shape
    check (office_city is null or (office_city = btrim(office_city) and char_length(office_city) between 2 and 80)),
  -- Cadastro concluído sempre tem a cidade e a UF de onde a pessoa trabalha.
  add constraint profiles_completed_has_office
    check (profile_completed_at is null or (office_city is not null and office_state is not null));

comment on column public.profiles.gender is
  'Gênero informado pela própria pessoa (FEMALE, MALE, OTHER, UNDISCLOSED). Opcional. Finalidade: tratamento correto nos textos.';
comment on column public.profiles.birth_date is
  'Data de nascimento informada pela própria pessoa. Opcional. Finalidade: aviso de aniversário à equipe.';
comment on column public.profiles.office_city is
  'Cidade onde a pessoa trabalha (não é endereço residencial).';
comment on column public.profiles.office_state is
  'UF onde a pessoa trabalha.';
comment on column public.profiles.profile_completed_at is
  'Quando a pessoa concluiu o cadastro pessoal. Nulo = pendente: o painel leva à etapa obrigatória. Só complete_my_profile grava.';

-- ═════════════════════════════ 2. gravar o próprio cadastro ══════════════

-- Sempre a PRÓPRIA conta (auth.uid()); não existe parâmetro de id. Serve à
-- etapa obrigatória e à tela "Meu perfil": a primeira gravação marca
-- profile_completed_at, as seguintes só atualizam os dados.
-- Chave ausente ou vazia em campo opcional = apagar o que estava gravado.
create or replace function public.complete_my_profile(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  v_name      text := regexp_replace(btrim(coalesce(p ->> 'full_name', '')), '\s+', ' ', 'g');
  v_preferred text := nullif(regexp_replace(btrim(coalesce(p ->> 'preferred_name', '')), '\s+', ' ', 'g'), '');
  v_gender    text := nullif(upper(btrim(coalesce(p ->> 'gender', ''))), '');
  v_birth_raw text := nullif(btrim(coalesce(p ->> 'birth_date', '')), '');
  v_birth     date;
  v_phone     text := nullif(regexp_replace(coalesce(p ->> 'phone', ''), '\D', '', 'g'), '');
  v_job       text := nullif(regexp_replace(btrim(coalesce(p ->> 'job_title', '')), '\s+', ' ', 'g'), '');
  v_city      text := regexp_replace(btrim(coalesce(p ->> 'office_city', '')), '\s+', ' ', 'g');
  v_state     text := upper(btrim(coalesce(p ->> 'office_state', '')));
  v_first     boolean;
  v_at        timestamptz;
begin
  if v_uid is null then
    raise exception 'Sem sessão' using errcode = '42501';
  end if;
  -- A etapa vem depois da verificação em duas etapas.
  if not private.session_is_mfa_verified() then
    raise exception 'Conclua a verificação em duas etapas antes do cadastro' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles pr where pr.id = v_uid and pr.active) then
    raise exception 'Conta inativa' using errcode = '42501';
  end if;

  if not private.valid_person_name(v_name) then
    raise exception 'Informe o nome completo, só com letras' using errcode = '22023';
  end if;
  if v_preferred is not null and (char_length(v_preferred) > 40 or not private.valid_person_name(v_preferred)) then
    raise exception 'Como prefere ser chamado: use só letras, até 40 caracteres' using errcode = '22023';
  end if;
  if v_gender is not null and v_gender not in ('FEMALE', 'MALE', 'OTHER', 'UNDISCLOSED') then
    raise exception 'Gênero inválido' using errcode = '22023';
  end if;
  if v_birth_raw is not null then
    if v_birth_raw !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'Data de nascimento inválida' using errcode = '22023';
    end if;
    begin
      v_birth := v_birth_raw::date;
    exception when others then
      raise exception 'Data de nascimento inválida' using errcode = '22023';
    end;
    -- Entre 16 e 120 anos, no dia de Brasília.
    if v_birth > (now() at time zone 'America/Sao_Paulo')::date - interval '16 years'
       or v_birth < (now() at time zone 'America/Sao_Paulo')::date - interval '120 years' then
      raise exception 'Confira a data de nascimento' using errcode = '22023';
    end if;
  end if;
  if v_phone is not null and (char_length(v_phone) not between 10 and 11 or v_phone !~ '^[1-9][0-9]') then
    raise exception 'Informe o telefone com DDD' using errcode = '22023';
  end if;
  if v_job is not null and char_length(v_job) > 80 then
    raise exception 'Cargo muito longo (máximo de 80 caracteres)' using errcode = '22023';
  end if;
  if char_length(v_city) not between 2 and 80 or v_city ~ '[0-9@/\\<>]' then
    raise exception 'Informe a cidade onde você trabalha' using errcode = '22023';
  end if;
  if v_state !~ '^[A-Z]{2}$' then
    raise exception 'Informe a UF onde você trabalha' using errcode = '22023';
  end if;

  update public.profiles pr set
    full_name            = v_name,
    preferred_name       = v_preferred,
    gender               = v_gender,
    birth_date           = v_birth,
    phone                = v_phone,
    job_title            = v_job,
    office_city          = v_city,
    office_state         = v_state::public.uf_code,
    profile_completed_at = coalesce(pr.profile_completed_at, now())
  where pr.id = v_uid
  returning (pr.profile_completed_at = now()), pr.profile_completed_at into v_first, v_at;

  if v_first then
    perform private.record_audit_event('PERSONAL_PROFILE_COMPLETED', 'profiles', v_uid, '{}');
  end if;
  return jsonb_build_object('completed_at', v_at, 'first_time', v_first);
end
$$;

comment on function public.complete_my_profile(jsonb) is
  'A pessoa grava o próprio cadastro pessoal (nome, tratamento, gênero, nascimento, telefone, cargo, cidade e UF de trabalho). A primeira gravação marca profile_completed_at.';

revoke all on function public.complete_my_profile(jsonb) from public, anon;
grant execute on function public.complete_my_profile(jsonb) to authenticated;

-- ═════════════════════════════ 3. contexto da sessão ═════════════════════

-- 038 refeita, corpo idêntico, com UMA chave a mais: profile.completed.
create or replace function public.get_my_session_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_state text;
  v_ctx   jsonb;
begin
  if v_uid is null then
    return null;
  end if;
  v_state := private.jwt_session_state();

  select jsonb_build_object(
    'user_id', v_uid,
    'email', u.email,
    'profile', (select jsonb_build_object('full_name', p.full_name, 'preferred_name', p.preferred_name,
                                          'job_title', p.job_title, 'active', p.active,
                                          -- 079: cadastro pessoal concluído
                                          'completed', p.profile_completed_at is not null)
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
    'aal', coalesce(auth.jwt() ->> 'aal', 'aal1'),
    -- 038: 'VALID' | 'NO_SESSION_CLAIM' | 'REVOKED' | 'REAUTH_REQUIRED'
    'session_state', v_state
  ) into v_ctx
  from auth.users u
  where u.id = v_uid;

  return v_ctx;
end
$$;
