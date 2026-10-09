-- DG Brasil — 018: filas (Supabase Queues / pgmq) e ciclo da execução de agente
--
-- agent_runs é o registro de domínio. A fila só transporta o id.
--
--   pedido     public.request_agent_run (usuário ADMIN/LAWYER, ou backend com
--              service role informando o usuário): valida, cria agent_runs,
--              guarda a entrada em agent_run_inputs e enfileira — numa transação.
--   consumo    worker (papel dg_worker): pgmq.read → private.claim_agent_run
--              (reserva atômica: só um worker ganha) → funções private.worker_*
--              escopadas à execução → private.heartbeat_agent_run periódico
--              (estende o VT enquanto o agente roda) → pgmq.archive.
--   O navegador nunca toca na fila.
--
-- Nome da fila com underscore (agent_execution): pgmq cria tabelas q_<nome> e
-- a_<nome>, e hífen em nome de tabela é fonte de erro.

-- A guarda olha a EXTENSÃO, não o schema. `supabase db reset` remove a
-- extensão pgmq mas deixa o schema pgmq para trás, com as tabelas de fila
-- (q_*/a_*), que não pertencem à extensão. Checar o schema fazia esta migration
-- pular o create extension e quebrar (achado na validação real, Etapa 3.3 —
-- exceção documentada ao baseline, ver supabase/README.md).
-- Schema órfão nunca é apagado: é renomeado para pgmq_orfao_<data> (dados
-- preservados para inspeção) e a extensão nasce limpa. No PGlite dos testes o
-- pgmq não está disponível e o shim faz o papel dele.
-- As tabelas de fila do schema órfão também ganham o prefixo orfao_: o pgmq
-- procura a tabela da fila por nome em pg_class sem olhar o schema
-- (pgmq._belongs_to_pgmq), e um q_agent_execution sobrando no órfão fazia o
-- pgmq.create abaixo falhar com "more than one row returned by a subquery".
do $$
declare
  orfao record;
