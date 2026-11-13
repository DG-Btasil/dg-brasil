-- 067 · Revisões: fila por execução do agente, responsável ao nascer e fim do
--       "solicitar alterações" em proposta.
--
-- Achados da revisão final (13/11/2026):
--   a) Um trabalho de agente gera muitas revisões soltas (um só gerou 21
--      propostas; o ambiente de teste tem 334 itens). A fila plana não é operável.
--   b) Todas nascem "sem responsável".
--   c) "Solicitar alterações" numa PROPOSTA do agente deixa a revisão sem poder
--      receber outra decisão (009: só PENDING/REOPENED aceitam decisão, e revisão
--      de proposta não se reabre), a proposta fica PENDING para sempre e, no prazo
--      de publicação, a publicação fica presa "Com o agente" (043).
--
-- O que muda:
--
--   1. reviews.agent_run_id: a execução do agente que gerou o item. Preenchida
--      pelo banco no nascimento (gatilho novo, antes do INSERT), nunca pelo
--      navegador (a coluna não tem grant de escrita):
--        · proposta            → agent_proposals.agent_run_id;
--        · resultado de análise → legal_analysis_results.agent_run_id;
--        · minuta do agente    → a execução declarada na transação da entrega
--          (dg.agent_run_id, que worker_scope e executor_lease já marcam), só
--          para versão de origem AGENT e execução do mesmo caso.
--      Item enviado por pessoa fica sem execução. As revisões que já existem são
--      preenchidas uma vez (propostas, resultados e, para minutas, a lista
--      metadata.documents da execução), sem tocar em updated_at nem gerar evento
--      de auditoria: por isso os gatilhos de usuário da tabela ficam desligados
--      SÓ durante esse preenchimento.
--
--   2. Responsável ao nascer: o mesmo gatilho atribui a revisão ao advogado
--      responsável pelo caso (legal_cases.assigned_lawyer_id) quando ela nasce
--      sem responsável e ele é ADMIN ou advogado ATIVO do escritório. Proposta
--      estrutural (agente, skill…) só é atribuída a ADMIN. Sem caso, sem
--      advogado ou advogado inativo: continua sem responsável, como antes.
--      As funções que criam revisões (018, 034, 039, 059) não mudam.
--
--   3. Aviso "revisão atribuída" (private.notify_reviews, 037): continua um por
--      revisão e por pessoa quando alguém atribui, e não dispara em dobro (o
--      responsável entra ANTES do INSERT; não há UPDATE depois). Para o trabalho
--      de agente que nasce já atribuído, vira UM aviso por execução e por
--      responsável (a mesma execução pode gerar dezenas de itens). Item URGENTE
--      continua com o aviso próprio.
--
--   4. private.review_decisions_apply (009): recusa REQUEST_CHANGES quando o alvo
--      é proposta de agente. Documento e análise continuam aceitando.
--
--   5. Revisões de proposta já paradas em "alterações solicitadas" (com a
--      proposta ainda PENDING): voltam para a fila como REOPENED, para uma pessoa
--      decidir de novo (aprovar ou rejeitar). Nada é aprovado nem rejeitado por
--      aqui. A decisão antiga continua no histórico; a volta fica na auditoria
--      (REVIEW_REOPENED, sem autor). A publicação judicial não é tocada.
--
--   6. Leitura da fila no banco, para ADMIN e advogado (mesma regra da RLS de
--      reviews), com os mesmos filtros da listagem e busca por texto (cliente,
--      caso, título do item, agente), sem diferenciar acento nem maiúscula:
--        · list_review_groups: a fila agrupada por execução; item sem execução
--          forma um grupo por caso. Devolve só rótulos e contagens.
--        · list_review_queue: os ids de uma página da fila plana (usado quando
--          há busca por texto; o conteúdo continua vindo da tabela, com a RLS).
--
-- 001–061 não são alteradas (a 009 e a 037 têm uma função cada redefinida aqui).
-- Rodar de novo não quebra nem duplica.

-- ═════════════════════════════ 1. execução do agente ══════════════════════

