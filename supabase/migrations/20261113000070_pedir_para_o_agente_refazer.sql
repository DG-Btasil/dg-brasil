-- 070 · Revisões: "Pedir para o agente refazer".
--
-- Pedido da dona do escritório (13/11/2026), segunda solução para "está quase
-- certo, só muda uma coisa" (a primeira é o "Corrigir e aprovar" da 069): a
-- pessoa escreve o que está errado e o sistema manda um trabalho novo para o
-- MESMO agente, com o recado. O resultado volta para Revisões.
--
-- O contrato do README continua inteiro: refazer nunca aplica nada. A revisão é
-- encerrada como rejeitada e o trabalho novo entrega como qualquer outro, para
-- uma pessoa decidir.
--
--   1. public.redo_agent_review(revisão, recado): numa transação,
--        a) confere quem pede (ADMIN ou advogado; proposta estrutural só ADMIN),
--           revisão em aberto e ligada a um trabalho de agente
--           (reviews.agent_run_id, 067), recado de 10 a 4000 caracteres;
--        b) encerra a revisão pela porta de sempre (private.decide_review):
--           REJEITADA, com a justificativa "Pedido ao agente para refazer:
--           <recado>". Nada é aplicado (proposta rejeitada não se aplica;
--           análise volta a PENDING pelo gatilho da 039);
--        c) pede o trabalho novo pela porta de sempre (private.request_agent_run,
--           018: papel e acesso ao caso conferidos de novo), em nome de quem
--           pediu, com o MESMO agente, caso e processo. O pedido leva, nesta
--           ordem: "REFAZER", o recado, o que foi entregue antes (proposta,
--           minuta ou análise), a convenção _v2/_v3/_v4 do nome do arquivo e o
--           pedido original. Os parâmetros do trabalho anterior vão junto (no
--           trabalho de publicação, a lista de dias úteis que o agente leu).
--           Análise: o trabalho novo vira a execução da própria análise, como
--           o reenvio da 039/045 (a análise volta para a fila e o agente recebe
--           o resultado anterior e o recado);
--        d) agent_runs.redo_of_run_id e redo_of_review_id: de qual trabalho e
--           de qual revisão o novo é o refazer. Só esta função grava; não mudam
--           depois. Um refazer por trabalho (índice único): o refazer de um
--           refazer forma a cadeia, de no máximo 3 a partir do trabalho
--           original. No quarto, o banco recusa e a tela diz para tratar à mão;
--        e) publicação do DJEN ligada ao trabalho anterior, sem prazo e ainda
--           não tratada: passa a apontar para o trabalho novo e fica "Com o
--           agente". Assim a vigia da 062 não a solta por "a revisão terminou
--           sem prazo" (o tempo de espera conta de novo a partir do refazer) e
--           o prazo do trabalho novo, aprovado em Revisões, fecha a publicação
--           pelo gatilho de sempre. Se o trabalho anterior ainda tem outra
--           proposta de prazo viva, a publicação fica com ele.
--      Auditoria AGENT_RUN_REDO_REQUESTED (o recado não entra: fica na decisão
--      da revisão e no pedido do trabalho).
--   2. Prazo direto (059) nunca vale para o trabalho refeito: uma pessoa já
--      olhou e pediu correção, então a nova proposta de prazo volta para
--      Revisões. private.judicial_direct_deadline_check (definição da 062) ganha
--      só essa conferência, antes das outras; o resto é idêntico.
--   3. public.get_review_redo(revisão): o que a tela precisa para o botão e para
--      "Refeito em ..." / "Refazer de ...": o trabalho da revisão, a posição na
--      cadeia, o refazer já pedido e, se não der para pedir, o motivo.
--
-- O computador do escritório não muda: o pedido chega ao agente como sempre
-- ("Pedido de quem enviou" e, na ponte, o pedido repassado ao agente da
-- máquina), e o roteiro do conector já manda gerar a versão _v2 quando o pedido
-- diz REFAZER.
--
-- 001–069 não são alteradas (agent_runs ganha duas colunas por ALTER; a função
-- da 062 é redefinida aqui). Rodar de novo não quebra nem duplica.

-- ═════════════════════════════ 1. o vínculo do refazer ═════════════════════

alter table public.agent_runs
  add column if not exists redo_of_run_id uuid references public.agent_runs (id) on delete restrict,
  add column if not exists redo_of_review_id uuid references public.reviews (id) on delete restrict;

alter table public.agent_runs drop constraint if exists agent_runs_redo_complete;
alter table public.agent_runs
  add constraint agent_runs_redo_complete check (
    (redo_of_run_id is null) = (redo_of_review_id is null) and redo_of_run_id is distinct from id);

