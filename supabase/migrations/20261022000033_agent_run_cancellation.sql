-- 033 — Interromper análise / execução de agente com segurança (Etapa 4.3.1)
--
-- Antes: o ADMIN gravava status = 'CANCELLED' direto (política
-- agent_runs_cancel_admin), inclusive numa execução RUNNING — o worker seguia
-- rodando sem saber, e a análise ligada à execução ficava presa em "na fila"
-- ou "em análise" para sempre (nada sincronizava análise ← execução).
--
-- Agora (sem enum novo: a máquina de estados de agent_runs continua a mesma):
--
--   QUEUED         → CANCELLED na hora; a mensagem da fila é arquivada (o
--                    worker já não reservaria: claim só pega QUEUED).
--   RUNNING        → pedido de cancelamento (cancel_requested_at/by). O worker
--                    confere antes e durante o trabalho
--                    (private.worker_cancel_requested) e confirma com
--                    worker_finish_run(..., 'CANCELLED') — só aceito com pedido.
--                    Reserva de worker morto (batimento parado) com pedido vira
--                    CANCELLED em vez de ser retomada; nova tentativa
--                    (requeue) com pedido também vira CANCELLED.
--   WAITING_HUMAN  → só ADMIN cancela (comportamento anterior); LAWYER decide
--                    em Revisões.
--   encerrada      → recusado; repetir o pedido é idempotente (mesmo resultado).
--
-- Quem: ADMIN (qualquer execução) ou LAWYER (execução de caso que acessa).
-- ASSISTANT e parceiros, não. Tudo auditado (pedido: AGENT_RUN_CANCEL_REQUESTED;
-- mudança de estado: AGENT_RUN_CANCELLED pela trilha de linha).
--
-- Análise ← execução: um gatilho mantém legal_analyses coerente com a execução
-- ligada a ela (fila, rodando, aguardando revisão, concluída, falhou,
-- interrompida). Antes não existia: a análise nunca saía de QUEUED.

alter table public.agent_runs
  add column cancel_requested_at timestamptz,
  add column cancel_requested_by uuid references public.profiles (id) on delete restrict;

alter table public.agent_runs
  add constraint agent_runs_cancel_request_consistent
    check ((cancel_requested_at is null) = (cancel_requested_by is null));

comment on column public.agent_runs.cancel_requested_at is
  'Pedido de interrupção (RUNNING): o worker confere e confirma CANCELLED. Uma vez feito, não se desfaz.';

-- O pedido não se desfaz nem muda de autor.
create or replace function private.agent_runs_cancel_request_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.cancel_requested_at is not null
     and (new.cancel_requested_at is distinct from old.cancel_requested_at
          or new.cancel_requested_by is distinct from old.cancel_requested_by) then
    raise exception 'Pedido de interrupção não se desfaz' using errcode = '23514';
  end if;
  if new.cancel_requested_at is not null and old.cancel_requested_at is null
     and old.status in ('COMPLETED', 'FAILED', 'CANCELLED') then
    raise exception 'Execução já encerrada' using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger agent_runs_cancel_request_guard
  before update on public.agent_runs
  for each row execute function private.agent_runs_cancel_request_guard();

-- RUNNING não é mais cancelado por UPDATE direto: só pelo pedido (abaixo), que
-- o worker confirma. QUEUED/WAITING_HUMAN continuam (ADMIN).
drop policy agent_runs_cancel_admin on public.agent_runs;
create policy agent_runs_cancel_admin on public.agent_runs for update to authenticated
  using ((select private.is_admin()) and status in ('QUEUED', 'WAITING_HUMAN'))
  with check ((select private.is_admin()) and status = 'CANCELLED');

-- ───────────────────────────── pedido de interrupção ──────────────────────

