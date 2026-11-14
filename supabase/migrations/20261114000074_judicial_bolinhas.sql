-- 074 · Integração judicial: bolinhas de conferência da captura.
--
-- A tela passa a mostrar, com um ponto colorido, se a captura foi conferida:
-- no DJEN, por OAB, com validade "hoje" (a regra fica toda no painel, com o
-- que o banco já devolve); no DataJud, por processo, com validade de 24 h. Na
-- tela do processo o painel também já tem o que precisa. Faltava o resumo de
-- Integrações ("X de Y processos lidos nas últimas 24 h · Z com falha"): o
-- banco devolvia os acompanhados (Y) e os com falha (Z), mas não o X.
--
--   1. private.get_judicial_overview() (definição vigente, da 062; nada depois
--      dela a redefine) ganha, em "processes", o campo synced_last_24h: os
--      processos acompanhados (sync_enabled) com leitura concluída nas últimas
--      24 h (last_synced_at >= now() - 24 h). Pausado não conta. O resto da
--      função fica igual.
--
-- Painel sem este campo (banco anterior à 074) mostra só "Y processos
-- acompanhados · Z com falha", sem quebrar.
--
-- Assinatura, security definer, search_path = '' e permissões ficam iguais
-- (create or replace mantém os grants; os revokes/grants abaixo só reafirmam).
--
-- Como desfazer: rodar de novo a definição de private.get_judicial_overview()
-- da 062 (o painel volta à linha sem o X).

-- ═════════════════════════════ 1. visão geral ═════════════════════════════

-- Visão geral da integração judicial (043/059/061/062). Novo (074):
--   - processes.synced_last_24h: acompanhados lidos nas últimas 24 h.
create or replace function private.get_judicial_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_s public.judicial_settings;
begin
  perform private.judicial_require_internal(false);
  select * into v_s from public.judicial_settings where id;
  return jsonb_build_object(
    'can_manage', private.is_admin(),
    'settings', jsonb_build_object(
      'djen_enabled', v_s.djen_enabled, 'datajud_enabled', v_s.datajud_enabled, 'lookback_days', v_s.lookback_days,
      'deadline_agent_id', v_s.deadline_agent_id,
      'deadline_agent_name', (select a.name from public.agents a where a.id = v_s.deadline_agent_id),
      'deadline_auto_apply', v_s.deadline_auto_apply,
      'deadline_auto_task', v_s.deadline_auto_task,
      'agent_timeout_hours', v_s.agent_timeout_hours,
      'updated_at', v_s.updated_at),
    'monitors', coalesce((select jsonb_agg(private.judicial_monitor_json(m, true)
                                           order by (o.type = 'OWNER') desc, o.name, m.active desc, m.oab_state, m.oab_number)
                          from public.judicial_monitors m join public.organizations o on o.id = m.organization_id), '[]'::jsonb),
    'runs', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'trigger', r.trigger, 'scope', r.scope, 'status', r.status,
                                                          'started_at', r.started_at, 'finished_at', r.finished_at,
                                                          'stats', r.stats, 'error', r.error) order by r.started_at desc)
                      from (select * from public.judicial_sync_runs order by started_at desc limit 10) r), '[]'::jsonb),
    'last_full_run', (select jsonb_build_object('id', r.id, 'trigger', r.trigger, 'status', r.status,
                                                'started_at', r.started_at, 'finished_at', r.finished_at)
                      from public.judicial_sync_runs r
                      where r.scope = 'ALL' and r.status <> 'RUNNING'
                      order by r.started_at desc limit 1),
    'capture', private.judicial_capture_health(),
    'processes', (select jsonb_build_object(
                    'tracked', count(*) filter (where r.sync_enabled),
                    'paused', count(*) filter (where not r.sync_enabled),
                    'never_synced', count(*) filter (where r.sync_enabled and r.last_synced_at is null),
                    'with_error', count(*) filter (where r.sync_enabled and r.last_error is not null),
                    'synced_last_24h', count(*) filter (where r.sync_enabled and r.last_synced_at >= now() - interval '24 hours'))
                  from public.process_external_refs r
                  join public.legal_processes p on p.id = r.legal_process_id and p.deleted_at is null and p.cnj_number = r.external_id
                  where r.provider = 'DATAJUD'),
    'publications', (select jsonb_build_object(
                       'pending', count(*) filter (where pb.triage_status = 'PENDING'),
                       'with_agent', count(*) filter (where pb.triage_status = 'WITH_AGENT'),
                       'done_last_30_days', count(*) filter (where pb.triage_status = 'DONE' and pb.triaged_at > now() - interval '30 days'))
                     from public.judicial_publications pb
                     join public.legal_processes lp on lp.id = pb.legal_process_id and lp.deleted_at is null),
    'agents', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name) order by a.name)
                        from public.agents a where a.status = 'ACTIVE' and a.deleted_at is null), '[]'::jsonb),
    'calendar', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'court', d.court, 'day', d.day, 'kind', d.kind,
                                                              'description', d.description) order by d.day, d.court nulls first)
                          from public.court_calendar_days d where d.day >= (now() at time zone 'America/Sao_Paulo')::date - 31), '[]'::jsonb));
end
$$;

revoke all on function private.get_judicial_overview() from public, anon, authenticated, service_role;
grant execute on function private.get_judicial_overview() to authenticated;
