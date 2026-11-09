-- DG Brasil — 047: Roadmap 2.0, bloco 4 — tarefas do processo para os agentes
--
-- Pedido da Barbara (2026-11-06): além das movimentações (informativas), o
-- processo precisa de uma LISTA DE AFAZERES em que a equipe escreve o que os
-- agentes devem fazer. Cada tarefa entra na fila; o agente ORQUESTRADOR (no
-- Claude Code do escritório) decide quem faz; o agente entrega para REVISÃO
-- HUMANA; a pessoa confere e dá o "check" de concluída. "O DG Brasil é a
-- central de comunicação das pessoas reais com o mundo digital."
--
--   process_tasks: título, o que fazer, agente (vazio = orquestrador), prazo,
--   situação e a execução atual. A situação acompanha a execução sozinha
--   (trigger em agent_runs):
--     OPEN        aberta (sem agente configurado ou devolvida para refazer)
--     QUEUED      na fila do orquestrador
--     IN_PROGRESS um agente está trabalhando
--     IN_REVIEW   o agente entregou: aguardando revisão/conferência humana
--     DONE        conferida e concluída por uma pessoa (o "check")
--     CANCELLED   cancelada (com motivo)
--   process_task_settings: qual agente é o orquestrador (ADMIN escolhe). Sem
--   escolha, vale o agente ativo de identificador "orquestrador": o agente do
--   Claude Code do computador do escritório que recebe as tarefas pelo MCP e
--   distribui entre os outros agentes locais.
--
-- O agente recebe a tarefa como o "pedido" da execução (agent_run_inputs),
-- que o MCP do escritório já mostra (ver_trabalho). Nada é consumado sem
-- revisão humana: as entregas seguem para Revisões, como sempre.
--
-- 001–046 não são alteradas.

-- ───────────────────────────── configuração ──────────────────────────────

create table public.process_task_settings (
  id                    boolean primary key default true constraint process_task_settings_singleton check (id),
  orchestrator_agent_id uuid references public.agents (id) on delete restrict,
  updated_by            uuid references public.profiles (id) on delete restrict,
  updated_at            timestamptz not null default now()
);

comment on table public.process_task_settings is
  'Linha única: o agente orquestrador que recebe as tarefas dos processos quando a pessoa não escolhe um agente.';

insert into public.process_task_settings (id) values (true) on conflict (id) do nothing;

alter table public.process_task_settings enable row level security;
create policy process_task_settings_select_internal on public.process_task_settings for select to authenticated
  using ((select private.is_internal_user()));
revoke all on public.process_task_settings from public, anon, authenticated;
grant select on public.process_task_settings to authenticated;

-- ───────────────────────────── tarefas ───────────────────────────────────

