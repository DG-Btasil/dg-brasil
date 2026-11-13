-- 059 · Prazo direto: o prazo do agente de prazos entra na agenda sem passar
--       por Revisões.
--
-- Decisão da dona do produto (13/11/2026): "Prazo deve ter uma regra especial
-- que não precisa ir para proposta: o agente dá o prazo e pronto. Não precisa ir
-- para revisão. A pessoa vê o prazo e tem que seguir."
--
-- Até a 058, toda publicação nova do DJEN virava um trabalho do agente de prazos
-- (043/058), a proposta CREATE_DEADLINE ia para Revisões e o prazo só existia
-- depois que um advogado aprovava. Agora:
--
--   1. Configuração: judicial_settings.deadline_auto_apply (padrão: ligado).
--      get_judicial_overview devolve e save_judicial_settings aceita a chave
--      "deadline_auto_apply". Quem não manda a chave não muda nada.
--   2. Regra do prazo direto (private.worker_create_proposal, 018 — a porta por
--      onde passa toda proposta, inclusive a do computador do escritório, 040):
--      proposta CREATE_DEADLINE de um TRABALHO DE PUBLICAÇÃO, com a opção ligada
--      e aprovada nas conferências, nasce sem exigir revisão humana, é aprovada
--      e aplicada NA MESMA TRANSAÇÃO: o prazo já sai criado, a publicação fica
--      tratada (DONE/DEADLINE) e as pessoas do processo são avisadas.
--        - "Trabalho de publicação" é o trabalho para o qual uma linha de
--          judicial_publications aponta (agent_run_id). É o critério mais firme:
--          só private.judicial_request_deadline_proposal grava esse vínculo. O
--          JSON do pedido (kind = JUDICIAL_PUBLICATION) não serve de prova: um
--          advogado pode pedir um trabalho avulso com qualquer JSON, e o pedido
--          é apagado depois de 180 dias.
--        - A máquina de estados da proposta (012) NÃO muda: PENDING → APPROVED →
--          APPLIED, com requires_human_review = false desde o nascimento (a
--          guarda só proíbe DESLIGAR a exigência, e continua proibindo).
--        - Conferências (private.judicial_direct_deadline_check). Qualquer falha
--          → caminho antigo (revisão em Revisões), com o motivo na linha do tempo
--          do trabalho (agent_run_events):
--            · a publicação existe, não foi cancelada, ainda está com o agente
--              (WITH_AGENT) e não tem prazo;
--            · este trabalho ainda não tem outra proposta de prazo (só UMA
--              proposta direta por publicação: a segunda vai para Revisões);
--            · o processo da publicação continua no caso do trabalho, e a
--              proposta não aponta outro processo;
--            · title não vazio; due_at com data, hora e fuso;
--            · o vencimento não passou;
--            · a data do vencimento (America/Sao_Paulo) é um dos dias úteis da
--              lista que o banco calculou para a publicação (business_days do
--              pedido; sem o pedido, recalcula como a 043);
--            · há para quem o prazo aparecer: responsável do processo, senão o
--              advogado do caso (o primeiro que for usuário interno ativo).
--        - Se a criação do prazo falhar por qualquer motivo, nada fica pela
--          metade: a proposta volta a exigir revisão e segue o caminho antigo.
--   3. O prazo: caso e processo da publicação, responsável como acima, source
--      'AGENT' — tudo pelo aplicador de sempre (private.apply_proposal_effect).
--      O que foi aplicado (processo e responsável) fica gravado na proposta.
--   4. Publicação: o gatilho da 043 (judicial_publications_follow_proposals) já
--      fecha a triagem quando a proposta vira APPLIED. Sem revisão, triaged_by
--      fica vazio; triage_notes diz que o prazo entrou direto.
--   5. Aviso: quem a 043 avisa da publicação (private.judicial_recipients) recebe
--      "Prazo criado pelo agente: <título> — vence DD/MM/AAAA" (tipo
--      DEADLINE_CREATED, que já existe, categoria Prazos). Para o responsável não
--      receber dois avisos do mesmo prazo, o aviso genérico "Novo prazo" do
--      gatilho da 037 (private.notify_deadlines) não sai neste caso.
--   6. "Sem prazo" (proposta OTHER): NADA muda. Continua em Revisões e a
--      publicação volta para a triagem da equipe.
--   7. O pedido ao agente (private.judicial_request_deadline_proposal, 058): com
--      a opção ligada, o trecho "O QUE FAZER" avisa que o prazo ENTRA DIRETO NA
--      AGENDA. Com a opção desligada, o texto é o da 058.
--   8. Kit: as orientações da Diana (intimacao-dg, 058) diziam que o prazo só
--      vale depois da aprovação em Revisões. Se ainda forem exatamente o texto da
--      058, ganham versão nova com a regra atual. Orientações que o escritório
--      editou não são tocadas.
--
-- O computador do escritório recebe, na resposta de propor
-- (private.executor_create_proposal, 040), a chave nova "applied": true quando a
-- proposta já foi aplicada (prazo direto).
--
-- Para desligar: save_judicial_settings('{"deadline_auto_apply": false}') (tela
-- de Integrações): os prazos do agente voltam a passar por Revisões.
--
-- 001–058 não são alteradas (043 ganha uma coluna por ALTER; funções da 018, 037,
-- 040, 043 e 058 são redefinidas aqui). Rodar de novo não quebra nem duplica.

