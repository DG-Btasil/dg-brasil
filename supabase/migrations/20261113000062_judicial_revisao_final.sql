-- 062 · Integração judicial: correções da revisão final antes da produção.
--
-- Achados da revisão (captura de publicações e triagem). O que muda:
--
--   1. Publicação "Com o agente" passa a ter validade. Até a 061 ela só voltava
--      para "A tratar" quando o trabalho do agente terminava: com o computador
--      do escritório desligado, o trabalho ficava na fila para sempre, a tela
--      dizia "o agente está calculando o prazo" e nenhum prazo nascia.
--        - judicial_settings.agent_timeout_hours (padrão 4, horas corridas, de 1
--          a 72): quanto tempo a publicação espera o agente.
--        - private.judicial_release_stuck_publications(): devolve para a triagem
--          da equipe (PENDING) toda publicação WITH_AGENT sem prazo e sem
--          proposta viva quando (a) passou o tempo de espera, (b) o trabalho do
--          agente já terminou ou (c) a revisão da proposta terminou sem gerar
--          prazo ("alterações solicitadas": a proposta fica PENDING para sempre,
--          porque revisão de proposta não se reabre, 009). Avisa o responsável
--          pelo processo e os ADMIN ativos, uma vez por publicação.
--        - O trabalho que ficou na fila NÃO é cancelado (cancelar é da área dos
--          agentes e exige uma pessoa). Se o agente responder depois, a proposta
--          cai em Revisões: private.judicial_direct_deadline_check (059) já
--          recusa o prazo direto de publicação que não está mais WITH_AGENT.
--          Aprovada em Revisões, o gatilho da 043 agora fecha também a
--          publicação que tinha voltado para a triagem (antes ela ficava "A
--          tratar" com o prazo já criado, convite a um segundo prazo).
--        - "Tratar eu mesmo": judicial_publication_decide aceita TAKE_OVER
--          (WITH_AGENT → PENDING, por decisão de uma pessoa).
--        - A tela da publicação recebe desde quando ela está com o agente e a
--          situação do computador do escritório.
--   2. Captura que não rodou deixa de ser silenciosa.
--        - private.judicial_capture_health(): em dia útil, depois das 08:00 de
--          Brasília, com o DJEN ligado, diz se há OAB ativa sem busca concluída
--          no dia e por quê (nenhuma busca começou; ou começou e há OAB com
--          falha). Diz também se o agendador do banco está sem configuração
--          (pg_net, Vault ou os dois segredos): antes isso só virava um texto
--          devolvido ao pg_cron.
--        - private.judicial_watchdog(), a cada 15 min no pg_cron
--          (dg-judicial-vigia): solta as publicações do item 1 e avisa os ADMIN
--          ativos da captura atrasada, uma vez por dia por motivo.
--        - get_judicial_overview devolve "capture" (o estado acima) e
--          "last_full_run" (a última busca completa, mesmo que não esteja entre
--          as 10 últimas rodadas: depois de 10 lotes do DataJud a tela dizia
--          "Ainda não"). public.get_judicial_capture_alert() serve a faixa de
--          alerta da Home.
--        - Rodada interrompida (044) passa a avisar os ADMIN, com a mesma chave
--          do aviso de falha (057: no máximo dois por dia).
--   3. Janela do DJEN por OAB, pela prova de diligência. Antes toda busca lia
--      [hoje − dias revistos, hoje]: com 6 dias sem captura, publicação sumia
--      em definitivo. Agora cada dia dos últimos 30 só é dado como lido quando
--      foi conferido com sucesso "dias revistos" dias depois dele
--      (judicial_capture_days). O servidor lê primeiro a janela normal e depois
--      os dias antigos que faltam, em pedaços de até 7 dias, do mais antigo para
--      o mais novo. OAB nova: os 30 dias. A OAB com dia antigo por ler continua
--      na fila dos lotes até ficar em dia.
--   4. "Buscar agora" entre 00:00 e 05:00 marcava a OAB como conferida no dia e
--      o caderno das 03:00 só entrava na manhã seguinte: a OAB só conta como
--      conferida no dia com busca concluída a partir das 05:00.
--   5. Contador "Publicações a tratar" contava publicação de processo excluído,
--      que a lista não mostra: agora conta como a lista.
--   6. Teor cortado não entra direto. O pedido ao agente cabe em 20 mil
--      caracteres e o teor vai por último: publicação longa chegava sem o fim
--      (onde costuma estar o prazo). Agora o pedido leva o começo e o fim do
--      teor, avisa do corte, e o prazo proposto vai para Revisões.
--   7. Data local do prazo na publicação (due_on), para a tela não mostrar
--      "vence em há -10 dias".
--
-- Não muda: o esquema do calendário (court_calendar_days), private.notify,
-- private.notification_category (os avisos usam tipos que já existem),
-- lembretes de prazo, o aplicador de propostas e decide_review.
--
-- 001–061 não são alteradas (043 ganha uma coluna por ALTER; funções da 043,
-- 044, 059 e 061 são redefinidas aqui). Rodar de novo não quebra nem duplica.

-- ═════════════════════════════ 1. configuração ════════════════════════════

alter table public.judicial_settings
  add column if not exists agent_timeout_hours integer not null default 4;

alter table public.judicial_settings drop constraint if exists judicial_settings_agent_timeout_hours;
alter table public.judicial_settings
  add constraint judicial_settings_agent_timeout_hours check (agent_timeout_hours between 1 and 72);

comment on column public.judicial_settings.agent_timeout_hours is
  'Horas corridas que a publicação espera o agente de prazos (062). Passou disso sem prazo nem proposta, volta para a triagem da equipe e o responsável é avisado.';

-- ═════════════════════════════ 2. janela do DJEN por OAB ══════════════════

-- O dia mais antigo, dos últimos 30, que ainda precisa ser lido para uma OAB
-- (nulo = nada além da janela normal). Um dia D está em dia quando foi
-- conferido com sucesso em D + p_lookback ou depois: o DJEN libera parte das
-- publicações com atraso, por isso cada dia é relido por p_lookback dias. Dia
-- nunca conferido (OAB nova, OAB pausada, captura parada) também precisa.
create or replace function private.judicial_djen_gap_from(
  p_oab_number text, p_oab_state text, p_today date, p_lookback integer
)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select min(g.d)::date
  from generate_series(p_today - 30, p_today - greatest(coalesce(p_lookback, 5), 1) - 1, interval '1 day') as g(d)
  left join public.judicial_capture_days c
    on c.oab_number = p_oab_number and c.oab_state::text = upper(p_oab_state) and c.day = g.d::date
  where c.last_ok_at is null
     or (c.last_ok_at at time zone 'America/Sao_Paulo')::date < g.d::date + greatest(coalesce(p_lookback, 5), 1)
$$;

-- A OAB ainda não foi conferida HOJE? Só conta busca concluída a partir das
-- 05:00 de Brasília: o DJEN libera o caderno do dia às 03:00, e uma busca
-- pedida na tela de madrugada não pode dar o dia por conferido.
create or replace function private.judicial_djen_pending_today(
  p_oab_number text, p_oab_state text, p_now timestamptz default now()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(bool_or(
           s.last_success_at is null
           or s.last_success_at < (((p_now at time zone 'America/Sao_Paulo')::date + time '05:00') at time zone 'America/Sao_Paulo')), false)
  from public.judicial_monitors m
  join public.organizations o on o.id = m.organization_id and o.status = 'ACTIVE' and o.deleted_at is null
  left join public.judicial_monitor_status s on s.judicial_monitor_id = m.id
  where m.active and m.oab_number = p_oab_number and m.oab_state::text = upper(p_oab_state)
$$;

-- OABs que o agendador ainda precisa ler no DJEN (043). A partir das 05:00 de
-- Brasília: a OAB sem busca concluída no dia (desde as 05:00) e a OAB com dia
-- antigo por ler (062). Depois de uma tentativa, espera 10 min. Cada OAB uma
-- vez, mesmo que vários escritórios a acompanhem; a tentada há mais tempo
-- primeiro.
create or replace function private.judicial_djen_due(p_now timestamptz default now())
returns table (oab_number text, oab_state text, last_attempt timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select m.oab_number, m.oab_state::text, min(s.last_attempt_at)
  from public.judicial_monitors m
  join public.organizations o on o.id = m.organization_id and o.status = 'ACTIVE' and o.deleted_at is null
  left join public.judicial_monitor_status s on s.judicial_monitor_id = m.id
  where m.active
    and (p_now at time zone 'America/Sao_Paulo')::time >= time '05:00'
  group by m.oab_number, m.oab_state
  having coalesce(max(s.last_attempt_at), '-infinity'::timestamptz) < p_now - interval '10 minutes'
     and (bool_or(s.last_success_at is null
                  or s.last_success_at < (((p_now at time zone 'America/Sao_Paulo')::date + time '05:00') at time zone 'America/Sao_Paulo'))
          or private.judicial_djen_gap_from(
               m.oab_number, m.oab_state::text, (p_now at time zone 'America/Sao_Paulo')::date,
               (select x.lookback_days from public.judicial_settings x where x.id)) is not null)
$$;

-- Abre uma rodada (043/044). Novo (062):
--   - rodada interrompida avisa os ADMIN (mesma chave do aviso de falha da 057:
--     no máximo dois avisos por dia por pessoa);
--   - cada OAB vem com "essential" (ler a janela normal, [hoje − dias revistos,
--     hoje]) e "from" (o dia mais antigo que ainda falta ler, quando houver).
--     Agendada: essential só para a OAB ainda não conferida hoje. Pedida na
--     tela: sempre.
create or replace function private.judicial_sync_begin(
  p_trigger text, p_requested_by uuid default null, p_process_id uuid default null, p_only_datajud boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s     public.judicial_settings;
  v_run   uuid;
  v_stale integer;
  v_to    uuid;
  v_local timestamp := now() at time zone 'America/Sao_Paulo';
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if p_trigger not in ('CRON', 'MANUAL') then
    raise exception 'Origem inválida' using errcode = '22023';
  end if;
  if p_trigger = 'MANUAL' and (p_requested_by is null
     or coalesce(private.user_internal_role(p_requested_by)::text, '') not in ('ADMIN', 'LAWYER')
     or not coalesce(private.is_active_internal_user(p_requested_by), false)) then
    raise exception 'Busca manual só por ADMIN ou advogado ativo' using errcode = '42501';
  end if;
  if p_process_id is not null and p_trigger <> 'MANUAL' then
    raise exception 'Busca de um processo só é manual' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('dg-judicial-sync'));
  with x as (
    update public.judicial_sync_runs
       set status = 'FAILED', finished_at = now(), error = 'Interrompida (sem conclusão em 6 min).'
     where status = 'RUNNING' and started_at < now() - interval '6 minutes'
    returning id)
  select count(*) into v_stale from x;
  if v_stale > 0 then
    for v_to in select * from private.active_admin_ids() loop
      perform private.notify(v_to, 'JUDICIAL_SYNC_FAILED',
        'A busca de publicações e andamentos foi interrompida',
        'Uma busca começou e não terminou. A próxima continua de onde ela parou. Veja os detalhes em DG Brasil → Integrações.',
        'WARNING',
        'jsync:' || to_char(v_local, 'YYYY-MM-DD') || case when extract(hour from v_local) < 12 then ':am' else ':pm' end);
    end loop;
  end if;
  if p_process_id is null and exists (
    select 1 from public.judicial_sync_runs r
    where r.status = 'RUNNING' and (r.scope = 'ALL' or (coalesce(p_only_datajud, false) and r.scope = 'DATAJUD'))) then
    return jsonb_build_object('busy', true);
  end if;

  select * into v_s from public.judicial_settings where id;
  -- Agendada sem nada a fazer (nenhuma OAB pendente, nenhum processo vencido no
  -- DataJud): não abre rodada (não polui o histórico).
  if p_trigger = 'CRON'
     and (coalesce(p_only_datajud, false) or not v_s.djen_enabled or not exists (select 1 from private.judicial_djen_due()))
     and (not v_s.datajud_enabled or jsonb_array_length(private.judicial_datajud_queue(1, null)) = 0) then
    return jsonb_build_object('busy', false, 'idle', true);
  end if;
  insert into public.judicial_sync_runs (trigger, requested_by, scope)
  values (p_trigger, p_requested_by,
          case when p_process_id is not null then 'PROCESS' when coalesce(p_only_datajud, false) then 'DATAJUD' else 'ALL' end)
  returning id into v_run;

  return jsonb_build_object(
    'busy', false, 'idle', false, 'run_id', v_run,
    'djen_enabled', v_s.djen_enabled and p_process_id is null and not coalesce(p_only_datajud, false),
    'datajud_enabled', v_s.datajud_enabled or p_process_id is not null,
    'lookback_days', v_s.lookback_days,
    'today', v_today,
    -- Uma consulta por OAB, mesmo que vários escritórios a acompanhem.
    -- Agendada: as OABs ainda não conferidas hoje e as com dia antigo por ler
    -- (lotes até todas ficarem em dia).
    'oabs', case when p_trigger = 'CRON' and not coalesce(p_only_datajud, false) then coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                         'oab_number', x.oab_number, 'oab_state', x.oab_state,
                         'essential', private.judicial_djen_pending_today(x.oab_number, x.oab_state),
                         'from', private.judicial_djen_gap_from(x.oab_number, x.oab_state, v_today, v_s.lookback_days)))
                       order by x.last_attempt nulls first, x.oab_state, x.oab_number)
      from private.judicial_djen_due() x), '[]'::jsonb)
    -- Manual ("Buscar agora"): todas as OABs ativas.
    when p_process_id is null and not coalesce(p_only_datajud, false) then coalesce((
      -- A OAB consultada há mais tempo primeiro: se o tempo da rodada acabar,
      -- a próxima começa pelas que ficaram de fora.
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                         'oab_number', x.oab_number, 'oab_state', x.oab_state, 'essential', true,
                         'from', private.judicial_djen_gap_from(x.oab_number, x.oab_state, v_today, v_s.lookback_days)))
                       order by x.last_attempt nulls first, x.oab_state, x.oab_number)
      from (select m.oab_number, m.oab_state::text as oab_state, min(s.last_attempt_at) as last_attempt
            from public.judicial_monitors m
            join public.organizations o on o.id = m.organization_id and o.status = 'ACTIVE' and o.deleted_at is null
            left join public.judicial_monitor_status s on s.judicial_monitor_id = m.id
            where m.active
            group by m.oab_number, m.oab_state) x), '[]'::jsonb) else '[]'::jsonb end);
