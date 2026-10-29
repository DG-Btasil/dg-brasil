-- DG Brasil — 040: execução pelo computador do escritório (Claude Code + MCP)
--
-- Troca de arquitetura (docs/mcp/relatorio-diagnostico.md): o worker na nuvem
-- (apps/agentes, Claude API) sai; quem executa é o Claude Code do computador
-- do escritório, em modo ASSISTIDO (uma pessoa abre o Claude Code e manda
-- processar a fila). O DG Brasil continua dono dos dados, da fila e da
-- revisão humana. Esta migration só ACRESCENTA:
--
--   1. executors: computadores autorizados. O token aparece uma vez na tela;
--      o banco guarda só o SHA-256. Revogável. Capacidades por ferramenta.
--   2. Reserva por trabalho: claim gera um token de reserva (só o hash fica em
--      agent_runs.lease_token_hash). Toda ferramenta de trabalho exige token do
--      computador + token de reserva + reserva viva, e deriva o caso DA
--      execução — nunca de um argumento. São cascas finas sobre as funções
--      worker_* já testadas (018/033/039), com claimed_by =
--      'executor:<id>:<prefixo do hash da reserva>'.
--   3. agent_run_events: linha do tempo (situação, progresso, documento aberto
--      com a versão e o checksum, entregas, erros). Append-only.
--   4. Manutenção no próprio banco (pg_cron), que antes morava no worker:
--      aplicar propostas aprovadas, fechar execuções decididas, devolver à
--      fila a reserva de computador que parou de responder (até 3 tentativas)
--      e lembretes de prazo (037).
--   5. Agente aponta para o agente local do Claude Code
--      (configuration.local_agent). Instruções da versão viram as orientações
--      do DG Brasil para aquele trabalho (o que entregar e como).
--   6. Congelamento do que era só da Claude API: registro de skill no provedor
--      e envio de arquivos de skill (tabelas e dados ficam).
--
-- Nenhuma chave do Supabase vai para o computador do escritório: o servidor do
-- DG Brasil fala com o banco como dg_worker e assina URLs do Storage.
--
-- Pós-baseline: 001–039 não são alteradas.

-- ═════════════════════════════ 1. computadores ══════════════════════════

create table public.executors (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations (id) on delete restrict,
  name                text not null check (btrim(name) <> '' and length(name) <= 80),
  -- SHA-256 (hex) do token. O token em si nunca chega ao banco.
  token_hash          text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  -- Só para reconhecer na tela ("dgx_AbC1…").
  token_prefix        text not null check (token_prefix ~ '^dgx_[A-Za-z0-9_-]{4,12}$'),
  capabilities        text[] not null default array[
                        'jobs.list', 'jobs.claim', 'case.read', 'documents.read', 'knowledge.read',
                        'analysis.submit', 'drafts.submit', 'proposals.create'],
  last_seen_at        timestamptz,
  last_client_version text check (last_client_version is null or length(last_client_version) <= 120),
  revoked_at          timestamptz,
  revoked_by          uuid references public.profiles (id) on delete restrict,
  created_by          uuid references public.profiles (id) on delete restrict,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint executors_capabilities_known check (capabilities <@ array[
    'jobs.list', 'jobs.claim', 'case.read', 'documents.read', 'knowledge.read',
    'analysis.submit', 'drafts.submit', 'proposals.create']::text[])
);

comment on table public.executors is
  'Computadores autorizados a executar trabalhos (Claude Code + MCP do DG Brasil). Só o hash do token.';

create trigger executors_set_updated_at
  before update on public.executors
  for each row execute function private.set_updated_at();

-- Só a organização dona executa trabalho (parceiro nunca).
create or replace function private.executors_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.organizations o where o.id = new.organization_id and o.type = 'OWNER') then
    raise exception 'Só o escritório (organização dona) cadastra computador executor' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and (new.token_hash is distinct from old.token_hash
                           or new.organization_id is distinct from old.organization_id) then
    raise exception 'Token e organização do computador não mudam: cadastre outro' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and old.revoked_at is not null and new.revoked_at is null then
    raise exception 'Acesso revogado não volta: cadastre outro' using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger executors_validate
  before insert or update on public.executors
  for each row execute function private.executors_validate();

alter table public.executors enable row level security;
revoke all on public.executors from public, anon, authenticated, service_role;
-- Leitura e gestão só pelas RPCs abaixo.

-- ═════════════════════════════ 2. reserva e linha do tempo ══════════════

alter table public.agent_runs
  add column executor_id      uuid references public.executors (id) on delete restrict,
  add column lease_token_hash text check (lease_token_hash is null or lease_token_hash ~ '^[0-9a-f]{64}$'),
  add column progress_message text check (progress_message is null or length(progress_message) <= 200),
  add column progress_at      timestamptz;

create index agent_runs_executor_idx on public.agent_runs (executor_id) where executor_id is not null;
create index agent_runs_running_heartbeat_idx on public.agent_runs (heartbeat_at) where status = 'RUNNING';

create table public.agent_run_events (
  id                  bigint generated always as identity primary key,
  agent_run_id        uuid not null references public.agent_runs (id) on delete restrict,
  kind                text not null check (kind in ('STATUS', 'PROGRESS', 'DOCUMENT_OPENED', 'OUTPUT', 'ERROR', 'LEASE')),
  from_status         text,
  to_status           text,
  message             text check (message is null or length(message) <= 500),
  document_version_id uuid references public.document_versions (id) on delete restrict,
  checksum_sha256     text check (checksum_sha256 is null or checksum_sha256 ~ '^[0-9a-f]{64}$'),
  executor_id         uuid references public.executors (id) on delete restrict,
  actor_user_id       uuid references public.profiles (id) on delete restrict,
  created_at          timestamptz not null default now()
);

comment on table public.agent_run_events is
  'Linha do tempo da execução (situação, progresso, documento aberto com versão e checksum, entregas). Append-only.';

create index agent_run_events_run_idx on public.agent_run_events (agent_run_id, id);

create trigger agent_run_events_append_only
  before update or delete on public.agent_run_events
  for each row execute function private.prevent_mutation();

alter table public.agent_run_events enable row level security;
revoke all on public.agent_run_events from public, anon, authenticated, service_role;
-- Leitura pela tela: get_agent_run_detail.

-- Toda mudança de situação vira evento, venha de onde vier (executor, pessoa,
-- manutenção).
create or replace function private.agent_runs_log_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is not distinct from old.status then
    return null;
  end if;
  insert into public.agent_run_events (agent_run_id, kind, from_status, to_status, message, executor_id, actor_user_id)
  values (new.id, 'STATUS', old.status, new.status,
          case when new.status in ('FAILED', 'QUEUED') then left(new.error_code, 60) end,
          case when new.status = 'RUNNING' then new.executor_id end,
          auth.uid());
  return null;
end
$$;

create trigger agent_runs_log_status
  after update of status on public.agent_runs
  for each row execute function private.agent_runs_log_status();

-- ═════════════════════════════ 3. gestão (tela) ═════════════════════════

-- ADMIN cadastra. O servidor gera o token, mostra uma vez e manda só o hash.
create or replace function private.dg_create_executor(p_name text, p_token_hash text, p_token_prefix text)
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
  if not private.is_admin() then
    raise exception 'Somente ADMIN autoriza computador' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_name, '')), '') is null then
    raise exception 'Dê um nome ao computador' using errcode = '23514';
  end if;
  insert into public.executors (organization_id, name, token_hash, token_prefix, created_by)
  values (private.current_organization_id(), btrim(p_name), p_token_hash, p_token_prefix, auth.uid())
  returning id into v_id;
  perform private.record_audit_event('EXECUTOR_CREATED', 'executors', v_id,
    jsonb_build_object('name', btrim(p_name), 'token_prefix', p_token_prefix));
  return jsonb_build_object('id', v_id);