create table public.process_tasks (
  id               uuid primary key default gen_random_uuid(),
  legal_process_id uuid not null,
  legal_case_id    uuid not null,
  title            text not null check (btrim(title) <> '' and length(title) <= 200),
  instructions     text not null check (btrim(instructions) <> '' and length(instructions) <= 10000),
  status           text not null default 'OPEN' check (status in ('OPEN', 'QUEUED', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'CANCELLED')),
  priority         text not null default 'NORMAL' check (priority in ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
  -- Agente escolhido pela pessoa; vazio = orquestrador da configuração.
  agent_id         uuid references public.agents (id) on delete restrict,
  agent_run_id     uuid references public.agent_runs (id) on delete restrict,
  attempts         integer not null default 0 check (attempts >= 0),
  due_at           timestamptz,
  last_error       text check (last_error is null or length(last_error) <= 1000),
  created_by       uuid references public.profiles (id) on delete restrict,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  completed_by     uuid references public.profiles (id) on delete restrict,
  completed_at     timestamptz,
  completion_note  text check (completion_note is null or length(completion_note) <= 2000),
  cancelled_at     timestamptz,
  cancel_reason    text check (cancel_reason is null or length(cancel_reason) <= 1000),
  constraint process_tasks_process_fkey
    foreign key (legal_process_id, legal_case_id)
    references public.legal_processes (id, legal_case_id) on delete restrict,
  constraint process_tasks_done_has_author check (status <> 'DONE' or (completed_at is not null and completed_by is not null)),
  constraint process_tasks_cancel_has_reason check (status <> 'CANCELLED' or nullif(btrim(cancel_reason), '') is not null)
);

comment on table public.process_tasks is
  'Lista de afazeres do processo para os agentes: a equipe escreve, o orquestrador distribui, o agente entrega para revisão e a pessoa dá o check.';

create index process_tasks_process_idx on public.process_tasks (legal_process_id, created_at desc);
create index process_tasks_open_idx on public.process_tasks (status) where status not in ('DONE', 'CANCELLED');
create unique index process_tasks_run_key on public.process_tasks (agent_run_id) where agent_run_id is not null;

create trigger process_tasks_set_updated_at
  before update on public.process_tasks
  for each row execute function private.set_updated_at();

alter table public.process_tasks enable row level security;
-- Equipe interna lê; escrita só pelas funções abaixo (sem INSERT/UPDATE direto).
create policy process_tasks_select_internal on public.process_tasks for select to authenticated
  using ((select private.is_internal_user()));
revoke all on public.process_tasks from public, anon, authenticated;
grant select on public.process_tasks to authenticated;
grant select on public.process_tasks to service_role;

create trigger process_tasks_audit
  after insert or update on public.process_tasks
  for each row execute function private.audit_roadmap2_row();

-- Registro na linha do tempo do processo (movimentações): a lista de afazeres
-- aparece junto do resto. Fonte MANUAL (equipe) ou AGENT: o parceiro nunca vê
-- (RLS de process_events, 032) — o texto da tarefa é interno.
create or replace function private.process_task_event(p_task public.process_tasks, p_title text, p_description text, p_source text default 'MANUAL')
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.process_events (legal_process_id, event_type, title, description, occurred_at, source, important, raw_data)
  values (p_task.legal_process_id, 'TASK', p_title, p_description, now(), p_source, false,
          jsonb_build_object('process_task_id', p_task.id, 'status', p_task.status))
$$;

-- Texto que o agente recebe (o "pedido" da execução).
create or replace function private.process_task_request(p_task public.process_tasks, p_note text default null)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select left(concat_ws(E'\n\n',
    'TAREFA DO PROCESSO (lista de afazeres do DG Brasil)',
    'Título: ' || p_task.title,
    'O que fazer:' || E'\n' || p_task.instructions,
    case when p_task.due_at is not null
         then 'Prazo interno: ' || to_char(p_task.due_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') end,
    case when nullif(btrim(coalesce(p_note, '')), '') is not null
         then 'Observação da equipe (nova tentativa):' || E'\n' || btrim(p_note) end,
    'Ao terminar: entregue o resultado (minuta, análise ou proposta) pelo DG Brasil. Tudo vai para revisão humana; nada é protocolado nem enviado sem aprovação.'
  ), 20000)
$$;

-- Orquestrador em vigor: o escolhido pelo ADMIN ou, sem escolha, o agente
-- ativo com identificador "orquestrador".
create or replace function private.process_task_orchestrator()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select s.orchestrator_agent_id from public.process_task_settings s
       join public.agents a on a.id = s.orchestrator_agent_id and a.status = 'ACTIVE' and a.deleted_at is null
      where s.id),
    (select a.id from public.agents a where a.slug = 'orquestrador' and a.status = 'ACTIVE' and a.deleted_at is null))
$$;

-- Agente da tarefa: o escolhido pela pessoa ou o orquestrador em vigor.
create or replace function private.process_task_agent(p_task public.process_tasks)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p_task.agent_id, private.process_task_orchestrator())
$$;

