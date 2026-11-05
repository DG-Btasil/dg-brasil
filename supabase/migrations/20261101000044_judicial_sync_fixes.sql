-- 044: correções da validação da Etapa 8 (docs/qa/etapa-8/problemas-etapa-8.md).
--
-- JUD-04 (DataJud lento ou fora do ar): uma falha passageira (tempo esgotado,
-- limite 429, erro 5xx, rede) é tentada de novo 1 h depois, e não só no dia
-- seguinte; "não encontrado" e leitura com sucesso continuam a cada 20 h. O
-- servidor diz qual é o caso (p_transient). Coluna nova: next_attempt_at.
--
-- JUD-06 (rodada presa como RUNNING): o servidor agora corta cada consulta no
-- prazo da rodada (antes podia passar dos 60 s da Vercel). Se ainda assim uma
-- rodada morrer, ela é dada como interrompida depois de 6 min (era 15): a
-- rota tem no máximo 60 s (300 s no plano Pro), então 6 min já é certeza.

-- ═════════════════════════════ 1. próxima leitura do DataJud ══════════════

alter table public.process_external_refs
  add column next_attempt_at timestamptz;

-- O que já foi tentado segue a regra antiga (20 h depois da última tentativa).
update public.process_external_refs
   set next_attempt_at = last_attempt_at + interval '20 hours'
 where provider = 'DATAJUD' and last_attempt_at is not null;

drop function private.judicial_ingest_datajud(uuid, uuid, boolean, text, jsonb, jsonb);

create or replace function private.judicial_datajud_queue(p_limit integer default 50, p_process_id uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('ref_id', x.id, 'legal_process_id', x.legal_process_id,
                                               'cnj', x.external_id, 'baseline', x.baseline_at is not null)), '[]'::jsonb)
  from (select r.* from public.process_external_refs r
        join public.legal_processes p on p.id = r.legal_process_id and p.deleted_at is null and p.cnj_number = r.external_id
        where r.provider = 'DATAJUD'
          and (p_process_id is null and r.sync_enabled or r.legal_process_id = p_process_id)
          -- Quando a próxima leitura está liberada: 20 h depois de uma leitura
          -- (ou de "não encontrado"); 1 h depois de uma falha passageira.
          and (p_process_id is not null or r.last_attempt_at is null or r.next_attempt_at is null or r.next_attempt_at <= now())
        order by r.last_attempt_at nulls first
        limit least(greatest(coalesce(p_limit, 50), 1), 500)) x
$$;