end
$$;

create or replace function private.dg_revoke_executor(p_executor_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_released integer := 0;
  r record;
begin
  if auth.uid() is null or not exists (select 1 from private.current_membership()) then
    raise exception 'Sem sessão liberada' using errcode = '42501';
  end if;
  if not private.is_admin() then
    raise exception 'Somente ADMIN revoga computador' using errcode = '42501';
  end if;
  update public.executors set revoked_at = now(), revoked_by = auth.uid()
   where id = p_executor_id and revoked_at is null;
  if not found then
    if not exists (select 1 from public.executors e where e.id = p_executor_id) then
      raise exception 'Computador não encontrado' using errcode = 'P0002';
    end if;
    return jsonb_build_object('id', p_executor_id, 'already_revoked', true, 'released', 0);
  end if;
  -- O que ele tinha reservado volta para a fila agora (sem esperar a reserva vencer).
  for r in select x.id, x.queue_msg_id, x.cancel_requested_at from public.agent_runs x
           where x.executor_id = p_executor_id and x.status = 'RUNNING'
           for update loop
    perform set_config('dg.agent_run_id', r.id::text, true);
    update public.agent_runs
       set status = case when r.cancel_requested_at is not null then 'CANCELLED' else 'QUEUED' end,
           claimed_by = null, lease_token_hash = null,
           error_code = 'EXECUTOR_REVOKED', error_message = 'O acesso do computador foi revogado.'
     where id = r.id;
    if r.queue_msg_id is not null then
      if r.cancel_requested_at is not null then
        perform pgmq.archive('agent_execution', r.queue_msg_id);
      else
        perform pgmq.set_vt('agent_execution', r.queue_msg_id, 0);
      end if;
    end if;
    v_released := v_released + 1;
  end loop;
  perform set_config('dg.agent_run_id', '', true);
  perform private.record_audit_event('EXECUTOR_REVOKED', 'executors', p_executor_id,
    jsonb_build_object('released_runs', v_released));
  return jsonb_build_object('id', p_executor_id, 'already_revoked', false, 'released', v_released);
end
$$;

-- Situação do escritório para a tela. Qualquer usuário interno vê se há
-- computador conectado (o aviso da análise); só ADMIN vê a lista.
create or replace function private.get_executor_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_admin boolean;
begin
  if auth.uid() is null or not exists (select 1 from private.current_membership()) then
    raise exception 'Sem sessão liberada' using errcode = '42501';
  end if;
  if not private.is_internal_user() then
    raise exception 'Somente a equipe interna' using errcode = '42501';
  end if;
  v_admin := private.is_admin();
  return jsonb_build_object(
    'execution_enabled', private.worker_ai_enabled(),
    'online', exists (select 1 from public.executors e
                      where e.revoked_at is null and e.last_seen_at > now() - interval '3 minutes'),
    'last_seen_at', (select max(e.last_seen_at) from public.executors e where e.revoked_at is null),
    'queued', (select count(*) from public.agent_runs r where r.status = 'QUEUED'),
    'running', (select count(*) from public.agent_runs r where r.status = 'RUNNING'),
    'executors', case when v_admin then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'name', e.name, 'token_prefix', e.token_prefix, 'capabilities', e.capabilities,
        'last_seen_at', e.last_seen_at, 'client_version', e.last_client_version,
        'online', e.revoked_at is null and e.last_seen_at > now() - interval '3 minutes',
        'revoked_at', e.revoked_at, 'created_at', e.created_at,
        'created_by_name', p.full_name,
        'running', (select count(*) from public.agent_runs r where r.executor_id = e.id and r.status = 'RUNNING'))
        order by e.revoked_at nulls first, e.created_at desc)
      from public.executors e left join public.profiles p on p.id = e.created_by), '[]'::jsonb) end);
end
$$;

-- ═════════════════════════════ 4. portas do executor ════════════════════
-- Chamadas pelo servidor do DG Brasil (rotas /api/executor/v1) com login
-- dg_worker. Token do computador e token de reserva chegam já em SHA-256.

create or replace function private.executor_require(p_token_hash text, p_capability text default null)
returns public.executors
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.executors;
begin
  select * into v from public.executors e where e.token_hash = p_token_hash and e.revoked_at is null;
  if v.id is null then
    raise exception 'Acesso do computador inválido ou revogado' using errcode = '42501';
  end if;
  if p_capability is not null and not (p_capability = any (v.capabilities)) then
    raise exception 'Este computador não tem permissão para: %', p_capability using errcode = '42501';
  end if;
  if v.last_seen_at is null or v.last_seen_at < now() - interval '20 seconds' then
    update public.executors set last_seen_at = now() where id = v.id;
  end if;
  return v;
end
$$;