alter table public.reviews
  add column if not exists agent_run_id uuid references public.agent_runs (id) on delete restrict;

comment on column public.reviews.agent_run_id is
  'Execução do agente que gerou o item em revisão (067). Preenchida pelo banco no nascimento; vazia quando o item foi enviado por uma pessoa. Só agrupa a fila: não muda quem decide.';

create index if not exists reviews_agent_run_idx on public.reviews (agent_run_id) where agent_run_id is not null;

-- ═════════════════════════════ 2. nascimento da revisão ═══════════════════

create or replace function private.reviews_fill_on_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run    uuid;
  v_type   text;
  v_text   text;
  v_lawyer uuid;
  v_role   public.membership_role;
begin
  -- (a) De qual execução veio. O valor informado por quem insere é ignorado.
  if new.agent_proposal_id is not null then
    select p.agent_run_id, p.proposal_type into v_run, v_type
    from public.agent_proposals p where p.id = new.agent_proposal_id;
  elsif new.legal_analysis_result_id is not null then
    select r.agent_run_id into v_run
    from public.legal_analysis_results r where r.id = new.legal_analysis_result_id;
  elsif new.document_version_id is not null
        and exists (select 1 from public.document_versions v
                    where v.id = new.document_version_id and v.source = 'AGENT') then
    v_text := coalesce(current_setting('dg.agent_run_id', true), '');
    if v_text ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
      select r.id into v_run from public.agent_runs r
      where r.id = v_text::uuid and r.legal_case_id is not distinct from new.legal_case_id;
    end if;
  end if;
  new.agent_run_id := v_run;

  -- (b) Responsável: o advogado do caso, se estiver ativo.
  if new.assigned_reviewer_id is null and new.legal_case_id is not null then
    select c.assigned_lawyer_id into v_lawyer from public.legal_cases c where c.id = new.legal_case_id;
    if v_lawyer is not null then
      v_role := private.user_internal_role(v_lawyer);
      if v_role = 'ADMIN'
         or (v_role = 'LAWYER' and not coalesce(private.proposal_requires_admin(v_type), false)) then
        new.assigned_reviewer_id := v_lawyer;
      end if;
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists reviews_fill_on_insert on public.reviews;
create trigger reviews_fill_on_insert
  before insert on public.reviews
  for each row execute function private.reviews_fill_on_insert();

-- Revisões que já existem: só a execução (o responsável delas não muda).
alter table public.reviews disable trigger user;

update public.reviews r
   set agent_run_id = p.agent_run_id
  from public.agent_proposals p
 where p.id = r.agent_proposal_id and r.agent_run_id is null;

update public.reviews r
   set agent_run_id = lr.agent_run_id
  from public.legal_analysis_results lr
 where lr.id = r.legal_analysis_result_id and r.agent_run_id is null;

update public.reviews r
   set agent_run_id = s.run_id
  from (
    select distinct on (d.version_id) d.version_id, ar.id as run_id, ar.legal_case_id
    from public.agent_runs ar
    cross join lateral jsonb_array_elements_text(
      case when jsonb_typeof(ar.metadata -> 'documents') = 'array' then ar.metadata -> 'documents' else '[]'::jsonb end
    ) d(version_id)
    order by d.version_id, ar.created_at
  ) s
 where r.document_version_id is not null
   and r.agent_run_id is null
   and r.document_version_id::text = s.version_id
   and s.legal_case_id is not distinct from r.legal_case_id;

alter table public.reviews enable trigger user;

-- ═════════════════════════════ 3. aviso de atribuição ═════════════════════

-- Igual à 037, com uma diferença: trabalho de agente que nasce já atribuído
-- gera um aviso por execução e por responsável, não um por item.
create or replace function private.notify_reviews()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_subject text;
  v_owner   uuid;
  v_agent   text;