create unique index if not exists agent_runs_one_redo_per_run on public.agent_runs (redo_of_run_id) where redo_of_run_id is not null;
create index if not exists agent_runs_redo_review_idx on public.agent_runs (redo_of_review_id) where redo_of_review_id is not null;

comment on column public.agent_runs.redo_of_run_id is
  'Refazer (070): o trabalho anterior que uma pessoa mandou refazer em Revisões. Um refazer por trabalho; no máximo 3 em cadeia.';
comment on column public.agent_runs.redo_of_review_id is
  'Refazer (070): a revisão em que a pessoa pediu para refazer (encerrada como rejeitada, com o recado).';

-- Só o refazer (marcado na transação) grava o vínculo; depois de gravado, não muda.
create or replace function private.agent_runs_redo_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.redo_of_run_id is not null or new.redo_of_review_id is not null then
      raise exception 'O vínculo do refazer só se grava por "Pedir para o agente refazer"' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.redo_of_run_id is not distinct from old.redo_of_run_id and new.redo_of_review_id is not distinct from old.redo_of_review_id then
    return new;
  end if;
  if old.redo_of_run_id is not null or old.redo_of_review_id is not null then
    raise exception 'O vínculo do refazer não muda depois de gravado' using errcode = '42501';
  end if;
  if coalesce(current_setting('dg.agent_redo', true), '') <> new.id::text then
    raise exception 'O vínculo do refazer só se grava por "Pedir para o agente refazer" (redo_agent_review)' using errcode = '42501';
  end if;
  return new;
end
$$;

drop trigger if exists agent_runs_redo_guard on public.agent_runs;
create trigger agent_runs_redo_guard
  before insert or update on public.agent_runs
  for each row execute function private.agent_runs_redo_guard();