-- Confere a reserva e devolve o claimed_by para as funções worker_*.
-- p_write: escrita recusa trabalho com interrupção pedida.
create or replace function private.executor_lease(
  p_token_hash text, p_agent_run_id uuid, p_lease_hash text, p_capability text, p_write boolean default false
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exec public.executors;
  v_run  record;
begin
  v_exec := private.executor_require(p_token_hash, p_capability);
  select r.status, r.claimed_by, r.executor_id, r.lease_token_hash, r.heartbeat_at, r.cancel_requested_at into v_run
  from public.agent_runs r where r.id = p_agent_run_id;
  if v_run.status is distinct from 'RUNNING' or v_run.executor_id is distinct from v_exec.id
     or v_run.lease_token_hash is distinct from p_lease_hash then
    raise exception 'Trabalho não está reservado por este computador' using errcode = '42501';
  end if;
  if v_run.heartbeat_at < now() - interval '300 seconds' then
    raise exception 'A reserva deste trabalho venceu' using errcode = '42501';
  end if;
  if p_write and v_run.cancel_requested_at is not null then
    raise exception 'Trabalho interrompido a pedido' using errcode = '55000';
  end if;
  perform set_config('dg.agent_run_id', p_agent_run_id::text, true);
  return v_run.claimed_by;
end
$$;

-- Conexão do MCP: valida o token e marca "visto agora".
create or replace function private.executor_authenticate(p_token_hash text, p_client_version text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.executors;
begin
  v := private.executor_require(p_token_hash, null);
  if p_client_version is not null and p_client_version is distinct from v.last_client_version then
    update public.executors set last_client_version = left(p_client_version, 120) where id = v.id;
  end if;
  return jsonb_build_object('executor_id', v.id, 'name', v.name, 'capabilities', v.capabilities,
                            'execution_enabled', private.worker_ai_enabled());
end
$$;

-- Fila: só o necessário para escolher. Sem nome de cliente nem título do caso
-- antes da reserva.
create or replace function private.executor_list_jobs(p_token_hash text, p_limit integer default 20)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.executor_require(p_token_hash, 'jobs.list');
  return coalesce((
    select jsonb_agg(j order by j ->> 'created_at')
    from (
      select jsonb_build_object(
        'id', r.id,
        'created_at', r.created_at,
        'kind', case when an.id is not null then 'ANALYSIS' else 'EXECUTE' end,
        'operation', r.operation,
        'attempt', r.attempt,
        'agent', jsonb_build_object('slug', a.slug, 'name', a.name,
                                    'local_agent', v.configuration ->> 'local_agent'),
        'analysis_template', t.name,
        'requested_by_name', p.full_name,
        'has_request_text', exists (select 1 from public.agent_run_inputs i
                                    where i.agent_run_id = r.id and i.request_text is not null)) as j
      from public.agent_runs r
      join public.agents a on a.id = r.agent_id
      join public.agent_versions v on v.id = r.agent_version_id
      left join public.legal_analyses an on an.agent_run_id = r.id
      left join public.analysis_templates t on t.id = an.analysis_template_id
      left join public.profiles p on p.id = r.requested_by
      where r.cancel_requested_at is null
        and (r.status = 'QUEUED'
             or (r.status = 'RUNNING' and r.heartbeat_at < now() - interval '300 seconds'))
      order by r.created_at
      limit least(greatest(coalesce(p_limit, 20), 1), 50)
    ) x), '[]'::jsonb);
end
$$;

-- Contexto do trabalho: o que o worker_run_context já devolvia, mais o
-- agente (nome local no Claude Code e as orientações da versão).
create or replace function private.executor_context_of(p_agent_run_id uuid, p_claimed_by text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ctx   jsonb;
  v_agent jsonb;
begin
  v_ctx := private.worker_run_context(p_agent_run_id, p_claimed_by);
  select jsonb_build_object(
    'id', a.id, 'slug', a.slug, 'name', a.name, 'purpose', a.purpose,
    'version_id', v.id, 'version_number', v.version_number,
    'local_agent', v.configuration ->> 'local_agent',
    'instructions', v.instructions) into v_agent
  from public.agent_runs r
  join public.agents a on a.id = r.agent_id
  join public.agent_versions v on v.id = r.agent_version_id
  where r.id = p_agent_run_id;
  return v_ctx || jsonb_build_object('agent', v_agent, 'lease_seconds', 300, 'max_attempts', 3);
end
$$;

-- Reserva exclusiva. Interruptor desligado: não reserva (o pedido fica na fila).
create or replace function private.executor_claim(p_token_hash text, p_agent_run_id uuid, p_lease_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exec    public.executors;
  v_run     record;
  v_claimed record;
  v_by      text;
begin
  v_exec := private.executor_require(p_token_hash, 'jobs.claim');
  if p_lease_hash is null or p_lease_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Token de reserva inválido' using errcode = '22023';
  end if;
  if not private.worker_ai_enabled() then
    return jsonb_build_object('claimed', false, 'reason', 'DISABLED');
  end if;

  select r.id, r.status, r.attempt, r.queue_msg_id, r.cancel_requested_at, a.status as agent_status into v_run
  from public.agent_runs r join public.agents a on a.id = r.agent_id
  where r.id = p_agent_run_id
  for update of r;
  if v_run.id is null then
    raise exception 'Trabalho não encontrado' using errcode = 'P0002';
  end if;
  if v_run.attempt >= 3 and v_run.status in ('QUEUED', 'RUNNING') then
    perform set_config('dg.agent_run_id', p_agent_run_id::text, true);
    update public.agent_runs
       set status = 'FAILED', completed_at = now(), claimed_by = null, lease_token_hash = null,
           error_code = 'MAX_ATTEMPTS', error_message = 'Limite de 3 tentativas atingido.'
     where id = p_agent_run_id;
    if v_run.queue_msg_id is not null then
      perform pgmq.archive('agent_execution', v_run.queue_msg_id);
    end if;
    return jsonb_build_object('claimed', false, 'reason', 'MAX_ATTEMPTS');
  end if;

  v_by := 'executor:' || v_exec.id::text || ':' || left(p_lease_hash, 16);
  select * into v_claimed from private.claim_agent_run(p_agent_run_id, v_by, v_run.queue_msg_id, 300);
  if not coalesce(v_claimed.claimed, false) then
    return jsonb_build_object('claimed', false, 'reason', 'NOT_AVAILABLE', 'status', v_claimed.status);
  end if;

  update public.agent_runs
     set executor_id = v_exec.id, lease_token_hash = p_lease_hash,
         progress_message = 'Reservado pelo computador do escritório', progress_at = now()
   where id = p_agent_run_id;
  if v_run.queue_msg_id is not null then
    perform pgmq.set_vt('agent_execution', v_run.queue_msg_id, 300);
  end if;
  insert into public.agent_run_events (agent_run_id, kind, message, executor_id)
  values (p_agent_run_id, 'LEASE', 'Reservado por ' || v_exec.name, v_exec.id);

  return jsonb_build_object('claimed', true, 'attempt', v_claimed.attempt,
                            'context', private.executor_context_of(p_agent_run_id, v_by));
end
$$;

create or replace function private.executor_job_context(p_token_hash text, p_agent_run_id uuid, p_lease_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return private.executor_context_of(p_agent_run_id,
    private.executor_lease(p_token_hash, p_agent_run_id, p_lease_hash, 'jobs.claim'));
end
$$;

-- Renova a reserva. Não falha: devolve se deve parar (interrupção pedida,
-- reserva perdida) para o MCP encerrar com calma.
create or replace function private.executor_heartbeat(
  p_token_hash text, p_agent_run_id uuid, p_lease_hash text, p_progress text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exec public.executors;
  v_run  record;
  v_msg  text := nullif(btrim(left(coalesce(p_progress, ''), 200)), '');
begin
  v_exec := private.executor_require(p_token_hash, null);
  select r.status, r.executor_id, r.lease_token_hash, r.queue_msg_id, r.cancel_requested_at, r.progress_message into v_run
  from public.agent_runs r where r.id = p_agent_run_id
  for update;
  if v_run.status is distinct from 'RUNNING' or v_run.executor_id is distinct from v_exec.id
     or v_run.lease_token_hash is distinct from p_lease_hash then
    return jsonb_build_object('ok', false, 'status', v_run.status,
                              'cancel_requested', v_run.cancel_requested_at is not null);
  end if;
  perform set_config('dg.agent_run_id', p_agent_run_id::text, true);
  update public.agent_runs
     set heartbeat_at = now(),
         progress_message = coalesce(v_msg, progress_message),
         progress_at = case when v_msg is not null then now() else progress_at end
   where id = p_agent_run_id;
  if v_run.queue_msg_id is not null then
    perform pgmq.set_vt('agent_execution', v_run.queue_msg_id, 300);
  end if;
  if v_msg is not null and v_msg is distinct from v_run.progress_message then
    insert into public.agent_run_events (agent_run_id, kind, message, executor_id)
    values (p_agent_run_id, 'PROGRESS', v_msg, v_exec.id);
  end if;
  return jsonb_build_object('ok', true, 'status', 'RUNNING',
                            'cancel_requested', v_run.cancel_requested_at is not null);
end
$$;

create or replace function private.executor_get_case(p_token_hash text, p_agent_run_id uuid, p_lease_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_by   text := private.executor_lease(p_token_hash, p_agent_run_id, p_lease_hash, 'case.read');
  v_case uuid;
  v_out  jsonb;
begin
  select r.legal_case_id into v_case from public.agent_runs r where r.id = p_agent_run_id;
  if v_case is null then
    return null;
  end if;
  v_out := private.worker_get_case(p_agent_run_id, v_by, v_case);
  if v_out is not null then
    perform private.record_personal_data_access((v_out ->> 'client_id')::uuid, 'LEGAL_CASE', v_case,
                                                'VIEW_DETAIL', 'Trabalho no computador do escritório');
  end if;
  return v_out;
end
$$;

create or replace function private.executor_get_process(
  p_token_hash text, p_agent_run_id uuid, p_lease_hash text, p_legal_process_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return private.worker_get_process(p_agent_run_id,
    private.executor_lease(p_token_hash, p_agent_run_id, p_lease_hash, 'case.read'), p_legal_process_id, 50);
end
$$;

-- Documentos do caso, última versão de cada um, com o checksum para conferir
-- o download.
create or replace function private.executor_list_documents(p_token_hash text, p_agent_run_id uuid, p_lease_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope record;
begin
  select * into v_scope from private.worker_scope(p_agent_run_id,
    private.executor_lease(p_token_hash, p_agent_run_id, p_lease_hash, 'documents.read'));
  if v_scope.legal_case_id is null then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'document_id', d.id, 'title', d.title, 'category', d.category::text, 'visibility', d.visibility,
      'version_id', v.id, 'version_number', v.version_number, 'filename', v.original_filename,
      'mime_type', v.mime_type, 'size', v.file_size, 'checksum_sha256', v.checksum_sha256,
      'source', v.source, 'created_at', v.created_at) order by d.category, d.title)
    from public.case_documents cd
    join public.documents d on d.id = cd.document_id and d.deleted_at is null
    join lateral (select x.* from public.document_versions x where x.document_id = d.id
                  order by x.version_number desc limit 1) v on true
    where cd.legal_case_id = v_scope.legal_case_id), '[]'::jsonb);
end
$$;

-- Abre uma versão do caso (para o servidor assinar o download) e registra
-- QUAL versão foi processada.
create or replace function private.executor_open_document(
  p_token_hash text, p_agent_run_id uuid, p_lease_hash text, p_document_version_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_by  text := private.executor_lease(p_token_hash, p_agent_run_id, p_lease_hash, 'documents.read');
  v_doc record;
  v_sum text;
  v_ex  uuid;
begin
  select * into v_doc from private.worker_open_document(p_agent_run_id, v_by, p_document_version_id);
  if v_doc.storage_object_name is null then
    raise exception 'Documento não pertence ao caso deste trabalho' using errcode = 'P0002';
  end if;
  select v.checksum_sha256 into v_sum from public.document_versions v where v.id = p_document_version_id;
  select r.executor_id into v_ex from public.agent_runs r where r.id = p_agent_run_id;
  insert into public.agent_run_events (agent_run_id, kind, message, document_version_id, checksum_sha256, executor_id)
  values (p_agent_run_id, 'DOCUMENT_OPENED', left(v_doc.title, 200), p_document_version_id, v_sum, v_ex);
  return jsonb_build_object(
    'storage_object_name', v_doc.storage_object_name, 'filename', v_doc.original_filename,
    'size', v_doc.file_size, 'mime_type', v_doc.mime_type, 'checksum_sha256', v_sum,
    'document_id', v_doc.document_id, 'title', v_doc.title, 'category', v_doc.category,
    'version_number', v_doc.version_number);
end
$$;

-- Teses autorizadas (agente + modelo de análise), versão vigente.
create or replace function private.executor_list_theses(p_token_hash text, p_agent_run_id uuid, p_lease_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope record;
begin
  select * into v_scope from private.worker_scope(p_agent_run_id,
    private.executor_lease(p_token_hash, p_agent_run_id, p_lease_hash, 'knowledge.read'));
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', t.id, 'version_id', v.id, 'slug', t.slug, 'title', t.title, 'description', t.description,
      'version', v.version_number, 'foundations', v.foundations,
      'application_criteria', v.application_criteria, 'exclusion_criteria', v.exclusion_criteria,
      'notes', v.notes) order by t.title)
    from public.legal_theses t
    join public.legal_thesis_versions v on v.id = t.current_version_id
    where t.status = 'ACTIVE' and t.deleted_at is null
      and (exists (select 1 from public.agent_thesis_bindings b
                   where b.agent_id = v_scope.agent_id and b.legal_thesis_id = t.id and b.enabled)
           or exists (select 1 from public.legal_analyses an
                      join public.analysis_template_thesis_bindings tb on tb.analysis_template_id = an.analysis_template_id
                      where an.agent_run_id = p_agent_run_id and tb.legal_thesis_id = t.id))), '[]'::jsonb);
end
$$;

-- Referências autorizadas. Texto vem inline; arquivo vem como objeto do
-- Storage (bucket reference-materials) para o servidor assinar.
create or replace function private.executor_list_references(
  p_token_hash text, p_agent_run_id uuid, p_lease_hash text, p_reference_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope record;
begin
  select * into v_scope from private.worker_scope(p_agent_run_id,
    private.executor_lease(p_token_hash, p_agent_run_id, p_lease_hash, 'knowledge.read'));
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'version_id', v.id, 'type', r.type, 'title', r.title, 'description', r.description,
      'content_text', case when p_reference_id is not null then v.content_text end,
      'storage_object_name', case when p_reference_id is not null then v.storage_object_name end,
      'has_text', v.content_text is not null, 'has_file', v.storage_object_name is not null,
      'mime_type', v.metadata ->> 'mime_type', 'filename', v.metadata ->> 'original_filename') order by r.title)
    from public.reference_materials r
    join public.reference_material_versions v on v.id = r.current_version_id
    where r.status = 'ACTIVE' and r.deleted_at is null
      and (p_reference_id is null or r.id = p_reference_id)
      and exists (select 1 from public.agent_reference_bindings b
                  where b.agent_id = v_scope.agent_id and b.reference_material_id = r.id and b.enabled)), '[]'::jsonb);
