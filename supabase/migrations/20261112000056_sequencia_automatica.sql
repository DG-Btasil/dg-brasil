-- 056 · Sequência automática: análise aprovada → próximos agentes do caso.
--
-- Pedido da dona (12/11/2026): depois que o advogado APROVA em Revisões a
-- análise da Clara, ninguém chamava o Lucas (kit do cliente) nem a Alice
-- (petições iniciais): alguém precisava pedir à mão em "Executar em um caso".
-- Agora o banco faz isso sozinho, na mesma transação da aprovação.
--
--   1. analysis_templates.next_agent_ids: os agentes que recebem trabalho no
--      mesmo caso, NESTA ORDEM, quando o advogado aprova o resultado de uma
--      análise deste modelo. Vazio (padrão) = nada acontece, como antes.
--      analysis_templates.next_agent_requests: o pedido em texto de cada um,
--      por id do agente ({"<agent_id>": "o que fazer"}). Fica no modelo, ao
--      lado da lista, porque é configuração do modelo (outro modelo pode
--      querer outro pedido para o mesmo agente) e porque a tela futura
--      (pós-MVP) edita as duas coisas juntas. A chave é o id, não o
--      identificador (slug): o id não muda se o agente for renomeado.
--      Agente sem texto recebe um pedido genérico.
--   2. Gatilho na revisão: quando a revisão de um RESULTADO DE ANÁLISE
--      (reviews.legal_analysis_result_id, 039) passa a APPROVED, cada agente
--      da lista vira uma execução no caso, pela mesma porta da execução
--      avulsa (private.request_agent_run, 018: valida papel, caso, processo e
--      agente, grava o pedido em agent_run_inputs e enfileira). Quem pede é o
--      advogado que aprovou. A ordem da lista é a ordem da fila.
--
-- Regras:
--   - viabilidade: o resultado da análise (resultadoAnalise do executor) não
--     tem campo confiável de "sem viabilidade" (só textos livres). Por isso a
--     sequência dispara SEMPRE. Os agentes lidam com o "sem ação": registram
--     na ficha de revisão, e o advogado decide em Revisões, como em tudo;
--   - idempotente: a execução leva uma chave fixa por (resultado, agente)
--     (agent_runs.idempotency_key, 026). Aprovar de novo (reabrir e aprovar,
--     ou outra pessoa aprovar) não cria execução duplicada;
--   - agente pausado (status diferente de ACTIVE), excluído ou inexistente:
--     não entra, fica registrado na atividade do caso e a aprovação segue;
--   - a aprovação NUNCA falha por causa da sequência: erro ao enfileirar um
--     agente desfaz só o pedido dele (subtransação), fica registrado na
--     atividade do caso (auditoria do caso, aba Atividade) com aviso aos
--     administradores, e os outros agentes da lista seguem;
--   - a Análise Bancária já sai configurada com Lucas e Alice, se os dois
--     existirem e se a lista dela ainda estiver vazia.
--
-- Nenhuma tela lê ou grava as colunas novas nesta etapa (o site publicado pode
-- rodar antes desta migration). Mudar a sequência é pelo banco, por enquanto.
--
-- 001–055 não são alteradas.

-- ═════════════════════════════ 1. as colunas ══════════════════════════════

alter table public.analysis_templates
  add column next_agent_ids uuid[] not null default '{}',
  add column next_agent_requests jsonb not null default '{}'
    constraint analysis_templates_next_agent_requests_object check (jsonb_typeof(next_agent_requests) = 'object');

comment on column public.analysis_templates.next_agent_ids is
  'Sequência automática (056): depois que o advogado aprova a análise deste modelo, estes agentes recebem trabalho no mesmo caso, nesta ordem. Vazio = nada acontece.';
comment on column public.analysis_templates.next_agent_requests is
  'Pedido em texto de cada agente da sequência automática, por id do agente: {"<agent_id>": "o que fazer"}. Agente sem texto recebe um pedido genérico.';