begin
  v_subject := coalesce(
    (select 'Análise: ' || t.name from public.legal_analyses a join public.analysis_templates t on t.id = a.analysis_template_id where a.id = new.legal_analysis_id),
    (select 'Documento: ' || d.title || ' (v' || v.version_number || ')' from public.document_versions v join public.documents d on d.id = v.document_id where v.id = new.document_version_id),
    'Proposta do agente');

  -- Atribuída (na criação ou depois).
  if new.assigned_reviewer_id is not null
     and (tg_op = 'INSERT' or new.assigned_reviewer_id is distinct from old.assigned_reviewer_id)
     and new.status in ('PENDING', 'REOPENED') then
    if tg_op = 'INSERT' and new.agent_run_id is not null and new.priority <> 'URGENT' then
      select a.name into v_agent
      from public.agent_runs r join public.agents a on a.id = r.agent_id where r.id = new.agent_run_id;
      perform private.notify(new.assigned_reviewer_id, 'REVIEW_ASSIGNED', 'Revisões atribuídas a você',
                             coalesce(v_agent, 'Agente') || ': novo trabalho para revisar', 'INFO',
                             'review-assigned-run:' || new.agent_run_id || ':' || new.assigned_reviewer_id,
                             new.legal_case_id, new.legal_process_id, null, 'review', new.id);
    else
      perform private.notify(new.assigned_reviewer_id, 'REVIEW_ASSIGNED', 'Revisão atribuída a você', v_subject,
                             case when new.priority = 'URGENT' then 'URGENT' else 'INFO' end,
                             'review-assigned:' || new.id || ':' || new.assigned_reviewer_id, new.legal_case_id, new.legal_process_id, null, 'review', new.id);
    end if;
  end if;

  -- Decidida: avisa quem pediu o material revisado.
  if tg_op = 'UPDATE' and new.status is distinct from old.status and new.status in ('APPROVED', 'REJECTED', 'CHANGES_REQUESTED') then
    v_owner := coalesce(
      (select a.started_by from public.legal_analyses a where a.id = new.legal_analysis_id),
      (select v.created_by from public.document_versions v where v.id = new.document_version_id),
      (select r.requested_by from public.agent_proposals p join public.agent_runs r on r.id = p.agent_run_id where p.id = new.agent_proposal_id));
    perform private.notify(v_owner, 'REVIEW_DECIDED',
                           case new.status when 'APPROVED' then 'Revisão aprovada' when 'REJECTED' then 'Revisão rejeitada' else 'Alterações pedidas na revisão' end,
                           v_subject, case when new.status = 'APPROVED' then 'INFO' else 'WARNING' end,
                           'review-decided:' || new.id || ':' || new.status || ':' || coalesce(new.decided_at::text, ''),
                           new.legal_case_id, new.legal_process_id, null, 'review', new.id);
  end if;
  return null;
end
$$;

-- ═════════════════════════════ 4. decisão: proposta não aceita "alterações" ══

-- Igual à 009, com uma regra a mais: proposta de agente só se aprova ou rejeita.
create or replace function private.review_decisions_apply()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_review record;
  v_actor  uuid := auth.uid();
  v_role   public.membership_role;