end
$$;

create or replace function private.executor_submit_analysis(
  p_token_hash text, p_agent_run_id uuid, p_lease_hash text, p_summary text, p_result jsonb,
  p_schema_version integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_by  text := private.executor_lease(p_token_hash, p_agent_run_id, p_lease_hash, 'analysis.submit', true);
  v_out record;
begin
  if nullif(btrim(coalesce(p_summary, '')), '') is null or length(p_summary) > 4000 then
    raise exception 'Resumo da análise é obrigatório (até 4000 caracteres)' using errcode = '22023';
  end if;
  select * into v_out from private.worker_submit_analysis_result(p_agent_run_id, v_by, p_summary, p_result, p_schema_version);
  if v_out.created then
    insert into public.agent_run_events (agent_run_id, kind, message, executor_id)
    select p_agent_run_id, 'OUTPUT', 'Resultado da análise entregue', r.executor_id
    from public.agent_runs r where r.id = p_agent_run_id;
  end if;
  return jsonb_build_object('result_id', v_out.result_id, 'review_id', v_out.review_id, 'created', v_out.created);
end
$$;

-- Propostas: tudo que altera dado relevante passa por um humano. Tipos
-- estruturais (agente, skill) nunca vêm do executor.
create or replace function private.executor_create_proposal(
  p_token_hash text, p_agent_run_id uuid, p_lease_hash text, p_proposal_type text, p_payload jsonb,
  p_idempotency_key text, p_priority text default 'NORMAL', p_legal_process_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_by  text := private.executor_lease(p_token_hash, p_agent_run_id, p_lease_hash, 'proposals.create', true);
  v_out record;
begin
  if p_proposal_type not in ('CREATE_DEADLINE', 'REQUEST_DOCUMENT', 'UPDATE_CASE', 'CREATE_PROCESS', 'OTHER') then
    raise exception 'Tipo de proposta não permitido ao computador: %', p_proposal_type using errcode = '22023';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' or pg_column_size(p_payload) > 65536 then
    raise exception 'Proposta precisa ser um objeto de até 64 KB' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_payload ->> 'summary', '')), '') is null then
    raise exception 'Proposta precisa de um resumo (summary)' using errcode = '22023';
  end if;
  if p_priority not in ('LOW', 'NORMAL', 'HIGH', 'URGENT') then
    raise exception 'Prioridade inválida' using errcode = '22023';
  end if;
  select * into v_out from private.worker_create_proposal(p_agent_run_id, v_by, p_proposal_type, p_payload,
                                                          p_idempotency_key, p_priority, p_legal_process_id);
  if v_out.created then
    insert into public.agent_run_events (agent_run_id, kind, message, executor_id)
    select p_agent_run_id, 'OUTPUT', 'Proposta: ' || left(p_payload ->> 'summary', 180), r.executor_id
    from public.agent_runs r where r.id = p_agent_run_id;
  end if;
  return jsonb_build_object('proposal_id', v_out.proposal_id, 'created', v_out.created);
