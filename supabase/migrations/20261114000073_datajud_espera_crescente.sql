-- 073 · DataJud: a espera depois de uma falha cresce quando o mesmo processo
--       falha seguidas vezes.
--
-- Achado 2 da revisão pré-produção: um processo que falha no DataJud volta
-- para a fila. Desde a 044 a falha já grava next_attempt_at (1 h se a falha é
-- passageira, 20 h nas outras) e a fila respeita essa data. Faltava a espera
-- crescer: um processo que dá tempo esgotado ou erro 5xx toda vez era
-- consultado de novo de hora em hora, o dia inteiro, gastando consultas e
-- tempo de rodada (cada uma pode levar ~50 s) que serviriam aos outros.
--
--   1. Coluna nova em process_external_refs: consecutive_failures (falhas
--      seguidas, começa em 0).
--   2. private.judicial_ingest_datajud (definição vigente, da 044; nada depois
--      dela a redefine) muda só nas falhas e no sucesso:
--        · falha passageira (p_transient): soma 1 e espera 1 h, 2 h, 4 h, 8 h,
--          16 h, e daí em diante 20 h (teto, o mesmo intervalo de uma leitura
--          com sucesso);
--        · falha não passageira ("não encontrado", sem índice, erro do
--          servidor sem p_transient): continua 20 h, e também soma 1;
--        · leitura com sucesso: zera a contagem (e segue em 20 h).
--      "Processo excluído ou com outro CNJ" não é falha do DataJud (a fila nem
--      devolve esse processo): fica como estava.
--   3. private.legal_processes_track_cnj (gatilho da 043): trocar o CNJ do
--      processo também zera a contagem, como já zerava a última tentativa e o
--      erro. O CNJ novo começa do zero.
--
-- A fila (private.judicial_datajud_queue, 044) não muda: ela já só devolve o
-- processo quando next_attempt_at passou, e é ali que a espera crescente
-- aparece. A busca de um processo só ("Buscar agora" na tela do processo)
-- continua ignorando a espera; se der certo, zera a contagem.
--
-- Assinaturas, security definer, search_path = '' e permissões ficam iguais
-- (create or replace mantém os grants; os revokes/grants abaixo só reafirmam).
--
-- Como desfazer: rodar de novo as definições das duas funções da 043/044
-- (judicial_ingest_datajud da 044 e legal_processes_track_cnj da 043) e
-- `alter table public.process_external_refs drop column consecutive_failures`.

-- ═════════════════════════════ 1. contagem de falhas seguidas ═════════════

alter table public.process_external_refs
  add column consecutive_failures integer not null default 0
    check (consecutive_failures >= 0);

comment on column public.process_external_refs.consecutive_failures is
  'Falhas seguidas da leitura (DataJud). Depois de falha passageira, a próxima tentativa espera 1 h, 2 h, 4 h, 8 h, 16 h, teto de 20 h. Zera no sucesso.';

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
begin
  select * into v_ref from public.process_external_refs r where r.id = p_ref_id and r.provider = 'DATAJUD' for update;
  if v_ref.id is null then
    raise exception 'Referência não encontrada' using errcode = 'P0002';
  end if;
  if not coalesce(p_ok, false) then
    -- 073: falhas seguidas. Passageira: 1 h, 2 h, 4 h, 8 h, 16 h, depois 20 h
    -- (o expoente é limitado antes da conta, para nunca estourar o intervalo).
    -- Não passageira: 20 h, como antes.
    v_failures := least(v_ref.consecutive_failures, 1000) + 1;
    update public.process_external_refs
       set last_attempt_at = now(), last_error = left(coalesce(nullif(btrim(p_error), ''), 'Falha sem detalhe'), 500),
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

  -- 073: leitura com sucesso zera as falhas seguidas.
  update public.process_external_refs
     set last_attempt_at = now(), last_synced_at = now(), last_error = null, next_attempt_at = now() + interval '20 hours',
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
    -- 073: zera também as falhas seguidas.
    update public.process_external_refs
       set external_id = new.cnj_number, baseline_at = null, last_synced_at = null,
           last_attempt_at = null, last_error = null, metadata = '{}', consecutive_failures = 0
     where id = v_ref;
  end if;
  return new;
end
$$;

-- ═════════════════════════════ 4. permissões (iguais às de antes) ═════════

revoke all on function private.judicial_ingest_datajud(uuid, uuid, boolean, text, jsonb, jsonb, boolean)
  from public, anon, authenticated, service_role;
grant execute on function private.judicial_ingest_datajud(uuid, uuid, boolean, text, jsonb, jsonb, boolean) to dg_worker;
revoke all on function private.legal_processes_track_cnj() from public, anon, authenticated, service_role;
