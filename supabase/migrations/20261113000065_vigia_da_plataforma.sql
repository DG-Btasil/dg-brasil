-- 065 · Operação em produção: vigia diária da plataforma, expurgo dos pedidos
--       vencidos e contador de consultas pagas no banco.
--
-- Achados da revisão final (antes da produção):
--
--   1. Ninguém era avisado quando algo quebrava. O agendador do banco podia
--      falhar por dias, um trabalho de agente podia ficar parado na fila e o
--      computador do escritório podia sumir sem que ninguém soubesse.
--      private.platform_watch() roda uma vez por dia útil, de manhã (08:30 de
--      Brasília, agendamento dg-vigia-da-plataforma), e avisa os ADMIN ativos
--      do escritório quando:
--        a) algum agendamento do pg_cron falhou desde a última conferência
--           (24 h; na segunda-feira, 72 h, para cobrir o fim de semana);
--        b) com a execução ligada, há trabalho de agente na fila há mais de
--           24 h (na segunda, o fim de semana não conta);
--        c) com a execução ligada, nenhum computador do escritório faz contato
--           há mais de 3 dias (ou não há nenhum autorizado).
--      Um aviso por motivo por dia e por pessoa (a chave do aviso leva o motivo
--      e o dia, e private.notify não repete a mesma chave). O tipo é
--      SECURITY_NOTICE: categoria que a pessoa não consegue desligar. Sem
--      motivo, não avisa nada. Um motivo que falhe ao conferir não impede os
--      outros. A função não corrige nada: só avisa.
--      Os limites (24 h, 3 dias) são parâmetros com padrão; mudar é trocar o
--      comando do agendamento.
--   2. private.purge_expired_agent_run_inputs() (012) existia e nunca rodava:
--      o texto livre do pedido ao agente, que pode trazer dado pessoal, ficava
--      para sempre, e o supabase/README.md promete 180 dias. Passa a rodar todo
--      dia (dg-expurgo-de-pedidos). A função não muda.
--   3. O limite de consultas de CPF na Receita (pagas por consulta) era contado
--      na memória de cada instância do servidor: com várias instâncias, o
--      limite real era o limite vezes o número de instâncias.
--      public.consume_rate_limit('lookup.cpf') conta no banco, por pessoa: 15
--      por minuto, somando todas as instâncias. A lista de limites é fechada
--      aqui (o servidor não manda o número) e a chave leva só o id da pessoa,
--      nunca o CPF consultado. O servidor mantém o contador em memória como
--      reserva, para quando esta função não responder.
--
-- Não define retenção de notifications, judicial_sync_runs, audit_events nem de
-- nenhuma outra tabela: é decisão da dona do escritório.
-- As migrations 001–064 não são alteradas. private.notify não é redefinida.

-- ═════════════════════════════ 1. vigia diária ════════════════════════════

create or replace function private.platform_watch(p_queue_hours integer default 24, p_silent_days integer default 3)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_local    timestamp := now() at time zone 'America/Sao_Paulo';
  v_day      text := to_char(v_local, 'YYYY-MM-DD');
  -- Segunda-feira: sábado e domingo não contam como atraso.
  v_weekend  interval := case when extract(isodow from v_local) = 1 then interval '48 hours' else interval '0' end;
  v_window   interval := interval '24 hours' + v_weekend;
  v_hours    integer := 24 + case when extract(isodow from v_local) = 1 then 48 else 0 end;
  v_enabled  boolean := false;
  v_failed   integer := 0;
  v_jobs     text;
  v_stuck    integer := 0;
  v_active   integer := 0;
  v_last     timestamptz;
  v_silent   boolean := false;
  v_notified integer := 0;
  v_errors   text[] := '{}';
  v_to       uuid;
