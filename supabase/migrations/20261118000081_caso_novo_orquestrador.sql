-- 081 · Caso novo e análise aprovada vão ao orquestrador.
--
-- Decisão do usuário (18/11/2026): "caso novo deve ir para o orquestrador para
-- decidir qual agente vai ser utilizado, se cabe processo". Até aqui, caso novo
-- não chamava ninguém (alguém iniciava a Análise Bancária à mão) e a análise
-- aprovada chamava sempre a mesma sequência fixa (056: Lucas e Alice).
-- Escolhas do usuário: o caso vai quando chega o primeiro documento, e o
-- orquestrador decide também depois da análise aprovada (a lista fixa vira
-- reserva).
--
--   1. Configuração: process_task_settings.case_orchestration (padrão: ligado),
--      gravada por save_case_orchestration (só ADMIN). Desligada: caso novo não
--      chama ninguém e a análise aprovada segue a lista fixa (056), como antes.
--   2. CASO NOVO. O caso vai ao orquestrador (uma vez só por caso) quando TUDO
--      isto vale:
--        · a opção está ligada e há orquestrador em vigor (047);
--        · o caso não foi excluído e não está em rascunho, recusado, encerrado
--          ou arquivado (o rascunho do parceiro vai quando ele envia o caso);
--        · o caso tem documento próprio, não gerado por agente (061);
--        · o caso ainda não tem análise nenhuma (se alguém já iniciou a
--          análise à mão, o caso já está andando);
--        · há em nome de quem pedir: a pessoa logada, se for ADMIN ou advogado;
--          senão o advogado do caso; senão quem criou o caso, se for da equipe. Quem
--          anexa costuma ser o PARCEIRO, que não pode pedir trabalho a agente:
--          o pedido sai em nome do advogado, por private.request_agent_run_as.
--      Gatilhos: arquivo confirmado (document_versions), documento ligado ao
--      caso (case_documents) e caso que sai do rascunho (legal_cases.status).
--      Sem advogado: nada vai, fica registrado na atividade do caso e os
--      administradores são avisados uma vez. Nada aqui derruba o envio do
--      documento nem a mudança do caso.
--   3. ANÁLISE APROVADA. private.analysis_sequence_enqueue (056) passa a mandar
--      o caso de volta ao orquestrador, com o resumo da análise, quando a opção
--      está ligada e há orquestrador. Sem isso, ou se o envio falhar, roda a
--      lista fixa do modelo (056), sem mudança. Uma vez por resultado aprovado.
--   4. A porta da análise. Quando o orquestrador escolhe o agente de ANÁLISE de
--      um modelo (a Clara, na Análise Bancária), a análise não pode rodar dentro
--      do trabalho do orquestrador: o resultado só é aceito numa execução de
--      análise (worker_submit_analysis_result, 039), e é a aprovação dela que
--      traz o caso de volta (3). private.executor_start_case_analysis abre a
--      análise do modelo daquele agente no caso e põe na fila, em nome de quem
--      pediu o trabalho do orquestrador, como se a pessoa tivesse clicado em
--      "Iniciar análise". Só um trabalho do orquestrador em vigor pode pedir;
--      repetir não duplica.
--
-- Os pedidos começam com "CASO NOVO" e "ANÁLISE APROVADA": é por esse começo
-- que o roteiro do computador do escritório (conector 1.4.0) sabe que deve
-- chamar o orquestrador, como já faz com "TAREFA DO PROCESSO".
--
-- 001–080 não são alteradas (047 ganha uma coluna por ALTER; a função da 056 é
-- redefinida aqui, e a lista fixa continua idêntica em
-- private.analysis_sequence_fixed). Rodar de novo não quebra nem duplica.

-- ═════════════════════════════ 1. configuração ════════════════════════════

alter table public.process_task_settings
  add column if not exists case_orchestration boolean not null default true;

comment on column public.process_task_settings.case_orchestration is
  'Caso novo e análise aprovada vão ao orquestrador (081). Desligado: caso novo não chama ninguém e a análise aprovada segue a lista fixa do modelo (056).';