-- Quantos refazeres em cadeia levaram até este trabalho (0 = trabalho original).
create or replace function private.agent_run_redo_depth(p_agent_run_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  with recursive c(id, prev, n) as (
    select r.id, r.redo_of_run_id, 0 from public.agent_runs r where r.id = p_agent_run_id
    union all
    select r.id, r.redo_of_run_id, c.n + 1 from public.agent_runs r join c on r.id = c.prev where c.n < 50
  )
  select coalesce(max(n), 0) from c
$$;

-- ═════════════════════════════ 2. pode pedir? ══════════════════════════════

-- Situação do refazer de uma revisão (sem conferir quem pede). Devolve o
-- trabalho, a cadeia e, quando não dá para pedir, o código e a frase do motivo.
create or replace function private.review_redo_state(p_review_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rv     record;
  v_run    record;
  v_depth  integer;
  v_redone record;
  v_code   text;
  v_why    text;
begin
  select r.id, r.status, r.agent_run_id, r.legal_case_id, r.legal_analysis_id, r.agent_proposal_id
    into v_rv
  from public.reviews r where r.id = p_review_id;
  if v_rv.id is null then
    return null;
  end if;
  if v_rv.agent_run_id is null then
    return jsonb_build_object('agent_run_id', null, 'can_redo', false, 'blocked', 'NO_RUN',
                              'message', 'Este item foi enviado por uma pessoa, não por um agente: não há trabalho para refazer.');
  end if;

  select r.id, r.status, r.redo_of_run_id, r.redo_of_review_id, r.created_at, a.name as agent_name,
         a.status as agent_status, a.deleted_at as agent_deleted
    into v_run
  from public.agent_runs r join public.agents a on a.id = r.agent_id
  where r.id = v_rv.agent_run_id;
  v_depth := private.agent_run_redo_depth(v_run.id);
  select n.id, n.status, n.created_at, n.requested_by into v_redone
  from public.agent_runs n where n.redo_of_run_id = v_run.id;

  if v_rv.status not in ('PENDING', 'REOPENED') then
    v_code := 'DECIDED';
    v_why := 'Esta revisão já foi decidida.';
  elsif v_redone.id is not null then
    v_code := 'ALREADY_REDONE';
    v_why := 'Este trabalho já foi mandado refazer em ' || to_char(v_redone.created_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI')
      || '. Os itens do trabalho refeito chegam em Revisões.';
  elsif v_depth >= 3 then
    v_code := 'LIMIT';
    v_why := 'Este trabalho já foi refeito 3 vezes a partir do original. É melhor tratar à mão: corrija e aprove, ou rejeite e faça a providência.';
  elsif v_run.status in ('QUEUED', 'RUNNING') then
    v_code := 'RUNNING';
    v_why := 'O agente ainda está neste trabalho. Espere ele terminar para pedir o refazer.';
  elsif v_run.agent_status <> 'ACTIVE' or v_run.agent_deleted is not null then
    v_code := 'AGENT_INACTIVE';
    v_why := 'O agente deste trabalho está desativado: não dá para pedir o refazer a ele.';
  elsif v_rv.legal_analysis_id is not null and not exists (
          select 1 from public.legal_analyses a where a.id = v_rv.legal_analysis_id and a.agent_run_id = v_run.id) then
    v_code := 'ANALYSIS_MOVED';
    v_why := 'A análise já foi enviada de novo ao agente por outro caminho.';
  end if;

  return jsonb_build_object(
    'agent_run_id', v_run.id, 'agent_name', v_run.agent_name, 'run_status', v_run.status, 'round', v_depth,
    'redo_of_run_id', v_run.redo_of_run_id, 'redo_of_review_id', v_run.redo_of_review_id,
    'redone', case when v_redone.id is null then null
                   else jsonb_build_object('agent_run_id', v_redone.id, 'status', v_redone.status,
                                           'created_at', v_redone.created_at, 'requested_by', v_redone.requested_by,
                                           'review_id', (select x.id from public.reviews x where x.agent_run_id = v_redone.id
                                                         order by x.created_at, x.id limit 1)) end,
    'redone_from_review', (select n.id from public.agent_runs n where n.redo_of_review_id = p_review_id limit 1) is not null,
    'can_redo', v_code is null, 'blocked', v_code, 'message', v_why);
end
$$;

create or replace function private.get_review_redo(p_review_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_case uuid;
begin
  if not private.has_internal_role('ADMIN', 'LAWYER') then
    raise exception 'Revisões são visíveis só a ADMIN e LAWYER' using errcode = '42501';
  end if;
  select r.legal_case_id into v_case from public.reviews r where r.id = p_review_id;
  if not found or (v_case is not null and not private.can_access_case(v_case)) then
    raise exception 'Revisão não encontrada' using errcode = 'P0002';
  end if;
  return private.review_redo_state(p_review_id);
end
$$;

create or replace function public.get_review_redo(p_review_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$ select private.get_review_redo(p_review_id) $$;

-- ═════════════════════════════ 3. pedir o refazer ══════════════════════════

create or replace function private.redo_agent_review(p_review_id uuid, p_message text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor     uuid := private.resolve_actor(null);
  v_role      public.membership_role := private.user_internal_role(v_actor);
  v_msg       text := btrim(coalesce(p_message, ''));
  v_rv        record;
  v_run       record;
  v_state     jsonb;
  v_depth     integer;
  v_input     record;
  v_pub       record;
  v_who       text;
  v_delivered text;
  v_head      text;
  v_text      text;
  v_params    jsonb;
  v_new       uuid;
  v_decision  uuid;
  v_relinked  boolean := false;
begin
  if v_role is null or v_role not in ('ADMIN', 'LAWYER') then
    raise exception 'Só ADMIN ou advogado do escritório pede para o agente refazer' using errcode = '42501';
  end if;

  select r.id, r.status, r.agent_run_id, r.legal_case_id, r.legal_process_id, r.legal_analysis_id,
         r.legal_analysis_result_id, r.agent_proposal_id, r.document_version_id
    into v_rv
  from public.reviews r where r.id = p_review_id
  for update;
  if not found or (v_rv.legal_case_id is not null and not private.can_access_case(v_rv.legal_case_id)) then
    raise exception 'Revisão não encontrada' using errcode = 'P0002';
  end if;

  -- Clique duplo ou nova tentativa: o refazer já pedido por esta revisão volta.
  select n.id into v_new from public.agent_runs n where n.redo_of_review_id = p_review_id;
  if v_new is not null then
    return jsonb_build_object('agent_run_id', v_new, 'review_id', p_review_id, 'deduplicated', true,
                              'round', private.agent_run_redo_depth(v_new));
  end if;

  if v_rv.agent_proposal_id is not null and private.proposal_requires_admin(
       (select p.proposal_type from public.agent_proposals p where p.id = v_rv.agent_proposal_id)) and v_role <> 'ADMIN' then
    raise exception 'Somente ADMIN decide proposta que altera a configuração do DG Brasil' using errcode = '42501';
  end if;
  if length(v_msg) < 10 then
    raise exception 'Escreva o que precisa mudar (no mínimo 10 caracteres)' using errcode = '22023';
  end if;
  if length(v_msg) > 4000 then
    raise exception 'O recado cabe em até 4000 caracteres' using errcode = '22023';
  end if;

  v_state := private.review_redo_state(p_review_id);
  if not coalesce((v_state ->> 'can_redo')::boolean, false) then
    raise exception '%', v_state ->> 'message' using errcode = '23514';
  end if;

  select r.id, r.agent_id, r.legal_case_id, r.legal_process_id, r.operation, r.status into v_run
  from public.agent_runs r where r.id = v_rv.agent_run_id
  for update;
  v_depth := private.agent_run_redo_depth(v_run.id);

  -- O que foi entregue antes, para o agente corrigir em vez de começar do zero.
  if v_rv.agent_proposal_id is not null then
    select 'Proposta (' || case p.proposal_type
              when 'CREATE_DEADLINE' then 'prazo' when 'REQUEST_DOCUMENT' then 'pedido de documento'
              when 'UPDATE_CASE' then 'atualização do caso' when 'CREATE_PROCESS' then 'cadastro de processo'
              else 'providência' end || ')'
           || coalesce(': ' || nullif(btrim(coalesce(p.payload -> 'data' ->> 'title', p.payload -> 'data' ->> 'label', '')), ''), '')
           || coalesce('. Resumo do agente: ' || nullif(btrim(p.payload ->> 'summary'), ''), '')
           || coalesce('. Dados propostos: ' || left((p.payload -> 'data')::text, 3000), '')
      into v_delivered
    from public.agent_proposals p where p.id = v_rv.agent_proposal_id;
  elsif v_rv.document_version_id is not null then
    select 'Minuta "' || d.title || '" (versão ' || v.version_number
           || coalesce(', arquivo ' || v.original_filename, '') || ')'
      into v_delivered
    from public.document_versions v join public.documents d on d.id = v.document_id
    where v.id = v_rv.document_version_id;
  else
    select 'Análise "' || t.name || '"'
           || coalesce('. Resumo do resultado: ' || left(nullif(btrim(lr.summary), ''), 1500), '')
      into v_delivered
    from public.legal_analyses a
    join public.analysis_templates t on t.id = a.analysis_template_id
    left join public.legal_analysis_results lr on lr.id = v_rv.legal_analysis_result_id
    where a.id = v_rv.legal_analysis_id;
  end if;

  -- 1. Encerra a revisão: rejeitada, com o recado. Nada é aplicado.
  v_decision := private.decide_review(p_review_id, 'REJECT', left('Pedido ao agente para refazer: ' || v_msg, 5000), null);

  -- 2. O pedido do trabalho novo.
  select i.request_text, i.parameters into v_input from public.agent_run_inputs i where i.agent_run_id = v_run.id;
  select p.id into v_pub from public.judicial_publications p where p.agent_run_id = v_run.id order by p.captured_at, p.id limit 1;
  select coalesce(nullif(btrim(pr.full_name), ''), 'uma pessoa da equipe') into v_who from public.profiles pr where pr.id = v_actor;

  v_head := 'REFAZER (' || (v_depth + 1) || 'º refazer deste trabalho, pedido em Revisões por ' || coalesce(v_who, 'uma pessoa da equipe')
    || ' em ' || to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') || ').' || E'\n'
    || 'Um advogado leu o que foi entregue no trabalho anterior e pediu para refazer. Corrija o que ele pediu, aproveitando o '
    || 'trabalho anterior, em vez de começar do zero. Entregue de novo o que este recado corrige; o resto do trabalho anterior '
    || 'continua em Revisões. Arquivo novo leva _v' || (v_depth + 2) || ' no fim do nome (ex.: MINUTA_..._v' || (v_depth + 2)
    || '.docx), sem apagar nem sobrescrever a versão anterior.'
    || case when v_pub.id is not null then E'\nNeste refazer o prazo proposto NÃO entra direto na agenda: ele volta para Revisões, para a equipe conferir.' else '' end
    || E'\n\nO QUE PRECISA MUDAR (recado do advogado):\n' || v_msg
    || E'\n\nO QUE FOI ENTREGUE ANTES:\n' || coalesce(v_delivered, '(sem descrição)')
    || E'\n\nPEDIDO ORIGINAL DO TRABALHO ANTERIOR:\n';
  -- agent_run_inputs aceita até 20 mil caracteres: o que sobra é do pedido original.
  v_text := v_head || left(coalesce(v_input.request_text, '(o pedido original não está mais guardado)'), greatest(20000 - length(v_head), 200));
  v_text := left(v_text, 20000);
  v_params := coalesce(v_input.parameters, '{}'::jsonb)
    || jsonb_build_object('redo_of_run_id', v_run.id, 'redo_of_review_id', p_review_id, 'redo_round', v_depth + 1);

  -- 3. O trabalho novo, pela porta de sempre (papel e acesso conferidos de novo).
  v_new := private.request_agent_run(v_run.agent_id, v_run.legal_case_id, v_run.legal_process_id, v_text, v_params,
                                     coalesce(v_run.operation, 'EXECUTE'), null);
  perform set_config('dg.agent_redo', v_new::text, true);
  update public.agent_runs set redo_of_run_id = v_run.id, redo_of_review_id = p_review_id where id = v_new;
  perform set_config('dg.agent_redo', '', true);

  -- Análise: o trabalho novo é a execução da própria análise (como o reenvio da 039/045).
  if v_rv.legal_analysis_id is not null then
    update public.agent_runs set retry_of_agent_run_id = v_run.id where id = v_new and retry_of_agent_run_id is null;
    update public.legal_analyses
       set status = 'QUEUED', agent_run_id = v_new, started_by = v_actor, started_at = now(), interruption_reason = null
     where id = v_rv.legal_analysis_id and agent_run_id = v_run.id and status = 'PENDING';
    if not found then
      raise exception 'A análise não pôde voltar para a fila' using errcode = '23514';
    end if;
  end if;

  -- 4. Publicação do trabalho anterior: fica com o trabalho novo, "Com o agente".
  if v_pub.id is not null then
    update public.judicial_publications p
       set agent_run_id = v_new, triage_status = 'WITH_AGENT', agent_error = null
     where p.agent_run_id = v_run.id and p.triage_status in ('WITH_AGENT', 'PENDING')
       and p.deadline_id is null and p.cancelled_at is null
       and not exists (select 1 from public.agent_proposals ap
                       where ap.agent_run_id = v_run.id and ap.proposal_type = 'CREATE_DEADLINE'
                         and (ap.status = 'APPROVED'
                              or (ap.status = 'PENDING' and exists (select 1 from public.reviews x
                                                                    where x.agent_proposal_id = ap.id and x.status in ('PENDING', 'REOPENED')))));
    v_relinked := found;
  end if;

  perform private.record_audit_event('AGENT_RUN_REDO_REQUESTED', 'agent_runs', v_new,
    jsonb_build_object('review_id', p_review_id, 'review_decision_id', v_decision, 'redo_of_run_id', v_run.id,
                       'legal_case_id', v_run.legal_case_id, 'attempt', v_depth + 1));

  return jsonb_build_object('agent_run_id', v_new, 'review_id', p_review_id, 'redo_of_run_id', v_run.id,
                            'round', v_depth + 1, 'publication_relinked', v_relinked, 'deduplicated', false);
end
$$;

create or replace function public.redo_agent_review(p_review_id uuid, p_message text)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.redo_agent_review(p_review_id, p_message) $$;

-- ═════════════════════════════ 4. sem prazo direto no refazer ══════════════

-- Conferências do prazo direto (059/062). Única mudança (070): trabalho refeito
-- a pedido de uma pessoa nunca vira prazo direto. O resto é o da 062.
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
  -- private.judicial_request_deadline_proposal (e, no refazer, 070) grava esse vínculo.
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

  if exists (select 1 from public.agent_runs r where r.id = p_agent_run_id and r.redo_of_run_id is not null) then
    -- 070: uma pessoa já olhou a entrega anterior e pediu para refazer.
    v_no := 'este trabalho é um refazer pedido em Revisões: o prazo volta para uma pessoa conferir';
  elsif v_p.cancelled_at is not null then
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

-- ═════════════════════════════ 5. permissões ══════════════════════════════

-- Blocos internos e função de gatilho: ninguém chama direto.
revoke all on function private.agent_runs_redo_guard() from public, anon, authenticated, service_role;
revoke all on function private.agent_run_redo_depth(uuid) from public, anon, authenticated, service_role;
revoke all on function private.review_redo_state(uuid) from public, anon, authenticated, service_role;
revoke all on function private.judicial_direct_deadline_check(uuid, uuid, uuid, jsonb) from public, anon, authenticated, service_role;
-- Tela: pública (invoker) → privada (definer); a privada confere o papel.
revoke all on function private.get_review_redo(uuid) from public, anon, authenticated, service_role;
revoke all on function private.redo_agent_review(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.get_review_redo(uuid) from public, anon, authenticated, service_role;
revoke all on function public.redo_agent_review(uuid, text) from public, anon, authenticated, service_role;
grant execute on function private.get_review_redo(uuid) to authenticated;
grant execute on function private.redo_agent_review(uuid, text) to authenticated;
grant execute on function public.get_review_redo(uuid) to authenticated;
grant execute on function public.redo_agent_review(uuid, text) to authenticated;