end
$$;

-- ═════════════════════════════ 3. a captura rodou hoje? ═══════════════════

-- Por que o agendador do banco (private.judicial_cron_kick, 043) não consegue
-- chamar a busca em lotes (nulo = está configurado). Antes isso só virava um
-- texto devolvido ao pg_cron, que ninguém lê.
create or replace function private.judicial_cron_config_problem()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_url    text;
  v_secret text;
begin
  if to_regnamespace('net') is null or to_regclass('vault.decrypted_secrets') is null then
    return 'pg_net ou Vault indisponível';
  end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1' into v_url using 'dg_app_url';
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1' into v_secret using 'dg_cron_secret';
  if nullif(btrim(coalesce(v_url, '')), '') is null or nullif(btrim(coalesce(v_secret, '')), '') is null then
    return 'segredos dg_app_url/dg_cron_secret ausentes';
  end if;
  return null;
end
$$;

-- Estado da captura do DJEN no dia. "applies": dia útil (segunda a sexta, fora
-- feriado nacional e Sexta-feira Santa), depois das 08:00 de Brasília, com o
-- DJEN ligado e ao menos uma OAB ativa. "late": há OAB sem busca concluída no
-- dia (desde as 05:00). "reason": NOT_RUN (nenhuma busca começou hoje) ou
-- OAB_FAILED (as buscas rodaram e alguma OAB não foi conferida).
create or replace function private.judicial_capture_health(p_now timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_s        public.judicial_settings;
  v_local    timestamp := p_now at time zone 'America/Sao_Paulo';
  v_today    date := (p_now at time zone 'America/Sao_Paulo')::date;
  v_since    timestamptz := (((p_now at time zone 'America/Sao_Paulo')::date + time '05:00') at time zone 'America/Sao_Paulo');
  v_total    integer;
  v_pending  integer;
  v_last     timestamptz;
  v_business boolean;
  v_applies  boolean;
  v_late     boolean := false;
  v_cfg      text := private.judicial_cron_config_problem();
  v_reason   text;
  v_title    text;
  v_msg      text;
begin
  select * into v_s from public.judicial_settings where id;
  select count(*), count(*) filter (where x.pending), max(x.last_success)
    into v_total, v_pending, v_last
  from (select bool_or(s.last_success_at is null or s.last_success_at < v_since) as pending,
               max(s.last_success_at) as last_success
        from public.judicial_monitors m
        join public.organizations o on o.id = m.organization_id and o.status = 'ACTIVE' and o.deleted_at is null
        left join public.judicial_monitor_status s on s.judicial_monitor_id = m.id
        where m.active
        group by m.oab_number, m.oab_state) x;
  v_business := extract(isodow from v_today) not in (6, 7)
    and coalesce(private.non_business_reason(v_today, null), '') not in ('Feriado nacional', 'Sexta-feira Santa');
  v_applies := coalesce(v_s.djen_enabled, false) and v_total > 0 and v_business and v_local::time >= time '08:00';

  if v_applies and v_pending > 0 then
    v_late := true;
    if not exists (select 1 from public.judicial_sync_runs r where r.scope = 'ALL' and r.started_at >= v_since) then
      v_reason := 'NOT_RUN';
      v_title := 'A busca de publicações não rodou hoje';
      v_msg := 'Nenhuma busca no DJEN começou hoje e há ' || v_pending || ' OAB(s) sem conferência. '
        || 'Pode haver publicação nova sem prazo: confira o DJEN por fora e avise quem cuida do sistema.';
    else
      v_reason := 'OAB_FAILED';
      v_title := 'Há OAB sem conferência no DJEN hoje';
      v_msg := v_pending || ' de ' || v_total || ' OAB(s) ainda sem busca concluída hoje. '
        || 'Pode haver publicação nova sem prazo: veja o motivo em DG Brasil → Integrações.';
    end if;
  end if;

  return jsonb_build_object(
    'applies', v_applies, 'late', v_late, 'reason', v_reason, 'title', v_title, 'message', v_msg,
    'oabs_total', v_total, 'oabs_pending', v_pending, 'last_success_at', v_last,
    'config_problem', v_cfg, 'checked_at', p_now);
end
$$;

-- Faixa de alerta da Home (ADMIN e advogado): o estado da captura, sem mais nada.
create or replace function private.get_judicial_capture_alert()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.judicial_require_internal(false);
  return private.judicial_capture_health() || jsonb_build_object('can_manage', private.is_admin());
end
$$;

create or replace function public.get_judicial_capture_alert()
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.get_judicial_capture_alert() $$;

-- ═════════════════════════════ 4. telas: visão geral e configuração ═══════

-- Visão geral da integração judicial (043/059/061). Novo (062):
--   - settings.agent_timeout_hours;
--   - last_full_run: a última busca completa (publicações e andamentos), mesmo
--     fora das 10 últimas rodadas;
--   - capture: o estado da captura do dia (seção 3);
--   - publications: só de processo que não foi excluído, como a lista.
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
                    'with_error', count(*) filter (where r.sync_enabled and r.last_error is not null))
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