-- A lista só tem agentes que existem (não excluídos), sem repetição; o texto
-- só fala de agente da lista.
create or replace function private.analysis_templates_validate_sequence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_val jsonb;
begin
  if cardinality(new.next_agent_ids) > 10 then
    raise exception 'A sequência automática aceita no máximo 10 agentes' using errcode = '23514';
  end if;
  if array_position(new.next_agent_ids, null) is not null then
    raise exception 'A sequência automática não aceita agente vazio' using errcode = '23514';
  end if;
  if cardinality(new.next_agent_ids) <> (select count(distinct x) from unnest(new.next_agent_ids) x) then
    raise exception 'O mesmo agente aparece duas vezes na sequência automática' using errcode = '23514';
  end if;
  if exists (
    select 1 from unnest(new.next_agent_ids) x
    where not exists (select 1 from public.agents a where a.id = x and a.deleted_at is null)
  ) then
    raise exception 'A sequência automática só aceita agentes cadastrados (e não excluídos)' using errcode = '23514';
  end if;

  for v_key, v_val in select e.key, e.value from jsonb_each(new.next_agent_requests) e loop
    if not exists (select 1 from unnest(new.next_agent_ids) x where x::text = v_key) then
      raise exception 'Pedido da sequência automática para um agente que não está na lista' using errcode = '23514';
    end if;
    if jsonb_typeof(v_val) <> 'string' or btrim(v_val #>> '{}') = '' or length(v_val #>> '{}') > 4000 then
      raise exception 'O pedido de cada agente da sequência é um texto de 1 a 4000 caracteres' using errcode = '23514';
    end if;
  end loop;
  return new;
end
$$;

create trigger analysis_templates_validate_sequence
  before insert or update of next_agent_ids, next_agent_requests on public.analysis_templates
  for each row execute function private.analysis_templates_validate_sequence();

-- ═════════════════════════════ 2. a sequência ═════════════════════════════

-- A chave da sequência vale para qualquer solicitante (a de 026 é por
-- solicitante): procurar por ela não pode varrer a tabela inteira.
create index agent_runs_idempotency_key_idx on public.agent_runs (idempotency_key) where idempotency_key is not null;

-- Enfileira os próximos agentes do modelo da análise cuja revisão foi
-- aprovada. Devolve quantos entraram na fila. Cada agente é uma subtransação:
-- erro num deles desfaz só o pedido dele, registra e segue.
create or replace function private.analysis_sequence_enqueue(p_review_id uuid)
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

  -- Quem pede é quem aprovou (a decisão desta transação).
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
    -- Uma execução por (resultado aprovado, agente): aprovar de novo não duplica.
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

-- Gatilho: revisão de resultado de análise acabou de ser APROVADA. Última
-- barreira: nada aqui derruba a aprovação.
create or replace function private.reviews_analysis_sequence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_err text;
begin
  begin
    perform private.analysis_sequence_enqueue(new.id);
  exception when others then
    get stacked diagnostics v_err = message_text;
    begin
      perform private.record_audit_event('AUTO_SEQUENCE_FAILED', 'legal_cases', new.legal_case_id,
        jsonb_build_object('review_id', new.id, 'legal_analysis_result_id', new.legal_analysis_result_id, 'error', left(v_err, 500)));
    exception when others then
      raise warning 'Sequência automática da revisão % não rodou: %', new.id, v_err;
    end;
  end;
  return null;
end
$$;

create trigger reviews_analysis_sequence
  after update of status on public.reviews
  for each row
  when (new.status = 'APPROVED' and old.status is distinct from new.status and new.legal_analysis_result_id is not null)
  execute function private.reviews_analysis_sequence();

revoke all on function private.analysis_templates_validate_sequence() from public, anon, authenticated, service_role;
revoke all on function private.analysis_sequence_enqueue(uuid) from public, anon, authenticated, service_role;
revoke all on function private.reviews_analysis_sequence() from public, anon, authenticated, service_role;

-- ═════════════════════════════ 3. Análise Bancária ════════════════════════

-- Lucas (kit do cliente) e depois Alice (iniciais), só se os dois existirem e
-- se a lista ainda estiver vazia (nunca sobrescreve o que o escritório mudou).
do $$
declare
  v_lucas uuid := (select a.id from public.agents a where a.slug = 'lucas-procuracao-dg' and a.deleted_at is null);
  v_alice uuid := (select a.id from public.agents a where a.slug = 'alice-inicial-dg' and a.deleted_at is null);
begin
  if v_lucas is null or v_alice is null then
    raise notice 'Sequência automática: Lucas ou Alice não cadastrados; Análise Bancária sem sequência';
    return;
  end if;
  update public.analysis_templates t
     set next_agent_ids = array[v_lucas, v_alice],
         next_agent_requests = jsonb_build_object(
           v_lucas::text, 'Gerar o kit do cliente (procuração, declaração de hipossuficiência e contrato de honorários).',
           v_alice::text, 'Redigir as petições iniciais da primeira rodada a partir do roteiro da Clara na pasta do cliente. A segunda rodada não está autorizada neste pedido.')
   where t.name = 'Análise Bancária' and cardinality(t.next_agent_ids) = 0;
end
$$;