begin
  if tg_op = 'INSERT' and tg_when = 'BEFORE' then
    new.decided_by := coalesce(new.decided_by, v_actor);
    if v_actor is not null and new.decided_by <> v_actor then
      raise exception 'Decisão só pode ser registrada em nome do próprio usuário' using errcode = '42501';
    end if;

    v_role := private.user_internal_role(new.decided_by);
    if v_role is null or v_role not in ('ADMIN', 'LAWYER') then
      raise exception 'Só ADMIN ou LAWYER interno decide revisões' using errcode = '42501';
    end if;

    select r.status, r.agent_proposal_id, p.proposal_type into v_review
    from public.reviews r
    left join public.agent_proposals p on p.id = r.agent_proposal_id
    where r.id = new.review_id
    for update of r;

    if not found then
      raise exception 'Revisão % não existe', new.review_id using errcode = '23503';
    end if;

    -- Proposta que altera configuração estrutural do DG Brasil (agente, skill,
    -- tese, referência): só ADMIN decide. LAWYER decide resultado jurídico.
    if v_review.agent_proposal_id is not null
       and private.proposal_requires_admin(v_review.proposal_type)
       and v_role <> 'ADMIN' then
      raise exception 'Somente ADMIN decide proposta % (configuração estrutural do DG Brasil)', v_review.proposal_type
        using errcode = '42501';
    end if;

    -- Proposta não tem o que "alterar": pedir alterações deixava a revisão sem
    -- saída e a proposta pendente para sempre (067).
    if new.decision = 'REQUEST_CHANGES' and v_review.agent_proposal_id is not null then
      raise exception 'Proposta do agente só pode ser aprovada ou rejeitada. Para recusar, rejeite e escreva o motivo.'
        using errcode = '23514';
    end if;

    if new.decision in ('APPROVE', 'REJECT', 'REQUEST_CHANGES')
       and v_review.status not in ('PENDING', 'REOPENED') then
      raise exception 'Revisão em % não aceita %', v_review.status, new.decision using errcode = '23514';
    end if;
    if new.decision = 'REOPEN' then
      if v_review.status not in ('APPROVED', 'REJECTED', 'CHANGES_REQUESTED') then
        raise exception 'Só se reabre revisão decidida (atual: %)', v_review.status using errcode = '23514';
      end if;
      -- Proposta decidida segue para aplicação ou descarte: não se desfaz um
      -- efeito reabrindo a revisão. Para rever, o agente gera outra proposta.
      if v_review.agent_proposal_id is not null then
        raise exception 'Revisão de proposta de agente não se reabre: gere uma nova proposta'
          using errcode = '23514';
      end if;
    end if;
    return new;
  end if;

  perform set_config('dg.review_decision_review_id', new.review_id::text, true);
  update public.reviews
     set status = case new.decision
                    when 'APPROVE'         then 'APPROVED'
                    when 'REJECT'          then 'REJECTED'
                    when 'REQUEST_CHANGES' then 'CHANGES_REQUESTED'
                    when 'REOPEN'          then 'REOPENED'
                  end,
         decided_at = case when new.decision = 'REOPEN' then null else new.created_at end
   where id = new.review_id;
  perform set_config('dg.review_decision_review_id', '', true);
  return null;
end
$$;

-- ═════════════════════════════ 5. as que já estavam paradas ═══════════════

-- Revisão de proposta em "alterações solicitadas" com a proposta ainda PENDING:
-- volta para a fila (REOPENED) para uma pessoa decidir. Só a revisão mais
-- recente da proposta, e só se não houver outra em aberto.
do $$
declare
  r   record;
  v_n integer := 0;
begin
  for r in
    select x.id
    from (
      select distinct on (rv.agent_proposal_id) rv.id, rv.status, rv.agent_proposal_id
      from public.reviews rv
      where rv.agent_proposal_id is not null
      order by rv.agent_proposal_id, rv.created_at desc, rv.id desc
    ) x
    join public.agent_proposals p on p.id = x.agent_proposal_id
    where x.status = 'CHANGES_REQUESTED' and p.status = 'PENDING'
      and not exists (select 1 from public.reviews o
                      where o.agent_proposal_id = x.agent_proposal_id and o.status in ('PENDING', 'REOPENED'))
  loop
    perform set_config('dg.review_decision_review_id', r.id::text, true);
    update public.reviews set status = 'REOPENED', decided_at = null where id = r.id;
    perform set_config('dg.review_decision_review_id', '', true);
    perform private.record_audit_event('REVIEW_REOPENED', 'reviews', r.id,
      jsonb_build_object('reason', 'changes_requested_on_proposal', 'migration', '067'));
    v_n := v_n + 1;
  end loop;
  if v_n > 0 then
    raise notice '067: % revisão(ões) de proposta em "alterações solicitadas" voltaram para a fila', v_n;
  end if;
end
$$;

-- ═════════════════════════════ 6. leitura da fila ═════════════════════════

