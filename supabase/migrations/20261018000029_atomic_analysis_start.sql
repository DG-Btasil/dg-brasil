-- DG Brasil — 029: início ATÔMICO e idempotente de análise jurídica (Etapa 4.3, Fase E)
--
-- Antes: criar a análise (insert) e enviá-la ao agente (request_agent_run_once
-- + update da análise) eram escritas SEPARADAS feitas pelo servidor. Uma falha
-- entre elas deixava execução enfileirada sem análise ligada (e um novo envio
-- com outra chave criava uma segunda execução), e o insert da análise não
-- tinha chave: clique duplo criava duas análises.
--
-- Agora, numa transação só:
--   1. start_legal_analysis_once(chave, caso, template, campos, enviar, pedido)
--      cria a análise e, se `enviar`, pede a execução ao agente principal do
--      template (agent_runs + agent_run_inputs + fila, por
--      private.request_agent_run — inalterada) e já grava a análise ligada à
--      execução (QUEUED). Tudo ou nada.
--   2. send_legal_analysis_once(chave, análise, pedido)
--      envio (ou nova tentativa) de análise existente: trava a linha, confere
--      o status, pede a execução e liga — tudo ou nada. Dois envios
--      simultâneos com chaves diferentes: o segundo espera o lock, vê QUEUED e
--      é recusado (nunca duas execuções para a mesma análise).
--
-- Idempotência pelo mecanismo genérico da 027 (usuário + operação + chave;
-- mesma chave + outro pedido = conflito). `p_parameters` (só correlação
-- técnica, como o request_id) fica FORA do hash: muda a cada tentativa. Auditoria: os triggers de linha já
-- registram ANALYSIS_STARTED / ANALYSIS_STATUS_CHANGED e a execução, na mesma
-- transação (com o request_id da requisição).
--
-- As funções são SECURITY INVOKER: a RLS de legal_analyses (só ADMIN/LAWYER)
-- vale como sempre; a execução é pedida pela função definer já existente, que
-- revalida papel, caso e agente. Os documentos obrigatórios continuam
-- conferidos pelo servidor ANTES (leitura; regra do checklist no TypeScript).
--
-- Nenhuma função aqui chama IA: "enviar" = enfileirar a execução.
--
-- Pós-baseline: 001–028 não são alteradas.

-- ───────────────────────────── 1. criar (e opcionalmente enviar) ─────────

