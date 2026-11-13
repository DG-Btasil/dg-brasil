-- 061 · O prazo do agente de prazos vira tarefa para os agentes.
--
-- Decisão da dona do produto (13/11/2026): "Quando o agente de prazos lança um
-- prazo, o sistema escreve sozinho uma tarefa na lista do processo (ex.:
-- 'Preparar a réplica, prazo até 03/12'); a tarefa vai para o orquestrador, que
-- chama o agente certo; a minuta chega em Revisões como qualquer outra. Caso sem
-- os autos anexados: cria a tarefa de qualquer jeito, mas só manda ao
-- orquestrador quando o caso tiver documento; sem documento, ela fica aberta com
-- o aviso 'anexe os autos'."
--
-- Até a 059, o agente de prazos dizia, na descrição do prazo, qual peça cabe e
-- qual agente a faz, mas ninguém era chamado. Agora:
--
--   1. Vínculo: process_tasks.source_deadline_id aponta o prazo que deu origem à
--      tarefa. No máximo UMA tarefa automática por prazo (índice único). Tarefa
--      escrita pela equipe continua com a coluna vazia. A tabela já é só da
--      equipe interna (RLS da 047): a coluna nova não abre nada para parceiro.
--   2. Gatilho em agent_proposals (depois de mudar a situação): proposta
--      CREATE_DEADLINE que vira APPLIED com o prazo criado, quando o trabalho
--      dela é o de uma publicação (judicial_publications.agent_run_id — o mesmo
--      critério da 059), cria a tarefa no processo do prazo. Vale para os dois
--      caminhos: prazo direto (059) e prazo aprovado em Revisões (018). Prazo
--      criado à mão pela equipe (tela da publicação ou agenda) não passa por
--      proposta: não gera tarefa. Proposta de prazo de um trabalho avulso (que
--      não nasceu de publicação) também não.
--        - O gatilho não depende do gatilho da 043 (que fecha a publicação), nem
--          da ordem entre os dois: só lê a quem a publicação aponta.
--        - As funções da 018 e da 059 não mudam.
--   3. A tarefa: título "Preparar: <título do prazo>"; o que fazer = de onde veio
--      o prazo, o vencimento, os dados da publicação (sem o teor: ele está no
--      PROCESSO_<CNJ>.txt da pasta do cliente), o pedido de redigir a peça e, por
--      último, a análise do agente de prazos (a descrição do prazo). Prioridade e
--      prazo interno = os do prazo. Sem agente escolhido (vai para o
--      orquestrador) e sem autor (ninguém escreveu: created_by vazio). Fica
--      registrada na linha do tempo do processo como registro de agente (o
--      parceiro não vê, 032).
--   4. Mandar ou deixar aberta. A tarefa vai para o orquestrador na hora (mesma
--      mecânica de private.process_task_enqueue, 047) só se TUDO isto valer:
--        · a descrição do prazo não começa com "CONFERIR:" (prazo duvidoso
--          espera uma pessoa);
--        · o vencimento não passou;
--        · o caso tem pelo menos um documento ativo que não foi gerado por
--          agente (private.case_has_own_document);
--        · há orquestrador em vigor (private.process_task_orchestrator, 047);
--        · há em nome de quem pedir: o responsável do prazo, o do processo, o
--          advogado do caso ou quem pediu o trabalho da publicação — o primeiro
--          que for ADMIN ou advogado ativo (a ordem da 043/059). Havendo uma
--          pessoa logada na transação, é ela.
--      Senão a tarefa nasce ABERTA, com o motivo em last_error — o campo que a
--      tela da lista de afazeres já mostra na tarefa aberta. Quando a pessoa
--      resolve (anexa os autos, confere o prazo) e clica em "Enviar aos
--      agentes", a 047 limpa o aviso e manda.
--   5. Nada aqui desfaz o prazo: qualquer erro ao criar ou enviar a tarefa é
--      engolido. Erro ao enviar → a tarefa fica aberta com o motivo. Erro ao
--      criar → fica registrado na linha do tempo do trabalho da publicação
--      (agent_run_events, tipo ERROR).
--   6. Configuração: judicial_settings.deadline_auto_task (padrão: ligado).
--      get_judicial_overview devolve e save_judicial_settings aceita a chave
--      "deadline_auto_task" (mesmo padrão de deadline_auto_apply). Desligada:
--      nenhuma tarefa é criada.
--
-- Para desligar: save_judicial_settings('{"deadline_auto_task": false}').
--
-- 001–060 não são alteradas (043 e 047 ganham uma coluna cada por ALTER; as duas
-- funções da tela da 043/059 são redefinidas aqui). Rodar de novo não quebra nem
-- duplica. Não depende da 060.