begin
  if p_queue_hours is null or p_queue_hours < 1 or p_queue_hours > 720 then
    raise exception 'Horas na fila: de 1 a 720' using errcode = '22023';
  end if;
  if p_silent_days is null or p_silent_days < 1 or p_silent_days > 60 then
    raise exception 'Dias sem contato: de 1 a 60' using errcode = '22023';
  end if;

  -- a) Agendador. O corte é pelo runid (que cresce com o tempo), como na 057:
  --    execução que nem começou fica sem horário e entraria ou sairia errado
  --    num corte só por data. Sem pg_cron (testes locais sem a simulação): pula.
  begin
    if to_regclass('cron.job_run_details') is not null then
      execute $q$
        with corte as (
          select coalesce(max(d.runid), 0) as runid
          from cron.job_run_details d
          where coalesce(d.end_time, d.start_time) < now() - $1
        ), falhas as (
          select coalesce(j.jobname, 'agendamento ' || d.jobid) as nome, count(*) as n
          from cron.job_run_details d
          left join cron.job j on j.jobid = d.jobid
          where d.status = 'failed' and d.runid > (select runid from corte)
          group by 1
        )
        select coalesce(sum(n), 0)::integer,
               left(string_agg(nome || ' (' || n || ')', ', ' order by n desc, nome), 400)
        from falhas
      $q$ into v_failed, v_jobs using v_window;
    end if;
  exception when others then
    v_failed := 0;
    v_errors := v_errors || ('agendador: ' || left(sqlerrm, 200));
  end;

  -- b) e c) só fazem sentido com a execução ligada: desligada, fila parada e
  --    computador calado são o esperado.
  begin
    v_enabled := coalesce((select s.execution_enabled from public.ai_runtime_settings s where s.id), false);
    if v_enabled then
      select count(*)::integer into v_stuck
      from public.agent_runs r
      where r.status = 'QUEUED' and r.cancel_requested_at is null
        and r.created_at < now() - make_interval(hours => p_queue_hours) - v_weekend;

      -- Computador recém-autorizado conta a partir da autorização.
      select count(*)::integer, max(coalesce(e.last_seen_at, e.created_at)) into v_active, v_last
      from public.executors e
      where e.revoked_at is null;
      v_silent := v_last is null or v_last < now() - make_interval(days => p_silent_days);
    end if;
  exception when others then
    v_stuck := 0;
    v_silent := false;
    v_errors := v_errors || ('fila: ' || left(sqlerrm, 200));
  end;

  if v_failed > 0 or v_stuck > 0 or v_silent then
    for v_to in select * from private.active_admin_ids() loop
      if v_failed > 0 and private.notify(v_to, 'SECURITY_NOTICE',
           'Rotinas automáticas do sistema falharam',
           case when v_failed = 1 then '1 execução de rotina automática falhou' else v_failed || ' execuções de rotinas automáticas falharam' end
             || ' nas últimas ' || v_hours || ' horas: ' || coalesce(v_jobs, 'sem nome') || '. Peça para o responsável técnico verificar.',
           'WARNING', 'watch:cron:' || v_day) then
        v_notified := v_notified + 1;
      end if;
      if v_stuck > 0 and private.notify(v_to, 'SECURITY_NOTICE',
           'Trabalhos de agente parados na fila',
           case when v_stuck = 1 then 'Há 1 trabalho de agente' else 'Há ' || v_stuck || ' trabalhos de agente' end
             || ' na fila há mais de ' || p_queue_hours || ' horas, com a execução ligada. '
             || 'Confira se a Vigia está aberta no computador do escritório (DG Brasil → Computador do escritório).',
           'WARNING', 'watch:queue:' || v_day) then
        v_notified := v_notified + 1;
      end if;
      if v_silent and private.notify(v_to, 'SECURITY_NOTICE',
           'O computador do escritório não faz contato',
           case when v_active = 0
                then 'A execução está ligada, mas não há nenhum computador autorizado. '
                else 'A execução está ligada, mas nenhum computador do escritório faz contato há mais de ' || p_silent_days || ' dias. ' end
             || 'Abra a Vigia no computador do escritório ou confira em DG Brasil → Computador do escritório. '
             || 'Se o escritório não está usando os agentes, desligue a execução.',
           'WARNING', 'watch:executor:' || v_day) then
        v_notified := v_notified + 1;
      end if;
    end loop;
  end if;

  return jsonb_build_object(
    'day', v_day, 'window_hours', v_hours, 'execution_enabled', v_enabled,
    'cron_failed', v_failed, 'queue_stuck', v_stuck, 'executors_silent', v_silent,
    'notified', v_notified, 'errors', to_jsonb(v_errors));
end
$$;

comment on function private.platform_watch(integer, integer) is
  'Vigia diária (065): avisa os ADMIN ativos (SECURITY_NOTICE) sobre falha no agendador, fila de agentes parada e computador do escritório sem contato. Um aviso por motivo por dia. Só avisa; não corrige.';

