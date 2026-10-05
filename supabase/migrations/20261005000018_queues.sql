-- DG Brasil — 018: filas (Supabase Queues / pgmq)
--
-- agent_runs é o registro de domínio. A fila só transporta o id.
-- Produtor: backend Next.js (service role). Consumidor: worker no Fly.io.
-- O navegador nunca toca na fila.
--
-- Nome da fila com underscore (agent_execution): pgmq cria tabelas q_<nome> e
-- a_<nome>, e hífen em nome de tabela é fonte de erro.

do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'pgmq') then
    create extension if not exists pgmq;
  end if;
end
$$;

do $$
begin
  if not exists (select 1 from pgmq.list_queues() q where q.queue_name = 'agent_execution') then
    perform pgmq.create('agent_execution');
  end if;
end
$$;

-- Fila fechada para anon/authenticated; aberta só para a service role.
revoke all on schema pgmq from public, anon, authenticated;
revoke all on all tables in schema pgmq from public, anon, authenticated;
revoke all on all sequences in schema pgmq from public, anon, authenticated;
revoke all on all functions in schema pgmq from public, anon, authenticated;

grant usage on schema pgmq to service_role;
grant all on all tables in schema pgmq to service_role;
grant all on all sequences in schema pgmq to service_role;
grant execute on all functions in schema pgmq to service_role;

-- Enfileira uma execução já registrada em agent_runs. A mensagem é montada
-- aqui, a partir de IDs: nunca leva CPF, documento, segredo ou prompt.
create or replace function private.enqueue_agent_run(
  p_agent_run_id   uuid,
  p_operation      text default 'EXECUTE',
  p_correlation_id uuid default gen_random_uuid()
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run    record;
  v_msg_id bigint;
begin
  if p_operation !~ '^[A-Z][A-Z_]{1,31}$' then
    raise exception 'operation inválida: %', p_operation using errcode = '22023';
  end if;

  select r.id, r.legal_case_id, r.status into v_run
  from public.agent_runs r where r.id = p_agent_run_id;

  if not found then
    raise exception 'agent_run % não existe', p_agent_run_id using errcode = '23503';
  end if;
  if v_run.status <> 'QUEUED' then
    raise exception 'agent_run % não está QUEUED (está %)', p_agent_run_id, v_run.status using errcode = '23514';
  end if;

  select s.send into v_msg_id
  from pgmq.send(
    'agent_execution',
    jsonb_build_object(
      'agent_run_id',   v_run.id,
      'legal_case_id',  v_run.legal_case_id,
      'operation',      p_operation,
      'correlation_id', p_correlation_id
    )
  ) as s(send);

  return v_msg_id;
end
$$;

revoke all on function private.enqueue_agent_run(uuid, text, uuid) from public, anon, authenticated;
grant execute on function private.enqueue_agent_run(uuid, text, uuid) to service_role;
