-- 052 · "Verificar agora": a Vigia processa a fila na hora, sem esperar os 15 min.
--
-- A sessão Vigia (docs/mcp/instalacao.md, seção 6) roda o roteiro a cada 15
-- minutos pelo /loop do Claude Code. Entre uma rodada e outra, o comando
-- "dg-executor esperar" fica em segundo plano consultando o DG Brasil; quando
-- ele termina, o Claude Code acorda a sessão e ela roda o roteiro na hora.
--
-- A fila é do escritório, não de um computador (qualquer computador autorizado
-- reserva qualquer trabalho). Por isso o pedido também é do escritório: um
-- pedido pendente por vez, e a primeira Vigia que consultar fica com ele.
--
--   1. executor_wake_requests: o pedido (quem pediu, quando, qual computador
--      atendeu e quando). Sem dado de cliente. Vale 10 minutos: depois disso
--      vira EXPIRED e não acorda ninguém (uma Vigia aberta horas depois não
--      roda por um clique antigo).
--   2. dg_request_executor_wake (tela): ADMIN ou LAWYER pede. Um pedido
--      pendente por vez: clicar de novo devolve o mesmo pedido.
--   3. get_executor_wake_status (tela): o último pedido, para a tela mostrar
--      "pedido enviado", "atendido às HH:MM" ou "a Vigia não respondeu".
--   4. executor_wake_poll (computador, dg_worker): diz se há pedido e já o
--      marca como atendido, de forma atômica (FOR UPDATE SKIP LOCKED + um
--      pendente por vez): duas Vigias nunca ficam com o mesmo pedido. Devolve
--      também se a execução está ligada e a hora do trabalho mais novo da fila
--      (só a hora: nem cliente, nem caso, nem agente).

-- ═════════════════════════════ 1. pedido ═════════════════════════════════

create table public.executor_wake_requests (
  id                      uuid primary key default gen_random_uuid(),
  organization_id         uuid not null references public.organizations (id) on delete restrict,
  status                  text not null default 'PENDING' check (status in ('PENDING', 'ATTENDED', 'EXPIRED')),
  requested_by            uuid not null references public.profiles (id) on delete restrict,
  requested_at            timestamptz not null default now(),
  attended_at             timestamptz,
  attended_by_executor_id uuid references public.executors (id) on delete restrict,
  expired_at              timestamptz,
  constraint executor_wake_requests_attended check (
    (status = 'ATTENDED') = (attended_at is not null and attended_by_executor_id is not null)),
  constraint executor_wake_requests_expired check ((status = 'EXPIRED') = (expired_at is not null))
);

comment on table public.executor_wake_requests is
  'Pedidos de "Verificar agora" para a sessão Vigia (052). Um pendente por escritório; sem dado de cliente.';

create unique index executor_wake_requests_one_pending
  on public.executor_wake_requests (organization_id) where status = 'PENDING';
create index executor_wake_requests_recent_idx
  on public.executor_wake_requests (organization_id, requested_at desc);

alter table public.executor_wake_requests enable row level security;
revoke all on public.executor_wake_requests from public, anon, authenticated, service_role;
-- Leitura e escrita só pelas funções abaixo.