-- Texto para busca: minúsculas e sem acento.
create or replace function private.review_fold(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  -- As maiúsculas acentuadas entram no mapa porque lower() depende do
  -- idioma configurado no banco para trocar letra acentuada.
  select translate(lower(btrim(coalesce(p_text, ''))),
                   'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
                   'aaaaaeeeeiiiiooooouuuucnaaaaaeeeeiiiiooooouuuucn')
$$;

-- O que a busca enxerga de um item: caso, cliente, título do item (na proposta:
-- o tipo, o que ela pede e o resumo do agente) e o agente.
create or replace function private.review_search_text(
  p_case uuid, p_version uuid, p_analysis uuid, p_proposal uuid, p_run uuid
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select private.review_fold(concat_ws(' ',
    (select concat_ws(' ', c.title, i.full_name, co.legal_name, co.trade_name)
       from public.legal_cases c
       left join public.individual_client_details i on i.client_id = c.client_id
       left join public.company_client_details co on co.client_id = c.client_id
      where c.id = p_case),
    (select d.title from public.document_versions v join public.documents d on d.id = v.document_id where v.id = p_version),
    (select 'Análise: ' || t.name from public.legal_analyses a
       join public.analysis_templates t on t.id = a.analysis_template_id where a.id = p_analysis),
    (select concat_ws(' ',
              case p.proposal_type
                when 'CREATE_DEADLINE'  then 'Proposta de prazo'
                when 'REQUEST_DOCUMENT' then 'Pedido de documento'
                when 'UPDATE_CASE'      then 'Atualização do caso'
                when 'CREATE_PROCESS'   then 'Cadastro de processo'
                when 'UPDATE_SKILL'     then 'Alteração de skill'
                when 'UPDATE_AGENT'     then 'Alteração de agente'
                else 'Proposta do agente'
              end,
              p.payload -> 'data' ->> 'title', p.payload -> 'data' ->> 'label', p.payload ->> 'summary')
       from public.agent_proposals p where p.id = p_proposal),
    (select a.name from public.agent_runs r join public.agents a on a.id = r.agent_id where r.id = p_run)))
$$;

-- As revisões que passam nos filtros. Bloco interno (sem RLS): só as duas
-- funções abaixo chamam, depois de conferir o papel.
--   statuses, priorities  listas de texto
--   assignee              id do responsável;  unassigned  true = sem responsável
--   legal_case_id, legal_process_id, target_kind, due_before
--   group_run             itens de uma execução
--   group_case            itens SEM execução de um caso
--   search                texto livre
create or replace function private.review_queue_rows(p_filters jsonb)
returns setof public.reviews
language sql
stable
security definer
set search_path = ''
as $$
  select r.*
  from public.reviews r
  where (jsonb_typeof(p_filters -> 'statuses') is distinct from 'array'
         or r.status in (select jsonb_array_elements_text(p_filters -> 'statuses')))
    and (jsonb_typeof(p_filters -> 'priorities') is distinct from 'array'
         or r.priority in (select jsonb_array_elements_text(p_filters -> 'priorities')))
    and (nullif(p_filters ->> 'assignee', '') is null
         or r.assigned_reviewer_id = (p_filters ->> 'assignee')::uuid)
    and (coalesce(p_filters ->> 'unassigned', 'false') <> 'true' or r.assigned_reviewer_id is null)
    and (nullif(p_filters ->> 'legal_case_id', '') is null
         or r.legal_case_id = (p_filters ->> 'legal_case_id')::uuid)
    and (nullif(p_filters ->> 'legal_process_id', '') is null
         or r.legal_process_id = (p_filters ->> 'legal_process_id')::uuid)
    and (case coalesce(p_filters ->> 'target_kind', '')
           when 'DOCUMENT_VERSION' then r.document_version_id is not null
           when 'ANALYSIS'         then r.legal_analysis_id is not null
           when 'AGENT_PROPOSAL'   then r.agent_proposal_id is not null
           else true
         end)
    and (nullif(p_filters ->> 'due_before', '') is null
         or r.due_at < (p_filters ->> 'due_before')::timestamptz)
    and (nullif(p_filters ->> 'group_run', '') is null
         or r.agent_run_id = (p_filters ->> 'group_run')::uuid)
    and (nullif(p_filters ->> 'group_case', '') is null
         or (r.agent_run_id is null and r.legal_case_id = (p_filters ->> 'group_case')::uuid))
    and (private.review_fold(p_filters ->> 'search') = ''
         or position(private.review_fold(p_filters ->> 'search')
                     in private.review_search_text(r.legal_case_id, r.document_version_id, r.legal_analysis_id,
                                                   r.agent_proposal_id, r.agent_run_id)) > 0)
$$;

-- Uma página da fila plana: total e ids na ordem pedida (nulos por último,
-- desempate por id, como a listagem direta).
create or replace function private.list_review_queue(
  p_filters   jsonb,
  p_sort      text,
  p_ascending boolean,
  p_limit     integer,
  p_offset    integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_filters jsonb := coalesce(p_filters, '{}'::jsonb);
  v_asc     boolean := coalesce(p_ascending, true);
  v_limit   integer := least(greatest(coalesce(p_limit, 25), 1), 50);
  v_offset  integer := greatest(coalesce(p_offset, 0), 0);
  v_out     jsonb;
begin
  if not private.has_internal_role('ADMIN', 'LAWYER') then
    raise exception 'Revisões são visíveis só a ADMIN e LAWYER' using errcode = '42501';
  end if;
  if jsonb_typeof(v_filters) <> 'object' then
    raise exception 'Filtros inválidos' using errcode = '22023';
  end if;

  with f as (
    select r.id,
           case p_sort when 'updated_at' then r.updated_at when 'due_at' then r.due_at else r.created_at end as k
    from private.review_queue_rows(v_filters) r
  ),
  o as (
    select f.id,
           row_number() over (order by case when v_asc then f.k end asc nulls last,
                                       case when not v_asc then f.k end desc nulls last,
                                       f.id) as rn
    from f
  )
  select jsonb_build_object(
           'total', (select count(*) from f),
           'ids', coalesce((select jsonb_agg(p.id order by p.rn)
                            from (select o.id, o.rn from o order by o.rn limit v_limit offset v_offset) p), '[]'::jsonb))
    into v_out;
  return v_out;
end
$$;

-- A fila agrupada: um grupo por execução do agente; item sem execução entra no
-- grupo do caso. Só rótulos e contagens (nenhum conteúdo revisado). A ordem é
-- a da fila: mais antigos primeiro (p_ascending) ou mais recentes primeiro.
create or replace function private.list_review_groups(
  p_filters   jsonb,
  p_ascending boolean,
  p_limit     integer,
  p_offset    integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_filters jsonb := coalesce(p_filters, '{}'::jsonb);
  v_asc     boolean := coalesce(p_ascending, true);
  v_limit   integer := least(greatest(coalesce(p_limit, 25), 1), 50);
  v_offset  integer := greatest(coalesce(p_offset, 0), 0);
  v_out     jsonb;
begin
  if not private.has_internal_role('ADMIN', 'LAWYER') then
    raise exception 'Revisões são visíveis só a ADMIN e LAWYER' using errcode = '42501';
  end if;
  if jsonb_typeof(v_filters) <> 'object' then
    raise exception 'Filtros inválidos' using errcode = '22023';
  end if;

  with f as (
    select * from private.review_queue_rows(v_filters)
  ),
  g as (
    select f.agent_run_id as run_id,
           case when f.agent_run_id is null then f.legal_case_id end as case_key,
           (array_agg(f.legal_case_id) filter (where f.legal_case_id is not null))[1] as case_id,
           count(*) as total,
           count(f.document_version_id) as documents,
           count(f.legal_analysis_id) as analyses,
           count(f.agent_proposal_id) as proposals,
           count(*) filter (where f.status in ('PENDING', 'REOPENED')) as open_items,
           count(*) filter (where f.assigned_reviewer_id is null) as unassigned,
           max(case f.priority when 'URGENT' then 4 when 'HIGH' then 3 when 'NORMAL' then 2 else 1 end) as top,
           min(f.created_at) as first_at,
           max(f.created_at) as last_at,
           array_agg(distinct f.assigned_reviewer_id) filter (where f.assigned_reviewer_id is not null) as reviewers
    from f
    group by 1, 2
  ),
  o as (
    select g.*,
           row_number() over (order by case when v_asc then g.first_at end asc,
                                       case when not v_asc then g.last_at end desc,
                                       g.run_id, g.case_key) as rn
    from g
  ),
  p as (
    select * from o order by o.rn limit v_limit offset v_offset
  )
  select jsonb_build_object(
           'total', (select count(*) from g),
           'total_items', (select coalesce(sum(g.total), 0) from g),
           'groups', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'key', case when p.run_id is not null then 'run:' || p.run_id else 'case:' || p.case_key end,
                      'agent_run_id', p.run_id,
                      'legal_case_id', p.case_id,
                      'agent_name', (select a.name from public.agent_runs r join public.agents a on a.id = r.agent_id
                                     where r.id = p.run_id),
                      'case_title', c.title,
                      'client_name', coalesce(i.full_name, co.legal_name),
                      'total', p.total,
                      'documents', p.documents,
                      'analyses', p.analyses,
                      'proposals', p.proposals,
                      'open', p.open_items,
                      'unassigned', p.unassigned,
                      'top_priority', case p.top when 4 then 'URGENT' when 3 then 'HIGH' when 2 then 'NORMAL' else 'LOW' end,
                      'first_created_at', p.first_at,
                      'last_created_at', p.last_at,
                      'reviewer_ids', coalesce(to_jsonb(p.reviewers), '[]'::jsonb)) order by p.rn)
             from p
             left join public.legal_cases c on c.id = p.case_id
             left join public.individual_client_details i on i.client_id = c.client_id
             left join public.company_client_details co on co.client_id = c.client_id), '[]'::jsonb))
    into v_out;
  return v_out;