-- Põe a tarefa na fila: nova execução com o pedido. Sem agente → fica ABERTA.
create or replace function private.process_task_enqueue(p_task_id uuid, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task  public.process_tasks;
  v_agent uuid;
  v_run   uuid;
begin
  select * into v_task from public.process_tasks where id = p_task_id for update;
  v_agent := private.process_task_agent(v_task);
  if v_agent is null then
    update public.process_tasks set status = 'OPEN', last_error = 'Nenhum agente escolhido e o orquestrador não está configurado.'
     where id = p_task_id;
    return null;
  end if;
  v_run := private.request_agent_run(v_agent, v_task.legal_case_id, v_task.legal_process_id,
    private.process_task_request(v_task, p_note),
    jsonb_build_object('process_task_id', v_task.id), 'PROCESS_TASK', null);
  update public.process_tasks
     set status = 'QUEUED', agent_run_id = v_run, attempts = attempts + 1, last_error = null
   where id = p_task_id;
  return v_run;
end
$$;

-- ───────────────────────────── operações (equipe) ────────────────────────

create or replace function public.create_process_task(
  p_legal_process_id uuid,
  p_title            text,
  p_instructions     text,
  p_agent_id         uuid default null,
  p_due_at           timestamptz default null,
  p_priority         text default 'NORMAL',
  p_send             boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case uuid;
  v_task public.process_tasks;
  v_run  uuid;
begin
  if not private.has_internal_role('ADMIN', 'LAWYER') then
    raise exception 'Somente ADMIN ou advogado cria tarefa para os agentes' using errcode = '42501';
  end if;
  select p.legal_case_id into v_case from public.legal_processes p where p.id = p_legal_process_id and p.deleted_at is null;
  if v_case is null then
    raise exception 'Processo não encontrado' using errcode = '42501';
  end if;
  if p_agent_id is not null and not exists (
    select 1 from public.agents a where a.id = p_agent_id and a.status = 'ACTIVE' and a.deleted_at is null
  ) then
    raise exception 'Agente inexistente ou inativo' using errcode = '23514';
  end if;

  insert into public.process_tasks (legal_process_id, legal_case_id, title, instructions, agent_id, due_at, priority, created_by)
  values (p_legal_process_id, v_case, btrim(p_title), btrim(p_instructions), p_agent_id, p_due_at,
          coalesce(nullif(p_priority, ''), 'NORMAL'), auth.uid())
  returning * into v_task;

  perform private.process_task_event(v_task, 'Tarefa para os agentes: ' || v_task.title, v_task.instructions);
  if coalesce(p_send, true) then
    v_run := private.process_task_enqueue(v_task.id);
  end if;
  return jsonb_build_object('task_id', v_task.id, 'agent_run_id', v_run,
    'status', (select t.status from public.process_tasks t where t.id = v_task.id));
end
$$;

-- Envia de novo (aberta, devolvida ou falhou), com observação opcional.
create or replace function public.send_process_task(p_task_id uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_run    uuid;
begin
  if not private.has_internal_role('ADMIN', 'LAWYER') then
    raise exception 'Somente ADMIN ou advogado envia tarefa aos agentes' using errcode = '42501';
  end if;
  select t.status into v_status from public.process_tasks t where t.id = p_task_id for update;
  if v_status is null then
    raise exception 'Tarefa não encontrada' using errcode = '42501';
  end if;
  if v_status not in ('OPEN', 'IN_REVIEW') then
    raise exception 'Esta tarefa já está com os agentes ou foi encerrada' using errcode = 'P0001';
  end if;
  v_run := private.process_task_enqueue(p_task_id, p_note);
  return jsonb_build_object('task_id', p_task_id, 'agent_run_id', v_run,
    'status', (select t.status from public.process_tasks t where t.id = p_task_id));
end
$$;

-- O "check": a pessoa confere e conclui.
create or replace function public.complete_process_task(p_task_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.process_tasks;
begin
  if not private.has_internal_role('ADMIN', 'LAWYER') then
    raise exception 'Somente ADMIN ou advogado conclui tarefa' using errcode = '42501';
  end if;
  update public.process_tasks
     set status = 'DONE', completed_at = now(), completed_by = auth.uid(),
         completion_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_task_id and status not in ('DONE', 'CANCELLED')
  returning * into v_task;
  if v_task.id is null then
    raise exception 'Tarefa não encontrada ou já encerrada' using errcode = 'P0001';
  end if;
  perform private.process_task_event(v_task, 'Tarefa concluída: ' || v_task.title,
    coalesce(v_task.completion_note, 'Conferida e concluída pela equipe.'));
end
$$;

create or replace function public.cancel_process_task(p_task_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.process_tasks;
begin
  if not private.has_internal_role('ADMIN', 'LAWYER') then
    raise exception 'Somente ADMIN ou advogado cancela tarefa' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Informe o motivo do cancelamento' using errcode = '22023';
  end if;
  update public.process_tasks
     set status = 'CANCELLED', cancelled_at = now(), cancel_reason = btrim(p_reason)
   where id = p_task_id and status not in ('DONE', 'CANCELLED')
  returning * into v_task;
  if v_task.id is null then
    raise exception 'Tarefa não encontrada ou já encerrada' using errcode = 'P0001';
  end if;
  -- Execução ainda na fila: pede a interrupção (o agente não começa).
  if v_task.agent_run_id is not null and exists (
    select 1 from public.agent_runs r where r.id = v_task.agent_run_id and r.status in ('QUEUED', 'RUNNING')
  ) then
    perform private.request_agent_run_cancel(v_task.agent_run_id);
  end if;
  perform private.process_task_event(v_task, 'Tarefa cancelada: ' || v_task.title, v_task.cancel_reason);
end
$$;

create or replace function public.save_process_task_settings(p_orchestrator_agent_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'Somente ADMIN escolhe o orquestrador' using errcode = '42501';
  end if;
  if p_orchestrator_agent_id is not null and not exists (
    select 1 from public.agents a where a.id = p_orchestrator_agent_id and a.status = 'ACTIVE' and a.deleted_at is null
  ) then
    raise exception 'Agente inexistente ou inativo' using errcode = '23514';
  end if;
  update public.process_task_settings
     set orchestrator_agent_id = p_orchestrator_agent_id, updated_by = auth.uid(), updated_at = now()
   where id;
  perform private.record_audit_event('PROCESS_TASK_SETTINGS_UPDATED', 'process_task_settings', null,
    jsonb_build_object('orchestrator_agent_id', p_orchestrator_agent_id));
end
$$;

-- Agentes que podem receber tarefa (ativos) e o orquestrador atual, para a
-- tela de quem cria tarefas (LAWYER não lê a tabela de agentes, só ADMIN).
create or replace function public.list_task_agents()
returns table (id uuid, name text, purpose text, is_orchestrator boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.name, a.purpose,
         a.id is not distinct from private.process_task_orchestrator()
  from public.agents a
  where private.has_internal_role('ADMIN', 'LAWYER')
    and a.status = 'ACTIVE' and a.deleted_at is null
  order by a.name
$$;

-- ───────────────────────────── acompanha a execução ──────────────────────
-- A situação da tarefa segue a execução atual, venha a mudança do MCP do
-- escritório, da manutenção ou de uma interrupção.
create or replace function private.process_tasks_follow_run()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.process_tasks;
begin
  select * into v_task from public.process_tasks t
   where t.agent_run_id = new.id and t.status not in ('DONE', 'CANCELLED')
   for update;
  if v_task.id is null then
    return null;
  end if;
  if new.status = 'RUNNING' then
    update public.process_tasks set status = 'IN_PROGRESS' where id = v_task.id;
  elsif new.status = 'QUEUED' then
    -- Computador parou de responder: a execução volta para a fila.
    update public.process_tasks set status = 'QUEUED' where id = v_task.id;
  elsif new.status in ('WAITING_HUMAN', 'COMPLETED') then
    update public.process_tasks set status = 'IN_REVIEW' where id = v_task.id and status <> 'IN_REVIEW';
    if v_task.status <> 'IN_REVIEW' then
      perform private.process_task_event(v_task, 'Tarefa entregue pelo agente: ' || v_task.title,
        'Aguardando a revisão da equipe (Revisões) e o check de concluída.', 'AGENT');
    end if;
  elsif new.status in ('FAILED', 'CANCELLED') then
    update public.process_tasks
       set status = 'OPEN',
           last_error = left(coalesce(case when new.status = 'CANCELLED' then 'Execução interrompida.' end,
                                      new.error_message, 'O agente não concluiu a tarefa.'), 1000)
     where id = v_task.id;
  end if;
  return null;
end
$$;

create trigger agent_runs_process_tasks
  after update of status on public.agent_runs
  for each row when (new.status is distinct from old.status)
  execute function private.process_tasks_follow_run();

-- ───────────────────────────── grants ────────────────────────────────────

revoke all on function public.create_process_task(uuid, text, text, uuid, timestamptz, text, boolean) from public, anon;
revoke all on function public.send_process_task(uuid, text) from public, anon;
revoke all on function public.complete_process_task(uuid, text) from public, anon;
revoke all on function public.cancel_process_task(uuid, text) from public, anon;
revoke all on function public.save_process_task_settings(uuid) from public, anon;
grant execute on function public.create_process_task(uuid, text, text, uuid, timestamptz, text, boolean) to authenticated;
grant execute on function public.send_process_task(uuid, text) to authenticated;
grant execute on function public.complete_process_task(uuid, text) to authenticated;
grant execute on function public.cancel_process_task(uuid, text) to authenticated;
grant execute on function public.save_process_task_settings(uuid) to authenticated;
revoke all on function public.list_task_agents() from public, anon;
grant execute on function public.list_task_agents() to authenticated;

revoke all on function private.process_task_event(public.process_tasks, text, text, text) from public, anon, authenticated;
revoke all on function private.process_task_request(public.process_tasks, text) from public, anon, authenticated;
revoke all on function private.process_task_agent(public.process_tasks) from public, anon, authenticated;
revoke all on function private.process_task_orchestrator() from public, anon, authenticated;
revoke all on function private.process_task_enqueue(uuid, text) from public, anon, authenticated;
revoke all on function private.process_tasks_follow_run() from public, anon, authenticated;
