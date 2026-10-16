-- 038 — Segurança de conta e sessões (Etapa 4.3.2)
--
-- Supabase Auth continua sendo a fonte de verdade. Uma "sessão" é uma linha
-- de auth.sessions, identificada pelo `session_id` do JWT. Nada aqui cria
-- sessão nem mexe em refresh token.
--
--   1. Sessão REVOGADA não acessa mais o banco. Antes, `signOut('others')`,
--      `signOut('global')` ou um reset de MFA impediam o refresh, mas o access
--      token já emitido seguia passando na RLS até expirar (~1 h).
--      private.current_membership() — base de TODA a RLS e dos helpers de
--      autorização — passa a exigir que o `session_id` do JWT exista em
--      auth.sessions, seja do usuário e não esteja vencida (`not_after`).
--   2. Reset administrativo de MFA força nova autenticação: sessão criada
--      ANTES do último MFA_RESET_COMPLETED do usuário deixa de valer (no
--      banco e na aplicação). Sem isso, uma sessão antiga (talvez roubada)
--      poderia cadastrar um autenticador novo depois do reset.
--   3. get_my_session_context() devolve também o estado da sessão (válida /
--      precisa autenticar de novo) — a aplicação, que já chama essa função a
--      cada requisição, manda para "Entrar novamente".
--   4. get_my_sessions(): sessões ATIVAS do PRÓPRIO usuário (auth.uid()),
--      DTO mínimo: id, se é a atual (pelo session_id do JWT verificado),
--      criação, última renovação, nível (aal) e navegador / sistema /
--      dispositivo — o user agent cru NUNCA sai do banco, nem IP.
--   5. record_account_security_event(): auditoria das ações do próprio
--      usuário (sair deste dispositivo, sair dos outros, sair de todos, senha
--      alterada) — antes da revogação, com o JWT ainda válido. Ações críticas
--      (outros dispositivos, todos, senha) também avisam a própria pessoa
--      (categoria SECURITY, que não se desliga).
--
-- Revogação de UMA sessão específica (que não a atual) NÃO é implementada: o
-- Supabase Auth não tem API oficial para isso (admin.signOut exige o JWT da
-- própria sessão). Não se apaga linha de auth.sessions na mão.
--
-- Pós-baseline: 001–037 não são alteradas.

-- Trava: a RLS inteira passa a ler auth.sessions (como dono das funções). Se
-- este papel não puder ler a tabela, a migration falha aqui — nada é aplicado —
-- em vez de deixar toda consulta da aplicação quebrando.
do $$
begin
  perform 1 from auth.sessions limit 1;
end
$$;

-- ───────────────────────────── sessão do JWT ──────────────────────────────

create or replace function private.jwt_session_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select case
    when coalesce(auth.jwt() ->> 'session_id', '') ~ '^[0-9a-fA-F-]{36}$' then (auth.jwt() ->> 'session_id')::uuid
  end
$$;

-- Estado da sessão do JWT: 'NO_SESSION_CLAIM' (service role, chamadas
-- internas), 'VALID', 'REVOKED' (não existe/vencida/de outro usuário) ou
-- 'REAUTH_REQUIRED' (criada antes do último reset de MFA do usuário).
-- Colunas lidas por to_jsonb: robusto a versões do Auth.
create or replace function private.jwt_session_state()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_sid     uuid := private.jwt_session_id();
  v_session jsonb;
begin
  if v_sid is null then
    return 'NO_SESSION_CLAIM';
  end if;
  select to_jsonb(s) into v_session from auth.sessions s where s.id = v_sid;
  if v_session is null
     or (v_session ->> 'user_id')::uuid is distinct from auth.uid()
     or (v_session ->> 'not_after' is not null and (v_session ->> 'not_after')::timestamptz <= now()) then
    return 'REVOKED';
  end if;
  if exists (
    select 1 from public.audit_events a
    where a.entity_type = 'profiles' and a.entity_id = auth.uid() and a.action = 'MFA_RESET_COMPLETED'
      and a.created_at > (v_session ->> 'created_at')::timestamptz
  ) then
    return 'REAUTH_REQUIRED';
  end if;
  return 'VALID';
end
$$;

revoke all on function private.jwt_session_id() from public, anon, service_role;
revoke all on function private.jwt_session_state() from public, anon, service_role;
grant execute on function private.jwt_session_id() to authenticated;
grant execute on function private.jwt_session_state() to authenticated;

-- Base da RLS: igual à 022 + a sessão do JWT precisa estar válida.
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
    and private.jwt_session_state() in ('VALID', 'NO_SESSION_CLAIM')
  limit 1