create or replace function public.save_case_orchestration(p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'Somente ADMIN muda a esteira do orquestrador' using errcode = '42501';
  end if;
  if p_enabled is null then
    raise exception 'Informe ligado ou desligado' using errcode = '22023';
  end if;
  update public.process_task_settings
     set case_orchestration = p_enabled, updated_by = auth.uid(), updated_at = now()
   where id;
  perform private.record_audit_event('PROCESS_TASK_SETTINGS_UPDATED', 'process_task_settings', null,
    jsonb_build_object('case_orchestration', p_enabled));
end
$$;

-- A opção está ligada E há orquestrador em vigor? Devolve o orquestrador ou nulo.
create or replace function private.case_orchestrator()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case when coalesce((select s.case_orchestration from public.process_task_settings s where s.id), false)
              then private.process_task_orchestrator() end
$$;

-- ═════════════════════════════ 2. pedir em nome do advogado ═══════════════

-- Igual a private.request_agent_run (018), mas SEMPRE em nome de p_actor, mesmo
-- com outra pessoa logada (o parceiro que anexou o documento). Só para os
-- gatilhos desta migration: ninguém de fora chama. Mesmas conferências: o ator
-- é ADMIN ou advogado ativo, o caso existe, o agente está ativo.
create or replace function private.request_agent_run_as(
  p_actor         uuid,
  p_agent_id      uuid,
  p_legal_case_id uuid,
  p_request_text  text,
  p_parameters    jsonb,
  p_operation     text default 'EXECUTE'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version uuid;
  v_run     uuid;
begin
  if p_actor is null or not private.is_active_internal_user(p_actor)
     or private.user_internal_role(p_actor) not in ('ADMIN', 'LAWYER') then
    raise exception 'O pedido precisa sair em nome de um ADMIN ou advogado ativo' using errcode = '42501';
  end if;
  if not exists (select 1 from public.legal_cases c where c.id = p_legal_case_id and c.deleted_at is null) then
    raise exception 'Caso % não existe ou foi excluído', p_legal_case_id using errcode = '42501';
  end if;
  select a.current_version_id into v_version
  from public.agents a
  where a.id = p_agent_id and a.status = 'ACTIVE' and a.deleted_at is null;
  if v_version is null then
    raise exception 'Agente inexistente, inativo ou sem versão corrente' using errcode = '23514';
  end if;

  insert into public.agent_runs
    (agent_id, agent_version_id, legal_case_id, legal_process_id, requested_by, operation)
  values
    (p_agent_id, v_version, p_legal_case_id, null, p_actor, coalesce(p_operation, 'EXECUTE'))
  returning id into v_run;

  insert into public.agent_run_inputs (agent_run_id, requested_by, request_text, parameters)
  values (v_run, p_actor, nullif(btrim(p_request_text), ''), coalesce(p_parameters, '{}'));

  perform private.enqueue_agent_run(v_run);
  return v_run;
end
$$;

-- ═════════════════════════════ 3. CASO NOVO ═══════════════════════════════

-- O pedido ao orquestrador: dados do caso e lista dos documentos (só nome,
-- categoria e arquivo; o conteúdo o orquestrador vê na pasta entrada). Nada de
-- CPF, benefício ou endereço.
create or replace function private.case_intake_request(p_legal_case_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select left(concat_ws(E'\n\n',
    'CASO NOVO (DG Brasil)',
    'O caso acabou de receber documento e ainda não tem análise. Decida qual agente do kit começa (análise do extrato, inicial, kit do cliente) ou se não cabe processo agora, e por quê.',
    'Caso: ' || c.title
      || E'\n' || 'Área: ' || coalesce(a.name, 'não informada')
      || E'\n' || 'Origem: ' || coalesce(o.name, 'não informada')
      || E'\n' || 'Situação: ' || c.status,
    case when nullif(btrim(coalesce(c.summary, '')), '') is not null
         then 'Resumo do caso:' || E'\n' || left(btrim(c.summary), 3000) end,
    'Documentos do caso:' || E'\n' || coalesce((
      select string_agg('- ' || d.title || ' (' || d.category::text
                          || coalesce(', ' || nullif(v.original_filename, ''), '') || ')', E'\n' order by d.created_at)
      from public.case_documents cd
      join public.documents d on d.id = cd.document_id and d.deleted_at is null and d.status = 'ACTIVE'
      left join lateral (select dv.original_filename from public.document_versions dv
                          where dv.document_id = d.id order by dv.version_number desc limit 1) v on true
      where cd.legal_case_id = c.id), '- (nenhum)'),
    'Ao terminar: o que for produzido vai para revisão humana; nada é protocolado nem enviado sem aprovação.'
  ), 20000)
  from public.legal_cases c
  left join public.legal_areas a on a.id = c.legal_area_id
  left join public.organizations o on o.id = c.origin_organization_id
  where c.id = p_legal_case_id
$$;

-- Manda o caso ao orquestrador, se for a hora. Devolve a execução criada ou
-- nulo (não era a hora, já foi, ou faltou quem pedisse). Erros sobem: os
-- gatilhos abaixo engolem.
create or replace function private.case_intake_enqueue(p_legal_case_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case    record;
  v_agent   uuid := private.case_orchestrator();
  v_key     uuid := md5('caso-novo:' || p_legal_case_id::text)::uuid;
  v_session uuid := auth.uid();
  v_actor   uuid;
  v_run     uuid;
  v_keep    text := coalesce(current_setting('dg.actor_user_id', true), '');
begin
  if v_agent is null or p_legal_case_id is null then
    return null;
  end if;
  select c.id, c.status, c.assigned_lawyer_id, c.created_by into v_case
  from public.legal_cases c
  where c.id = p_legal_case_id and c.deleted_at is null;
  if v_case.id is null or v_case.status in ('DRAFT', 'REJECTED', 'CLOSED', 'ARCHIVED') then
    return null;
  end if;
  if exists (select 1 from public.agent_runs r where r.idempotency_key = v_key)
     or exists (select 1 from public.legal_analyses a where a.legal_case_id = p_legal_case_id)
     or not private.case_has_own_document(p_legal_case_id) then
    return null;
  end if;

  if v_session is not null and private.is_active_internal_user(v_session)
     and private.user_internal_role(v_session) in ('ADMIN', 'LAWYER') then
    v_actor := v_session;
  else
    select u into v_actor
    from unnest(array[v_case.assigned_lawyer_id, v_case.created_by]) with ordinality t(u, o)
    where u is not null and private.is_active_internal_user(u) and private.user_internal_role(u) in ('ADMIN', 'LAWYER')
    order by o limit 1;
  end if;
  if v_actor is null then
    if not exists (select 1 from public.audit_events e
                    where e.entity_type = 'legal_cases' and e.entity_id = p_legal_case_id and e.action = 'CASE_INTAKE_SKIPPED') then
      perform private.record_audit_event('CASE_INTAKE_SKIPPED', 'legal_cases', p_legal_case_id,
        jsonb_build_object('reason', 'Caso sem advogado: defina o advogado do caso e peça o trabalho à mão.'));
      perform private.notify(u, 'AGENT_RUN_ATTENTION', 'Caso novo sem advogado',
        'Um caso recebeu documento, mas não foi ao orquestrador porque não tem advogado definido. Defina o advogado do caso e peça o trabalho em "Executar em um caso".',
        'WARNING', 'case-intake-no-lawyer:' || p_legal_case_id, p_legal_case_id, null, null, null, null)
      from private.active_admin_ids() u;
    end if;
    return null;
  end if;

  v_run := private.request_agent_run_as(v_actor, v_agent, p_legal_case_id,
    private.case_intake_request(p_legal_case_id),
    jsonb_build_object('caso_novo', 'true'), 'EXECUTE');
  update public.agent_runs set idempotency_key = v_key where id = v_run;
  perform private.record_audit_event('CASE_INTAKE_QUEUED', 'legal_cases', p_legal_case_id,
    jsonb_build_object('agent_run_id', v_run, 'agent_id', v_agent, 'requested_by', v_actor));
  -- O pedido em nome do advogado não muda quem está agindo nesta transação.
  perform set_config('dg.actor_user_id', v_keep, true);
  return v_run;
end
$$;

-- Última barreira dos gatilhos: nada aqui derruba o documento nem o caso.
create or replace function private.case_intake_try(p_legal_case_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_err text;
begin
  perform private.case_intake_enqueue(p_legal_case_id);
exception when others then
  get stacked diagnostics v_err = message_text;
  begin
    perform private.record_audit_event('CASE_INTAKE_FAILED', 'legal_cases', p_legal_case_id,
      jsonb_build_object('error', left(v_err, 500)));
  exception when others then
    raise warning 'Caso % não foi ao orquestrador: %', p_legal_case_id, v_err;
  end;
end
$$;

create or replace function private.document_versions_case_intake()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.source <> 'AGENT' then
    perform private.case_intake_try(cd.legal_case_id)
    from public.case_documents cd where cd.document_id = new.document_id;
  end if;
  return null;
end
$$;

create or replace function private.case_documents_case_intake()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.case_intake_try(new.legal_case_id);
  return null;
end
$$;

create or replace function private.legal_cases_case_intake()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.case_intake_try(new.id);
  return null;
end
$$;

drop trigger if exists document_versions_case_intake on public.document_versions;
create trigger document_versions_case_intake
  after insert on public.document_versions
  for each row execute function private.document_versions_case_intake();

drop trigger if exists case_documents_case_intake on public.case_documents;
create trigger case_documents_case_intake
  after insert on public.case_documents
  for each row execute function private.case_documents_case_intake();

drop trigger if exists legal_cases_case_intake on public.legal_cases;
create trigger legal_cases_case_intake
  after update of status on public.legal_cases
  for each row
  when (old.status = 'DRAFT' and new.status is distinct from old.status)
  execute function private.legal_cases_case_intake();

-- ═════════════════════════════ 4. ANÁLISE APROVADA ════════════════════════

-- A lista fixa da 056, idêntica, com outro nome: é a reserva.
create or replace function private.analysis_sequence_fixed(p_review_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rev   record;
  v_actor uuid;
  v_ag    record;
  v_key   uuid;
  v_run   uuid;
  v_text  text;
  v_err   text;
  v_n     integer := 0;
begin
  select r.id, r.legal_case_id, r.legal_process_id, r.legal_analysis_id, r.legal_analysis_result_id,
         t.id as template_id, t.name as template_name, t.next_agent_ids, t.next_agent_requests
    into v_rev
    from public.reviews r
    join public.legal_analyses a on a.id = r.legal_analysis_id
    join public.analysis_templates t on t.id = a.analysis_template_id
   where r.id = p_review_id and r.status = 'APPROVED' and r.legal_analysis_result_id is not null;
  if v_rev.id is null or cardinality(v_rev.next_agent_ids) = 0 then
    return 0;
  end if;

  select d.decided_by into v_actor
    from public.review_decisions d
   where d.review_id = p_review_id and d.decision = 'APPROVE'
   order by d.created_at desc
   limit 1;

  for v_ag in
    select x.agent_id, x.pos, a.slug, a.name, a.status, a.deleted_at
      from unnest(v_rev.next_agent_ids) with ordinality as x (agent_id, pos)
      left join public.agents a on a.id = x.agent_id
     order by x.pos
  loop
    v_key := md5('sequencia-automatica:' || v_rev.legal_analysis_result_id::text || ':' || v_ag.agent_id::text)::uuid;
    continue when exists (select 1 from public.agent_runs r where r.idempotency_key = v_key);

    if v_ag.slug is null or v_ag.deleted_at is not null or v_ag.status <> 'ACTIVE' then
      perform private.record_audit_event('AUTO_SEQUENCE_SKIPPED', 'legal_cases', v_rev.legal_case_id,
        jsonb_build_object('review_id', v_rev.id, 'legal_analysis_result_id', v_rev.legal_analysis_result_id,
                           'analysis_template_id', v_rev.template_id, 'agent_id', v_ag.agent_id, 'agent_slug', v_ag.slug,
                           'position', v_ag.pos,
                           'reason', case when v_ag.slug is null or v_ag.deleted_at is not null then 'Agente excluído'
                                          else 'Agente pausado (' || v_ag.status || ')' end));
      continue;
    end if;

    v_text := 'Sequência automática depois da análise aprovada: '
      || coalesce(nullif(btrim(v_rev.next_agent_requests ->> v_ag.agent_id::text), ''),
                  'faça o trabalho deste agente no caso, a partir da análise aprovada (' || v_rev.template_name || ').');
    begin
      v_run := private.request_agent_run(v_ag.agent_id, v_rev.legal_case_id, v_rev.legal_process_id, v_text,
        jsonb_build_object('sequencia_automatica', 'true',
                           'review_id', v_rev.id::text,
                           'legal_analysis_result_id', v_rev.legal_analysis_result_id::text,
                           'posicao', v_ag.pos::text),
        'EXECUTE', v_actor);
      update public.agent_runs set idempotency_key = v_key where id = v_run;
      perform private.record_audit_event('AUTO_SEQUENCE_QUEUED', 'legal_cases', v_rev.legal_case_id,
        jsonb_build_object('review_id', v_rev.id, 'legal_analysis_result_id', v_rev.legal_analysis_result_id,
                           'analysis_template_id', v_rev.template_id, 'agent_id', v_ag.agent_id, 'agent_slug', v_ag.slug,
                           'position', v_ag.pos, 'agent_run_id', v_run));
      v_n := v_n + 1;
    exception when others then
      get stacked diagnostics v_err = message_text;
      perform private.record_audit_event('AUTO_SEQUENCE_FAILED', 'legal_cases', v_rev.legal_case_id,
        jsonb_build_object('review_id', v_rev.id, 'legal_analysis_result_id', v_rev.legal_analysis_result_id,
                           'analysis_template_id', v_rev.template_id, 'agent_id', v_ag.agent_id, 'agent_slug', v_ag.slug,
                           'position', v_ag.pos, 'error', left(v_err, 500)));
      perform private.notify(u, 'AGENT_RUN_ATTENTION', 'Sequência automática não enfileirada',
        v_ag.name || ' não recebeu o trabalho depois da análise aprovada. Peça à mão em "Executar em um caso". Motivo: ' || left(v_err, 300),
        'WARNING', 'auto-sequence-failed:' || v_rev.legal_analysis_result_id || ':' || v_ag.agent_id,
        v_rev.legal_case_id, v_rev.legal_process_id, null, 'review', v_rev.id)
      from private.active_admin_ids() u;
    end;
  end loop;
  return v_n;
end
$$;

-- O pedido ao orquestrador depois da análise aprovada: o modelo, o resumo da
-- análise e o recado do advogado na aprovação.
create or replace function private.analysis_approved_request(p_review_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select left(concat_ws(E'\n\n',
    'ANÁLISE APROVADA (DG Brasil)',
    'Um advogado aprovou em Revisões a análise "' || t.name || '" deste caso. Decida os próximos agentes do kit (kit do cliente, iniciais, revisional, produto agregado) ou se não cabe processo, e por quê. A análise completa (roteiro) está na pasta do cliente.',
    'Caso: ' || c.title,
    'Resumo da análise aprovada:' || E'\n' || left(coalesce(nullif(btrim(res.summary), ''), '(sem resumo)'), 6000),
    (select 'Recado do advogado na aprovação:' || E'\n' || left(btrim(d.notes), 2000)
       from public.review_decisions d
      where d.review_id = r.id and d.decision = 'APPROVE' and nullif(btrim(coalesce(d.notes, '')), '') is not null
      order by d.created_at desc limit 1),
    'Decisão que só o advogado toma (como a segunda rodada de ações, "PODE GERAR") vale só se estiver escrita neste recado.',
    'Ao terminar: o que for produzido vai para revisão humana; nada é protocolado nem enviado sem aprovação.'
  ), 20000)
  from public.reviews r
  join public.legal_analyses a on a.id = r.legal_analysis_id
  join public.analysis_templates t on t.id = a.analysis_template_id
  join public.legal_cases c on c.id = r.legal_case_id
  left join public.legal_analysis_results res on res.id = r.legal_analysis_result_id
  where r.id = p_review_id
$$;

-- A 056 passa a perguntar ao orquestrador. Sem ele (ou se o envio falhar), a
-- lista fixa. Devolve quantos trabalhos entraram na fila.
create or replace function private.analysis_sequence_enqueue(p_review_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rev   record;
  v_agent uuid := private.case_orchestrator();
  v_actor uuid;
  v_key   uuid;
  v_run   uuid;
  v_err   text;
begin
  select r.id, r.legal_case_id, r.legal_process_id, r.legal_analysis_result_id into v_rev
    from public.reviews r
   where r.id = p_review_id and r.status = 'APPROVED' and r.legal_analysis_result_id is not null;
  if v_rev.id is null then
    return 0;
  end if;
  if v_agent is null then
    return private.analysis_sequence_fixed(p_review_id);
  end if;

  v_key := md5('analise-aprovada:' || v_rev.legal_analysis_result_id::text)::uuid;
  if exists (select 1 from public.agent_runs r where r.idempotency_key = v_key) then
    return 0;
  end if;
  select d.decided_by into v_actor
    from public.review_decisions d
   where d.review_id = p_review_id and d.decision = 'APPROVE'
   order by d.created_at desc
   limit 1;

  begin
    v_run := private.request_agent_run(v_agent, v_rev.legal_case_id, v_rev.legal_process_id,
      private.analysis_approved_request(p_review_id),
      jsonb_build_object('analise_aprovada', 'true',
                         'review_id', v_rev.id::text,
                         'legal_analysis_result_id', v_rev.legal_analysis_result_id::text),
      'EXECUTE', v_actor);
    update public.agent_runs set idempotency_key = v_key where id = v_run;
    perform private.record_audit_event('AUTO_SEQUENCE_QUEUED', 'legal_cases', v_rev.legal_case_id,
      jsonb_build_object('review_id', v_rev.id, 'legal_analysis_result_id', v_rev.legal_analysis_result_id,
                         'agent_id', v_agent, 'agent_run_id', v_run, 'orchestrator', true));
    return 1;
  exception when others then
    get stacked diagnostics v_err = message_text;
    perform private.record_audit_event('AUTO_SEQUENCE_FAILED', 'legal_cases', v_rev.legal_case_id,
      jsonb_build_object('review_id', v_rev.id, 'legal_analysis_result_id', v_rev.legal_analysis_result_id,
                         'agent_id', v_agent, 'orchestrator', true, 'error', left(v_err, 500)));
    return private.analysis_sequence_fixed(p_review_id);
  end;
end
$$;

-- ═════════════════════════════ 5. a porta da análise ═════════════════════

-- O orquestrador escolheu o agente de análise de um modelo (ex.: a Clara da
-- Análise Bancária): abre a análise do modelo no caso e põe na fila, em nome de
-- quem pediu o trabalho do orquestrador. p_local_agent é o nome do agente no
-- computador do escritório (configuration.local_agent), como o orquestrador o
-- escreve. Repetir devolve a mesma análise.
create or replace function private.executor_start_case_analysis(
  p_token_hash text, p_agent_run_id uuid, p_lease_hash text, p_local_agent text, p_request_text text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_by       text := private.executor_lease(p_token_hash, p_agent_run_id, p_lease_hash, 'analysis.submit', true);
  v_run      record;
  v_template record;
  v_open     record;
  v_key      uuid;
  v_new      uuid;
  v_id       uuid := gen_random_uuid();
begin
  select r.id, r.agent_id, r.legal_case_id, r.requested_by, c.legal_area_id into v_run
  from public.agent_runs r join public.legal_cases c on c.id = r.legal_case_id and c.deleted_at is null
  where r.id = p_agent_run_id;
  if v_run.id is null then
    raise exception 'Este trabalho não é de um caso' using errcode = '23514';
  end if;
  if v_run.agent_id is distinct from private.process_task_orchestrator() then
    raise exception 'Só o trabalho do orquestrador pede análise' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_local_agent, '')), '') is null or length(p_local_agent) > 64 then
    raise exception 'Informe o agente de análise' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_request_text, '')), '') is null or length(p_request_text) > 8000 then
    raise exception 'O pedido da análise é obrigatório (até 8000 caracteres)' using errcode = '22023';
  end if;

  -- O modelo ativo da área do caso cujo agente principal é esse agente local.
  select t.id, t.name, t.primary_agent_id into v_template
  from public.analysis_templates t
  join public.agents a on a.id = t.primary_agent_id and a.status = 'ACTIVE' and a.deleted_at is null
  join public.agent_versions v on v.id = a.current_version_id
  where t.active and t.legal_area_id = v_run.legal_area_id
    and v.configuration ->> 'local_agent' = btrim(p_local_agent)
  order by t.created_at
  limit 1;
  if v_template.id is null then
    raise exception 'O agente % não faz a análise de nenhum modelo ativo da área deste caso', btrim(p_local_agent)
      using errcode = '23514';
  end if;

  v_key := md5('orquestrador-analise:' || p_agent_run_id::text || ':' || v_template.id::text)::uuid;
  select a.id, a.agent_run_id into v_open
  from public.legal_analyses a join public.agent_runs r on r.id = a.agent_run_id
  where r.idempotency_key = v_key;
  if v_open.id is null then
    -- Análise do mesmo modelo já andando no caso (alguém clicou antes): não abre outra.
    select a.id, a.agent_run_id into v_open
    from public.legal_analyses a
    where a.legal_case_id = v_run.legal_case_id and a.analysis_template_id = v_template.id
      and a.status in ('QUEUED', 'RUNNING', 'WAITING_REVIEW')
    order by a.created_at desc limit 1;
  end if;
  if v_open.id is not null then
    return jsonb_build_object('analysis_id', v_open.id, 'agent_run_id', v_open.agent_run_id,
                              'template', v_template.name, 'created', false);
  end if;

  v_new := private.request_agent_run(v_template.primary_agent_id, v_run.legal_case_id, null,
    'Pedido do orquestrador: ' || btrim(p_request_text),
    jsonb_build_object('pedido_do_orquestrador', p_agent_run_id::text), 'EXECUTE', v_run.requested_by);
  update public.agent_runs set idempotency_key = v_key where id = v_new;
  insert into public.legal_analyses
    (id, legal_case_id, analysis_template_id, status, field_values, agent_run_id, started_by, started_at)
  values (v_id, v_run.legal_case_id, v_template.id, 'QUEUED', '{}', v_new, v_run.requested_by, now());

  insert into public.agent_run_events (agent_run_id, kind, message, executor_id)
  select p_agent_run_id, 'OUTPUT', left('Análise "' || v_template.name || '" pedida pelo orquestrador', 500), r.executor_id
  from public.agent_runs r where r.id = p_agent_run_id;
  return jsonb_build_object('analysis_id', v_id, 'agent_run_id', v_new, 'template', v_template.name, 'created', true);
end
$$;

-- ═════════════════════════════ 6. permissões ══════════════════════════════

revoke all on function public.save_case_orchestration(boolean) from public, anon;
grant execute on function public.save_case_orchestration(boolean) to authenticated;
revoke all on function private.case_orchestrator() from public, anon, authenticated, service_role;
revoke all on function private.request_agent_run_as(uuid, uuid, uuid, text, jsonb, text) from public, anon, authenticated, service_role;
revoke all on function private.case_intake_request(uuid) from public, anon, authenticated, service_role;
revoke all on function private.case_intake_enqueue(uuid) from public, anon, authenticated, service_role;
revoke all on function private.case_intake_try(uuid) from public, anon, authenticated, service_role;
revoke all on function private.document_versions_case_intake() from public, anon, authenticated, service_role;
revoke all on function private.case_documents_case_intake() from public, anon, authenticated, service_role;
revoke all on function private.legal_cases_case_intake() from public, anon, authenticated, service_role;
revoke all on function private.analysis_sequence_fixed(uuid) from public, anon, authenticated, service_role;
revoke all on function private.analysis_approved_request(uuid) from public, anon, authenticated, service_role;
revoke all on function private.analysis_sequence_enqueue(uuid) from public, anon, authenticated, service_role;
revoke all on function private.executor_start_case_analysis(text, uuid, text, text, text) from public, anon, authenticated, service_role;
grant execute on function private.executor_start_case_analysis(text, uuid, text, text, text) to dg_worker;