-- Salvar a configuração (043/059/061), agora aceitando agent_timeout_hours
-- (chave ausente ou nula não muda o valor). Nada mais muda.
create or replace function private.save_judicial_settings(p_settings jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent uuid := nullif(p_settings ->> 'deadline_agent_id', '')::uuid;
  v_hours integer := (p_settings ->> 'agent_timeout_hours')::integer;
begin
  perform private.judicial_require_internal(true);
  if v_agent is not null and not exists (
    select 1 from public.agents a where a.id = v_agent and a.status = 'ACTIVE' and a.deleted_at is null) then
    raise exception 'Agente inexistente ou inativo' using errcode = '23514';
  end if;
  if v_hours is not null and v_hours not between 1 and 72 then
    raise exception 'O tempo de espera do agente vai de 1 a 72 horas' using errcode = '22023';
  end if;
  update public.judicial_settings
     set djen_enabled = coalesce((p_settings ->> 'djen_enabled')::boolean, djen_enabled),
         datajud_enabled = coalesce((p_settings ->> 'datajud_enabled')::boolean, datajud_enabled),
         lookback_days = coalesce((p_settings ->> 'lookback_days')::integer, lookback_days),
         deadline_agent_id = case when p_settings ? 'deadline_agent_id' then v_agent else deadline_agent_id end,
         deadline_auto_apply = coalesce((p_settings ->> 'deadline_auto_apply')::boolean, deadline_auto_apply),
         deadline_auto_task = coalesce((p_settings ->> 'deadline_auto_task')::boolean, deadline_auto_task),
         agent_timeout_hours = coalesce(v_hours, agent_timeout_hours),
         updated_by = auth.uid(), updated_at = now()
   where id;
  perform private.record_audit_event('JUDICIAL_SETTINGS_UPDATED', 'judicial_settings', null,
    jsonb_build_object('fields', (select coalesce(jsonb_agg(k), '[]') from jsonb_object_keys(coalesce(p_settings, '{}')) k)));
  return jsonb_build_object('ok', true);
end
$$;

-- ═════════════════════════════ 5. telas: publicações ══════════════════════

-- Publicação para a tela (043). Novo (062): agent_requested_at (desde quando
-- está com o agente), deadline.due_on (a data local do vencimento, Brasília) e
-- pending_review_id só com revisão que ainda pode ser decidida.
create or replace function private.judicial_publication_json(p public.judicial_publications, p_full boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id, 'external_id', p.external_id, 'legal_process_id', p.legal_process_id, 'cnj_number', p.cnj_number,
    'process_title', lp.title, 'legal_case_id', lp.legal_case_id, 'case_title', c.title,
    'client_name', coalesce((select i.full_name from public.individual_client_details i where i.client_id = c.client_id),
                            (select co.legal_name from public.company_client_details co where co.client_id = c.client_id)),
    'responsible_user_id', coalesce(lp.responsible_user_id, c.assigned_lawyer_id),
    'court', p.court, 'organ', p.organ, 'communication_type', p.communication_type, 'class_name', p.class_name,
    'available_on', p.available_on, 'found_by', to_jsonb(p.found_by),
    'excerpt', left(regexp_replace(p.content, '\s+', ' ', 'g'), 280),
    'content', case when p_full then p.content end,
    'link', p.link,
    'certificate_url', case when p.djen_hash is not null then 'https://comunicaapi.pje.jus.br/api/v1/comunicacao/' || p.djen_hash || '/certidao' end,
    'cancelled_at', p.cancelled_at, 'cancel_reason', p.cancel_reason,
    'triage_status', p.triage_status, 'triage_outcome', p.triage_outcome, 'triage_notes', p.triage_notes,
    'triaged_by', p.triaged_by, 'triaged_at', p.triaged_at, 'deadline_id', p.deadline_id,
    'deadline', case when p.deadline_id is not null then
      (select jsonb_build_object('id', d.id, 'title', d.title, 'due_at', d.due_at,
                                 'due_on', to_char(d.due_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD'), 'status', d.status)
       from public.deadlines d where d.id = p.deadline_id) end,
    'agent_run_id', p.agent_run_id, 'agent_error', p.agent_error,
    'agent_run_status', (select r.status from public.agent_runs r where r.id = p.agent_run_id),
    'agent_requested_at', (select r.created_at from public.agent_runs r where r.id = p.agent_run_id),
    -- Só revisão que ainda pode ser decidida: "alterações solicitadas" numa
    -- proposta de agente é fim de linha (não se reabre, 009).
    'pending_review_id', (select rv.id from public.agent_proposals ap join public.reviews rv on rv.agent_proposal_id = ap.id
                          where ap.agent_run_id = p.agent_run_id
                            and rv.status in ('PENDING', 'REOPENED') order by rv.created_at desc limit 1),
    'captured_at', p.captured_at)
  from public.legal_processes lp
  join public.legal_cases c on c.id = lp.legal_case_id
  where lp.id = p.legal_process_id
$$;

-- Detalhe da publicação (043). Novo (062): agent_runtime, para a tela dizer se
-- o agente tem como responder (execução ligada, computador conectado) e quanto
-- tempo a publicação espera por ele.
create or replace function private.get_judicial_publication(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_p public.judicial_publications;
begin
  if not private.is_internal_user() then
    raise exception 'Somente a equipe do escritório' using errcode = '42501';
  end if;
  select * into v_p from public.judicial_publications where id = p_id;
  if v_p.id is null then
    raise exception 'Publicação não encontrada' using errcode = 'P0002';
  end if;
  return private.judicial_publication_json(v_p, true)
      || jsonb_build_object(
           'suggestion', private.judicial_deadline_dates(v_p.available_on, v_p.court, 15, 0),
           'agent_runtime', jsonb_build_object(
             'execution_enabled', private.worker_ai_enabled(),
             'executor_online', exists (select 1 from public.executors e
                                        where e.revoked_at is null and e.last_seen_at > now() - interval '3 minutes'),
             'timeout_hours', (select s.agent_timeout_hours from public.judicial_settings s where s.id)));
end
$$;

-- "Sem prazo" (fecha), "Reabrir" (volta para triagem) e, novo (062), "Tratar eu
-- mesmo" (TAKE_OVER): tira a publicação do agente e devolve para a triagem da
-- equipe. Se o agente responder depois, a proposta dele vai para Revisões (a
-- 059 só aceita prazo direto de publicação que ainda está com o agente).
create or replace function private.judicial_publication_decide(p_id uuid, p_action text, p_notes text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.judicial_publications;
begin
  perform private.judicial_require_internal(false);
  select * into v_p from public.judicial_publications where id = p_id for update;
  if v_p.id is null then
    raise exception 'Publicação não encontrada' using errcode = 'P0002';
  end if;
  if p_action = 'NO_DEADLINE' then
    if v_p.triage_status = 'DONE' then
      raise exception 'Esta publicação já foi tratada' using errcode = '55000';
    end if;
    if nullif(btrim(coalesce(p_notes, '')), '') is null then
      raise exception 'Diga por que esta publicação não tem prazo' using errcode = '22023';
    end if;
    update public.judicial_publications
       set triage_status = 'DONE', triage_outcome = 'NO_DEADLINE', triage_notes = left(btrim(p_notes), 2000),
           triaged_by = auth.uid(), triaged_at = now()
     where id = p_id;
  elsif p_action = 'REOPEN' then
    if v_p.triage_status <> 'DONE' then
      raise exception 'Só publicação já tratada pode ser reaberta' using errcode = '55000';
    end if;
    -- O prazo criado continua existindo (cancele-o em Prazos, se for o caso).
    update public.judicial_publications
       set triage_status = 'PENDING', triage_outcome = null, deadline_id = null,
           triage_notes = left(nullif(btrim(coalesce(p_notes, '')), ''), 2000), triaged_by = auth.uid(), triaged_at = now()
     where id = p_id;
  elsif p_action = 'TAKE_OVER' then
    if v_p.triage_status <> 'WITH_AGENT' then
      raise exception 'Esta publicação não está com o agente' using errcode = '55000';
    end if;
    update public.judicial_publications
       set triage_status = 'PENDING',
           agent_error = 'A equipe assumiu esta publicação. Se o agente responder depois, a proposta dele aparece em Revisões.'
     where id = p_id;
  else
    raise exception 'Ação inválida' using errcode = '22023';
  end if;
  perform private.record_audit_event('JUDICIAL_PUBLICATION_' || p_action, 'judicial_publications', p_id,
    jsonb_build_object('legal_process_id', v_p.legal_process_id));
  return jsonb_build_object('id', p_id, 'action', p_action);
end
$$;

-- ═════════════════════════════ 6. ligação com Revisões ════════════════════

-- Proposta de prazo aplicada fecha a triagem; rejeitada ou com falha devolve a
-- publicação à triagem quando não sobra outra pendente (043). Novo (062): a
-- proposta aplicada fecha também a publicação que já tinha voltado para a
-- triagem (o agente respondeu depois do tempo de espera, ou a equipe assumiu, e
-- alguém aprovou a proposta em Revisões). Antes ela ficava "A tratar" com o
-- prazo já criado. Publicação já tratada pela equipe não é mexida.
create or replace function private.judicial_publications_follow_proposals()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.proposal_type <> 'CREATE_DEADLINE' or new.status is not distinct from old.status then
    return new;
  end if;
  if new.status = 'APPLIED' and new.applied_entity_type = 'deadlines' and new.applied_entity_id is not null then
    update public.judicial_publications p
       set triage_status = 'DONE', triage_outcome = 'DEADLINE', deadline_id = new.applied_entity_id,
           triaged_by = (select d.decided_by from public.reviews rv join public.review_decisions d on d.review_id = rv.id
                         where rv.agent_proposal_id = new.id and d.decision = 'APPROVE'
                         order by d.created_at desc limit 1),
           triaged_at = now(),
           agent_error = null
     where p.agent_run_id = new.agent_run_id and p.triage_status in ('WITH_AGENT', 'PENDING') and p.deadline_id is null;
  elsif new.status in ('REJECTED', 'FAILED') then
    update public.judicial_publications p
       set triage_status = 'PENDING'
     where p.agent_run_id = new.agent_run_id and p.triage_status = 'WITH_AGENT'
       and not exists (select 1 from public.agent_proposals ap
                       where ap.agent_run_id = new.agent_run_id and ap.id <> new.id
                         and ap.proposal_type = 'CREATE_DEADLINE' and ap.status in ('PENDING', 'APPROVED'));
  end if;
  return new;
end
$$;

-- ═════════════════════════════ 7. publicação presa com o agente ═══════════

-- Devolve para a triagem da equipe a publicação que ficou presa "Com o agente"
-- e avisa o responsável pelo processo e os ADMIN ativos (uma vez por
-- publicação). Presa = WITH_AGENT, sem prazo, sem proposta de prazo viva
-- (aprovada esperando o aplicador, ou pendente com a revisão ainda em aberto) e:
--   (a) pedida ao agente há mais de agent_timeout_hours horas corridas; ou
--   (b) o trabalho do agente já terminou (ou não existe mais); ou
--   (c) a revisão da proposta terminou sem gerar prazo.
-- O trabalho que ficou na fila não é cancelado: se o agente responder depois, a
-- proposta vai para Revisões (seção 6 e 059). Devolve quantas soltou.
create or replace function private.judicial_release_stuck_publications(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hours integer := coalesce((select s.agent_timeout_hours from public.judicial_settings s where s.id), 4);
  r       record;
  v_why   text;
  v_to    uuid;
  v_n     integer := 0;
begin
  for r in
    select p.id, p.legal_process_id, p.available_on, p.cnj_number,
           ar.id as run_id, ar.status as run_status, ar.created_at as requested_at,
           lp.title, lp.legal_case_id, lp.deleted_at,
           coalesce(lp.responsible_user_id, c.assigned_lawyer_id) as responsible,
           exists (select 1 from public.agent_proposals ap
                   join public.reviews rv on rv.agent_proposal_id = ap.id
                   where ap.agent_run_id = p.agent_run_id and ap.proposal_type = 'CREATE_DEADLINE'
                     and rv.status in ('CHANGES_REQUESTED', 'REJECTED')) as review_ended
    from public.judicial_publications p
    join public.legal_processes lp on lp.id = p.legal_process_id
    join public.legal_cases c on c.id = lp.legal_case_id
    left join public.agent_runs ar on ar.id = p.agent_run_id
    where p.triage_status = 'WITH_AGENT' and p.deadline_id is null
      and not exists (
        select 1 from public.agent_proposals ap
        where ap.agent_run_id = p.agent_run_id and ap.proposal_type = 'CREATE_DEADLINE'
          and (ap.status = 'APPROVED'
               or (ap.status = 'PENDING' and not exists (
                     select 1 from public.reviews rv
                     where rv.agent_proposal_id = ap.id and rv.status in ('CHANGES_REQUESTED', 'REJECTED')))))
    order by p.captured_at, p.id
    for update of p skip locked
  loop
    if r.review_ended then
      v_why := 'A revisão da proposta do agente terminou sem criar prazo.';
    elsif r.run_id is null or r.run_status in ('COMPLETED', 'FAILED', 'CANCELLED') then
      v_why := 'O trabalho do agente terminou sem proposta de prazo.';
    elsif r.requested_at < p_now - make_interval(hours => v_hours) then
      v_why := 'O agente não respondeu em ' || v_hours || ' h (o computador do escritório pode estar desligado).';
    else
      continue;
    end if;

    update public.judicial_publications
       set triage_status = 'PENDING',
           agent_error = left(v_why || ' Crie o prazo ou registre que não há prazo. Se o agente responder depois, a proposta dele aparece em Revisões.', 500)
     where id = r.id;
    v_n := v_n + 1;

    if r.deleted_at is null then
      for v_to in
        select distinct u from (
          select r.responsible as u
          union all
          select a from private.active_admin_ids() a) x
        where u is not null
      loop
        perform private.notify(v_to, 'PUBLICATION_RECEIVED',
          'Publicação voltou para a triagem: ' || coalesce(nullif(btrim(r.title), ''), private.format_cnj(r.cnj_number)),
          v_why || ' Publicação de ' || to_char(r.available_on, 'DD/MM/YYYY') || ': crie o prazo ou registre que não há prazo.',
          'URGENT', 'pub-triagem:' || r.id, r.legal_case_id, r.legal_process_id, null, 'publication', r.id);
      end loop;
    end if;
  end loop;
  return v_n;
end
$$;

-- Vigia da integração judicial (pg_cron, a cada 15 min): solta as publicações
-- presas com o agente e avisa os ADMIN ativos quando a captura do dia está
-- atrasada ou o agendador está sem configuração — uma vez por dia por motivo
-- (a chave leva o dia e o motivo).
create or replace function private.judicial_watchdog(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_released integer;
  v_h        jsonb;
  v_day      text := to_char(p_now at time zone 'America/Sao_Paulo', 'YYYY-MM-DD');
  v_to       uuid;
begin
  v_released := private.judicial_release_stuck_publications(p_now);
  v_h := private.judicial_capture_health(p_now);
  if (v_h ->> 'late')::boolean then
    for v_to in select * from private.active_admin_ids() loop
      perform private.notify(v_to, 'JUDICIAL_SYNC_FAILED', v_h ->> 'title', v_h ->> 'message', 'URGENT',
                             'jcapture:' || v_day || ':' || (v_h ->> 'reason'));
    end loop;
  end if;
  if (v_h ->> 'applies')::boolean and v_h ->> 'config_problem' is not null then
    for v_to in select * from private.active_admin_ids() loop
      perform private.notify(v_to, 'JUDICIAL_SYNC_FAILED',
        'O agendador da busca de publicações está sem configuração',
        'Só a busca das 06:30 está rodando, e nela pode não caber tudo. Avise quem cuida do sistema (' || (v_h ->> 'config_problem') || ').',
        'WARNING', 'jcapture:' || v_day || ':CONFIG');
    end loop;
  end if;
  return jsonb_build_object('released', v_released, 'capture_late', (v_h ->> 'late')::boolean, 'reason', v_h ->> 'reason',
                            'config_problem', v_h ->> 'config_problem');
end
$$;

do $$
begin
  if to_regnamespace('cron') is not null then
    -- cron.schedule com nome atualiza o agendamento existente: rodar de novo não duplica.
    perform cron.schedule('dg-judicial-vigia', '*/15 * * * *', 'select private.judicial_watchdog()');
  else
    raise notice 'pg_cron indisponível: publicação presa com o agente e captura atrasada ficam sem vigia';
  end if;
end
$$;

-- ═════════════════════════════ 8. teor cortado não entra direto ═══════════

-- Conferências do prazo direto (059). Única mudança (062): pedido com o teor
-- cortado (publicação longa) não vira prazo direto — vai para Revisões, com o
-- motivo na linha do tempo do trabalho.
create or replace function private.judicial_direct_deadline_check(
  p_agent_run_id uuid, p_legal_case_id uuid, p_legal_process_id uuid, p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s     public.judicial_settings;
  v_p     public.judicial_publications;
  v_in    jsonb;
  v_data  jsonb := case when jsonb_typeof(p_payload -> 'data') = 'object' then p_payload -> 'data' else '{}'::jsonb end;
  v_proc  record;
  v_title text;
  v_txt   text;
  v_due   timestamptz;
  v_day   date;
  v_list  jsonb;
  v_resp  uuid;
  v_no    text;
begin
  select i.parameters into v_in from public.agent_run_inputs i where i.agent_run_id = p_agent_run_id;

  -- Trabalho de publicação = o trabalho para o qual a publicação aponta. Só
  -- private.judicial_request_deadline_proposal grava esse vínculo.
  select * into v_p from public.judicial_publications p
   where p.agent_run_id = p_agent_run_id
   order by p.captured_at, p.id
   limit 1
   for update;
  if v_p.id is null then
    -- Pedido com cara de publicação, mas sem a publicação apontar para ele
    -- (pedido avulso, ou pedido repetido de uma publicação que já tinha outro
    -- trabalho): caminho antigo, com o motivo.
    if v_in ->> 'kind' = 'JUDICIAL_PUBLICATION' then
      return jsonb_build_object('publication_job', true, 'ok', false,
                                'reason', 'a publicação não está ligada a este trabalho');
    end if;
    return jsonb_build_object('publication_job', false, 'ok', false);
  end if;

  select * into v_s from public.judicial_settings where id;
  if not coalesce(v_s.deadline_auto_apply, false) then
    -- Opção desligada: é o caminho normal, não uma conferência que falhou.
    return jsonb_build_object('publication_job', true, 'ok', false);
  end if;

  if v_p.cancelled_at is not null then
    v_no := 'a publicação foi cancelada pelo tribunal';
  elsif exists (select 1 from public.agent_proposals ap
                where ap.agent_run_id = p_agent_run_id and ap.proposal_type = 'CREATE_DEADLINE') then
    v_no := 'este trabalho já tem outra proposta de prazo (só uma entra direto por publicação)';
  elsif v_p.triage_status = 'DONE' then
    v_no := 'a publicação já foi tratada';
  elsif v_p.triage_status <> 'WITH_AGENT' then
    v_no := 'a publicação não está mais com o agente (voltou para a triagem da equipe)';
  elsif v_p.deadline_id is not null then
    v_no := 'a publicação já tem prazo';
  elsif v_in ->> 'content_truncated' = 'true' then
    -- 062: o agente não leu o teor inteiro. Sem o pedido guardado (apagado
    -- depois de 180 dias) não há como saber: aí vale o tamanho do teor.
    v_no := 'o teor da publicação foi cortado no pedido ao agente (publicação longa): uma pessoa confere pela íntegra';
  elsif v_in is null and length(v_p.content) > 15000 then
    v_no := 'o teor da publicação é longo e o pedido ao agente não está mais guardado: uma pessoa confere pela íntegra';
  end if;
  if v_no is not null then
    return jsonb_build_object('publication_job', true, 'ok', false, 'reason', v_no);
  end if;

  select lp.id, lp.legal_case_id, lp.responsible_user_id, c.assigned_lawyer_id into v_proc
  from public.legal_processes lp join public.legal_cases c on c.id = lp.legal_case_id
  where lp.id = v_p.legal_process_id and lp.deleted_at is null and c.deleted_at is null;
  if v_proc.id is null or v_proc.legal_case_id is distinct from p_legal_case_id then
    return jsonb_build_object('publication_job', true, 'ok', false,
                              'reason', 'o processo da publicação foi excluído ou não é mais do caso deste trabalho');
  end if;
  if (p_legal_process_id is not null and p_legal_process_id <> v_proc.id)
     or (nullif(v_data ->> 'legal_process_id', '') is not null and v_data ->> 'legal_process_id' <> v_proc.id::text) then
    return jsonb_build_object('publication_job', true, 'ok', false,
                              'reason', 'a proposta aponta um processo diferente do processo da publicação');
  end if;

  v_title := case when jsonb_typeof(v_data -> 'title') = 'string' then nullif(btrim(v_data ->> 'title'), '') end;
  if v_title is null then
    return jsonb_build_object('publication_job', true, 'ok', false, 'reason', 'o prazo veio sem título');
  end if;

  -- Data, hora e fuso explícitos: sem o fuso, "2026-12-01" viraria 30/11 à noite
  -- em Brasília e o prazo sairia no dia errado.
  v_txt := case when jsonb_typeof(v_data -> 'due_at') = 'string' then btrim(v_data ->> 'due_at') end;
  if v_txt is null or v_txt !~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}(:?\d{2})?)$' then
    return jsonb_build_object('publication_job', true, 'ok', false,
                              'reason', 'o vencimento (due_at) não veio com data, hora e fuso (ISO 8601, ex.: 2026-12-01T23:59:00-03:00)');
  end if;
  begin
    v_due := v_txt::timestamptz;
  exception when others then
    return jsonb_build_object('publication_job', true, 'ok', false, 'reason', 'o vencimento (due_at) não é uma data válida');
  end;
  v_day := (v_due at time zone 'America/Sao_Paulo')::date;
  if v_due <= now() then
    return jsonb_build_object('publication_job', true, 'ok', false,
                              'reason', 'o vencimento (' || to_char(v_day, 'DD/MM/YYYY') || ') já passou');
  end if;

  -- A lista de dias úteis que o banco calculou para ESTA publicação: a do
  -- pedido (a que o agente leu); sem ela, a mesma conta da 043.
  if v_in ->> 'kind' = 'JUDICIAL_PUBLICATION' and v_in ->> 'publication_id' = v_p.id::text
     and jsonb_typeof(v_in -> 'business_days') = 'array' and jsonb_array_length(v_in -> 'business_days') > 0 then
    v_list := v_in -> 'business_days';
  else
    begin
      v_list := private.judicial_deadline_dates(v_p.available_on, v_p.court, 15, 30) -> 'list';
    exception when others then
      v_list := null;
    end;
  end if;
  if v_list is null or jsonb_typeof(v_list) <> 'array' or not (v_list ? to_char(v_day, 'YYYY-MM-DD')) then
    return jsonb_build_object('publication_job', true, 'ok', false,
                              'reason', 'a data ' || to_char(v_day, 'DD/MM/YYYY') || ' não é um dos dias úteis da lista calculada para esta publicação');
  end if;

  -- Para o prazo aparecer para alguém: responsável do processo, senão o
  -- advogado do caso (a ordem do "ator" do pedido, na 043).
  select u into v_resp
  from unnest(array[v_proc.responsible_user_id, v_proc.assigned_lawyer_id]) with ordinality t(u, o)
  where u is not null and private.is_active_internal_user(u)
  order by o limit 1;
  if v_resp is null then
    return jsonb_build_object('publication_job', true, 'ok', false,
                              'reason', 'o processo não tem responsável nem advogado do caso ativo para receber o prazo');
  end if;

  return jsonb_build_object(
    'publication_job', true, 'ok', true, 'publication_id', v_p.id, 'title', v_title, 'due_at', v_due,
    'data', v_data || jsonb_build_object('legal_process_id', v_proc.id, 'responsible_user_id', v_resp));
end
$$;

-- Pedido de proposta de prazo de UMA publicação (043/058/059). Muda (062) só o
-- que acontece com publicação longa: o pedido cabe em 20 mil caracteres e o teor
-- vai por último, então o FIM do teor (onde costuma estar o dispositivo e o
-- prazo) era o que se perdia. Agora o pedido leva o começo e o fim do teor, com
-- o meio marcado como cortado, o agente é avisado e content_truncated = true faz
-- o prazo ir para Revisões (private.judicial_direct_deadline_check). Publicação
-- que cabe inteira: o pedido é exatamente o da 059.
create or replace function private.judicial_request_deadline_proposal(p_publication_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s      public.judicial_settings;
  v_p      public.judicial_publications;
  v_proc   record;
  v_actor  uuid;
  v_run    uuid;
  v_dates  jsonb;
  v_list   text;
  v_side   text;
  v_todo   text;
  v_head   text;
  v_text   text;
  v_cut    boolean;
  v_room   integer;
  v_first  integer;
  v_notice constant text := 'ATENÇÃO: esta publicação é longa e o TEOR abaixo está CORTADO NO MEIO. Leia a íntegra pelo link antes de propor. '
    || 'Por causa do corte, o prazo que você propuser vai para a equipe conferir em Revisões, mesmo com data da lista.';
  v_mark   constant text := E'\n\n[... TRECHO DO MEIO CORTADO: a publicação não coube inteira. Leia a íntegra pelo link. ...]\n\n';
begin
  select * into v_s from public.judicial_settings where id;
  if v_s.deadline_agent_id is null then
    return null;
  end if;
  select * into v_p from public.judicial_publications where id = p_publication_id;
  select lp.id, lp.legal_case_id, lp.title, lp.responsible_user_id, c.assigned_lawyer_id,
         lp.client_side, lp.adverse_party_summary,
         coalesce((select i.full_name from public.individual_client_details i where i.client_id = c.client_id),
                  (select co.legal_name from public.company_client_details co where co.client_id = c.client_id)) as client_name
    into v_proc
  from public.legal_processes lp join public.legal_cases c on c.id = lp.legal_case_id
  where lp.id = v_p.legal_process_id and lp.deleted_at is null and c.deleted_at is null;
  if v_proc.id is null then
    return null;
  end if;
  select u into v_actor from unnest(array[v_proc.responsible_user_id, v_proc.assigned_lawyer_id, v_s.updated_by]) with ordinality t(u, o)
  where u is not null and private.is_active_internal_user(u) and private.user_internal_role(u) in ('ADMIN', 'LAWYER')
  order by o limit 1;
  if v_actor is null then
    update public.judicial_publications set agent_error = 'Nenhum advogado ativo para pedir a proposta ao agente.' where id = p_publication_id;
    return null;
  end if;

  v_dates := private.judicial_deadline_dates(v_p.available_on, v_p.court, 15, 30);
  -- O executor mostra ao agente o TEXTO do pedido: a contagem vai nele.
  select string_agg('  dia ' || t.n || ': ' || to_char(t.d::date, 'DD/MM/YYYY'), E'\n' order by t.n) into v_list
  from jsonb_array_elements_text(v_dates -> 'list') with ordinality t(d, n);
  -- De que lado o cliente está (058): nome do cliente do caso, polo e parte
  -- contrária do cadastro do processo, cada um em uma linha.
  v_side := 'Nosso cliente: '
    || coalesce(nullif(left(btrim(regexp_replace(coalesce(v_proc.client_name, ''), '\s+', ' ', 'g')), 100), ''), 'sem nome no cadastro')
    || ' · ' || case v_proc.client_side when 'ACTIVE' then 'polo ativo' when 'PASSIVE' then 'polo passivo'
                                        when 'THIRD_PARTY' then 'polo terceiro' else 'polo não informado' end
    || ' (do cadastro do processo)'
    || coalesce(E'\nParte contrária: ' || nullif(left(btrim(regexp_replace(v_proc.adverse_party_summary, '\s+', ' ', 'g')), 100), ''), '');
  -- O QUE FAZER (059): com o prazo direto ligado, o prazo proposto entra na
  -- agenda sem revisão; desligado, o texto da 058.
  if v_s.deadline_auto_apply then
    v_todo := 'O QUE FAZER: leia o teor e diga se ele abre prazo para o nosso cliente. Se abrir, chame a ferramenta propor '
      || 'UMA vez, tipo CREATE_DEADLINE, dados {title, due_at (ISO 8601, fim do dia do vencimento, -03:00), description '
      || '(fundamento legal e a contagem: quantos dias úteis e por quê), priority}. '
      || 'ATENÇÃO: o prazo proposto ENTRA DIRETO NA AGENDA do processo, sem revisão de um advogado. Por isso, havendo prazo, '
      || 'a data de due_at tem de ser um dos dias da lista abaixo (data fora da lista não entra na agenda: vai para a equipe '
      || 'conferir). Na dúvida entre haver ou não prazo, proponha o prazo mais curto cabível e comece a descrição com '
      || '"CONFERIR:" — prazo a mais custa pouco, prazo perdido custa o processo. Só quando for claro que não há prazo para '
      || 'o nosso cliente, chame propor tipo OTHER, resumo começando com "Sem prazo:" e o motivo em dados.description — '
      || 'esse continua indo para a equipe conferir.';
  else
    v_todo := 'O QUE FAZER: leia o teor e diga se ele abre prazo para o nosso cliente. Se abrir, chame a ferramenta propor '
      || 'UMA vez, tipo CREATE_DEADLINE, dados {title, due_at (ISO 8601, fim do dia do vencimento, -03:00), description '
      || '(fundamento legal e a contagem: quantos dias úteis e por quê), priority}. Se não houver prazo, chame propor '
      || 'tipo OTHER, resumo começando com "Sem prazo:" e o motivo em dados.description — quem decide é a equipe.';
  end if;
  begin
    -- Tudo que vem antes do teor (o que o agente precisa ler primeiro).
    v_head := 'Publicação do DJEN no processo ' || private.format_cnj(v_p.cnj_number)
      || ' (' || coalesce(v_p.court, 'tribunal não informado') || coalesce(' — ' || v_p.organ, '')
      || '), disponibilizada em ' || to_char(v_p.available_on, 'DD/MM/YYYY')
      || ', publicada em ' || to_char((v_dates ->> 'published_on')::date, 'DD/MM/YYYY')
      || '. Tipo: ' || coalesce(v_p.communication_type, '—') || E'.\n'
      || v_side || E'\n\n'
      || v_todo || E'\n\n'
      || 'DIAS ÚTEIS a partir da publicação (dia 1 = primeiro dia do prazo; já descontados fins de semana, feriados nacionais, '
      || 'Sexta-feira Santa, recesso de 20/12 a 20/01 e os dias cadastrados para o tribunal; feriado local não cadastrado '
      || 'NÃO está descontado — avise na descrição se suspeitar de um):' || E'\n' || coalesce(v_list, '(indisponível)')
      || coalesce(E'\n\nÍntegra: ' || v_p.link, '') || E'\n\nTEOR:\n';
    -- agent_run_inputs aceita até 20 mil caracteres.
    v_cut := length(v_head) + length(v_p.content) > 20000;
    if v_cut then
      v_head := v_notice || E'\n\n' || v_head;
      v_room := greatest(20000 - length(v_head) - length(v_mark), 0);
      v_first := (v_room * 2) / 5;
      v_text := v_head || left(v_p.content, v_first) || v_mark || right(v_p.content, v_room - v_first);
    else
      v_text := v_head || v_p.content;
    end if;
    v_run := private.request_agent_run(
      v_s.deadline_agent_id, v_proc.legal_case_id, v_proc.id,
      left(v_text, 20000),
      jsonb_build_object('kind', 'JUDICIAL_PUBLICATION', 'publication_id', v_p.id, 'cnj', v_p.cnj_number,
                         'content_truncated', v_cut,
                         'court', v_p.court, 'available_on', v_p.available_on,
                         'published_on', v_dates -> 'published_on', 'first_day', v_dates -> 'first_day',
                         'business_days', v_dates -> 'list', 'skipped_days', v_dates -> 'skipped',
                         'calendar_note', v_dates -> 'note'),
      'EXECUTE', v_actor);
    update public.judicial_publications set agent_run_id = v_run, triage_status = 'WITH_AGENT', agent_error = null
    where id = p_publication_id and triage_status = 'PENDING';
  exception when others then
    update public.judicial_publications set agent_error = left('Agente não acionado: ' || sqlerrm, 500) where id = p_publication_id;
    v_run := null;
  end;
  -- request_agent_run fixa o ator da transação: limpa para os próximos avisos.
  perform set_config('dg.actor_user_id', '', true);
  return v_run;
end
$$;

-- ═════════════════════════════ 9. permissões ══════════════════════════════

-- Blocos internos, funções de gatilho e a vigia: ninguém chama direto.
revoke all on function private.judicial_djen_gap_from(text, text, date, integer) from public, anon, authenticated, service_role;
revoke all on function private.judicial_djen_pending_today(text, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function private.judicial_djen_due(timestamptz) from public, anon, authenticated, service_role;
revoke all on function private.judicial_cron_config_problem() from public, anon, authenticated, service_role;
revoke all on function private.judicial_capture_health(timestamptz) from public, anon, authenticated, service_role;
revoke all on function private.judicial_release_stuck_publications(timestamptz) from public, anon, authenticated, service_role;
revoke all on function private.judicial_watchdog(timestamptz) from public, anon, authenticated, service_role;
revoke all on function private.judicial_publications_follow_proposals() from public, anon, authenticated, service_role;
revoke all on function private.judicial_publication_json(public.judicial_publications, boolean) from public, anon, authenticated, service_role;
revoke all on function private.judicial_direct_deadline_check(uuid, uuid, uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.judicial_request_deadline_proposal(uuid) from public, anon, authenticated, service_role;
-- Tela: pública (invoker) → privada (definer); a privada confere o papel.
revoke all on function private.get_judicial_overview() from public, anon, authenticated, service_role;
revoke all on function private.save_judicial_settings(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.get_judicial_publication(uuid) from public, anon, authenticated, service_role;
revoke all on function private.judicial_publication_decide(uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function private.get_judicial_capture_alert() from public, anon, authenticated, service_role;
revoke all on function public.get_judicial_capture_alert() from public, anon, authenticated, service_role;
grant execute on function private.get_judicial_overview() to authenticated;
grant execute on function private.save_judicial_settings(jsonb) to authenticated;
grant execute on function private.get_judicial_publication(uuid) to authenticated;
grant execute on function private.judicial_publication_decide(uuid, text, text) to authenticated;
grant execute on function private.get_judicial_capture_alert() to authenticated;
grant execute on function public.get_judicial_capture_alert() to authenticated;
-- Servidor do DG Brasil (login dg_worker): a porta que abre a rodada, como na 043.
revoke all on function private.judicial_sync_begin(text, uuid, uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function private.judicial_sync_begin(text, uuid, uuid, boolean) to dg_worker;