$$;

-- ───────────────────────────── contexto da sessão (022 + sessão) ──────────

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
    'aal', coalesce(auth.jwt() ->> 'aal', 'aal1'),
    -- 038: 'VALID' | 'NO_SESSION_CLAIM' | 'REVOKED' | 'REAUTH_REQUIRED'
    'session_state', v_state
  ) into v_ctx
  from auth.users u
  where u.id = v_uid;

  return v_ctx;
end
$$;

-- ───────────────────────────── dispositivo (sem fingerprint) ──────────────
-- Só família do navegador, do sistema e classe do aparelho. Nada de versão
-- exata, IP, idioma, fontes ou qualquer identificador persistente.

create or replace function private.ua_browser(p_ua text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_ua is null or btrim(p_ua) = '' then null
    when p_ua ~* 'edg(e|a|ios)?/' then 'Edge'
    when p_ua ~* '(opr|opera)/' then 'Opera'
    when p_ua ~* 'samsungbrowser/' then 'Samsung Internet'
    when p_ua ~* '(firefox|fxios)/' then 'Firefox'
    when p_ua ~* '(chrome|crios|chromium)/' then 'Chrome'
    when p_ua ~* 'safari/' and p_ua ~* 'version/' then 'Safari'
    else null
  end
$$;

create or replace function private.ua_os(p_ua text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_ua is null or btrim(p_ua) = '' then null
    when p_ua ~* 'iphone' then 'iPhone'
    when p_ua ~* 'ipad' then 'iPad'
    when p_ua ~* 'android' then 'Android'
    when p_ua ~* 'cros' then 'ChromeOS'
    when p_ua ~* 'windows' then 'Windows'
    when p_ua ~* 'mac os x|macintosh' then 'macOS'
    when p_ua ~* 'linux' then 'Linux'
    else null
  end
$$;

create or replace function private.ua_device(p_ua text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_ua is null or btrim(p_ua) = '' then null
    when p_ua ~* 'ipad|tablet' or (p_ua ~* 'android' and p_ua !~* 'mobile') then 'TABLET'
    when p_ua ~* 'mobi|iphone|android' then 'MOBILE'
    when private.ua_browser(p_ua) is not null then 'DESKTOP'
    else null
  end
$$;

revoke all on function private.ua_browser(text) from public, anon, authenticated, service_role;
revoke all on function private.ua_os(text) from public, anon, authenticated, service_role;
revoke all on function private.ua_device(text) from public, anon, authenticated, service_role;

-- ───────────────────────────── sessões do próprio usuário ─────────────────

create or replace function private.get_my_sessions()
returns table (
  session_id        uuid,
  is_current        boolean,
  created_at        timestamptz,
  last_refreshed_at timestamptz,
  aal               text,
  browser           text,
  operating_system  text,
  device_class      text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_sid uuid := private.jwt_session_id();
begin
  -- Mesma barreira do resto: sessão liberada (aal2, vínculo ativo, sessão válida).
  if v_uid is null or not exists (select 1 from private.current_membership()) then
    raise exception 'Sem sessão liberada' using errcode = '42501';
  end if;
  return query
  select (j ->> 'id')::uuid,
         (j ->> 'id')::uuid = v_sid,
         (j ->> 'created_at')::timestamptz,
         coalesce((j ->> 'refreshed_at')::timestamp at time zone 'UTC', (j ->> 'updated_at')::timestamptz, (j ->> 'created_at')::timestamptz),
         j ->> 'aal',
         private.ua_browser(j ->> 'user_agent'),
         private.ua_os(j ->> 'user_agent'),
         private.ua_device(j ->> 'user_agent')
  from (select to_jsonb(s) as j from auth.sessions s where s.user_id = v_uid) x
  where (j ->> 'not_after' is null or (j ->> 'not_after')::timestamptz > now())
    -- Sessão anterior a um reset de MFA não vale mais: não aparece como ativa.
    and not exists (
      select 1 from public.audit_events a
      where a.entity_type = 'profiles' and a.entity_id = v_uid and a.action = 'MFA_RESET_COMPLETED'
        and a.created_at > (j ->> 'created_at')::timestamptz
    )
  order by ((j ->> 'id')::uuid = v_sid) desc, 4 desc;
end
$$;

create or replace function public.get_my_sessions()
returns table (
  session_id uuid, is_current boolean, created_at timestamptz, last_refreshed_at timestamptz,
  aal text, browser text, operating_system text, device_class text
)
language sql
stable
security invoker
set search_path = ''
as $$ select * from private.get_my_sessions() $$;

revoke all on function private.get_my_sessions() from public, anon, service_role;
grant execute on function private.get_my_sessions() to authenticated;
revoke all on function public.get_my_sessions() from public, anon;
grant execute on function public.get_my_sessions() to authenticated;

-- ───────────────────────────── auditoria das ações da conta ───────────────
-- O próprio usuário registra, ANTES de revogar (o JWT ainda vale). Só ações
-- da lista; nunca token, senha, OTP nem id completo de outra sessão.

create or replace function private.record_account_security_event(p_action text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not exists (select 1 from private.current_membership()) then
    raise exception 'Sem sessão liberada' using errcode = '42501';
  end if;
  if p_action not in ('SESSION_CURRENT_REVOKED', 'OTHER_SESSIONS_REVOKED', 'ALL_SESSIONS_REVOKED', 'PASSWORD_CHANGED') then
    raise exception 'Evento de segurança não permitido' using errcode = '22023';
  end if;
  return private.record_audit_event(p_action, 'profiles', v_uid, jsonb_build_object('aal', auth.jwt() ->> 'aal'));
end
$$;

create or replace function public.record_account_security_event(p_action text)
returns uuid
language sql
security invoker
set search_path = ''
as $$ select private.record_account_security_event(p_action) $$;

revoke all on function private.record_account_security_event(text) from public, anon, service_role;
grant execute on function private.record_account_security_event(text) to authenticated;
revoke all on function public.record_account_security_event(text) from public, anon;
grant execute on function public.record_account_security_event(text) to authenticated;

-- ───────────────────────────── avisos de segurança ────────────────────────
-- 037 avisava MFA redefinido e troca de perfil. Agora também senha alterada e
-- sessões encerradas — inclusive quando quem fez foi a própria pessoa (é o
-- registro dela; se não foi ela, é o alerta). Categoria SECURITY: não desliga.

create or replace function private.notify_security_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user  uuid;
  v_title text;
  v_msg   text;
  v_type  text := 'SECURITY_NOTICE';
begin
  if new.action = 'MFA_RESET_COMPLETED' and new.entity_type = 'profiles' then
    perform private.notify(new.entity_id, 'MFA_RESET', 'Sua verificação em duas etapas foi redefinida',
                           'Um administrador removeu o seu autenticador. As sessões abertas antes disso foram encerradas. Se você não pediu isso, avise o administrador do escritório.',
                           'WARNING', 'security:' || new.id);
    return null;
  elsif new.action = 'ROLE_CHANGED' then
    perform private.notify((new.metadata ->> 'user_id')::uuid, 'ROLE_CHANGED', 'Seu perfil de acesso mudou',
                           'As telas e ações disponíveis para você foram atualizadas.', 'WARNING', 'security:' || new.id);
    return null;
  elsif new.action = 'PASSWORD_CHANGED' then
    v_user := new.entity_id; v_title := 'Sua senha foi alterada';
    v_msg := 'As outras sessões foram encerradas. Se não foi você, avise o administrador do escritório.';
  elsif new.action = 'OTHER_SESSIONS_REVOKED' then
    v_user := new.entity_id; v_title := 'Outras sessões encerradas';
    v_msg := 'Todos os outros dispositivos saíram da sua conta. Esta sessão continua ativa.';
  elsif new.action = 'ALL_SESSIONS_REVOKED' then
    v_user := new.entity_id; v_title := 'Todas as sessões encerradas';
    v_msg := 'Você saiu de todos os dispositivos. O próximo acesso pede senha e código.';
  else
    return null;
  end if;
  -- Aviso para a PRÓPRIA pessoa (notify pula o autor; aqui não deve pular).
  insert into public.notifications (user_id, type, title, message, severity, event_key)
  values (v_user, v_type, v_title, v_msg, 'WARNING', 'security:' || new.id)
  on conflict (user_id, event_key) where event_key is not null do nothing;
  return null;
end
$$;

drop trigger audit_events_notify_security on public.audit_events;
create trigger audit_events_notify_security
  after insert on public.audit_events
  for each row when (new.action in ('MFA_RESET_COMPLETED', 'ROLE_CHANGED', 'PASSWORD_CHANGED', 'OTHER_SESSIONS_REVOKED', 'ALL_SESSIONS_REVOKED'))
  execute function private.notify_security_events();

revoke all on function private.notify_security_events() from public, anon, authenticated, service_role;