create or replace function private.request_agent_run_cancel(p_agent_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor   uuid := auth.uid();
  v_admin   boolean;
  v_run     record;
  v_outcome text;
begin
  if v_actor is null or not exists (select 1 from private.current_membership()) then
    raise exception 'Sem sessão liberada' using errcode = '42501';
  end if;
  if not private.has_internal_role('ADMIN', 'LAWYER') then
    raise exception 'Somente ADMIN ou advogado interrompe uma execução' using errcode = '42501';
  end if;
  v_admin := private.is_admin();

  select r.id, r.status, r.legal_case_id, r.queue_msg_id, r.heartbeat_at, r.cancel_requested_at into v_run
  from public.agent_runs r where r.id = p_agent_run_id
  for update;
  -- Mesma resposta para inexistente e sem acesso (sem enumeração).
  if not found or (not v_admin and (v_run.legal_case_id is null or not private.can_access_case(v_run.legal_case_id))) then
    raise exception 'Execução não encontrada' using errcode = 'P0002';
  end if;

  if v_run.status = 'CANCELLED' then
    v_outcome := 'ALREADY_CANCELLED';
  elsif v_run.status = 'QUEUED' then
    update public.agent_runs
       set status = 'CANCELLED', cancel_requested_at = coalesce(cancel_requested_at, now()),
           cancel_requested_by = coalesce(cancel_requested_by, v_actor)
     where id = v_run.id;
    if v_run.queue_msg_id is not null then
      perform pgmq.archive('agent_execution', v_run.queue_msg_id);
    end if;
    v_outcome := 'CANCELLED';
  elsif v_run.status = 'RUNNING' then
    if v_run.cancel_requested_at is not null then
      v_outcome := 'ALREADY_REQUESTED';
    elsif v_run.heartbeat_at < now() - interval '300 seconds' then
      -- Worker morto: ninguém confirmaria. Cancela já (a reserva não volta).
      update public.agent_runs
         set status = 'CANCELLED', cancel_requested_at = now(), cancel_requested_by = v_actor
       where id = v_run.id;
      if v_run.queue_msg_id is not null then
        perform pgmq.archive('agent_execution', v_run.queue_msg_id);
      end if;
      v_outcome := 'CANCELLED';
    else
      update public.agent_runs set cancel_requested_at = now(), cancel_requested_by = v_actor where id = v_run.id;
      perform private.record_audit_event('AGENT_RUN_CANCEL_REQUESTED', 'agent_runs', v_run.id,
        jsonb_build_object('from', v_run.status, 'legal_case_id', v_run.legal_case_id));
      v_outcome := 'CANCEL_REQUESTED';
    end if;
  elsif v_run.status = 'WAITING_HUMAN' then
    if not v_admin then
      raise exception 'A execução já entregou o resultado: decida em Revisões' using errcode = '23514';
    end if;
    update public.agent_runs
       set status = 'CANCELLED', cancel_requested_at = now(), cancel_requested_by = v_actor
     where id = v_run.id;
    v_outcome := 'CANCELLED';
  else
    raise exception 'Execução já encerrada' using errcode = '23514';
  end if;

  return jsonb_build_object(
    'agent_run_id', v_run.id,
    'status', (select r.status from public.agent_runs r where r.id = v_run.id),
    'outcome', v_outcome);
end
$$;

create or replace function public.request_agent_run_cancel(p_agent_run_id uuid)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.request_agent_run_cancel(p_agent_run_id) $$;

revoke all on function private.request_agent_run_cancel(uuid) from public, anon, service_role;
grant execute on function private.request_agent_run_cancel(uuid) to authenticated;
revoke all on function public.request_agent_run_cancel(uuid) from public, anon;
grant execute on function public.request_agent_run_cancel(uuid) to authenticated;

-- Estado de interrupção para a tela (LAWYER não lê agent_runs): só id,
-- situação e se há pedido pendente, das execuções que o usuário pode ver
-- (ADMIN: todas; LAWYER: de casos que acessa). No máximo 100 ids.
create or replace function private.get_agent_run_cancel_state(p_ids uuid[])
returns table (agent_run_id uuid, status text, cancel_requested boolean)
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
  if not private.has_internal_role('ADMIN', 'LAWYER') then
    raise exception 'Somente ADMIN ou advogado' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_ids), 0) > 100 then
    raise exception 'No máximo 100 execuções por consulta' using errcode = '22023';
  end if;
  v_admin := private.is_admin();
  return query
  select r.id, r.status, r.cancel_requested_at is not null
  from public.agent_runs r
  where r.id = any (p_ids)
    and (v_admin or (r.legal_case_id is not null and private.can_access_case(r.legal_case_id)));