begin
  if not exists (select 1 from pg_extension where extname = 'pgmq')
     and exists (select 1 from pg_available_extensions where name = 'pgmq') then
    if exists (select 1 from pg_namespace where nspname = 'pgmq') then
      execute format('alter schema pgmq rename to %I',
                     'pgmq_orfao_' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISS'));
    end if;
    create extension pgmq;
  end if;

  for orfao in
    select n.nspname, c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname like 'pgmq\_orfao\_%'
       and c.relkind in ('r', 'p')
       and c.relname ~ '^[qa]_'
  loop
    execute format('alter table %I.%I rename to %I',
                   orfao.nspname, orfao.relname, left('orfao_' || orfao.relname, 63));
  end loop;
end
$$;

do $$
begin
  if not exists (select 1 from pgmq.list_queues() q where q.queue_name = 'agent_execution') then
    perform pgmq.create('agent_execution');
  end if;
end
$$;

-- Fila fechada para anon/authenticated; aberta para a service role.
revoke all on schema pgmq from public, anon, authenticated;
revoke all on all tables in schema pgmq from public, anon, authenticated;
revoke all on all sequences in schema pgmq from public, anon, authenticated;
revoke all on all functions in schema pgmq from public, anon, authenticated;

grant usage on schema pgmq to service_role;
grant all on all tables in schema pgmq to service_role;
grant all on all sequences in schema pgmq to service_role;
grant execute on all functions in schema pgmq to service_role;

-- dg_worker: só ler, estender a invisibilidade e arquivar mensagens DESTA fila.
-- Não cria nem apaga fila, não envia mensagem (quem enfileira é o banco).
grant usage on schema pgmq to dg_worker;
grant select, update, delete on pgmq.q_agent_execution to dg_worker;
grant select, insert on pgmq.a_agent_execution to dg_worker;
do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'pgmq'
      and p.proname in ('read', 'archive', 'set_vt', 'format_table_name', 'validate_queue_name')
  loop
    execute format('grant execute on function %s to dg_worker', f);
  end loop;
end
$$;

-- Enfileira uma execução já registrada em agent_runs. A mensagem é montada
-- aqui, a partir de IDs: nunca leva CPF, documento, segredo ou prompt.
create or replace function private.enqueue_agent_run(
  p_agent_run_id   uuid,
  p_operation      text default null,
  p_correlation_id uuid default null
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
  select r.id, r.legal_case_id, r.status, r.operation, r.correlation_id into v_run
  from public.agent_runs r where r.id = p_agent_run_id
  for update;

  if not found then
    raise exception 'agent_run % não existe', p_agent_run_id using errcode = '23503';
  end if;
  if v_run.status <> 'QUEUED' then
    raise exception 'agent_run % não está QUEUED (está %)', p_agent_run_id, v_run.status using errcode = '23514';
  end if;
  if p_operation is not null and p_operation !~ '^[A-Z][A-Z_]{1,31}$' then
    raise exception 'operation inválida: %', p_operation using errcode = '22023';
  end if;

  select s.send into v_msg_id
  from pgmq.send(
    'agent_execution',
    jsonb_build_object(
      'agent_run_id',   v_run.id,
      'legal_case_id',  v_run.legal_case_id,
      'operation',      coalesce(p_operation, v_run.operation),
      'correlation_id', coalesce(p_correlation_id, v_run.correlation_id)
    )
  ) as s(send);

  update public.agent_runs set queue_msg_id = v_msg_id where id = v_run.id;
  return v_msg_id;
end
$$;

revoke all on function private.enqueue_agent_run(uuid, text, uuid) from public, anon, authenticated;
grant execute on function private.enqueue_agent_run(uuid, text, uuid) to service_role;

-- ───────────────────────────── pedido de execução ─────────────────────────
-- ADMIN e LAWYER pedem. ASSISTANT e parceiros, não. O banco revalida papel e
-- acesso contra o solicitante — não basta a Server Action ter validado.
-- LAWYER só pede execução ligada a um caso; ADMIN pode pedir sem caso (ex.:
-- revisão de skill). A entrada livre (pedido em texto) vai para
-- agent_run_inputs, nunca para agent_runs.metadata.
create or replace function private.request_agent_run(
  p_agent_id         uuid,
  p_legal_case_id    uuid default null,
  p_legal_process_id uuid default null,
  p_request_text     text default null,
  p_parameters       jsonb default '{}',
  p_operation        text default 'EXECUTE',
  p_actor            uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor   uuid := private.resolve_actor(p_actor);
  v_role    public.membership_role := private.user_internal_role(v_actor);
  v_version uuid;
  v_run     uuid;
begin
  if v_role is null or v_role not in ('ADMIN', 'LAWYER') then
    raise exception 'Somente ADMIN ou LAWYER interno inicia execução de agente' using errcode = '42501';
  end if;

  if p_legal_case_id is null then
    if v_role <> 'ADMIN' then
      raise exception 'Execução sem caso é só de ADMIN' using errcode = '42501';
    end if;
    if p_legal_process_id is not null then
      raise exception 'Processo informado sem caso' using errcode = '23514';
    end if;
  else
    -- Usuário interno ativo acessa todos os casos não excluídos.
    if not exists (select 1 from public.legal_cases c where c.id = p_legal_case_id and c.deleted_at is null) then
      raise exception 'Caso % não existe ou foi excluído', p_legal_case_id using errcode = '42501';
    end if;
    if p_legal_process_id is not null and not exists (
      select 1 from public.legal_processes p
      where p.id = p_legal_process_id and p.legal_case_id = p_legal_case_id and p.deleted_at is null
    ) then
      raise exception 'O processo não pertence ao caso' using errcode = '23514';
    end if;
  end if;

  select a.current_version_id into v_version
  from public.agents a
  where a.id = p_agent_id and a.status = 'ACTIVE' and a.deleted_at is null;
  if v_version is null then
    raise exception 'Agente inexistente, inativo ou sem versão corrente' using errcode = '23514';
  end if;

  insert into public.agent_runs
    (agent_id, agent_version_id, legal_case_id, legal_process_id, requested_by, operation)
  values
    (p_agent_id, v_version, p_legal_case_id, p_legal_process_id, v_actor, coalesce(p_operation, 'EXECUTE'))
  returning id into v_run;

  if nullif(btrim(p_request_text), '') is not null or coalesce(p_parameters, '{}') <> '{}' then
    insert into public.agent_run_inputs (agent_run_id, requested_by, request_text, parameters)
    values (v_run, v_actor, nullif(btrim(p_request_text), ''), coalesce(p_parameters, '{}'));
  end if;

  perform private.enqueue_agent_run(v_run);
  return v_run;
end
$$;

create or replace function public.request_agent_run(
  p_agent_id         uuid,
  p_legal_case_id    uuid default null,
  p_legal_process_id uuid default null,
  p_request_text     text default null,
  p_parameters       jsonb default '{}',
  p_operation        text default 'EXECUTE',
  p_actor            uuid default null
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.request_agent_run(p_agent_id, p_legal_case_id, p_legal_process_id,
                                   p_request_text, p_parameters, p_operation, p_actor)
$$;

revoke all on function private.request_agent_run(uuid, uuid, uuid, text, jsonb, text, uuid) from public, anon;
revoke all on function public.request_agent_run(uuid, uuid, uuid, text, jsonb, text, uuid) from public, anon;
grant execute on function private.request_agent_run(uuid, uuid, uuid, text, jsonb, text, uuid) to authenticated, service_role;
grant execute on function public.request_agent_run(uuid, uuid, uuid, text, jsonb, text, uuid) to authenticated, service_role;

-- ═════════════════════════════ WORKER ════════════════════════════════════
-- O dg_worker não lê nem escreve tabelas de domínio diretamente. Cada função
-- abaixo:
--   1. exige a execução RESERVADA por este worker (claimed_by + RUNNING), salvo
--      reservar e aplicar proposta já decidida por humano;
--   2. deriva caso, processo e cliente da PRÓPRIA execução — nunca aceita
--      client_id/case_id arbitrário;
--   3. devolve só o necessário;
--   4. marca a transação com dg.agent_run_id: a auditoria registra actor AGENT.
-- SECURITY DEFINER com search_path vazio; EXECUTE só para dg_worker.

-- Reserva atômica: UPDATE ... WHERE status = 'QUEUED'. Dois workers com a mesma
-- execução: o segundo espera o lock da linha, reavalia o WHERE e não ganha.
-- Reserva RUNNING só é retomada se o batimento parou há mais de
-- p_stale_after_seconds (o worker que a tinha morreu). Sempre devolve uma
-- linha: claimed=false traz o status atual (null = execução inexistente).
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

-- Batimento: só o dono da reserva bate; cada batida empurra a invisibilidade
-- da mensagem (pgmq.set_vt). false = reserva perdida: o worker para de gravar.
create or replace function private.heartbeat_agent_run(
  p_agent_run_id uuid,
  p_worker       text,
  p_msg_id       bigint,
  p_vt_seconds   integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.agent_runs
     set heartbeat_at = now()
   where id = p_agent_run_id and status = 'RUNNING' and claimed_by = p_worker;
  if not found then
    return false;
  end if;
  perform pgmq.set_vt('agent_execution', p_msg_id, p_vt_seconds);
  return true;
end
$$;

-- Confere a reserva e devolve o escopo da execução.
create or replace function private.worker_scope(p_agent_run_id uuid, p_worker text)
returns table (legal_case_id uuid, legal_process_id uuid, client_id uuid, agent_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('dg.agent_run_id', p_agent_run_id::text, true);
  return query
  select r.legal_case_id, r.legal_process_id, c.client_id, r.agent_id
  from public.agent_runs r
  left join public.legal_cases c on c.id = r.legal_case_id
  where r.id = p_agent_run_id and r.status = 'RUNNING' and r.claimed_by = p_worker;
  if not found then
    raise exception 'Execução % não está reservada por este worker', p_agent_run_id using errcode = '42501';
  end if;
end
$$;

-- Contexto da execução: identidade, cliente do caso, entrada (pedido em texto)
-- e se uma tentativa anterior já deixou saída.
create or replace function private.worker_run_context(p_agent_run_id uuid, p_worker text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope record;
  v_run   record;
  v_input record;
begin
  select * into v_scope from private.worker_scope(p_agent_run_id, p_worker);
  select r.id, r.agent_id, r.agent_version_id, r.legal_case_id, r.legal_process_id, r.operation,
         r.requested_by, r.attempt, r.metadata
    into v_run
  from public.agent_runs r where r.id = p_agent_run_id;
  select i.request_text, i.parameters into v_input
  from public.agent_run_inputs i where i.agent_run_id = p_agent_run_id;

  return jsonb_build_object(
    'id', v_run.id,
    'agent_id', v_run.agent_id,
    'agent_version_id', v_run.agent_version_id,
    'legal_case_id', v_run.legal_case_id,
    'legal_process_id', v_run.legal_process_id,
    'client_id', v_scope.client_id,
    'operation', v_run.operation,
    'requested_by', v_run.requested_by,
    'attempt', v_run.attempt,
    'previous_output',
      exists (select 1 from public.agent_proposals p where p.agent_run_id = p_agent_run_id)
      or jsonb_array_length(coalesce(v_run.metadata -> 'documents', '[]'::jsonb)) > 0,
    'input', jsonb_build_object('request_text', v_input.request_text,
                                'parameters', coalesce(v_input.parameters, '{}'::jsonb))
  );
end
$$;

-- Busca de cliente: só o cliente do caso da execução. Execução sem caso não
-- busca cliente nenhum.
create or replace function private.worker_find_client(p_agent_run_id uuid, p_worker text, p_term text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope  record;
  v_digits text := regexp_replace(coalesce(p_term, ''), '\D', '', 'g');
  v_name   text := replace(replace(coalesce(p_term, ''), '%', ''), '_', '');
begin
  select * into v_scope from private.worker_scope(p_agent_run_id, p_worker);
  if v_scope.client_id is null or length(btrim(p_term)) < 3 then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'kind', c.kind, 'cpf', c.cpf, 'cnpj', c.cnpj, 'status', c.status,
      'nome', coalesce(i.full_name, co.legal_name),
      'birth_date', i.birth_date, 'marital_status', i.marital_status, 'profession', i.profession,
      'casos', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'titulo', k.title, 'status', k.status))
                         from public.legal_cases k where k.client_id = c.id and k.deleted_at is null), '[]'::jsonb)))
    from public.clients c
    left join public.individual_client_details i on i.client_id = c.id
    left join public.company_client_details co on co.client_id = c.id
    where c.id = v_scope.client_id and c.deleted_at is null
      and ((length(v_digits) >= 11 and (c.cpf = v_digits or c.cnpj = v_digits))
           or coalesce(i.full_name, co.legal_name) ilike '%' || v_name || '%')
  ), '[]'::jsonb);