-- Só o agendador (dono da função) executa.
revoke all on function private.platform_watch(integer, integer) from public, anon, authenticated, service_role;

-- ═════════════════════════════ 2. contador de consultas ═══════════════════

create table public.rate_limit_hits (
  id     bigint generated always as identity primary key,
  -- "<limite>:user:<id da pessoa>". Nunca o dado consultado.
  bucket text not null check (bucket ~ '^[a-z0-9_.:-]{3,120}$'),
  hit_at timestamptz not null default now()
);

comment on table public.rate_limit_hits is
  'Usos recentes de operações com limite por pessoa (065). Só a chave do limite e a hora; sem dado de cliente. Linhas com mais de 1 hora são apagadas no uso seguinte da mesma chave.';

create index rate_limit_hits_bucket_idx on public.rate_limit_hits (bucket, hit_at desc);

alter table public.rate_limit_hits enable row level security;
revoke all on public.rate_limit_hits from public, anon, authenticated, service_role;
-- Leitura e escrita só pela função abaixo.

-- Consome UM uso do limite, se houver. A lista de limites é fechada aqui: o
-- servidor (e quem chamar a API direto) só escolhe o nome. Chamar direto não
-- contorna nada: só gasta o próprio limite.
create or replace function private.consume_rate_limit(p_scope text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user   uuid := auth.uid();
  v_limit  integer;
  v_window interval;
  v_bucket text;
  v_count  integer;
  v_oldest timestamptz;
  v_now    timestamptz := clock_timestamp();
begin
  if v_user is null then
    raise exception 'Sessão necessária' using errcode = '42501';
  end if;
  if p_scope = 'lookup.cpf' then
    -- Consulta de CPF na Receita (Serpro): paga por consulta.
    v_limit := 15; v_window := interval '60 seconds';
  else
    raise exception 'Limite desconhecido' using errcode = '22023';
  end if;

  v_bucket := p_scope || ':user:' || v_user;
  -- Uma chamada por vez por chave: duas instâncias do servidor não passam juntas do limite.
  perform pg_advisory_xact_lock(hashtextextended(v_bucket, 0));
  delete from public.rate_limit_hits h where h.bucket = v_bucket and h.hit_at < v_now - interval '1 hour';

  select count(*)::integer, min(h.hit_at) into v_count, v_oldest
  from public.rate_limit_hits h
  where h.bucket = v_bucket and h.hit_at > v_now - v_window;

  if v_count >= v_limit then
    return jsonb_build_object('allowed', false,
      'retry_after_seconds', greatest(1, ceil(extract(epoch from (v_oldest + v_window - v_now)))::integer));
  end if;
  insert into public.rate_limit_hits (bucket, hit_at) values (v_bucket, v_now);
  return jsonb_build_object('allowed', true, 'retry_after_seconds', 0);
end
$$;

revoke all on function private.consume_rate_limit(text) from public, anon, authenticated, service_role;
grant execute on function private.consume_rate_limit(text) to authenticated;

create or replace function public.consume_rate_limit(p_scope text)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.consume_rate_limit(p_scope) $$;

revoke all on function public.consume_rate_limit(text) from public, anon, service_role;
grant execute on function public.consume_rate_limit(text) to authenticated;

-- ═════════════════════════════ 3. agendamentos ════════════════════════════
-- Horários em UTC (o pg_cron do Supabase roda em UTC). cron.schedule com nome é
-- idempotente: repetir atualiza o horário e o comando.
--   dg-vigia-da-plataforma: 11:30 UTC = 08:30 de Brasília, de segunda a sexta.
--   dg-expurgo-de-pedidos:  06:27 UTC = 03:27 de Brasília, todo dia.

do $$
begin
  if to_regnamespace('cron') is not null then
    perform cron.schedule('dg-vigia-da-plataforma', '30 11 * * 1-5', 'select private.platform_watch()');
    perform cron.schedule('dg-expurgo-de-pedidos', '27 6 * * *', 'select private.purge_expired_agent_run_inputs()');
  else
    raise notice 'pg_cron indisponível: agende private.platform_watch() (dias úteis) e private.purge_expired_agent_run_inputs() (diário)';
  end if;
end
$$;