-- ═════════════════════════════ 1. configuração ════════════════════════════

alter table public.judicial_settings
  add column if not exists deadline_auto_task boolean not null default true;

comment on column public.judicial_settings.deadline_auto_task is
  'O prazo do agente vira tarefa para os agentes (061): quando o agente de prazos lança um prazo a partir de uma publicação, o sistema cria a tarefa na lista do processo e manda ao orquestrador. Desligado: nenhuma tarefa é criada.';

-- Visão geral da integração judicial (043/059), agora com deadline_auto_task.
-- Nada mais muda.
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
      'updated_at', v_s.updated_at),
    'monitors', coalesce((select jsonb_agg(private.judicial_monitor_json(m, true)
                                           order by (o.type = 'OWNER') desc, o.name, m.active desc, m.oab_state, m.oab_number)
                          from public.judicial_monitors m join public.organizations o on o.id = m.organization_id), '[]'::jsonb),
    'runs', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'trigger', r.trigger, 'scope', r.scope, 'status', r.status,
                                                          'started_at', r.started_at, 'finished_at', r.finished_at,
                                                          'stats', r.stats, 'error', r.error) order by r.started_at desc)
                      from (select * from public.judicial_sync_runs order by started_at desc limit 10) r), '[]'::jsonb),
    'processes', (select jsonb_build_object(
                    'tracked', count(*) filter (where r.sync_enabled),
                    'paused', count(*) filter (where not r.sync_enabled),
                    'never_synced', count(*) filter (where r.sync_enabled and r.last_synced_at is null),
                    'with_error', count(*) filter (where r.sync_enabled and r.last_error is not null))
                  from public.process_external_refs r
                  join public.legal_processes p on p.id = r.legal_process_id and p.deleted_at is null and p.cnj_number = r.external_id
                  where r.provider = 'DATAJUD'),
    'publications', (select jsonb_build_object(
                       'pending', count(*) filter (where triage_status = 'PENDING'),
                       'with_agent', count(*) filter (where triage_status = 'WITH_AGENT'),
                       'done_last_30_days', count(*) filter (where triage_status = 'DONE' and triaged_at > now() - interval '30 days'))
                     from public.judicial_publications),
    'agents', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name) order by a.name)
                        from public.agents a where a.status = 'ACTIVE' and a.deleted_at is null), '[]'::jsonb),
    'calendar', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'court', d.court, 'day', d.day, 'kind', d.kind,
                                                              'description', d.description) order by d.day, d.court nulls first)
                          from public.court_calendar_days d where d.day >= (now() at time zone 'America/Sao_Paulo')::date - 31), '[]'::jsonb));
end
$$;