-- ═════════════════════════════ 1. configuração ════════════════════════════

alter table public.judicial_settings
  add column if not exists deadline_auto_apply boolean not null default true;

comment on column public.judicial_settings.deadline_auto_apply is
  'Prazo direto (059): o prazo proposto pelo agente de prazos a partir de uma publicação entra na agenda sem passar por Revisões. Desligado: volta a exigir a aprovação de um advogado.';

-- Visão geral da integração judicial (043), agora com deadline_auto_apply.
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

-- Salvar a configuração (043), agora aceitando deadline_auto_apply (mesmo padrão
-- de datajud_enabled: chave ausente ou nula não muda o valor). Nada mais muda.
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
         updated_by = auth.uid(), updated_at = now()
   where id;
  perform private.record_audit_event('JUDICIAL_SETTINGS_UPDATED', 'judicial_settings', null,
    jsonb_build_object('fields', (select coalesce(jsonb_agg(k), '[]') from jsonb_object_keys(coalesce(p_settings, '{}')) k)));
  return jsonb_build_object('ok', true);
end
$$;

-- ═════════════════════════════ 2. conferências do prazo direto ════════════

-- Diz se a proposta CREATE_DEADLINE deste trabalho pode virar prazo direto.
-- Devolve:
--   publication_job  o trabalho nasceu de uma publicação?
--   ok               passou em todas as conferências (e a opção está ligada)?
--   reason           por que não passou (nulo quando ok, quando o trabalho não é
--                    de publicação e quando a opção está desligada);
--   publication_id, title, due_at, data
--                    (só com ok) a publicação e os dados do prazo como serão
--                    aplicados: os do agente, com o processo da publicação e o
--                    responsável escolhido aqui.
-- Trava a linha da publicação até o fim da transação: duas propostas do mesmo
-- trabalho não passam juntas.
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

-- ═════════════════════════════ 3. o aviso do prazo ════════════════════════