end
$$;

create or replace function public.list_review_queue(
  p_filters jsonb default '{}', p_sort text default 'created_at', p_ascending boolean default true,
  p_limit integer default 25, p_offset integer default 0
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$ select private.list_review_queue(p_filters, p_sort, p_ascending, p_limit, p_offset) $$;

create or replace function public.list_review_groups(
  p_filters jsonb default '{}', p_ascending boolean default true, p_limit integer default 25, p_offset integer default 0
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$ select private.list_review_groups(p_filters, p_ascending, p_limit, p_offset) $$;

-- ═════════════════════════════ 7. permissões ══════════════════════════════

-- Funções de gatilho e blocos internos: ninguém executa direto.
revoke all on function private.reviews_fill_on_insert() from public, anon, authenticated, service_role;
revoke all on function private.notify_reviews() from public, anon, authenticated, service_role;
revoke all on function private.review_decisions_apply() from public, anon, authenticated, service_role;
revoke all on function private.review_fold(text) from public, anon, authenticated, service_role;
revoke all on function private.review_search_text(uuid, uuid, uuid, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function private.review_queue_rows(jsonb) from public, anon, authenticated, service_role;
-- Tela: pública (invoker) → privada (definer); a privada confere o papel.
revoke all on function private.list_review_queue(jsonb, text, boolean, integer, integer) from public, anon, authenticated, service_role;
revoke all on function private.list_review_groups(jsonb, boolean, integer, integer) from public, anon, authenticated, service_role;
revoke all on function public.list_review_queue(jsonb, text, boolean, integer, integer) from public, anon, authenticated, service_role;
revoke all on function public.list_review_groups(jsonb, boolean, integer, integer) from public, anon, authenticated, service_role;
grant execute on function private.list_review_queue(jsonb, text, boolean, integer, integer) to authenticated;
grant execute on function private.list_review_groups(jsonb, boolean, integer, integer) to authenticated;
grant execute on function public.list_review_queue(jsonb, text, boolean, integer, integer) to authenticated;
grant execute on function public.list_review_groups(jsonb, boolean, integer, integer) to authenticated;