end
$$;

-- O caso da execução (e só ele): cliente, processos, prazos abertos,
-- documentos (última versão, aprovação, verificação) e pendências.
create or replace function private.worker_get_case(p_agent_run_id uuid, p_worker text, p_legal_case_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope record;
begin
  select * into v_scope from private.worker_scope(p_agent_run_id, p_worker);
  if v_scope.legal_case_id is null or p_legal_case_id is distinct from v_scope.legal_case_id then
    return null;
  end if;
  return (
    select jsonb_build_object(
      'id', k.id, 'titulo', k.title, 'resumo', k.summary, 'status', k.status, 'client_id', k.client_id,
      'area', a.code, 'cliente', coalesce(i.full_name, co.legal_name),
      'processos', coalesce((select jsonb_agg(jsonb_build_object(
          'id', p.id, 'cnj', p.cnj_number, 'status', p.status, 'tribunal', p.court))
        from public.legal_processes p where p.legal_case_id = k.id and p.deleted_at is null), '[]'::jsonb),
      'prazos_abertos', coalesce((select jsonb_agg(jsonb_build_object(
          'id', d.id, 'titulo', d.title, 'vence_em', d.due_at, 'processo_id', d.legal_process_id) order by d.due_at)
        from public.deadlines d where d.legal_case_id = k.id and d.status = 'OPEN'), '[]'::jsonb),
      'documentos', coalesce((select jsonb_agg(jsonb_build_object(
          'id', doc.id, 'titulo', doc.title, 'categoria', doc.category, 'visibilidade', doc.visibility,
          'ultima_versao_id', ult.document_version_id, 'versao', ult.version_number,
          'aprovacao', ult.approval_status, 'verificacao', vs.verification_status))
        from public.case_documents cd
        join public.documents doc on doc.id = cd.document_id and doc.deleted_at is null
        left join lateral (
          select va.document_version_id, va.version_number, va.approval_status
          from public.document_version_approvals va
          where va.document_id = doc.id order by va.version_number desc limit 1
        ) ult on true
        left join public.document_version_verification_status vs on vs.document_version_id = ult.document_version_id
        where cd.legal_case_id = k.id), '[]'::jsonb),
      'pendencias', coalesce((select jsonb_agg(jsonb_build_object(
          'categoria', r.category, 'descricao', r.requirement_label, 'obrigatorio', r.required, 'status', r.status))
        from public.case_document_requirements r where r.legal_case_id = k.id), '[]'::jsonb))
    from public.legal_cases k
    join public.legal_areas a on a.id = k.legal_area_id
    left join public.individual_client_details i on i.client_id = k.client_id
    left join public.company_client_details co on co.client_id = k.client_id
    where k.id = v_scope.legal_case_id and k.deleted_at is null
  );
end
$$;

-- Um processo do caso da execução: dados, partes e últimas movimentações.
create or replace function private.worker_get_process(
  p_agent_run_id uuid, p_worker text, p_legal_process_id uuid, p_events integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope record;
begin
  select * into v_scope from private.worker_scope(p_agent_run_id, p_worker);
  if v_scope.legal_case_id is null then
    return null;
  end if;
  return (
    select jsonb_build_object(
      'id', p.id, 'legal_case_id', p.legal_case_id, 'cnj_number', p.cnj_number, 'status', p.status,
      'court', p.court, 'court_unit', p.court_unit, 'district', p.district, 'state', p.state,
      'legal_class', p.legal_class, 'subject', p.subject, 'client_side', p.client_side,
      'case_value', p.case_value, 'distribution_date', p.distribution_date,
      'partes', coalesce((select jsonb_agg(jsonb_build_object('tipo', pp.party_type, 'nome', pp.name))
                          from public.process_parties pp where pp.legal_process_id = p.id), '[]'::jsonb),
      'movimentacoes', coalesce((select jsonb_agg(e order by e.occurred_at desc)
                                 from (select ev.event_type, ev.description, ev.occurred_at, ev.source
                                       from public.process_events ev where ev.legal_process_id = p.id
                                       order by ev.occurred_at desc
                                       limit least(greatest(coalesce(p_events, 50), 1), 200)) e), '[]'::jsonb))
    from public.legal_processes p
    where p.id = p_legal_process_id and p.legal_case_id = v_scope.legal_case_id and p.deleted_at is null
  );
end
$$;

-- Versão de documento VINCULADO ao caso da execução, para baixar do Storage.
-- O acesso fica registrado (LGPD) com ator AGENT.
create or replace function private.worker_get_document_version(
  p_agent_run_id uuid, p_worker text, p_document_version_id uuid
)
returns table (storage_object_name text, original_filename text, file_size bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope record;
begin
  select * into v_scope from private.worker_scope(p_agent_run_id, p_worker);
  if v_scope.legal_case_id is null then
    return;
  end if;
  return query
  select v.storage_object_name, v.original_filename, v.file_size
  from public.document_versions v
  join public.documents d on d.id = v.document_id and d.deleted_at is null
  join public.case_documents cd on cd.document_id = d.id and cd.legal_case_id = v_scope.legal_case_id
  where v.id = p_document_version_id;
  if found then
    perform private.record_personal_data_access(v_scope.client_id, 'DOCUMENT_VERSION', p_document_version_id,
                                                'DOWNLOAD', 'Execução de agente');
  end if;
end
$$;

-- Proposta do agente + revisão PENDING, numa transação. Idempotente por
-- (agent_run_id, idempotency_key): a mesma proposta não vira duas.
create or replace function private.worker_create_proposal(
  p_agent_run_id     uuid,
  p_worker           text,
  p_proposal_type    text,
  p_payload          jsonb,
  p_idempotency_key  text,
  p_priority         text default 'NORMAL',
  p_legal_process_id uuid default null
)
returns table (proposal_id uuid, created boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope   record;
  v_process uuid;
  v_id      uuid;
begin
  select * into v_scope from private.worker_scope(p_agent_run_id, p_worker);

  if p_proposal_type in ('CREATE_DEADLINE', 'REQUEST_DOCUMENT', 'UPDATE_CASE', 'CREATE_PROCESS')
     and v_scope.legal_case_id is null then
    raise exception '% só pode ser proposto numa execução ligada a um caso', p_proposal_type using errcode = '23514';
  end if;

  v_process := coalesce(p_legal_process_id, v_scope.legal_process_id);
  if v_process is not null and v_scope.legal_case_id is null then
    v_process := null;
  end if;
  if v_process is not null and not exists (
    select 1 from public.legal_processes p where p.id = v_process and p.legal_case_id = v_scope.legal_case_id
  ) then
    raise exception 'legal_process_id não pertence ao caso desta execução' using errcode = '23514';
  end if;

  insert into public.agent_proposals
    (agent_run_id, legal_case_id, legal_process_id, proposal_type, payload, requires_human_review, idempotency_key)
  values
    (p_agent_run_id, v_scope.legal_case_id, v_process, p_proposal_type, p_payload, true, p_idempotency_key)
  on conflict on constraint agent_proposals_idempotency_key do nothing
  returning id into v_id;

  if v_id is null then
    select p.id into v_id from public.agent_proposals p
    where p.agent_run_id = p_agent_run_id and p.idempotency_key = p_idempotency_key;
    return query select v_id, false;
    return;
  end if;

  insert into public.reviews (legal_case_id, agent_proposal_id, priority)
  values (v_scope.legal_case_id, v_id, coalesce(p_priority, 'NORMAL'));
  return query select v_id, true;
end
$$;

-- Minuta: documento INTERNAL do caso (novo ou existente no caso), versão
-- AGENT e revisão PENDING, numa transação. O arquivo já está no Storage, no
-- caminho de legal_document_object_name (o trigger de versão confere).
create or replace function private.worker_deliver_document(
  p_agent_run_id        uuid,
  p_worker              text,
  p_document_id         uuid,
  p_create_document     boolean,
  p_document_version_id uuid,
  p_category            text,
  p_title               text,
  p_description         text,
  p_storage_object_name text,
  p_original_filename   text,
  p_mime_type           text,
  p_file_size           bigint,
  p_checksum_sha256     text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope  record;
  v_number integer;
begin
  select * into v_scope from private.worker_scope(p_agent_run_id, p_worker);
  if v_scope.legal_case_id is null then
    raise exception 'Minuta só numa execução ligada a um caso' using errcode = '23514';
  end if;

  if p_create_document then
    insert into public.documents (id, client_id, category, title, description, visibility)
    values (p_document_id, v_scope.client_id, p_category, p_title, p_description, 'INTERNAL');
    insert into public.case_documents (legal_case_id, document_id, purpose)
    values (v_scope.legal_case_id, p_document_id, 'AGENT_DRAFT');
  elsif not exists (
    select 1 from public.case_documents cd join public.documents d on d.id = cd.document_id
    where cd.document_id = p_document_id and cd.legal_case_id = v_scope.legal_case_id and d.deleted_at is null
  ) then
    raise exception 'documento_id não é documento deste caso' using errcode = '23514';
  end if;

  insert into public.document_versions
    (id, document_id, storage_object_name, original_filename, mime_type, file_size, checksum_sha256, source)
  values
    (p_document_version_id, p_document_id, p_storage_object_name, p_original_filename, p_mime_type,
     p_file_size, p_checksum_sha256, 'AGENT')
  returning version_number into v_number;

  insert into public.reviews (legal_case_id, legal_process_id, document_version_id)
  values (v_scope.legal_case_id, v_scope.legal_process_id, p_document_version_id);

  update public.agent_runs
     set metadata = jsonb_set(metadata, '{documents}',
                              coalesce(metadata -> 'documents', '[]'::jsonb) || to_jsonb(p_document_version_id::text))
   where id = p_agent_run_id;
  return v_number;
end
$$;

-- Fim da execução, só por quem tem a reserva. false = reserva perdida.
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
  if p_status not in ('COMPLETED', 'WAITING_HUMAN', 'FAILED') then
    raise exception 'Status final inválido: %', p_status using errcode = '22023';
  end if;
  perform set_config('dg.agent_run_id', p_agent_run_id::text, true);
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

-- Devolve a execução à fila (nova tentativa), só por quem tem a reserva.
create or replace function private.worker_requeue_run(p_agent_run_id uuid, p_worker text, p_error_message text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('dg.agent_run_id', p_agent_run_id::text, true);
  update public.agent_runs
     set status = 'QUEUED', error_code = 'AGENT_ERROR', error_message = left(p_error_message, 2000)
   where id = p_agent_run_id and status = 'RUNNING' and claimed_by = p_worker;
  return found;
end
$$;

-- ───────────────────────────── aplicação de propostas ─────────────────────
-- O ÚNICO lugar que transforma proposta APROVADA por humano em fato. Roda no
-- banco: o worker não precisa de escrita direta em prazo, processo, caso,
-- pendência, solicitação, skill ou agente. Validação defensiva do payload
-- (o worker já validou com zod ao propor); qualquer erro vira FAILED com a
-- mensagem, sem efeito parcial.

create or replace function private.apply_proposal_effect(
  p_type             text,
  p_data             jsonb,
  p_legal_case_id    uuid,
  p_legal_process_id uuid
)
returns table (entity_type text, entity_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id      uuid;
  v_target  uuid;
  v_status  text;
begin
  if p_type in ('CREATE_DEADLINE', 'REQUEST_DOCUMENT', 'UPDATE_CASE', 'CREATE_PROCESS') and p_legal_case_id is null then
    raise exception 'proposta sem caso';
  end if;

  case p_type
  when 'CREATE_DEADLINE' then
    if nullif(btrim(p_data ->> 'title'), '') is null or p_data ->> 'due_at' is null then
      raise exception 'CREATE_DEADLINE exige title e due_at';
    end if;
    insert into public.deadlines
      (legal_case_id, legal_process_id, title, description, due_at, priority, responsible_user_id, source)
    values
      (p_legal_case_id, coalesce((p_data ->> 'legal_process_id')::uuid, p_legal_process_id),
       p_data ->> 'title', p_data ->> 'description', (p_data ->> 'due_at')::timestamptz,
       coalesce(p_data ->> 'priority', 'NORMAL'), (p_data ->> 'responsible_user_id')::uuid, 'AGENT')
    returning id into v_id;
    return query select 'deadlines'::text, v_id;

  when 'REQUEST_DOCUMENT' then
    insert into public.case_document_requirements
      (legal_case_id, requirement_label, category, required, status, requested_at)
    values
      (p_legal_case_id, p_data ->> 'label', p_data ->> 'category',
       coalesce((p_data ->> 'required')::boolean, true), 'REQUESTED', now())
    returning id into v_id;
    -- Caso de parceiro: o pedido chega ao parceiro como solicitação.
    if nullif(btrim(p_data ->> 'message_to_partner'), '') is not null then
      insert into public.partner_requests
        (partner_organization_id, legal_case_id, type, title, description, due_at)
      select c.partner_organization_id, c.id, 'DOCUMENT', p_data ->> 'label', p_data ->> 'message_to_partner',
             (p_data ->> 'due_at')::timestamptz
      from public.legal_cases c
      where c.id = p_legal_case_id and c.partner_organization_id is not null;
    end if;
    return query select 'case_document_requirements'::text, v_id;

  when 'UPDATE_CASE' then
    if p_data ? 'status' and p_data ->> 'status' not in
       ('WAITING_DOCUMENTS', 'READY_FOR_ANALYSIS', 'ANALYZING', 'WAITING_REVIEW') then
      raise exception 'Agente não põe o caso em %', p_data ->> 'status';
    end if;
    update public.legal_cases
       set title = coalesce(p_data ->> 'title', title),
           summary = coalesce(p_data ->> 'summary', summary),
           status = coalesce(p_data ->> 'status', status)
     where id = p_legal_case_id
       and status in ('DRAFT', 'SUBMITTED', 'WAITING_DOCUMENTS', 'READY_FOR_ANALYSIS', 'ANALYZING', 'WAITING_REVIEW')
    returning id into v_id;
    if v_id is null then
      raise exception 'O caso já foi decidido: agente não altera caso aceito, rejeitado ou encerrado';
    end if;
    return query select 'legal_cases'::text, v_id;

  when 'CREATE_PROCESS' then
    insert into public.legal_processes
      (legal_case_id, cnj_number, technical_origin, court, court_unit, district, state,
       legal_class, subject, client_side, adverse_party_summary, case_value, status)
    values
      (p_legal_case_id, p_data ->> 'cnj_number', 'AGENT', p_data ->> 'court', p_data ->> 'court_unit',
       p_data ->> 'district', p_data ->> 'state', p_data ->> 'legal_class', p_data ->> 'subject',
       p_data ->> 'client_side', p_data ->> 'adverse_party_summary', (p_data ->> 'case_value')::numeric, 'PREPARING')
    returning id into v_id;
    return query select 'legal_processes'::text, v_id;

  when 'UPDATE_SKILL' then
    select s.id into v_target from public.skills s where s.slug = p_data ->> 'skill_slug' and s.deleted_at is null;
    if v_target is null then
      raise exception 'skill % não existe', p_data ->> 'skill_slug';
    end if;
    insert into public.skill_versions (skill_id, instructions, configuration)
    values (v_target, p_data ->> 'instructions', coalesce(p_data -> 'configuration', '{}'::jsonb))
    returning id into v_id;
    update public.skills set current_version_id = v_id where id = v_target;
    return query select 'skills'::text, v_target;

  when 'UPDATE_AGENT' then
    select a.id into v_target from public.agents a where a.slug = p_data ->> 'agent_slug' and a.deleted_at is null;
    if v_target is null then
      raise exception 'agente % não existe', p_data ->> 'agent_slug';
    end if;
    if jsonb_typeof(coalesce(p_data -> 'configuration', '{}'::jsonb)) <> 'object' then
      raise exception 'configuration precisa ser objeto';
    end if;
    insert into public.agent_versions (agent_id, instructions, configuration)
    values (v_target, p_data ->> 'instructions', coalesce(p_data -> 'configuration', '{}'::jsonb))
    returning id into v_id;
    update public.agents set current_version_id = v_id where id = v_target;
    return query select 'agents'::text, v_target;

  when 'OTHER' then
    -- Sem efeito automático: aprovado, vira providência da equipe.
    return;

  else
    raise exception 'Tipo de proposta sem aplicador: %', p_type;
  end case;
end
$$;

-- Pega UMA proposta decidida (for update skip locked: dois workers não pegam a
-- mesma), aplica e marca APPLIED com o efeito — ou FAILED com o erro. Também
-- cobre o caminho antigo (PENDING com revisão já decidida). Devolve a linha
-- processada, ou nenhuma se não há o que fazer.
create or replace function private.worker_apply_next_proposal(p_worker text)
returns table (proposal_id uuid, agent_run_id uuid, status text, error text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p      record;
  v_effect record;
  v_error  text;
begin
  select p.id, p.agent_run_id, p.legal_case_id, p.legal_process_id, p.proposal_type, p.payload, p.status,
         (select rv.status from public.reviews rv where rv.agent_proposal_id = p.id
          order by rv.created_at desc limit 1) as review_status
    into v_p
  from public.agent_proposals p
  where p.status = 'APPROVED'
     or (p.status = 'PENDING' and exists (
           select 1 from public.reviews rv
           where rv.agent_proposal_id = p.id and rv.status in ('APPROVED', 'REJECTED')))
  order by p.created_at
  for update of p skip locked
  limit 1;

  if v_p.id is null then
    return;
  end if;

  perform set_config('dg.agent_run_id', v_p.agent_run_id::text, true);
  perform set_config('dg.request_id', v_p.agent_run_id::text, true);

  if v_p.status = 'PENDING' and v_p.review_status = 'REJECTED' then
    update public.agent_proposals set status = 'REJECTED' where id = v_p.id;
    perform private.worker_close_run_if_decided(v_p.agent_run_id);
    return query select v_p.id, v_p.agent_run_id, 'REJECTED'::text, null::text;
    return;
  end if;
  if v_p.status = 'PENDING' then
    update public.agent_proposals set status = 'APPROVED' where id = v_p.id;
  end if;

  begin
    select * into v_effect
    from private.apply_proposal_effect(v_p.proposal_type, v_p.payload -> 'data', v_p.legal_case_id, v_p.legal_process_id);
    update public.agent_proposals
       set status = 'APPLIED', applied_entity_type = v_effect.entity_type, applied_entity_id = v_effect.entity_id
     where id = v_p.id;
    if v_effect.entity_id is not null then
      perform private.record_audit_event('AGENT_PROPOSAL_EFFECT', v_effect.entity_type, v_effect.entity_id,
        jsonb_build_object('agent_proposal_id', v_p.id, 'proposal_type', v_p.proposal_type));
    end if;
  exception when others then
    v_error := left(sqlerrm, 2000);
    update public.agent_proposals set status = 'FAILED', application_error = v_error where id = v_p.id;
  end;

  perform private.worker_close_run_if_decided(v_p.agent_run_id);
  return query select v_p.id, v_p.agent_run_id,
                      case when v_error is null then 'APPLIED' else 'FAILED' end, v_error;
end
$$;

-- Execução que esperava humano termina quando nenhuma proposta dela está pendente.
create or replace function private.worker_close_run_if_decided(p_agent_run_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('dg.agent_run_id', p_agent_run_id::text, true);
  update public.agent_runs
     set status = 'COMPLETED', completed_at = now()
   where id = p_agent_run_id and status = 'WAITING_HUMAN'
     and not exists (select 1 from public.agent_proposals p
                     where p.agent_run_id = p_agent_run_id and p.status in ('PENDING', 'APPROVED'));
  return found;
end
$$;

-- Fecha execuções cujas propostas foram todas decididas (ex.: rejeitadas pela
-- decisão humana, que já leva a proposta a REJECTED). Devolve quantas.
create or replace function private.worker_close_decided_runs()
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
    select x.id from public.agent_runs x
    where x.status = 'WAITING_HUMAN'
      and not exists (select 1 from public.agent_proposals p
                      where p.agent_run_id = x.id and p.status in ('PENDING', 'APPROVED'))
    limit 50
  loop
    if private.worker_close_run_if_decided(r.id) then
      n := n + 1;
    end if;
  end loop;
  return n;
end
$$;

do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname in ('claim_agent_run', 'heartbeat_agent_run', 'worker_scope', 'worker_run_context',
                        'worker_find_client', 'worker_get_case', 'worker_get_process',
                        'worker_get_document_version', 'worker_create_proposal', 'worker_deliver_document',
                        'worker_finish_run', 'worker_requeue_run', 'worker_apply_next_proposal',
                        'worker_close_run_if_decided', 'worker_close_decided_runs', 'apply_proposal_effect')
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
  end loop;

  -- dg_worker executa só as portas de entrada (não os blocos internos).
  for f in
    select p.oid::regprocedure
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname in ('claim_agent_run', 'heartbeat_agent_run', 'worker_run_context',
                        'worker_find_client', 'worker_get_case', 'worker_get_process',
                        'worker_get_document_version', 'worker_create_proposal', 'worker_deliver_document',
                        'worker_finish_run', 'worker_requeue_run', 'worker_apply_next_proposal',
                        'worker_close_decided_runs')
  loop
    execute format('grant execute on function %s to dg_worker', f);
  end loop;
end
$$;