create or replace function private.judicial_ingest_datajud(
  p_run_id uuid, p_ref_id uuid, p_ok boolean, p_error text, p_meta jsonb, p_movements jsonb,
  p_transient boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ref      public.process_external_refs;
  v_proc     record;
  v_inserted integer := 0;
  v_baseline boolean;
  v_last     record;
  v_to       uuid;
  m          jsonb;
  v_id       uuid;
begin
  select * into v_ref from public.process_external_refs r where r.id = p_ref_id and r.provider = 'DATAJUD' for update;
  if v_ref.id is null then
    raise exception 'Referência não encontrada' using errcode = 'P0002';
  end if;
  if not coalesce(p_ok, false) then
    update public.process_external_refs
       set last_attempt_at = now(), last_error = left(coalesce(nullif(btrim(p_error), ''), 'Falha sem detalhe'), 500),
           next_attempt_at = now() + case when coalesce(p_transient, false) then interval '1 hour' else interval '20 hours' end
     where id = p_ref_id;
    return jsonb_build_object('ok', false);
  end if;

  select lp.id, lp.legal_case_id, lp.cnj_number, lp.title into v_proc
  from public.legal_processes lp where lp.id = v_ref.legal_process_id and lp.deleted_at is null;
  if v_proc.id is null or v_proc.cnj_number is distinct from v_ref.external_id then
    update public.process_external_refs set last_attempt_at = now(), next_attempt_at = now() + interval '20 hours',
           last_error = 'Processo excluído ou com outro CNJ' where id = p_ref_id;
    return jsonb_build_object('ok', false);
  end if;
  v_baseline := v_ref.baseline_at is null;

  -- Preenche só o que está vazio.
  if p_meta is not null and jsonb_typeof(p_meta) = 'object' then
    update public.legal_processes lp
       set court = coalesce(lp.court, left(nullif(p_meta ->> 'court', ''), 100)),
           court_unit = coalesce(lp.court_unit, left(nullif(p_meta ->> 'court_unit', ''), 300)),
           legal_class = coalesce(lp.legal_class, left(nullif(p_meta ->> 'legal_class', ''), 300)),
           subject = coalesce(lp.subject, left(nullif(p_meta ->> 'subject', ''), 500)),
           distribution_date = coalesce(lp.distribution_date, nullif(p_meta ->> 'distribution_date', '')::date)
     where lp.id = v_proc.id
       and ((lp.court is null and nullif(p_meta ->> 'court', '') is not null)
         or (lp.court_unit is null and nullif(p_meta ->> 'court_unit', '') is not null)
         or (lp.legal_class is null and nullif(p_meta ->> 'legal_class', '') is not null)
         or (lp.subject is null and nullif(p_meta ->> 'subject', '') is not null)
         or (lp.distribution_date is null and nullif(p_meta ->> 'distribution_date', '') is not null));
  end if;

  for m in select * from jsonb_array_elements(coalesce(p_movements, '[]'::jsonb)) limit 3000 loop
    if coalesce(m ->> 'external_id', '') !~ '^[0-9a-f]{64}$' or m ->> 'occurred_at' is null or nullif(btrim(m ->> 'name'), '') is null then
      continue;
    end if;
    insert into public.process_events
      (legal_process_id, external_provider, external_id, event_type, title, description, occurred_at, source, raw_data)
    values
      (v_proc.id, 'DATAJUD', m ->> 'external_id', 'MOVEMENT', left(m ->> 'name', 300),
       left(coalesce(nullif(btrim(m ->> 'description'), ''), m ->> 'name'), 4000), (m ->> 'occurred_at')::timestamptz,
       'JUDICIAL_INTEGRATION',
       jsonb_build_object('code', m -> 'code', 'grau', m -> 'grau', 'run_id', p_run_id))
    on conflict (external_provider, external_id) where external_provider is not null and external_id is not null do nothing
    returning id into v_id;
    if v_id is not null then
      v_inserted := v_inserted + 1;
      v_id := null;
    end if;
  end loop;

  update public.process_external_refs
     set last_attempt_at = now(), last_synced_at = now(), last_error = null, next_attempt_at = now() + interval '20 hours',
         baseline_at = coalesce(baseline_at, now()),
         metadata = metadata || jsonb_strip_nulls(jsonb_build_object(
           'alias', p_meta ->> 'alias', 'graus', p_meta -> 'graus', 'source_updated_at', p_meta ->> 'source_updated_at'))
   where id = p_ref_id;

  if not v_baseline and v_inserted > 0 then
    select e.title, e.occurred_at into v_last from public.process_events e
    where e.legal_process_id = v_proc.id and e.external_provider = 'DATAJUD'
    order by e.occurred_at desc limit 1;
    for v_to in select * from private.judicial_recipients(v_proc.id) loop
      perform private.notify(v_to, 'PROCESS_MOVEMENT',
        'Movimentação nova: ' || coalesce(nullif(btrim(v_proc.title), ''), private.format_cnj(v_proc.cnj_number)),
        coalesce(v_last.title, 'Andamento') || case when v_inserted > 1 then ' (+' || (v_inserted - 1) || ')' else '' end,
        'INFO', 'mov:' || v_proc.id || ':' || coalesce(p_run_id::text, now()::text), v_proc.legal_case_id, v_proc.id);
    end loop;
  end if;
  return jsonb_build_object('ok', true, 'inserted', v_inserted, 'baseline', v_baseline);
end
$$;

-- ═════════════════════════════ 2. rodada interrompida ════════════════════

create or replace function private.judicial_sync_begin(
  p_trigger text, p_requested_by uuid default null, p_process_id uuid default null, p_only_datajud boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s   public.judicial_settings;
  v_run uuid;
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
  update public.judicial_sync_runs
     set status = 'FAILED', finished_at = now(), error = 'Interrompida (sem conclusão em 6 min).'
   where status = 'RUNNING' and started_at < now() - interval '6 minutes';
  if p_process_id is null and exists (
    select 1 from public.judicial_sync_runs r
    where r.status = 'RUNNING' and (r.scope = 'ALL' or (coalesce(p_only_datajud, false) and r.scope = 'DATAJUD'))) then
    return jsonb_build_object('busy', true);
  end if;

  select * into v_s from public.judicial_settings where id;
  -- Agendada sem nada a fazer (nenhuma OAB pendente hoje, nenhum processo
  -- vencido no DataJud): não abre rodada (não polui o histórico).
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
    'today', (now() at time zone 'America/Sao_Paulo')::date,
    -- Uma consulta por OAB, mesmo que vários escritórios a acompanhem.
    -- Agendada: só as OABs ainda não conferidas hoje (lotes até todas darem certo).
    'oabs', case when p_trigger = 'CRON' and not coalesce(p_only_datajud, false) then coalesce((
      select jsonb_agg(jsonb_build_object('oab_number', x.oab_number, 'oab_state', x.oab_state)
                       order by x.last_attempt nulls first, x.oab_state, x.oab_number)
      from private.judicial_djen_due() x), '[]'::jsonb)
    -- Manual ("Buscar agora"): todas as OABs ativas.
    when p_process_id is null and not coalesce(p_only_datajud, false) then coalesce((
      -- A OAB consultada há mais tempo primeiro: se o tempo da rodada acabar,
      -- a próxima começa pelas que ficaram de fora.
      select jsonb_agg(jsonb_build_object('oab_number', x.oab_number, 'oab_state', x.oab_state)
                       order by x.last_attempt nulls first, x.oab_state, x.oab_number)
      from (select m.oab_number, m.oab_state::text as oab_state, min(s.last_attempt_at) as last_attempt
            from public.judicial_monitors m
            join public.organizations o on o.id = m.organization_id and o.status = 'ACTIVE' and o.deleted_at is null
            left join public.judicial_monitor_status s on s.judicial_monitor_id = m.id
            where m.active
            group by m.oab_number, m.oab_state) x), '[]'::jsonb) else '[]'::jsonb end);
end
$$;

-- ═════════════════════════════ 3. permissões ═════════════════════════════

revoke all on function private.judicial_ingest_datajud(uuid, uuid, boolean, text, jsonb, jsonb, boolean)
  from public, anon, authenticated, service_role;
grant execute on function private.judicial_ingest_datajud(uuid, uuid, boolean, text, jsonb, jsonb, boolean) to dg_worker;