create or replace function public.start_legal_analysis_once(
  p_key           uuid,
  p_legal_case_id uuid,
  p_template_id   uuid,
  p_field_values  jsonb default '{}',
  p_send          boolean default false,
  p_request_text  text default null,
  -- Só correlação técnica (ex.: {"request_id": uuid}); fora do hash da chave.
  p_parameters    jsonb default '{}'
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_prev     jsonb;
  v_id       uuid := gen_random_uuid();
  v_area     uuid;
  v_template record;
  v_run      uuid;
  v_send     boolean := coalesce(p_send, false);
begin
  if not (select private.has_internal_role('ADMIN', 'LAWYER')) then
    raise exception 'Somente ADMIN ou advogado inicia análise jurídica' using errcode = '42501';
  end if;
  if p_field_values is null or jsonb_typeof(p_field_values) <> 'object' then
    raise exception 'Campos da análise inválidos' using errcode = '22023';
  end if;

  v_prev := private.idempotency_begin('legal_analysis.start', p_key, jsonb_build_object(
    'legal_case_id', p_legal_case_id, 'template_id', p_template_id, 'fields', p_field_values,
    'send', v_send, 'request_text', p_request_text));
  if v_prev is not null then
    return jsonb_build_object(
      'analysis_id', v_prev ->> 'resource_id',
      'agent_run_id', v_prev -> 'response' ->> 'agent_run_id',
      'deduplicated', true);
  end if;

  select c.legal_area_id into v_area
  from public.legal_cases c
  where c.id = p_legal_case_id and c.deleted_at is null;
  if v_area is null then
    raise exception 'Caso não encontrado' using errcode = '42501';
  end if;

  select t.id, t.legal_area_id, t.active, t.primary_agent_id into v_template
  from public.analysis_templates t
  where t.id = p_template_id;
  if v_template.id is null or not v_template.active then
    raise exception 'Template de análise indisponível' using errcode = '23514';
  end if;
  if v_template.legal_area_id <> v_area then
    raise exception 'O template não é da área jurídica deste caso' using errcode = '23514';
  end if;

  if v_send then
    if v_template.primary_agent_id is null then
      raise exception 'O template desta análise não tem agente configurado' using errcode = '23514';
    end if;
    v_run := private.request_agent_run(v_template.primary_agent_id, p_legal_case_id, null, p_request_text, coalesce(p_parameters, '{}'), 'EXECUTE', null);
  end if;

  insert into public.legal_analyses
    (id, legal_case_id, analysis_template_id, status, field_values, agent_run_id, started_by, started_at)
  values
    (v_id, p_legal_case_id, p_template_id,
     case when v_run is null then 'PENDING' else 'QUEUED' end,
     p_field_values, v_run, auth.uid(),
     case when v_run is null then null else now() end);

  perform private.idempotency_complete('legal_analysis.start', p_key, 'legal_analyses', v_id,
    jsonb_build_object('agent_run_id', v_run));
  return jsonb_build_object('analysis_id', v_id, 'agent_run_id', v_run, 'deduplicated', false);
end
$$;

comment on function public.start_legal_analysis_once(uuid, uuid, uuid, jsonb, boolean, text, jsonb) is
  'Cria a análise e, opcionalmente, pede a execução ao agente do template e liga — numa transação, idempotente (027).';

-- ───────────────────────────── 2. enviar análise existente ───────────────

create or replace function public.send_legal_analysis_once(
  p_key          uuid,
  p_analysis_id  uuid,
  p_request_text text default null,
  p_parameters   jsonb default '{}'
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_prev  jsonb;
  v_a     record;
  v_agent uuid;
  v_run   uuid;
begin
  if not (select private.has_internal_role('ADMIN', 'LAWYER')) then
    raise exception 'Somente ADMIN ou advogado envia análise ao agente' using errcode = '42501';
  end if;

  v_prev := private.idempotency_begin('legal_analysis.send', p_key,
    jsonb_build_object('analysis_id', p_analysis_id, 'request_text', p_request_text));
  if v_prev is not null then
    return jsonb_build_object('analysis_id', p_analysis_id, 'agent_run_id', v_prev -> 'response' ->> 'agent_run_id', 'deduplicated', true);
  end if;

  -- Trava a análise: dois envios simultâneos (chaves diferentes) nunca geram duas execuções.
  select a.id, a.status, a.legal_case_id, a.analysis_template_id into v_a
  from public.legal_analyses a
  where a.id = p_analysis_id
  for update;
  if v_a.id is null then
    raise exception 'Análise não encontrada' using errcode = '42501';
  end if;
  if v_a.status not in ('PENDING', 'WAITING_DOCUMENTS', 'FAILED', 'CANCELLED') then
    raise exception 'Esta análise já está com o agente ou foi concluída' using errcode = 'P0001';
  end if;

  select t.primary_agent_id into v_agent
  from public.analysis_templates t
  where t.id = v_a.analysis_template_id and t.active;
  if v_agent is null then
    raise exception 'O template desta análise não tem agente configurado' using errcode = '23514';
  end if;

  v_run := private.request_agent_run(v_agent, v_a.legal_case_id, null, p_request_text, coalesce(p_parameters, '{}'), 'EXECUTE', null);

  update public.legal_analyses
     set status = 'QUEUED', agent_run_id = v_run, started_by = auth.uid(), started_at = now(), interruption_reason = null
   where id = p_analysis_id;

  perform private.idempotency_complete('legal_analysis.send', p_key, 'agent_runs', v_run,
    jsonb_build_object('agent_run_id', v_run));
  return jsonb_build_object('analysis_id', p_analysis_id, 'agent_run_id', v_run, 'deduplicated', false);
end
$$;

comment on function public.send_legal_analysis_once(uuid, uuid, text, jsonb) is
  'Envia (ou reenvia) análise existente ao agente do template: execução + fila + análise QUEUED numa transação, idempotente (027).';

-- ───────────────────────────── grants ─────────────────────────────────────

revoke all on function public.start_legal_analysis_once(uuid, uuid, uuid, jsonb, boolean, text, jsonb) from public, anon, service_role;
revoke all on function public.send_legal_analysis_once(uuid, uuid, text, jsonb) from public, anon, service_role;
grant execute on function public.start_legal_analysis_once(uuid, uuid, uuid, jsonb, boolean, text, jsonb) to authenticated;
grant execute on function public.send_legal_analysis_once(uuid, uuid, text, jsonb) to authenticated;