-- Aviso de prazo novo (037). Única mudança (059): quando o prazo está sendo
-- criado pela regra do prazo direto, o aviso genérico "Novo prazo" não sai — o
-- aviso próprio ("Prazo criado pelo agente") sai em
-- private.judicial_direct_deadline_apply, para o responsável e para as outras
-- pessoas do processo. O sinal (dg.prazo_direto) só fica ligado dentro daquela
-- função, durante a criação do prazo.
create or replace function private.notify_deadlines()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_to   uuid := private.deadline_recipient(new.responsible_user_id, new.legal_case_id);
  v_sev  text := case new.priority when 'URGENT' then 'URGENT' when 'HIGH' then 'WARNING' else 'INFO' end;
  v_when text := to_char(new.due_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY');
begin
  if new.status <> 'OPEN' then
    return null;
  end if;
  if tg_op = 'INSERT' and current_setting('dg.prazo_direto', true) = 'on' then
    return null;
  end if;
  if tg_op = 'INSERT' then
    perform private.notify(v_to, 'DEADLINE_CREATED', 'Novo prazo: ' || new.title, 'Vence em ' || v_when || '.', v_sev,
                           'deadline-created:' || new.id, new.legal_case_id, new.legal_process_id, null, 'deadline', new.id);
  elsif new.responsible_user_id is not null and new.responsible_user_id is distinct from old.responsible_user_id then
    perform private.notify(new.responsible_user_id, 'DEADLINE_ASSIGNED', 'Prazo atribuído a você: ' || new.title, 'Vence em ' || v_when || '.', v_sev,
                           'deadline-assigned:' || new.id || ':' || new.responsible_user_id, new.legal_case_id, new.legal_process_id, null, 'deadline', new.id);
  end if;
  return null;
end
$$;

-- ═════════════════════════════ 4. aplicar o prazo direto ══════════════════

-- Aprova e aplica, na hora, a proposta que passou nas conferências (p_check é a
-- resposta de private.judicial_direct_deadline_check). Usa a máquina de estados
-- de sempre (PENDING → APPROVED → APPLIED) e o aplicador de sempre
-- (private.apply_proposal_effect). Qualquer erro aqui é devolvido a quem chamou,
-- que desfaz tudo e manda a proposta para Revisões.
create or replace function private.judicial_direct_deadline_apply(p_proposal_id uuid, p_check jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ap     record;
  v_pub    public.judicial_publications;
  v_proc   record;
  v_data   jsonb := p_check -> 'data';
  v_effect record;
  v_d      record;
  v_to     uuid;
  v_when   text;
begin
  select ap.id, ap.agent_run_id, ap.legal_case_id, ap.legal_process_id, ap.proposal_type, ap.status,
         ap.requires_human_review, ap.payload
    into v_ap
  from public.agent_proposals ap where ap.id = p_proposal_id for update;
  if v_ap.id is null or v_ap.proposal_type <> 'CREATE_DEADLINE' or v_ap.status <> 'PENDING'
     or v_ap.requires_human_review or not coalesce((p_check ->> 'ok')::boolean, false) then
    raise exception 'Proposta fora da regra do prazo direto' using errcode = '23514';
  end if;
  select * into v_pub from public.judicial_publications p
   where p.id = (p_check ->> 'publication_id')::uuid and p.agent_run_id = v_ap.agent_run_id
     and p.triage_status = 'WITH_AGENT' and p.deadline_id is null and p.cancelled_at is null
   for update;
  if v_pub.id is null then
    raise exception 'A publicação não está mais com o agente' using errcode = '55000';
  end if;

  -- Aprovada sem revisão (a guarda aceita: a proposta nasceu sem exigir revisão
  -- humana). O que vai ser aplicado fica gravado na proposta.
  update public.agent_proposals
     set payload = jsonb_set(v_ap.payload, '{data}', v_data), status = 'APPROVED'
   where id = p_proposal_id;

  perform set_config('dg.prazo_direto', 'on', true);
  select * into v_effect
  from private.apply_proposal_effect('CREATE_DEADLINE', v_data, v_ap.legal_case_id, v_pub.legal_process_id);
  perform set_config('dg.prazo_direto', '', true);
  if v_effect.entity_id is null then
    raise exception 'O prazo não foi criado';
  end if;

  -- APPLIED: o gatilho da 043 fecha a triagem da publicação com o prazo.
  update public.agent_proposals
     set status = 'APPLIED', applied_entity_type = v_effect.entity_type, applied_entity_id = v_effect.entity_id
   where id = p_proposal_id;
  update public.judicial_publications
     set triage_notes = 'Prazo lançado direto pelo agente de prazos, sem revisão (prazo direto).'
   where id = v_pub.id and triage_status = 'DONE' and deadline_id = v_effect.entity_id;
  if not found then
    raise exception 'A publicação não ficou ligada ao prazo criado';
  end if;

  perform private.record_audit_event('AGENT_PROPOSAL_EFFECT', v_effect.entity_type, v_effect.entity_id,
    jsonb_build_object('agent_proposal_id', p_proposal_id, 'proposal_type', 'CREATE_DEADLINE',
                       'direct', true, 'publication_id', v_pub.id));

  -- Aviso para as mesmas pessoas que a 043 avisa da publicação. Uma vez por
  -- prazo (a chave é o prazo).
  select d.id, d.title, d.due_at, d.priority, d.legal_case_id, d.legal_process_id into v_d
  from public.deadlines d where d.id = v_effect.entity_id;
  select lp.title, lp.cnj_number into v_proc from public.legal_processes lp where lp.id = v_pub.legal_process_id;
  v_when := to_char(v_d.due_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY');
  for v_to in select * from private.judicial_recipients(v_pub.legal_process_id) loop
    perform private.notify(v_to, 'DEADLINE_CREATED',
      'Prazo criado pelo agente: '
        || case when length(v_d.title) > 150 then left(v_d.title, 149) || '…' else v_d.title end
        || ' — vence ' || v_when,
      coalesce(nullif(btrim(v_proc.title), ''), private.format_cnj(v_proc.cnj_number), 'Processo')
        || ' · publicação do DJEN de ' || to_char(v_pub.available_on, 'DD/MM/YYYY')
        || '. O prazo entrou direto na agenda, sem revisão de um advogado: confira a contagem.',
      case v_d.priority when 'URGENT' then 'URGENT' when 'HIGH' then 'WARNING' else 'INFO' end,
      'prazo-direto:' || v_d.id, v_d.legal_case_id, v_d.legal_process_id, null, 'deadline', v_d.id);
  end loop;

  insert into public.agent_run_events (agent_run_id, kind, message, executor_id)
  select r.id, 'OUTPUT', left('Prazo lançado direto na agenda, sem revisão: ' || v_d.title, 470) || ' — vence ' || v_when, r.executor_id
  from public.agent_runs r where r.id = v_ap.agent_run_id;

  return v_effect.entity_id;
end
$$;

-- ═════════════════════════════ 5. a porta das propostas ═══════════════════

-- Proposta do agente (018). Como antes: proposta + revisão PENDING, numa
-- transação, idempotente por (agent_run_id, idempotency_key).
-- Novo (059): CREATE_DEADLINE de um trabalho de publicação que passa nas
-- conferências do prazo direto NÃO ganha revisão: é aprovada e aplicada aqui
-- mesmo. Se não passa (ou se a criação do prazo falha), segue o caminho antigo e
-- o motivo fica na linha do tempo do trabalho. Os outros tipos (inclusive OTHER,
-- o "Sem prazo") não mudam.
create or replace function private.worker_create_proposal(
  p_agent_run_id     uuid,
  p_worker           text,
  p_proposal_type    text,
  p_payload          jsonb,
  p_idempotency_key  text,
  p_priority         text default 'NORMAL',
  p_legal_process_id uuid default null
)
returns table (proposal_id uuid, created boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope   record;
  v_process uuid;
  v_id      uuid;
  v_check   jsonb := '{}'::jsonb;
  v_direct  boolean := false;
  v_reason  text;
begin
  select * into v_scope from private.worker_scope(p_agent_run_id, p_worker);

  if p_proposal_type in ('CREATE_DEADLINE', 'REQUEST_DOCUMENT', 'UPDATE_CASE', 'CREATE_PROCESS')
     and v_scope.legal_case_id is null then
    raise exception '% só pode ser proposto numa execução ligada a um caso', p_proposal_type using errcode = '23514';
  end if;

  v_process := coalesce(p_legal_process_id, v_scope.legal_process_id);
  if v_process is not null and v_scope.legal_case_id is null then
    v_process := null;
  end if;
  if v_process is not null and not exists (
    select 1 from public.legal_processes p where p.id = v_process and p.legal_case_id = v_scope.legal_case_id
  ) then
    raise exception 'legal_process_id não pertence ao caso desta execução' using errcode = '23514';
  end if;

  -- Prazo direto (059): confere antes de gravar, porque a proposta já nasce
  -- dizendo se exige revisão humana (a guarda não deixa desligar depois).
  if p_proposal_type = 'CREATE_DEADLINE' then
    v_check := private.judicial_direct_deadline_check(p_agent_run_id, v_scope.legal_case_id, v_process, p_payload);
    v_direct := coalesce((v_check ->> 'ok')::boolean, false);
    v_reason := v_check ->> 'reason';
  end if;

  insert into public.agent_proposals
    (agent_run_id, legal_case_id, legal_process_id, proposal_type, payload, requires_human_review, idempotency_key)
  values
    (p_agent_run_id, v_scope.legal_case_id, v_process, p_proposal_type, p_payload, not v_direct, p_idempotency_key)
  on conflict on constraint agent_proposals_idempotency_key do nothing
  returning id into v_id;

  if v_id is null then
    select p.id into v_id from public.agent_proposals p
    where p.agent_run_id = p_agent_run_id and p.idempotency_key = p_idempotency_key;
    return query select v_id, false;
    return;
  end if;

  if v_direct then
    begin
      perform private.judicial_direct_deadline_apply(v_id, v_check);
    exception when others then
      -- Nada fica pela metade: o bloco é desfeito e a proposta segue para
      -- Revisões, exigindo revisão humana (ligar a exigência a guarda aceita).
      v_direct := false;
      v_reason := 'não foi possível criar o prazo (' || sqlerrm || ')';
      perform set_config('dg.prazo_direto', '', true);
      update public.agent_proposals set requires_human_review = true where id = v_id;
    end;
  end if;

  if not v_direct then
    insert into public.reviews (legal_case_id, agent_proposal_id, priority)
    values (v_scope.legal_case_id, v_id, coalesce(p_priority, 'NORMAL'));
    if v_reason is not null then
      insert into public.agent_run_events (agent_run_id, kind, message, executor_id)
      select r.id, 'OUTPUT', left('Prazo não entrou direto na agenda (foi para Revisões): ' || v_reason, 500), r.executor_id
      from public.agent_runs r where r.id = p_agent_run_id;
    end if;
  end if;
  return query select v_id, true;
end
$$;

-- Proposta vinda do computador do escritório (040). Tipos estruturais (agente,
-- skill) nunca vêm do executor. Única mudança (059): a resposta diz também se a
-- proposta já foi aplicada ("applied": true no prazo direto), para o computador
-- não dizer ao agente que ela está esperando em Revisões.
create or replace function private.executor_create_proposal(
  p_token_hash text, p_agent_run_id uuid, p_lease_hash text, p_proposal_type text, p_payload jsonb,
  p_idempotency_key text, p_priority text default 'NORMAL', p_legal_process_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_by  text := private.executor_lease(p_token_hash, p_agent_run_id, p_lease_hash, 'proposals.create', true);
  v_out record;
begin
  if p_proposal_type not in ('CREATE_DEADLINE', 'REQUEST_DOCUMENT', 'UPDATE_CASE', 'CREATE_PROCESS', 'OTHER') then
    raise exception 'Tipo de proposta não permitido ao computador: %', p_proposal_type using errcode = '22023';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' or pg_column_size(p_payload) > 65536 then
    raise exception 'Proposta precisa ser um objeto de até 64 KB' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_payload ->> 'summary', '')), '') is null then
    raise exception 'Proposta precisa de um resumo (summary)' using errcode = '22023';
  end if;
  if p_priority not in ('LOW', 'NORMAL', 'HIGH', 'URGENT') then
    raise exception 'Prioridade inválida' using errcode = '22023';
  end if;
  select * into v_out from private.worker_create_proposal(p_agent_run_id, v_by, p_proposal_type, p_payload,
                                                          p_idempotency_key, p_priority, p_legal_process_id);
  if v_out.created then
    insert into public.agent_run_events (agent_run_id, kind, message, executor_id)
    select p_agent_run_id, 'OUTPUT', 'Proposta: ' || left(p_payload ->> 'summary', 180), r.executor_id
    from public.agent_runs r where r.id = p_agent_run_id;
  end if;
  return jsonb_build_object(
    'proposal_id', v_out.proposal_id, 'created', v_out.created,
    'applied', coalesce((select ap.status = 'APPLIED' from public.agent_proposals ap where ap.id = v_out.proposal_id), false));
end
$$;

-- ═════════════════════════════ 6. o pedido de prazo ═══════════════════════

-- Pedido de proposta de prazo de UMA publicação (043/058). Muda só o trecho
-- "O QUE FAZER": com o prazo direto ligado, o agente fica sabendo que o prazo
-- entra direto na agenda; desligado, o texto é o da 058. Como o texto novo é
-- mais comprido, content_truncated passa a dizer exatamente se o pedido foi
-- cortado (antes era uma aproximação pelo tamanho do teor).
create or replace function private.judicial_request_deadline_proposal(p_publication_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s     public.judicial_settings;
  v_p     public.judicial_publications;
  v_proc  record;
  v_actor uuid;
  v_run   uuid;
  v_dates jsonb;
  v_list  text;
  v_side  text;
  v_todo  text;
  v_text  text;
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
    v_text := 'Publicação do DJEN no processo ' || private.format_cnj(v_p.cnj_number)
      || ' (' || coalesce(v_p.court, 'tribunal não informado') || coalesce(' — ' || v_p.organ, '')
      || '), disponibilizada em ' || to_char(v_p.available_on, 'DD/MM/YYYY')
      || ', publicada em ' || to_char((v_dates ->> 'published_on')::date, 'DD/MM/YYYY')
      || '. Tipo: ' || coalesce(v_p.communication_type, '—') || E'.\n'
      || v_side || E'\n\n'
      || v_todo || E'\n\n'
      || 'DIAS ÚTEIS a partir da publicação (dia 1 = primeiro dia do prazo; já descontados fins de semana, feriados nacionais, '
      || 'Sexta-feira Santa, recesso de 20/12 a 20/01 e os dias cadastrados para o tribunal; feriado local não cadastrado '
      || 'NÃO está descontado — avise na descrição se suspeitar de um):' || E'\n' || coalesce(v_list, '(indisponível)')
      || coalesce(E'\n\nÍntegra: ' || v_p.link, '') || E'\n\nTEOR:\n' || v_p.content;
    v_run := private.request_agent_run(
      v_s.deadline_agent_id, v_proc.legal_case_id, v_proc.id,
      -- agent_run_inputs aceita até 20 mil caracteres; teor maior vai cortado
      -- (o agente lê a íntegra pelo link, se precisar).
      left(v_text, 20000),
      jsonb_build_object('kind', 'JUDICIAL_PUBLICATION', 'publication_id', v_p.id, 'cnj', v_p.cnj_number,
                         'content_truncated', length(v_text) > 20000,
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

-- ═════════════════════════════ 7. orientações do agente do kit ════════════

-- A Diana do kit (058) dizia que "o prazo só vale depois que um advogado aprovar
-- em Revisões". Versões de agente não mudam (são só-inclusão): quem ainda está
-- com exatamente o texto da 058 ganha uma versão nova, que vira a atual. Vale
-- para o agente de identificador intimacao-dg e para o que alguém cadastrou pelo
-- site apontando para o mesmo agente do computador. Orientações editadas pelo
-- escritório e agentes arquivados ficam como estão. Rodar de novo não cria outra
-- versão (o texto atual já não é o da 058).
do $$
declare
  v_slug constant text := 'intimacao-dg';
  v_058  constant text := concat_ws(E'\n',
    'Como entregar no DG Brasil:',
    '- O agente termina a resposta com um bloco PROPOR (tipo, resumo, dados). Chame a ferramenta propor UMA vez, exatamente com esses dados.',
    '- Nunca escreva ao cliente nem diga que algo foi protocolado: o prazo só vale depois que um advogado aprovar em Revisões.');
  v_059  constant text := concat_ws(E'\n',
    'Como entregar no DG Brasil:',
    '- O agente termina a resposta com um bloco PROPOR (tipo, resumo, dados). Chame a ferramenta propor UMA vez, exatamente com esses dados.',
    '- Nunca escreva ao cliente nem diga que algo foi protocolado. O prazo proposto entra direto na agenda do processo; "Sem prazo" vai para a equipe conferir.');
  r         record;
  v_version uuid;
  v_n       integer := 0;
begin
  for r in
    select a.id, v.configuration
    from public.agents a
    join public.agent_versions v on v.id = a.current_version_id
    where (a.slug = v_slug or v.configuration ->> 'local_agent' = v_slug)
      and a.deleted_at is null
      and v.instructions = v_058
  loop
    insert into public.agent_versions (agent_id, instructions, configuration)
    values (r.id, v_059, r.configuration)
    returning id into v_version;
    update public.agents set current_version_id = v_version where id = r.id;
    v_n := v_n + 1;
  end loop;
  if v_n > 0 then
    raise notice 'Agente de prazos (%): orientações atualizadas para o prazo direto em % agente(s)', v_slug, v_n;
  end if;
end
$$;

-- ═════════════════════════════ 8. permissões ══════════════════════════════

-- Mesmo padrão de onde cada função veio. Nenhuma função private nova fica
-- aberta para usuário logado.
-- Blocos internos (043/058 e os dois novos): ninguém chama direto.
revoke all on function private.judicial_direct_deadline_check(uuid, uuid, uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.judicial_direct_deadline_apply(uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.judicial_request_deadline_proposal(uuid) from public, anon, authenticated, service_role;
-- Função de gatilho (037): ninguém executa direto.
revoke all on function private.notify_deadlines() from public, anon, authenticated, service_role;
-- Tela (043): pública (invoker) → privada (definer); a privada confere o papel.
revoke all on function private.get_judicial_overview() from public, anon, authenticated, service_role;
revoke all on function private.save_judicial_settings(jsonb) from public, anon, authenticated, service_role;
grant execute on function private.get_judicial_overview() to authenticated;
grant execute on function private.save_judicial_settings(jsonb) to authenticated;
-- Portas do worker (018) e do computador do escritório (040): só o dg_worker.
revoke all on function private.worker_create_proposal(uuid, text, text, jsonb, text, text, uuid) from public, anon, authenticated, service_role;
revoke all on function private.executor_create_proposal(text, uuid, text, text, jsonb, text, text, uuid) from public, anon, authenticated, service_role;
grant execute on function private.worker_create_proposal(uuid, text, text, jsonb, text, text, uuid) to dg_worker;
grant execute on function private.executor_create_proposal(text, uuid, text, text, jsonb, text, text, uuid) to dg_worker;
