-- 057 · Busca judicial: aviso de falha no máximo duas vezes por dia; limpeza do
--       histórico do agendador.
--
-- Achados da revisão pré-produção (docs/deploy/organizacao-pre-producao.md):
--
--   1. private.judicial_sync_finish (043) avisava todos os ADMIN a cada rodada
--      PARTIAL ou FAILED. A chave do aviso levava o id da rodada, então nunca
--      era tratada como repetida: com o DataJud instável, um aviso a cada 5 min
--      por pessoa (no DEV, 91 mil avisos em 8 dias).
--      Agora a chave é o dia e o período (manhã ou tarde, horário de Brasília):
--      cada ADMIN recebe NO MÁXIMO DOIS avisos por dia, o da primeira falha de
--      cada período. A rodada continua registrada com situação, números e erro
--      em judicial_sync_runs; o que muda é só a repetição do aviso.
--   2. cron.job_run_details guarda uma linha por execução de agendamento e o
--      pg_cron nunca apaga: ~1.700 linhas por dia. private.cron_history_housekeeping
--      apaga o que tem mais de 7 dias, uma vez por dia (dg-limpeza-do-agendador).
--   3. A 037 agendava dg-deadline-reminders quando o pg_cron já estava ligado, e
--      a 040 agendou dg-lembretes-de-prazo para a mesma função sem remover o
--      anterior. Num projeto novo ficariam os dois. Remove o antigo, se existir.

-- ═════════════════════════════ 1. aviso da busca judicial ═════════════════

create or replace function private.judicial_sync_finish(p_run_id uuid, p_status text, p_stats jsonb, p_error text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_to    uuid;
  v_local timestamp := now() at time zone 'America/Sao_Paulo';
  v_key   text;
begin
  if p_status not in ('COMPLETED', 'PARTIAL', 'FAILED') then
    raise exception 'Situação inválida' using errcode = '22023';
  end if;
  update public.judicial_sync_runs
     set status = p_status, finished_at = now(), stats = coalesce(p_stats, '{}'),
         error = left(nullif(btrim(coalesce(p_error, '')), ''), 1000)
   where id = p_run_id and status = 'RUNNING';
  if found and p_status in ('PARTIAL', 'FAILED') then
    -- Um aviso por pessoa por período: jsync:2026-11-13:am | jsync:2026-11-13:pm.
    v_key := 'jsync:' || to_char(v_local, 'YYYY-MM-DD') || case when extract(hour from v_local) < 12 then ':am' else ':pm' end;
    for v_to in select * from private.active_admin_ids() loop
      perform private.notify(v_to, 'JUDICIAL_SYNC_FAILED',
        case when p_status = 'FAILED' then 'A busca de publicações e andamentos falhou' else 'A busca de publicações e andamentos terminou com falhas' end,
        coalesce(left(nullif(btrim(coalesce(p_error, '')), ''), 300), 'Veja os detalhes em Configurações → Integrações.'),
        'WARNING', v_key);
    end loop;
  end if;
end
$$;

-- ═════════════════════════════ 2. histórico do agendador ══════════════════

-- Apaga as execuções antigas de cron.job_run_details. O corte é pelo runid (que
-- cresce com o tempo), para levar junto as linhas sem horário: execução que nem
-- chegou a começar ("job startup timeout") fica com start_time e end_time nulos.
-- Sem pg_cron (testes locais), não faz nada.
create or replace function private.cron_history_housekeeping(p_keep interval default interval '7 days')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_last    bigint;
  v_deleted integer := 0;
begin
  if p_keep is null or p_keep < interval '1 day' then
    raise exception 'Guarde pelo menos 1 dia de histórico' using errcode = '22023';
  end if;
  if to_regclass('cron.job_run_details') is null then
    return 0;
  end if;
  execute 'select max(runid) from cron.job_run_details where coalesce(end_time, start_time) < now() - $1'
    into v_last using p_keep;
  if v_last is null then
    return 0;
  end if;
  execute 'delete from cron.job_run_details where runid <= $1' using v_last;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end
$$;

revoke all on function private.cron_history_housekeeping(interval) from public, anon, authenticated, service_role;

do $$
begin
  if to_regnamespace('cron') is not null then
    perform cron.schedule('dg-limpeza-do-agendador', '43 6 * * *', 'select private.cron_history_housekeeping()');
  else
    raise notice 'pg_cron indisponível: nada a limpar';
  end if;
end
$$;

-- ═════════════════════════════ 3. agendamento duplicado ═══════════════════

do $$
begin
  if to_regnamespace('cron') is not null
     and to_regprocedure('cron.unschedule(text)') is not null
     and exists (select 1 from cron.job where jobname = 'dg-deadline-reminders') then
    execute 'select cron.unschedule($1)' using 'dg-deadline-reminders';
  end if;
exception when others then
  raise notice 'dg-deadline-reminders não removido (%): remova com select cron.unschedule(''dg-deadline-reminders'')', sqlerrm;
end
$$;