-- Pedido pendente há mais de 10 minutos não acorda mais ninguém.
create or replace function private.executor_wake_expire(p_organization_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.executor_wake_requests
     set status = 'EXPIRED', expired_at = now()
   where organization_id = p_organization_id
     and status = 'PENDING'
     and requested_at < now() - interval '10 minutes'
$$;

-- ═════════════════════════════ 2 e 3. tela ═══════════════════════════════

create or replace function private.get_executor_wake_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_out jsonb;
begin
  if auth.uid() is null or not private.is_internal_user() then
    raise exception 'Somente a equipe interna' using errcode = '42501';
  end if;
  select organization_id into v_org from private.current_membership();
  select jsonb_build_object(
    'id', w.id,
    -- Pendente vencido aparece como EXPIRED mesmo antes de alguém gravar isso.
    'status', case when w.status = 'PENDING' and w.requested_at < now() - interval '10 minutes'
                   then 'EXPIRED' else w.status end,
    'requested_at', w.requested_at,
    'requested_by_name', p.full_name,
    'attended_at', w.attended_at,
    -- O nome do computador segue a regra da 040: só o ADMIN vê a lista.
    'attended_by_name', case when private.is_admin() then e.name end)
  into v_out
  from public.executor_wake_requests w
  left join public.profiles p on p.id = w.requested_by
  left join public.executors e on e.id = w.attended_by_executor_id
  where w.organization_id = v_org
  order by w.requested_at desc
  limit 1;
  return jsonb_build_object(
    'can_request', private.has_internal_role('ADMIN', 'LAWYER'),
    'last', v_out);
end
$$;

create or replace function private.dg_request_executor_wake()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_id  uuid;
  v_new boolean := false;
begin
  if auth.uid() is null or not private.has_internal_role('ADMIN', 'LAWYER') then
    raise exception 'Só o administrador ou um advogado do escritório pede a verificação' using errcode = '42501';
  end if;
  if not private.worker_ai_enabled() then
    raise exception 'A execução pelo escritório está desligada: ligue em DG Brasil → Computador do escritório' using errcode = '22023';
  end if;
  select organization_id into v_org from private.current_membership();
  perform private.executor_wake_expire(v_org);

  insert into public.executor_wake_requests (organization_id, requested_by)
  values (v_org, auth.uid())
  on conflict (organization_id) where status = 'PENDING' do nothing
  returning id into v_id;
  if v_id is not null then
    v_new := true;
    perform private.record_audit_event('EXECUTOR_WAKE_REQUESTED', 'executor_wake_requests', v_id, '{}');
  else
    -- Já havia um pedido esperando: clicar de novo não cria outro.
    select id into v_id from public.executor_wake_requests
     where organization_id = v_org and status = 'PENDING';
  end if;
  return private.get_executor_wake_status() || jsonb_build_object('created', v_new);
end
$$;

-- ═════════════════════════════ 4. computador ═════════════════════════════

create or replace function private.executor_wake_poll(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exec public.executors;
  v_id   uuid;
begin
  v_exec := private.executor_require(p_token_hash, 'jobs.list');
  if not private.worker_ai_enabled() then
    -- Desligado: ninguém é acordado e o pedido não é consumido (vence sozinho).
    return jsonb_build_object('wake', false, 'execution_enabled', false, 'newest_job_at', null);
  end if;
  perform private.executor_wake_expire(v_exec.organization_id);

  -- Um pendente por escritório (índice único). Quem trancar primeiro fica com
  -- ele; a outra Vigia pula a linha trancada e recebe wake=false.
  update public.executor_wake_requests w
     set status = 'ATTENDED', attended_at = now(), attended_by_executor_id = v_exec.id
   where w.id = (select x.id from public.executor_wake_requests x
                  where x.organization_id = v_exec.organization_id and x.status = 'PENDING'
                  for update skip locked)
  returning w.id into v_id;

  return jsonb_build_object(
    'wake', v_id is not null,
    'execution_enabled', true,
    -- Para a opção "--fila" do esperar: só a hora do trabalho mais novo da fila.
    'newest_job_at', (select max(r.created_at) from public.agent_runs r
                      where r.status = 'QUEUED' and r.cancel_requested_at is null));
end
$$;

-- ═════════════════════════════ grants ════════════════════════════════════

revoke all on function private.executor_wake_expire(uuid) from public, anon, authenticated, service_role;
revoke all on function private.get_executor_wake_status() from public, anon, authenticated, service_role;
revoke all on function private.dg_request_executor_wake() from public, anon, authenticated, service_role;
revoke all on function private.executor_wake_poll(text) from public, anon, authenticated, service_role;

-- Tela (usuário logado; cada função confere o papel).
grant execute on function private.get_executor_wake_status() to authenticated;
grant execute on function private.dg_request_executor_wake() to authenticated;

create or replace function public.get_executor_wake_status()
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.get_executor_wake_status() $$;

create or replace function public.dg_request_executor_wake()
returns jsonb language sql security invoker set search_path = ''
as $$ select private.dg_request_executor_wake() $$;

revoke all on function public.get_executor_wake_status() from public, anon, service_role;
revoke all on function public.dg_request_executor_wake() from public, anon, service_role;
grant execute on function public.get_executor_wake_status() to authenticated;
grant execute on function public.dg_request_executor_wake() to authenticated;

-- Servidor do DG Brasil (login dg_worker): só a porta do computador.
grant execute on function private.executor_wake_poll(text) to dg_worker;