end
$$;

-- Minuta, passo 1: reserva identificadores e o caminho no Storage. Nada é
-- gravado ainda; o servidor assina o envio para este caminho.
create or replace function private.executor_prepare_output(
  p_token_hash text, p_agent_run_id uuid, p_lease_hash text, p_filename text, p_mime_type text, p_size bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope record;
  v_doc   uuid := gen_random_uuid();
  v_ver   uuid := gen_random_uuid();
begin
  select * into v_scope from private.worker_scope(p_agent_run_id,
    private.executor_lease(p_token_hash, p_agent_run_id, p_lease_hash, 'drafts.submit', true));
  if v_scope.legal_case_id is null then
    raise exception 'Minuta só em trabalho ligado a um caso' using errcode = '23514';
  end if;
  if nullif(btrim(coalesce(p_filename, '')), '') is null or length(p_filename) > 200 then
    raise exception 'Nome de arquivo inválido' using errcode = '22023';
  end if;
  if p_mime_type not in ('application/pdf',
                         'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                         'text/plain', 'text/csv') then
    raise exception 'Tipo de arquivo não aceito para minuta: %', p_mime_type using errcode = '22023';
  end if;
  if p_size is null or p_size <= 0 or p_size > 52428800 then
    raise exception 'Arquivo vazio ou maior que 50 MB' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'document_id', v_doc, 'document_version_id', v_ver,
    'storage_object_name', private.legal_document_object_name(v_scope.client_id, v_doc, v_ver, p_filename));
end
$$;

-- Minuta, passo 2: o arquivo já está no Storage. Confere o caminho (não dá
-- para apontar para outro cliente), cria versão INTERNA + revisão pendente.
-- Repetir com os mesmos ids devolve o mesmo resultado.
create or replace function private.executor_finalize_output(
  p_token_hash text, p_agent_run_id uuid, p_lease_hash text,
  p_document_id uuid, p_document_version_id uuid, p_storage_object_name text, p_filename text,
  p_mime_type text, p_size bigint, p_checksum_sha256 text, p_title text, p_category text, p_description text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_by     text := private.executor_lease(p_token_hash, p_agent_run_id, p_lease_hash, 'drafts.submit', true);
  v_scope  record;
  v_number integer;
begin
  select * into v_scope from private.worker_scope(p_agent_run_id, v_by);
  select v.version_number into v_number from public.document_versions v
  where v.id = p_document_version_id and v.document_id = p_document_id;
  if v_number is not null then
    return jsonb_build_object('document_id', p_document_id, 'document_version_id', p_document_version_id,
                              'version_number', v_number, 'created', false);
  end if;
  if v_scope.client_id is null
     or p_storage_object_name is distinct from
        private.legal_document_object_name(v_scope.client_id, p_document_id, p_document_version_id, p_filename) then
    raise exception 'Caminho do arquivo não corresponde a este trabalho' using errcode = '42501';
  end if;
  if not exists (select 1 from storage.objects o
                 where o.bucket_id = 'legal-documents' and o.name = p_storage_object_name) then
    raise exception 'Arquivo ainda não chegou ao Storage' using errcode = 'P0002';
  end if;
  if p_checksum_sha256 is null or p_checksum_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Checksum SHA-256 obrigatório' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_title, '')), '') is null or length(p_title) > 200 then
    raise exception 'Título da minuta obrigatório (até 200 caracteres)' using errcode = '22023';
  end if;
  v_number := private.worker_deliver_document(p_agent_run_id, v_by, p_document_id, true, p_document_version_id,
    p_category, btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''), p_storage_object_name,
    p_filename, p_mime_type, p_size, p_checksum_sha256);
  insert into public.agent_run_events (agent_run_id, kind, message, document_version_id, checksum_sha256, executor_id)
  select p_agent_run_id, 'OUTPUT', 'Minuta: ' || left(btrim(p_title), 180), p_document_version_id, p_checksum_sha256,
         r.executor_id
  from public.agent_runs r where r.id = p_agent_run_id;
  return jsonb_build_object('document_id', p_document_id, 'document_version_id', p_document_version_id,
                            'version_number', v_number, 'created', true);
end
$$;

-- Registro técnico da execução (sem conteúdo, sem prompt): versões e perfil.
create or replace function private.executor_record_config(
  p_token_hash text, p_agent_run_id uuid, p_lease_hash text, p_snapshot jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  return private.worker_record_run_config(p_agent_run_id,
    private.executor_lease(p_token_hash, p_agent_run_id, p_lease_hash, 'jobs.claim'), p_snapshot);
end
$$;

-- Fim técnico. Com entrega pendente: aguardando decisão humana. Análise sem
-- resultado não "conclui": falha. Interrupção pedida: cancelada.
create or replace function private.executor_complete(
  p_token_hash text, p_agent_run_id uuid, p_lease_hash text, p_report jsonb default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_by      text := private.executor_lease(p_token_hash, p_agent_run_id, p_lease_hash, 'jobs.claim');
  v_run     record;
  v_status  text;
  v_code    text;
  v_msg     text;
  v_report  jsonb;
begin
  select r.queue_msg_id, r.cancel_requested_at,
         exists (select 1 from public.legal_analyses a where a.agent_run_id = r.id) as is_analysis,
         exists (select 1 from public.legal_analysis_results x where x.agent_run_id = r.id) as has_result,
         exists (select 1 from public.agent_proposals p where p.agent_run_id = r.id)
           or exists (select 1 from public.legal_analysis_results x where x.agent_run_id = r.id)
           or jsonb_array_length(coalesce(r.metadata -> 'documents', '[]'::jsonb)) > 0 as has_output
    into v_run
  from public.agent_runs r where r.id = p_agent_run_id;

  -- Só números e versões; nada de conteúdo.
  select coalesce(jsonb_object_agg(k, p_report -> k), '{}'::jsonb) into v_report
  from jsonb_object_keys(coalesce(p_report, '{}'::jsonb)) k
  where k in ('client_version', 'claude_code_version', 'duration_ms', 'documents_downloaded', 'mode');

  if v_run.cancel_requested_at is not null then
    v_status := 'CANCELLED';
  elsif v_run.is_analysis and not v_run.has_result then
    v_status := 'FAILED';
    v_code := 'NO_ANALYSIS_RESULT';
    v_msg := 'O trabalho terminou sem entregar o resultado da análise.';
  elsif v_run.has_output and private.agent_run_has_pending_outputs(p_agent_run_id) then
    v_status := 'WAITING_HUMAN';
  else
    v_status := 'COMPLETED';
  end if;

  perform private.worker_finish_run(p_agent_run_id, v_by, v_status, v_code, v_msg, null, null, null, null,
                                    jsonb_build_object('executor', v_report));
  update public.agent_runs set lease_token_hash = null,
         progress_message = case v_status when 'WAITING_HUMAN' then 'Aguardando revisão humana'
                                          when 'COMPLETED' then 'Concluído'
                                          when 'CANCELLED' then 'Interrompido a pedido'
                                          else 'Falhou' end,
         progress_at = now()
   where id = p_agent_run_id;
  if v_run.queue_msg_id is not null then
    perform pgmq.archive('agent_execution', v_run.queue_msg_id);
  end if;
  return jsonb_build_object('status', v_status, 'error_code', v_code);
end
$$;

-- Falha informada pelo computador. Transitória e sem entrega: volta à fila
-- (até 3 tentativas). Senão: falhou. Mensagem curta e sem dado do cliente.
create or replace function private.executor_fail(
  p_token_hash text, p_agent_run_id uuid, p_lease_hash text, p_error_code text, p_message text,
  p_retryable boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_by     text := private.executor_lease(p_token_hash, p_agent_run_id, p_lease_hash, 'jobs.claim');
  v_run    record;
  v_status text;
  v_code   text;
begin
  if p_error_code not in ('MISSING_INPUT', 'DOCUMENT_CHECKSUM_MISMATCH', 'DOCUMENT_UNREADABLE', 'INVALID_OUTPUT',
                          'TOOL_ERROR', 'AGENT_NOT_FOUND', 'AGENT_ERROR', 'CONFIGURATION_ERROR', 'INTERRUPTED',
                          'INTERNAL_ERROR') then
    raise exception 'Código de erro desconhecido: %', p_error_code using errcode = '22023';
  end if;
  select r.queue_msg_id, r.attempt, r.cancel_requested_at,
         exists (select 1 from public.agent_proposals p where p.agent_run_id = r.id)
           or exists (select 1 from public.legal_analysis_results x where x.agent_run_id = r.id)
           or jsonb_array_length(coalesce(r.metadata -> 'documents', '[]'::jsonb)) > 0 as has_output
    into v_run
  from public.agent_runs r where r.id = p_agent_run_id;

  if v_run.cancel_requested_at is not null then
    perform private.worker_finish_run(p_agent_run_id, v_by, 'CANCELLED');
    v_status := 'CANCELLED';
  elsif coalesce(p_retryable, false) and not v_run.has_output and v_run.attempt < 3 then
    update public.agent_runs
       set status = 'QUEUED', claimed_by = null, lease_token_hash = null,
           error_code = p_error_code, error_message = left(p_message, 2000),
           progress_message = 'De volta à fila', progress_at = now()
     where id = p_agent_run_id;
    if v_run.queue_msg_id is not null then
      perform pgmq.set_vt('agent_execution', v_run.queue_msg_id, 30);
    end if;
    return jsonb_build_object('status', 'QUEUED', 'error_code', p_error_code);
  else
    v_code := case when v_run.has_output then 'PARTIAL_OUTPUT' else p_error_code end;
    perform private.worker_finish_run(p_agent_run_id, v_by, 'FAILED', v_code,
      case when v_run.has_output then 'Falhou depois de entregar parte do resultado: ' else '' end || left(p_message, 1800));
    v_status := 'FAILED';
  end if;

  update public.agent_runs set lease_token_hash = null, progress_at = now(),
         progress_message = case v_status when 'CANCELLED' then 'Interrompido a pedido' else 'Falhou' end
   where id = p_agent_run_id;
  if v_run.queue_msg_id is not null then
    perform pgmq.archive('agent_execution', v_run.queue_msg_id);
  end if;
  return jsonb_build_object('status', v_status, 'error_code', v_code);
end
$$;

-- Devolver sem executar (a pessoa desistiu, sessão vai fechar): volta à fila
-- sem gastar tentativa. Só antes de qualquer entrega.
create or replace function private.executor_release(p_token_hash text, p_agent_run_id uuid, p_lease_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_by  text := private.executor_lease(p_token_hash, p_agent_run_id, p_lease_hash, 'jobs.claim');
  v_run record;
begin
  select r.queue_msg_id, r.cancel_requested_at,
         exists (select 1 from public.agent_proposals p where p.agent_run_id = r.id)
           or exists (select 1 from public.legal_analysis_results x where x.agent_run_id = r.id)
           or jsonb_array_length(coalesce(r.metadata -> 'documents', '[]'::jsonb)) > 0 as has_output
    into v_run
  from public.agent_runs r where r.id = p_agent_run_id;
  if v_run.has_output then
    raise exception 'O trabalho já entregou algo: conclua em vez de devolver' using errcode = '23514';
  end if;
  if v_run.cancel_requested_at is not null then
    perform private.worker_finish_run(p_agent_run_id, v_by, 'CANCELLED');
    update public.agent_runs set lease_token_hash = null where id = p_agent_run_id;
    if v_run.queue_msg_id is not null then
      perform pgmq.archive('agent_execution', v_run.queue_msg_id);
    end if;
    return jsonb_build_object('status', 'CANCELLED');
  end if;
  update public.agent_runs
     set status = 'QUEUED', claimed_by = null, lease_token_hash = null, attempt = greatest(attempt - 1, 0),
         progress_message = 'Devolvido à fila', progress_at = now()
   where id = p_agent_run_id;
  if v_run.queue_msg_id is not null then
    perform pgmq.set_vt('agent_execution', v_run.queue_msg_id, 0);
  end if;
  return jsonb_build_object('status', 'QUEUED');
end
$$;

-- ═════════════════════════════ 5. manutenção ════════════════════════════

-- Computador que parou de responder (reserva sem renovação há 5 min): volta
-- à fila; na 3ª tentativa, falha. Interrupção pedida: cancela.
create or replace function private.expire_executor_leases()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select x.id, x.attempt, x.queue_msg_id, x.cancel_requested_at,
           exists (select 1 from public.agent_proposals p where p.agent_run_id = x.id)
             or exists (select 1 from public.legal_analysis_results y where y.agent_run_id = x.id)
             or jsonb_array_length(coalesce(x.metadata -> 'documents', '[]'::jsonb)) > 0 as has_output
    from public.agent_runs x
    where x.status = 'RUNNING' and x.heartbeat_at < now() - interval '300 seconds'
    order by x.heartbeat_at
    limit 100
    for update skip locked
  loop
    perform set_config('dg.agent_run_id', r.id::text, true);
    if r.cancel_requested_at is not null then
      update public.agent_runs set status = 'CANCELLED', lease_token_hash = null where id = r.id;
      if r.queue_msg_id is not null then perform pgmq.archive('agent_execution', r.queue_msg_id); end if;
    elsif r.has_output then
      -- Já entregou algo: refazer duplicaria a entrega. O que chegou segue em Revisões.
      update public.agent_runs
         set status = 'FAILED', completed_at = now(), lease_token_hash = null,
             error_code = 'PARTIAL_OUTPUT',
             error_message = 'O computador do escritório parou de responder depois de entregar parte do resultado.',
             progress_message = 'Falhou', progress_at = now()
       where id = r.id;
      if r.queue_msg_id is not null then perform pgmq.archive('agent_execution', r.queue_msg_id); end if;
    elsif r.attempt >= 3 then
      update public.agent_runs
         set status = 'FAILED', completed_at = now(), lease_token_hash = null,
             error_code = 'EXECUTOR_UNAVAILABLE',
             error_message = 'O computador do escritório parou de responder em 3 tentativas.',
             progress_message = 'Falhou', progress_at = now()
       where id = r.id;
      if r.queue_msg_id is not null then perform pgmq.archive('agent_execution', r.queue_msg_id); end if;
    else
      update public.agent_runs
         set status = 'QUEUED', claimed_by = null, lease_token_hash = null,
             error_code = 'LEASE_EXPIRED',
             error_message = 'O computador do escritório parou de responder; o trabalho voltou para a fila.',
             progress_message = 'De volta à fila', progress_at = now()
       where id = r.id;
      if r.queue_msg_id is not null then perform pgmq.set_vt('agent_execution', r.queue_msg_id, 0); end if;
    end if;
    n := n + 1;
  end loop;
  perform set_config('dg.agent_run_id', '', true);
  return n;
end
$$;

-- O que o worker fazia sem IA, agora no banco: propostas decididas por
-- humanos viram fato (efeito único), execuções decididas fecham, reservas
-- vencidas voltam à fila.
create or replace function private.maintenance_tick()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_applied integer := 0;
  v_failed  integer := 0;
  v_row     record;
  i         integer;
begin
  for i in 1..25 loop
    select * into v_row from private.worker_apply_next_proposal('pg_cron');
    exit when v_row.proposal_id is null;
    if v_row.status = 'FAILED' then v_failed := v_failed + 1; else v_applied := v_applied + 1; end if;
  end loop;
  perform set_config('dg.agent_run_id', '', true);
  perform set_config('dg.request_id', '', true);
  return jsonb_build_object(
    'proposals', v_applied, 'proposals_failed', v_failed,
    'closed_runs', private.worker_close_decided_runs(),
    'expired_leases', private.expire_executor_leases());
end
$$;

-- ═════════════════════════════ 6. agente → agente local ═════════════════

-- Configuração aceita a chave nova local_agent (nome do agente no Claude
-- Code). As chaves antigas continuam válidas para o histórico das versões.
create or replace function private.dg_validate_agent_configuration(p_conf jsonb)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  k text;
begin
  if p_conf is null or jsonb_typeof(p_conf) <> 'object' then
    raise exception 'Configuração do agente precisa ser um objeto' using errcode = '22023';
  end if;
  for k in select jsonb_object_keys(p_conf) loop
    if k not in ('local_agent', 'model', 'effort', 'max_turns', 'max_tool_calls', 'max_duration_seconds',
                 'max_budget_usd', 'code_execution', 'tools', 'max_output_tokens') then
      raise exception 'Configuração do agente: campo desconhecido "%"', k using errcode = '22023';
    end if;
  end loop;
  if p_conf ? 'local_agent' and (jsonb_typeof(p_conf -> 'local_agent') <> 'string'
                                 or p_conf ->> 'local_agent' !~ '^[a-z0-9][a-z0-9-]{0,63}$') then
    raise exception 'Configuração do agente: nome do agente local inválido (minúsculas, números e hífen)' using errcode = '22023';
  end if;
  if p_conf ? 'model' and (jsonb_typeof(p_conf -> 'model') <> 'string' or p_conf ->> 'model' !~ '^claude-[a-z0-9-]{2,60}$') then
    raise exception 'Configuração do agente: modelo inválido' using errcode = '22023';
  end if;
  if p_conf ? 'effort' and p_conf ->> 'effort' not in ('low', 'medium', 'high', 'xhigh', 'max') then
    raise exception 'Configuração do agente: esforço inválido' using errcode = '22023';
  end if;
  if p_conf ? 'code_execution' and jsonb_typeof(p_conf -> 'code_execution') <> 'boolean' then
    raise exception 'Configuração do agente: code_execution precisa ser verdadeiro ou falso' using errcode = '22023';
  end if;
  if p_conf ? 'tools' and jsonb_typeof(p_conf -> 'tools') <> 'array' then
    raise exception 'Configuração do agente: tools precisa ser lista' using errcode = '22023';
  end if;
  if (p_conf ? 'max_turns' and ((p_conf ->> 'max_turns')::numeric not between 1 and 200))
     or (p_conf ? 'max_tool_calls' and ((p_conf ->> 'max_tool_calls')::numeric not between 1 and 500))
     or (p_conf ? 'max_duration_seconds' and ((p_conf ->> 'max_duration_seconds')::numeric not between 30 and 3600))
     or (p_conf ? 'max_budget_usd' and ((p_conf ->> 'max_budget_usd')::numeric <= 0 or (p_conf ->> 'max_budget_usd')::numeric > 50))
     or (p_conf ? 'max_output_tokens' and ((p_conf ->> 'max_output_tokens')::numeric not between 1024 and 128000)) then
    raise exception 'Configuração do agente: limite fora da faixa permitida' using errcode = '22023';
  end if;
end
$$;

-- Detalhe da execução: o de 039 mais computador, progresso e linha do tempo.
create or replace function private.get_agent_run_detail(p_agent_run_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_admin boolean;
  v_run   record;
begin
  if auth.uid() is null or not exists (select 1 from private.current_membership()) then
    raise exception 'Sem sessão liberada' using errcode = '42501';
  end if;
  if not private.has_internal_role('ADMIN', 'LAWYER') then
    raise exception 'Execuções de agente são visíveis só a ADMIN e LAWYER' using errcode = '42501';
  end if;
  v_admin := private.is_admin();

  select r.*, a.name as agent_name, a.slug as agent_slug, e.name as executor_name into v_run
  from public.agent_runs r
  join public.agents a on a.id = r.agent_id
  left join public.executors e on e.id = r.executor_id
  where r.id = p_agent_run_id;
  if v_run.id is null
     or (not v_admin and (v_run.legal_case_id is null or not private.can_access_case(v_run.legal_case_id))) then
    raise exception 'Execução não encontrada' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'id', v_run.id,
    'agent', jsonb_build_object('id', v_run.agent_id, 'name', v_run.agent_name, 'slug', v_run.agent_slug),
    'status', v_run.status,
    'cancel_requested', v_run.cancel_requested_at is not null,
    'error_code', v_run.error_code,
    'attempt', v_run.attempt,
    'legal_case_id', v_run.legal_case_id,
    'legal_process_id', v_run.legal_process_id,
    'created_at', v_run.created_at,
    'started_at', v_run.started_at,
    'completed_at', v_run.completed_at,
    'retry_of_agent_run_id', v_run.retry_of_agent_run_id,
    'retried_by', coalesce((select jsonb_agg(x.id order by x.created_at) from public.agent_runs x
                            where x.retry_of_agent_run_id = v_run.id), '[]'::jsonb),
    'analysis_id', (select a.id from public.legal_analyses a where a.agent_run_id = v_run.id limit 1),
    'executor', case when v_run.executor_id is not null then jsonb_build_object('name', v_run.executor_name) end,
    'progress', case when v_run.progress_message is not null
                     then jsonb_build_object('message', v_run.progress_message, 'at', v_run.progress_at) end,
    'events', coalesce((select jsonb_agg(jsonb_build_object(
        'kind', ev.kind, 'from', ev.from_status, 'to', ev.to_status, 'message', ev.message,
        'document_version_id', ev.document_version_id, 'at', ev.created_at) order by ev.id)
      from (select * from public.agent_run_events x where x.agent_run_id = v_run.id order by x.id desc limit 200) ev),
      '[]'::jsonb),
    'proposals', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'type', p.proposal_type, 'status', p.status, 'summary', p.payload ->> 'summary',
        'review_id', (select rv.id from public.reviews rv where rv.agent_proposal_id = p.id order by rv.created_at desc limit 1),
        'application_error', case when v_admin then p.application_error end) order by p.created_at)
      from public.agent_proposals p where p.agent_run_id = v_run.id), '[]'::jsonb),
    'documents', coalesce((select jsonb_agg(jsonb_build_object(
        'version_id', v.id, 'document_id', d.id, 'title', d.title, 'version_number', v.version_number,
        'review_id', rv.id, 'review_status', rv.status) order by v.created_at)
      from jsonb_array_elements_text(coalesce(v_run.metadata -> 'documents', '[]'::jsonb)) dv(version_id)
      join public.document_versions v on v.id = dv.version_id::uuid
      join public.documents d on d.id = v.document_id
      left join lateral (select x.id, x.status from public.reviews x where x.document_version_id = v.id
                         order by x.created_at desc limit 1) rv on true), '[]'::jsonb),
    'analysis_result', (select jsonb_build_object('id', lr.id, 'summary', lr.summary,
        'review_id', rv.id, 'review_status', rv.status)
      from public.legal_analysis_results lr
      left join lateral (select x.id, x.status from public.reviews x where x.legal_analysis_result_id = lr.id
                         order by x.created_at desc limit 1) rv on true
      where lr.agent_run_id = v_run.id),
    'usage', case when v_admin then jsonb_build_object(
        'provider', v_run.provider, 'model', v_run.model,
        'input_tokens', v_run.input_tokens, 'output_tokens', v_run.output_tokens,
        'estimated_cost', v_run.estimated_cost, 'currency', v_run.estimated_cost_currency,
        'details', v_run.metadata -> 'usage', 'tools_used', v_run.metadata -> 'tools_used',
        'executor_report', v_run.metadata -> 'executor',
        'error_message', v_run.error_message) end,
    'config', case when v_admin then v_run.config_snapshot end
  );
end
$$;

-- Execuções novas são do computador do escritório.
alter table public.agent_runs alter column provider set default 'CLAUDE_CODE';

comment on table public.ai_runtime_settings is
  'Interruptor geral da execução pelo computador do escritório (linha única). Desligado: nenhum trabalho novo é reservado; pedidos ficam na fila.';

-- ═════════════════════════════ 7. congelamento (Claude API) ═════════════
-- O registro de skill no provedor era do worker, que saiu. Tabelas e dados
-- ficam (histórico). Skills passam a morar no Claude Code; a tela deixa de
-- enviar arquivos, mas a RPC da 039 continua válida (sem mudança de contrato).

revoke execute on function private.worker_register_skill_upload(uuid, text, uuid, text, text, text, text) from dg_worker;

-- ═════════════════════════════ 8. agendamento (pg_cron) ═════════════════
-- No Supabase o pg_cron existe e é habilitado aqui. Nos testes locais
-- (PGlite) a simulação traz um cron.schedule de mentira. Sem nenhum dos dois,
-- a manutenção pode ser chamada à mão: select private.maintenance_tick().

do $$
begin
  if to_regnamespace('cron') is null
     and exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
  end if;
  if to_regnamespace('cron') is not null then
    perform cron.schedule('dg-manutencao', '* * * * *', 'select private.maintenance_tick()');
    perform cron.schedule('dg-lembretes-de-prazo', '*/15 * * * *', 'select private.notify_deadline_reminders()');
  else
    raise notice 'pg_cron indisponível: agende private.maintenance_tick() a cada minuto';
  end if;
end
$$;

-- ═════════════════════════════ 9. grants ════════════════════════════════

do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname in ('executors_validate', 'agent_runs_log_status', 'dg_create_executor', 'dg_revoke_executor',
                        'get_executor_status', 'executor_require', 'executor_lease', 'executor_authenticate',
                        'executor_list_jobs', 'executor_context_of', 'executor_claim', 'executor_job_context',
                        'executor_heartbeat', 'executor_get_case', 'executor_get_process', 'executor_list_documents',
                        'executor_open_document', 'executor_list_theses', 'executor_list_references',
                        'executor_submit_analysis', 'executor_create_proposal', 'executor_prepare_output',
                        'executor_finalize_output', 'executor_record_config', 'executor_complete', 'executor_fail',
                        'executor_release', 'expire_executor_leases', 'maintenance_tick',
                        'dg_validate_agent_configuration', 'get_agent_run_detail')
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
  end loop;
end
$$;

-- Tela (usuário logado; cada função confere o papel).
grant execute on function private.dg_create_executor(text, text, text) to authenticated;
grant execute on function private.dg_revoke_executor(uuid) to authenticated;
grant execute on function private.get_executor_status() to authenticated;
grant execute on function private.get_agent_run_detail(uuid) to authenticated;
grant execute on function private.dg_validate_agent_configuration(jsonb) to authenticated;

create or replace function public.dg_create_executor(p_name text, p_token_hash text, p_token_prefix text)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.dg_create_executor(p_name, p_token_hash, p_token_prefix) $$;

create or replace function public.dg_revoke_executor(p_executor_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.dg_revoke_executor(p_executor_id) $$;

create or replace function public.get_executor_status()
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.get_executor_status() $$;

revoke all on function public.dg_create_executor(text, text, text) from public, anon, service_role;
revoke all on function public.dg_revoke_executor(uuid) from public, anon, service_role;
revoke all on function public.get_executor_status() from public, anon, service_role;
grant execute on function public.dg_create_executor(text, text, text) to authenticated;
grant execute on function public.dg_revoke_executor(uuid) to authenticated;
grant execute on function public.get_executor_status() to authenticated;

-- Servidor do DG Brasil (login dg_worker): só as portas do executor.
grant execute on function private.executor_authenticate(text, text) to dg_worker;
grant execute on function private.executor_list_jobs(text, integer) to dg_worker;
grant execute on function private.executor_claim(text, uuid, text) to dg_worker;
grant execute on function private.executor_job_context(text, uuid, text) to dg_worker;
grant execute on function private.executor_heartbeat(text, uuid, text, text) to dg_worker;
grant execute on function private.executor_get_case(text, uuid, text) to dg_worker;
grant execute on function private.executor_get_process(text, uuid, text, uuid) to dg_worker;
grant execute on function private.executor_list_documents(text, uuid, text) to dg_worker;
grant execute on function private.executor_open_document(text, uuid, text, uuid) to dg_worker;
grant execute on function private.executor_list_theses(text, uuid, text) to dg_worker;
grant execute on function private.executor_list_references(text, uuid, text, uuid) to dg_worker;
grant execute on function private.executor_submit_analysis(text, uuid, text, text, jsonb, integer) to dg_worker;
grant execute on function private.executor_create_proposal(text, uuid, text, text, jsonb, text, text, uuid) to dg_worker;
grant execute on function private.executor_prepare_output(text, uuid, text, text, text, bigint) to dg_worker;
grant execute on function private.executor_finalize_output(text, uuid, text, uuid, uuid, text, text, text, bigint, text, text, text, text) to dg_worker;
grant execute on function private.executor_record_config(text, uuid, text, jsonb) to dg_worker;
grant execute on function private.executor_complete(text, uuid, text, jsonb) to dg_worker;
grant execute on function private.executor_fail(text, uuid, text, text, text, boolean) to dg_worker;
grant execute on function private.executor_release(text, uuid, text) to dg_worker;