end
$$;

create or replace function public.get_agent_run_cancel_state(p_ids uuid[])
returns table (agent_run_id uuid, status text, cancel_requested boolean)
language sql
stable
security invoker
set search_path = ''
as $$ select * from private.get_agent_run_cancel_state(p_ids) $$;

revoke all on function private.get_agent_run_cancel_state(uuid[]) from public, anon, service_role;
grant execute on function private.get_agent_run_cancel_state(uuid[]) to authenticated;
revoke all on function public.get_agent_run_cancel_state(uuid[]) from public, anon;
grant execute on function public.get_agent_run_cancel_state(uuid[]) to authenticated;

-- ───────────────────────────── contrato do worker ─────────────────────────
-- Antes e durante tarefas longas, o worker DEVE conferir. true = pare: houve
-- pedido de interrupção, ou a execução não está mais reservada por ele.

create or replace function private.worker_cancel_requested(p_agent_run_id uuid, p_worker text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select r.cancel_requested_at is not null or r.status <> 'RUNNING' or r.claimed_by is distinct from p_worker
    from public.agent_runs r where r.id = p_agent_run_id
  ), true)
$$;

revoke all on function private.worker_cancel_requested(uuid, text) from public, anon, authenticated, service_role;
grant execute on function private.worker_cancel_requested(uuid, text) to dg_worker;