-- Salvar a configuração (043/059), agora aceitando deadline_auto_task (mesmo
-- padrão de deadline_auto_apply: chave ausente ou nula não muda o valor). Nada
-- mais muda.
create or replace function private.save_judicial_settings(p_settings jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent uuid := nullif(p_settings ->> 'deadline_agent_id', '')::uuid;
begin
  perform private.judicial_require_internal(true);
  if v_agent is not null and not exists (
    select 1 from public.agents a where a.id = v_agent and a.status = 'ACTIVE' and a.deleted_at is null) then
    raise exception 'Agente inexistente ou inativo' using errcode = '23514';
  end if;
  update public.judicial_settings
     set djen_enabled = coalesce((p_settings ->> 'djen_enabled')::boolean, djen_enabled),
         datajud_enabled = coalesce((p_settings ->> 'datajud_enabled')::boolean, datajud_enabled),
         lookback_days = coalesce((p_settings ->> 'lookback_days')::integer, lookback_days),
         deadline_agent_id = case when p_settings ? 'deadline_agent_id' then v_agent else deadline_agent_id end,
         deadline_auto_apply = coalesce((p_settings ->> 'deadline_auto_apply')::boolean, deadline_auto_apply),
         deadline_auto_task = coalesce((p_settings ->> 'deadline_auto_task')::boolean, deadline_auto_task),
         updated_by = auth.uid(), updated_at = now()
   where id;
  perform private.record_audit_event('JUDICIAL_SETTINGS_UPDATED', 'judicial_settings', null,
    jsonb_build_object('fields', (select coalesce(jsonb_agg(k), '[]') from jsonb_object_keys(coalesce(p_settings, '{}')) k)));
  return jsonb_build_object('ok', true);
end
$$;

-- ═════════════════════════════ 2. o vínculo com o prazo ═══════════════════

alter table public.process_tasks
  add column if not exists source_deadline_id uuid references public.deadlines (id) on delete restrict;

comment on column public.process_tasks.source_deadline_id is
  'Prazo que deu origem à tarefa (061): preenchido só na tarefa que o sistema cria quando o agente de prazos lança um prazo. Vazio na tarefa escrita pela equipe.';

-- No máximo uma tarefa automática por prazo (cancelada também conta: o sistema
-- não escreve a mesma tarefa duas vezes).
create unique index if not exists process_tasks_source_deadline_key
  on public.process_tasks (source_deadline_id) where source_deadline_id is not null;

-- ═════════════════════════════ 3. o caso tem os autos? ════════════════════

-- O caso tem pelo menos um documento ativo que NÃO foi gerado por agente?
--   - documento do caso = o que o agente recebe (case_documents, como em
--     private.executor_list_documents, 040);
--   - arquivado (status ARCHIVED) ou excluído (deleted_at) não conta;
--   - a origem fica na versão (document_versions.source): documento gerado por
--     agente é o que NASCEU de um agente (primeira versão com source AGENT).
--     Minuta do agente que a equipe editou depois (MANUAL_EDIT) continua sendo
--     do agente; documento da equipe ou do parceiro que ganhou uma versão de
--     agente continua contando.
create or replace function private.case_has_own_document(p_legal_case_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.case_documents cd
    join public.documents d on d.id = cd.document_id and d.deleted_at is null and d.status = 'ACTIVE'
    where cd.legal_case_id = p_legal_case_id
      and (select v.source from public.document_versions v
            where v.document_id = d.id order by v.version_number limit 1) <> 'AGENT')
$$;

-- ═════════════════════════════ 4. criar a tarefa do prazo ═════════════════

-- Cria a tarefa do processo para o prazo que a proposta acabou de lançar e,
-- podendo, manda ao orquestrador. Devolve a tarefa criada, ou nulo quando não é
-- o caso (opção desligada, trabalho que não é de publicação, tarefa já criada).
-- Erro ao MANDAR fica na própria tarefa (aberta, com o motivo). Erro ao CRIAR
-- sobe para quem chamou (o gatilho abaixo registra e segue).
create or replace function private.deadline_task_create(p_proposal_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ap      record;
  v_s       public.judicial_settings;
  v_pub     public.judicial_publications;
  v_d       public.deadlines;
  v_proc    record;
  v_task    public.process_tasks;
  v_title   text;
  v_when    text;
  v_cnj     text;
  v_head    text;
  v_desc    text;
  v_room    integer;
  v_why     text[] := '{}';
  v_agent   uuid;
  v_actor   uuid;
  v_session uuid := auth.uid();
  v_run     uuid;
  v_err     text;
begin
  select ap.id, ap.agent_run_id, ap.proposal_type, ap.status, ap.applied_entity_type, ap.applied_entity_id
    into v_ap
  from public.agent_proposals ap where ap.id = p_proposal_id;
  if v_ap.id is null or v_ap.proposal_type <> 'CREATE_DEADLINE' or v_ap.status <> 'APPLIED'
     or v_ap.applied_entity_type is distinct from 'deadlines' or v_ap.applied_entity_id is null then
    return null;
  end if;

  select * into v_s from public.judicial_settings where id;
  if not coalesce(v_s.deadline_auto_task, false) then
    return null;
  end if;

  -- Trabalho de publicação = o trabalho para o qual a publicação aponta (059).
  -- Não importa em que ponto da triagem ela está.
  select * into v_pub from public.judicial_publications p
   where p.agent_run_id = v_ap.agent_run_id
   order by p.captured_at, p.id
   limit 1;
  if v_pub.id is null then
    return null;
  end if;

  select * into v_d from public.deadlines d where d.id = v_ap.applied_entity_id;
  if v_d.id is null or exists (select 1 from public.process_tasks t where t.source_deadline_id = v_d.id) then
    return null;
  end if;

  -- A tarefa é do processo do prazo (sem processo no prazo, o da publicação).
  select lp.id, lp.legal_case_id, lp.cnj_number, lp.responsible_user_id, c.assigned_lawyer_id into v_proc
  from public.legal_processes lp join public.legal_cases c on c.id = lp.legal_case_id
  where lp.id = coalesce(v_d.legal_process_id, v_pub.legal_process_id)
    and lp.legal_case_id = v_d.legal_case_id and lp.deleted_at is null and c.deleted_at is null;
  if v_proc.id is null then
    raise exception 'o prazo não está em um processo ativo do caso';
  end if;

  v_title := btrim(regexp_replace(v_d.title, '\s+', ' ', 'g'));
  v_when  := to_char(v_d.due_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY');
  v_cnj   := coalesce(v_proc.cnj_number, v_pub.cnj_number);

  -- O que fazer. O teor da publicação NÃO vem para cá: está no arquivo do
  -- processo, na pasta do cliente (058). A análise do agente de prazos vem por
  -- último e é cortada se o texto passar do limite da tarefa (10 mil).
  v_head := concat_ws(E'\n\n',
    'Tarefa criada sozinha pelo DG Brasil: este prazo nasceu de uma publicação do DJEN e foi lançado na agenda pelo agente de prazos.',
    'Prazo: ' || v_title || E'\n' || 'Vencimento: ' || v_when || ' (horário de Brasília)',
    'Publicação do DJEN: disponibilizada em ' || to_char(v_pub.available_on, 'DD/MM/YYYY')
      || E'\n' || 'Tipo: ' || coalesce(nullif(left(btrim(regexp_replace(coalesce(v_pub.communication_type, ''), '\s+', ' ', 'g')), 100), ''), 'não informado')
      || E'\n' || 'Órgão: ' || coalesce(nullif(left(btrim(regexp_replace(concat_ws(' — ', v_pub.court, v_pub.organ), '\s+', ' ', 'g')), 300), ''), 'não informado'),
    'O que fazer: redigir a peça indicada abaixo para este prazo, com os autos e os documentos do caso. O arquivo '
      || case when v_cnj ~ '^[0-9]{20}$' then 'PROCESSO_' || private.format_cnj(v_cnj) || '.txt'
              else 'PROCESSO_<número do processo>.txt' end
      || ' da pasta do cliente traz a publicação inteira. Se a peça indicada não couber, dizer por quê na entrega.',
    'Análise do agente de prazos (descrição do prazo):');
  v_desc := coalesce(nullif(btrim(v_d.description), ''), '(o prazo veio sem descrição)');
  v_room := 10000 - length(v_head) - 1;
  if length(v_desc) > v_room then
    v_desc := left(v_desc, v_room - 11) || ' […cortado]';
  end if;

  -- Mandar ao orquestrador ou deixar aberta? Todos os motivos ficam na tarefa:
  -- quem resolver um já sabe do outro antes de clicar em "Enviar aos agentes".
  if lower(regexp_replace(coalesce(v_d.description, ''), '\s+', '', 'g')) like 'conferir:%' then
    v_why := v_why || 'Prazo marcado para conferir: confira e envie a tarefa.'::text;
  end if;
  if v_d.due_at <= now() then
    v_why := v_why || 'O vencimento do prazo já passou: confira e, se ainda couber, envie a tarefa.'::text;
  end if;
  if not private.case_has_own_document(v_d.legal_case_id) then
    v_why := v_why || 'Anexe os autos do processo e envie a tarefa.'::text;
  end if;
  v_agent := private.process_task_orchestrator();
  if v_agent is null then
    v_why := v_why || 'Orquestrador não configurado.'::text;
  end if;
  -- Em nome de quem o trabalho é pedido (private.request_agent_run, 018, exige
  -- ADMIN ou advogado ativo). Com uma pessoa logada na transação, é ela; sem
  -- sessão (computador do escritório, manutenção), a ordem da 043/059.
  if v_session is not null then
    if private.user_internal_role(v_session) in ('ADMIN', 'LAWYER') then
      v_actor := v_session;
    end if;
  else
    select u into v_actor
    from unnest(array[v_d.responsible_user_id, v_proc.responsible_user_id, v_proc.assigned_lawyer_id,
                      (select r.requested_by from public.agent_runs r where r.id = v_ap.agent_run_id)]) with ordinality t(u, o)
    where u is not null and private.is_active_internal_user(u) and private.user_internal_role(u) in ('ADMIN', 'LAWYER')
    order by o limit 1;
  end if;
  if v_actor is null then
    v_why := v_why || 'Nenhum advogado ativo no processo para pedir o trabalho ao orquestrador: envie a tarefa.'::text;
  end if;

  insert into public.process_tasks
    (legal_process_id, legal_case_id, title, instructions, priority, due_at, source_deadline_id, last_error)
  values
    (v_proc.id, v_proc.legal_case_id,
     case when length('Preparar: ' || v_title) > 200 then left('Preparar: ' || v_title, 199) || '…' else 'Preparar: ' || v_title end,
     v_head || E'\n' || v_desc, v_d.priority, v_d.due_at, v_d.id,
     nullif(array_to_string(v_why, ' '), ''))
  on conflict (source_deadline_id) where source_deadline_id is not null do nothing
  returning * into v_task;
  if v_task.id is null then
    return null;
  end if;

  if cardinality(v_why) = 0 then
    -- Mesma mecânica de private.process_task_enqueue (047), com o ator certo.
    -- Se falhar, só o envio é desfeito: a tarefa fica aberta com o motivo.
    begin
      v_run := private.request_agent_run(v_agent, v_task.legal_case_id, v_task.legal_process_id,
        private.process_task_request(v_task, null),
        jsonb_build_object('process_task_id', v_task.id), 'PROCESS_TASK', v_actor);
      update public.process_tasks
         set status = 'QUEUED', agent_run_id = v_run, attempts = attempts + 1, last_error = null
       where id = v_task.id;
    exception when others then
      get stacked diagnostics v_err = message_text;
      update public.process_tasks
         set last_error = left('Não foi possível enviar ao orquestrador (' || v_err || '). Envie a tarefa.', 1000)
       where id = v_task.id;
    end;
  end if;

  select * into v_task from public.process_tasks t where t.id = v_task.id;
  perform private.process_task_event(v_task, 'Tarefa criada pelo agente de prazos: ' || v_task.title,
    'Criada sozinha a partir do prazo "' || v_title || '" (vence ' || v_when || '). '
      || case when v_task.status = 'QUEUED' then 'Enviada ao orquestrador.'
              else 'Ficou aberta: ' || coalesce(v_task.last_error, 'envie a tarefa.') end,
    'AGENT');
  return v_task.id;
end
$$;

-- ═════════════════════════════ 5. o gatilho ═══════════════════════════════

-- Proposta de prazo acabou de ser aplicada. Última barreira: nada aqui derruba
-- a aplicação da proposta nem o prazo. O erro fica na linha do tempo do
-- trabalho da publicação.
create or replace function private.agent_proposals_deadline_task()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- private.request_agent_run fixa o ator da transação: quem aplicou a proposta
  -- continua sendo quem era (os avisos do prazo direto, 059, dependem disso).
  v_actor text := coalesce(current_setting('dg.actor_user_id', true), '');
  v_err   text;
begin
  begin
    perform private.deadline_task_create(new.id);
  exception when others then
    get stacked diagnostics v_err = message_text;
    begin
      insert into public.agent_run_events (agent_run_id, kind, message, executor_id)
      select r.id, 'ERROR', left('O prazo foi lançado, mas a tarefa do processo não foi criada: ' || v_err, 500), r.executor_id
      from public.agent_runs r where r.id = new.agent_run_id;
    exception when others then
      raise warning 'Tarefa do prazo da proposta % não foi criada: %', new.id, v_err;
    end;
  end;
  perform set_config('dg.actor_user_id', v_actor, true);
  return null;
end
$$;

-- Pelo nome, este gatilho roda antes do da 043 (agent_proposals_judicial_publications),
-- mas não depende disso: não lê nem muda a triagem da publicação.
drop trigger if exists agent_proposals_deadline_task on public.agent_proposals;
create trigger agent_proposals_deadline_task
  after update of status on public.agent_proposals
  for each row
  when (new.status = 'APPLIED' and old.status is distinct from new.status and new.proposal_type = 'CREATE_DEADLINE'
        and new.applied_entity_type = 'deadlines' and new.applied_entity_id is not null)
  execute function private.agent_proposals_deadline_task();

-- ═════════════════════════════ 6. permissões ══════════════════════════════

-- Blocos internos e função de gatilho: ninguém chama direto.
revoke all on function private.case_has_own_document(uuid) from public, anon, authenticated, service_role;
revoke all on function private.deadline_task_create(uuid) from public, anon, authenticated, service_role;
revoke all on function private.agent_proposals_deadline_task() from public, anon, authenticated, service_role;
-- Tela (043/059): pública (invoker) → privada (definer); a privada confere o papel.
revoke all on function private.get_judicial_overview() from public, anon, authenticated, service_role;
revoke all on function private.save_judicial_settings(jsonb) from public, anon, authenticated, service_role;
grant execute on function private.get_judicial_overview() to authenticated;
grant execute on function private.save_judicial_settings(jsonb) to authenticated;
