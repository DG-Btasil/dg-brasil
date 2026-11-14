-- 075 · DataJud: "ainda não aparece no DataJud" deixa de contar como falha.
--
-- Achado no teste ao vivo de 14/11/2026: as bolinhas de conferência (074)
-- tratavam como falha (vermelho, e no "Z com falha" de Integrações) o processo
-- que o DataJud responde que ainda não existe na cópia pública. Isso é normal:
-- a cópia pública atrasa de 1 a 3 semanas. No DEV a linha mostrava "3 de 47
-- processos lidos nas últimas 24 h · 47 com falha", quase todos "não aparece";
-- na produção, todo processo novo ficaria vermelho por semanas.
--
--   1. Coluna nova em process_external_refs: last_error_kind, o tipo do último
--      erro ('NOT_FOUND', 'TRANSIENT' ou 'OTHER'; nula quando não há erro). As
--      linhas que já têm erro são classificadas aqui: texto do "não encontrado"
--      do servidor → NOT_FOUND; qualquer outro → OTHER.
--   2. private.judicial_ingest_datajud (definição vigente, da 073) grava o tipo.
--      Sucesso zera. Falha: NOT_FOUND quando o servidor avisa, TRANSIENT quando
--      p_transient, OTHER no resto (inclusive "Processo excluído ou com outro
--      CNJ" e "sem índice no DataJud").
--      Como o servidor avisa: na falha, p_meta (que a função nunca leu quando
--      p_ok é falso) leva {"error_kind": "NOT_FOUND"}. A assinatura não muda:
--      não há sobrecarga nova, os grants ficam, e servidor e banco podem ser
--      atualizados em qualquer ordem (banco sem a 075 ignora o p_meta da falha;
--      servidor anterior à 075 manda p_meta nulo e o banco reconhece o "não
--      encontrado" pelo texto, que é uma constante do servidor).
--      A espera da 073 não muda: o "não encontrado" continua esperando 20 h e
--      continua somando nas falhas seguidas. A conta só pesa na espera de uma
--      falha passageira (TRANSIENT) que venha depois; para um processo que o
--      DataJud ainda nem tem, insistir de hora em hora depois de um tempo
--      esgotado gastaria consultas sem trazer nada. A primeira leitura com
--      sucesso zera tudo.
--   3. private.legal_processes_track_cnj (definição vigente, da 073): trocar o
--      CNJ zera também o tipo do erro (zerava o erro).
--   4. private.get_judicial_overview() (definição vigente, da 074): with_error
--      passa a contar só os erros que não são NOT_FOUND; campo novo
--      not_in_datajud, os acompanhados cujo último erro é NOT_FOUND. O resto da
--      função fica igual.
--   5. private.get_process_judicial_status (definição vigente, da 043) devolve
--      last_error_kind, como o last_error: só para a equipe interna.
--
-- Painel sem a 075 no banco (campos ausentes): tudo como antes. Painel sem a
-- 075 com o banco já na 075: "Z com falha" fica menor (sem os não encontrados)
-- e o card do processo continua vermelho para o não encontrado.
--
-- Assinaturas, security definer, search_path = '' e permissões ficam iguais
-- (create or replace mantém os grants; os revokes/grants abaixo só reafirmam).
-- Idempotente: pode rodar de novo.
--
-- Como desfazer: primeiro `alter table public.process_external_refs drop column
-- last_error_kind` (leva junto a regra de consistência); depois rodar de novo
-- as definições de judicial_ingest_datajud e legal_processes_track_cnj da 073,
-- get_judicial_overview da 074 e get_process_judicial_status da 043.

-- ═════════════════════════════ 1. tipo do último erro ═════════════════════

alter table public.process_external_refs add column if not exists last_error_kind text;

-- O tipo só existe junto com o erro; o erro pode não ter tipo só em linha
-- anterior à 075 (o passo abaixo classifica todas).
alter table public.process_external_refs drop constraint if exists process_external_refs_last_error_kind_check;
alter table public.process_external_refs add constraint process_external_refs_last_error_kind_check
  check (last_error_kind is null or (last_error_kind in ('NOT_FOUND', 'TRANSIENT', 'OTHER') and last_error is not null));

comment on column public.process_external_refs.last_error_kind is
  'Tipo do último erro da leitura (DataJud): NOT_FOUND (o processo ainda não aparece na cópia pública, que atrasa semanas: não é falha), TRANSIENT (falha passageira) ou OTHER. Nula sem erro.';

-- Linhas que já têm erro: o "não encontrado" é o texto fixo do servidor
-- (datajud.ts); o resto vira OTHER (antes da 075 não se guardava se era passageira).
update public.process_external_refs
   set last_error_kind = case when last_error like 'Processo ainda não aparece no DataJud%' then 'NOT_FOUND' else 'OTHER' end
 where last_error is not null and last_error_kind is null;

-- ═════════════════════════════ 2. gravação da leitura ═════════════════════

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
  v_failures integer;
  v_error    text;
  v_kind     text;
begin
  select * into v_ref from public.process_external_refs r where r.id = p_ref_id and r.provider = 'DATAJUD' for update;
  if v_ref.id is null then
    raise exception 'Referência não encontrada' using errcode = 'P0002';
  end if;
  if not coalesce(p_ok, false) then
    -- 073: falhas seguidas. Passageira: 1 h, 2 h, 4 h, 8 h, 16 h, depois 20 h
    -- (o expoente é limitado antes da conta, para nunca estourar o intervalo).
    -- Não passageira (inclusive o não encontrado, 075): 20 h, como antes.
    v_failures := least(v_ref.consecutive_failures, 1000) + 1;
    v_error := left(coalesce(nullif(btrim(p_error), ''), 'Falha sem detalhe'), 500);
    -- 075: tipo do erro. O servidor avisa o não encontrado em p_meta; servidor
    -- anterior à 075 não avisa, e o texto fixo dele basta.
    v_kind := case
                when jsonb_typeof(p_meta) = 'object' and p_meta ->> 'error_kind' = 'NOT_FOUND' then 'NOT_FOUND'
                when coalesce(p_transient, false) then 'TRANSIENT'
                when v_error like 'Processo ainda não aparece no DataJud%' then 'NOT_FOUND'
                else 'OTHER' end;
    update public.process_external_refs
       set last_attempt_at = now(), last_error = v_error, last_error_kind = v_kind,
           consecutive_failures = v_failures,
           next_attempt_at = now() + case when coalesce(p_transient, false)
                                          then least(interval '1 hour' * power(2, least(v_failures - 1, 5)), interval '20 hours')
                                          else interval '20 hours' end
     where id = p_ref_id;
    return jsonb_build_object('ok', false);
  end if;

  select lp.id, lp.legal_case_id, lp.cnj_number, lp.title into v_proc
  from public.legal_processes lp where lp.id = v_ref.legal_process_id and lp.deleted_at is null;
  if v_proc.id is null or v_proc.cnj_number is distinct from v_ref.external_id then
    update public.process_external_refs set last_attempt_at = now(), next_attempt_at = now() + interval '20 hours',
           last_error = 'Processo excluído ou com outro CNJ', last_error_kind = 'OTHER' where id = p_ref_id;
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

  -- 073: leitura com sucesso zera as falhas seguidas. 075: e o tipo do erro.
  update public.process_external_refs
     set last_attempt_at = now(), last_synced_at = now(), last_error = null, last_error_kind = null,
         next_attempt_at = now() + interval '20 hours',
         consecutive_failures = 0,
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

-- ═════════════════════════════ 3. CNJ trocado começa do zero ══════════════

create or replace function private.legal_processes_track_cnj()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ref uuid;
begin
  if new.cnj_number is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.cnj_number is not distinct from old.cnj_number then
    return new;
  end if;
  select r.id into v_ref from public.process_external_refs r
  where r.legal_process_id = new.id and r.provider = 'DATAJUD';
  if v_ref is null then
    insert into public.process_external_refs (legal_process_id, provider, external_id)
    values (new.id, 'DATAJUD', new.cnj_number)
    on conflict (provider, external_id) do nothing;
  else
    -- 073: zera também as falhas seguidas. 075: e o tipo do erro.
    update public.process_external_refs
       set external_id = new.cnj_number, baseline_at = null, last_synced_at = null,
           last_attempt_at = null, last_error = null, last_error_kind = null, metadata = '{}', consecutive_failures = 0
     where id = v_ref;
  end if;
  return new;
end
$$;

-- ═════════════════════════════ 4. visão geral ═════════════════════════════

-- Visão geral da integração judicial (043/059/061/062/074). Novo (075):
--   - processes.with_error: só os erros que não são "ainda não aparece no DataJud";
--   - processes.not_in_datajud: acompanhados cujo último erro é NOT_FOUND.
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
                    'with_error', count(*) filter (where r.sync_enabled and r.last_error is not null
                                                     and r.last_error_kind is distinct from 'NOT_FOUND'),
                    'not_in_datajud', count(*) filter (where r.sync_enabled and r.last_error is not null
                                                         and r.last_error_kind = 'NOT_FOUND'),
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

-- ═════════════════════════════ 5. situação do processo ════════════════════

-- Situação do acompanhamento automático de um processo. Parceiro: só os campos
-- de situação (sem erro técnico). Novo (075): last_error_kind, só para a equipe.
create or replace function private.get_process_judicial_status(p_process_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_internal boolean := private.is_internal_user();
  v_p        record;
  v_r        public.process_external_refs;
begin
  if not v_internal and not private.can_access_process(p_process_id) then
    raise exception 'Processo não encontrado' using errcode = 'P0002';
  end if;
  select lp.id, lp.cnj_number, lp.deleted_at into v_p from public.legal_processes lp where lp.id = p_process_id;
  if v_p.id is null or (not v_internal and v_p.deleted_at is not null) then
    raise exception 'Processo não encontrado' using errcode = 'P0002';
  end if;
  select * into v_r from public.process_external_refs r
  where r.legal_process_id = p_process_id and r.provider = 'DATAJUD';
  return jsonb_build_object(
    'has_cnj', v_p.cnj_number is not null,
    'tracked', v_r.id is not null and v_r.sync_enabled and v_p.cnj_number is not null and v_r.external_id = v_p.cnj_number,
    'sync_enabled', coalesce(v_r.sync_enabled, false),
    'last_synced_at', v_r.last_synced_at,
    'baseline_at', v_r.baseline_at,
    'court_alias', v_r.metadata ->> 'alias',
    'last_error', case when v_internal then v_r.last_error end,
    'last_error_kind', case when v_internal then v_r.last_error_kind end,
    'last_attempt_at', case when v_internal then v_r.last_attempt_at end,
    'can_manage', (select private.has_internal_role('ADMIN', 'LAWYER')),
    'publications', case when v_internal then (
      select jsonb_build_object('total', count(*), 'open', count(*) filter (where pb.triage_status <> 'DONE'))
      from public.judicial_publications pb where pb.legal_process_id = p_process_id) end);
end
$$;

-- ═════════════════════════════ 6. permissões (iguais às de antes) ═════════

revoke all on function private.judicial_ingest_datajud(uuid, uuid, boolean, text, jsonb, jsonb, boolean)
  from public, anon, authenticated, service_role;
grant execute on function private.judicial_ingest_datajud(uuid, uuid, boolean, text, jsonb, jsonb, boolean) to dg_worker;
revoke all on function private.legal_processes_track_cnj() from public, anon, authenticated, service_role;
revoke all on function private.get_judicial_overview() from public, anon, authenticated, service_role;
grant execute on function private.get_judicial_overview() to authenticated;
revoke all on function private.get_process_judicial_status(uuid) from public, anon, authenticated, service_role;
grant execute on function private.get_process_judicial_status(uuid) to authenticated;