-- Reserva: igual à 018, mas reserva vencida COM pedido de interrupção não é
-- retomada — vira CANCELLED (o worker que a tinha morreu; ninguém confirmaria).
create or replace function private.claim_agent_run(
  p_agent_run_id        uuid,
  p_worker              text,
  p_msg_id              bigint,
  p_stale_after_seconds integer default 300
)
returns table (claimed boolean, status text, attempt integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt integer;
begin
  perform set_config('dg.agent_run_id', p_agent_run_id::text, true);

  update public.agent_runs r
     set status = 'CANCELLED'
   where r.id = p_agent_run_id
     and r.status = 'RUNNING'
     and r.cancel_requested_at is not null
     and r.heartbeat_at < now() - make_interval(secs => p_stale_after_seconds);

  update public.agent_runs r
     set status = 'RUNNING',
         claimed_by = p_worker,
         claimed_at = now(),
         heartbeat_at = now(),
         started_at = coalesce(r.started_at, now()),
         attempt = r.attempt + 1,
         queue_msg_id = p_msg_id,
         error_code = null,
         error_message = null
   where r.id = p_agent_run_id
     and r.cancel_requested_at is null
     and (r.status = 'QUEUED'
          or (r.status = 'RUNNING'
              and r.heartbeat_at < now() - make_interval(secs => p_stale_after_seconds)))
  returning r.attempt into v_attempt;

  if found then
    return query select true, 'RUNNING'::text, v_attempt;
  else
    return query select false, r.status, r.attempt from public.agent_runs r where r.id = p_agent_run_id
                 union all select false, null::text, null::integer
                 where not exists (select 1 from public.agent_runs r where r.id = p_agent_run_id);
  end if;
end
$$;

-- Fim: 'CANCELLED' só confirma um pedido de interrupção existente; com pedido,
-- só CANCELLED ou FAILED.
create or replace function private.worker_finish_run(
  p_agent_run_id  uuid,
  p_worker        text,
  p_status        text,
  p_error_code    text default null,
  p_error_message text default null,
  p_model         text default null,
  p_input_tokens  bigint default null,
  p_output_tokens bigint default null,
  p_cost          numeric default null,
  p_summary       jsonb default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('COMPLETED', 'WAITING_HUMAN', 'FAILED', 'CANCELLED') then
    raise exception 'Status final inválido: %', p_status using errcode = '22023';
  end if;
  perform set_config('dg.agent_run_id', p_agent_run_id::text, true);
  if p_status = 'CANCELLED' and not exists (
    select 1 from public.agent_runs r
    where r.id = p_agent_run_id and r.claimed_by = p_worker and r.cancel_requested_at is not null
  ) then
    raise exception 'CANCELLED só confirma um pedido de interrupção' using errcode = '23514';
  end if;
  -- Com interrupção pedida, a execução não conclui. O que já foi entregue antes
  -- do pedido (proposta, minuta) continua em Revisões para decisão humana.
  if p_status in ('COMPLETED', 'WAITING_HUMAN') and exists (
    select 1 from public.agent_runs r where r.id = p_agent_run_id and r.cancel_requested_at is not null
  ) then
    raise exception 'Interrupção pedida: encerre como CANCELLED' using errcode = '23514';
  end if;
  update public.agent_runs
     set status = p_status,
         completed_at = case when p_status in ('COMPLETED', 'FAILED') then now() else completed_at end,
         error_code = p_error_code,
         error_message = left(p_error_message, 2000),
         model = coalesce(p_model, model),
         input_tokens = coalesce(p_input_tokens, input_tokens),
         output_tokens = coalesce(p_output_tokens, output_tokens),
         estimated_cost = coalesce(p_cost, estimated_cost),
         metadata = metadata || coalesce(p_summary, '{}'::jsonb)
   where id = p_agent_run_id and status = 'RUNNING' and claimed_by = p_worker;
  return found;
end
$$;

-- Nova tentativa: com pedido de interrupção, não volta para a fila — encerra.
create or replace function private.worker_requeue_run(p_agent_run_id uuid, p_worker text, p_error_message text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('dg.agent_run_id', p_agent_run_id::text, true);
  update public.agent_runs
     set status = case when cancel_requested_at is not null then 'CANCELLED' else 'QUEUED' end,
         error_code = 'AGENT_ERROR', error_message = left(p_error_message, 2000)
   where id = p_agent_run_id and status = 'RUNNING' and claimed_by = p_worker;
  return found;
end
$$;

-- ───────────────────────────── análise ← execução ─────────────────────────

create or replace function private.agent_runs_sync_analysis()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is not distinct from old.status then
    return null;
  end if;
  update public.legal_analyses a
     set status = case new.status
                    when 'QUEUED'        then 'QUEUED'
                    when 'RUNNING'       then 'RUNNING'
                    when 'WAITING_HUMAN' then 'WAITING_REVIEW'
                    when 'COMPLETED'     then 'COMPLETED'
                    when 'FAILED'        then 'FAILED'
                    when 'CANCELLED'     then 'CANCELLED'
                  end,
         completed_at = case when new.status = 'COMPLETED' then coalesce(a.completed_at, now()) else a.completed_at end,
         -- Texto fixo: o erro técnico da execução nunca vai para a análise.
         interruption_reason = case new.status
                                 when 'FAILED'    then 'A execução do agente falhou. Confira e envie de novo.'
                                 when 'CANCELLED' then 'Execução interrompida a pedido.'
                                 else a.interruption_reason
                               end
   where a.agent_run_id = new.id
     and a.status in ('QUEUED', 'RUNNING', 'WAITING_REVIEW');
  return null;
end
$$;

create trigger agent_runs_sync_analysis
  after update of status on public.agent_runs
  for each row execute function private.agent_runs_sync_analysis();
