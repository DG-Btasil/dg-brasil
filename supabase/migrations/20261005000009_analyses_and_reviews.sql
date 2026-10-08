-- DG Brasil — 009: análises jurídicas e revisões humanas
--
-- Uma revisão tem exatamente UM alvo: versão de documento, análise ou proposta
-- de agente. Decisões são append-only; o status da revisão é sempre o efeito
-- da última decisão.
--
-- GATE HUMANO ("IA executa. Humano decide."): o status de uma revisão NUNCA
-- muda por UPDATE direto. A única porta é private.decide_review, que grava a
-- decisão (review_decisions), muda a revisão, avança a proposta do agente e
-- audita — tudo na mesma transação. Três barreiras independentes:
--   1. grants: authenticated não grava status/decided_at nem insere decisão;
--   2. trigger: revisão nasce PENDING e o status só muda dentro da decisão;
--   3. trigger de proposta (012): APPROVED exige revisão APPROVED.

create table public.legal_analyses (
  id                   uuid primary key default gen_random_uuid(),
  legal_case_id        uuid not null references public.legal_cases (id) on delete restrict,
  analysis_template_id uuid not null references public.analysis_templates (id) on delete restrict,
  status               text not null default 'PENDING' check (status in (
                         'PENDING', 'WAITING_DOCUMENTS', 'QUEUED', 'RUNNING', 'WAITING_REVIEW',
                         'COMPLETED', 'FAILED', 'CANCELLED')),
  summary              text,
  -- Valores dos campos do template (analysis_template_fields.key → valor).
  field_values         jsonb not null default '{}' check (jsonb_typeof(field_values) = 'object'),
  -- Saída estruturada. Nunca chain-of-thought.
  result_data          jsonb not null default '{}',
  agent_run_id         uuid,  -- FK em 012_agents
  interruption_reason  text,
  started_by           uuid references public.profiles (id) on delete restrict,
  started_at           timestamptz,
  completed_at         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint legal_analyses_completed_has_date check (status <> 'COMPLETED' or completed_at is not null)
);

create index legal_analyses_case_idx on public.legal_analyses (legal_case_id);

create trigger legal_analyses_set_updated_at
  before update on public.legal_analyses
  for each row execute function private.set_updated_at();

-- ───────────────────────────── revisões ───────────────────────────────────

create table public.reviews (
  id                   uuid primary key default gen_random_uuid(),
  -- Opcional só quando o alvo é proposta sem caso (ex.: UPDATE_SKILL, UPDATE_AGENT).
  legal_case_id        uuid references public.legal_cases (id) on delete restrict,
  legal_process_id     uuid,
  document_version_id  uuid references public.document_versions (id) on delete restrict,
  legal_analysis_id    uuid references public.legal_analyses (id) on delete restrict,
  agent_proposal_id    uuid,  -- FK em 012_agents
  status               text not null default 'PENDING' check (status in (
                         'PENDING', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED', 'REOPENED')),
  -- URGENT é prioridade, nunca status.
  priority             text not null default 'NORMAL' check (priority in ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
  assigned_reviewer_id uuid references public.profiles (id) on delete restrict,
  due_at               timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  decided_at           timestamptz,
  constraint reviews_process_fkey
    foreign key (legal_process_id, legal_case_id)
    references public.legal_processes (id, legal_case_id) on delete restrict,
  constraint reviews_exactly_one_target check (
    num_nonnulls(document_version_id, legal_analysis_id, agent_proposal_id) = 1
  ),
  constraint reviews_case_required check (legal_case_id is not null or agent_proposal_id is not null)
);

create index reviews_status_created_idx on public.reviews (status, created_at);
create index reviews_case_idx on public.reviews (legal_case_id);

-- No máximo uma revisão em aberto por alvo.
create unique index reviews_one_open_per_version on public.reviews (document_version_id)
  where document_version_id is not null and status in ('PENDING', 'REOPENED');
create unique index reviews_one_open_per_analysis on public.reviews (legal_analysis_id)
  where legal_analysis_id is not null and status in ('PENDING', 'REOPENED');
create unique index reviews_one_open_per_proposal on public.reviews (agent_proposal_id)
  where agent_proposal_id is not null and status in ('PENDING', 'REOPENED');

create trigger reviews_set_updated_at
  before update on public.reviews
  for each row execute function private.set_updated_at();

-- O alvo pertence ao caso da revisão.
create or replace function private.reviews_validate_target()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.document_version_id is not null and not exists (
    select 1
    from public.document_versions v
    join public.documents d on d.id = v.document_id
    join public.legal_cases c on c.client_id = d.client_id
    where v.id = new.document_version_id and c.id = new.legal_case_id
  ) then
    raise exception 'A versão revisada não é de documento do cliente deste caso' using errcode = '23514';
  end if;

  if new.legal_analysis_id is not null and not exists (
    select 1 from public.legal_analyses a
    where a.id = new.legal_analysis_id and a.legal_case_id = new.legal_case_id
  ) then
    raise exception 'A análise revisada é de outro caso' using errcode = '23514';
  end if;

  if new.agent_proposal_id is not null and exists (
    select 1 from public.agent_proposals p
    where p.id = new.agent_proposal_id
      and p.legal_case_id is distinct from new.legal_case_id
  ) then
    raise exception 'A revisão precisa ser do mesmo caso da proposta' using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' and (
       new.document_version_id is distinct from old.document_version_id
    or new.legal_analysis_id   is distinct from old.legal_analysis_id
    or new.agent_proposal_id   is distinct from old.agent_proposal_id
    or new.legal_case_id       is distinct from old.legal_case_id
  ) then
    raise exception 'O alvo de uma revisão não muda: abra outra revisão' using errcode = '23514';
  end if;

  return new;
end
$$;

create trigger reviews_validate_target
  before insert or update on public.reviews
  for each row execute function private.reviews_validate_target();

-- Barreira 2 do gate: revisão nasce PENDING; status e decided_at só mudam
-- dentro de review_decisions_apply (que marca a transação com o id da revisão).
create or replace function private.reviews_guard_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'PENDING' or new.decided_at is not null then
      raise exception 'Revisão nasce PENDING, sem decisão' using errcode = '42501';
    end if;
    return new;
  end if;

  if (new.status is distinct from old.status or new.decided_at is distinct from old.decided_at)
     and coalesce(current_setting('dg.review_decision_review_id', true), '') <> new.id::text then
    raise exception 'Status de revisão só muda por decisão registrada (decide_review)' using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger reviews_guard_status
  before insert or update on public.reviews
  for each row execute function private.reviews_guard_status();

-- ───────────────────────────── decisões (append-only) ─────────────────────

create table public.review_decisions (
  id         uuid primary key default gen_random_uuid(),
  review_id  uuid not null references public.reviews (id) on delete restrict,
  decision   text not null check (decision in ('APPROVE', 'REJECT', 'REQUEST_CHANGES', 'REOPEN')),
  notes      text,
  decided_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint review_decisions_reason_required check (
    decision not in ('REJECT', 'REQUEST_CHANGES') or nullif(btrim(notes), '') is not null
  )
);

create index review_decisions_review_idx on public.review_decisions (review_id, created_at);

create trigger review_decisions_append_only
  before update or delete on public.review_decisions
  for each row execute function private.prevent_mutation();

-- Valida quem decide e a transição; aplica o novo status à revisão.
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

create trigger review_decisions_validate
  before insert on public.review_decisions
  for each row execute function private.review_decisions_apply();

create trigger review_decisions_apply_status
  after insert on public.review_decisions
  for each row execute function private.review_decisions_apply();

-- A operação de decisão: decisão → status da revisão → proposta → auditoria,
-- numa transação só. Usuário logado decide em nome próprio (auth.uid()); o
-- backend com service role informa p_actor e o banco revalida o papel dele.
create or replace function private.decide_review(
  p_review_id uuid,
  p_decision  text,
  p_notes     text default null,
  p_actor     uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor    uuid := private.resolve_actor(p_actor);
  v_decision uuid;
  v_proposal uuid;
begin
  insert into public.review_decisions (review_id, decision, notes, decided_by)
  values (p_review_id, p_decision, p_notes, v_actor)
  returning id into v_decision;

  -- Próxima etapa da proposta do agente (aplicar o efeito é do worker).
  select agent_proposal_id into v_proposal from public.reviews where id = p_review_id;
  if v_proposal is not null then
    if p_decision = 'APPROVE' then
      update public.agent_proposals set status = 'APPROVED' where id = v_proposal and status = 'PENDING';
    elsif p_decision = 'REJECT' then
      update public.agent_proposals set status = 'REJECTED' where id = v_proposal and status = 'PENDING';
    end if;
  end if;

  return v_decision;
end
$$;

-- ───────────────────────────── aprovação por versão ───────────────────────
-- Situação derivada (não gravada) de cada versão. Uma versão nova nasce sem
-- aprovação; a versão aprovada anterior continua APPROVED no histórico.

create view public.document_version_approvals
with (security_invoker = true)
as
select
  v.id as document_version_id,
  v.document_id,
  v.version_number,
  case
    when exists (select 1 from public.reviews r
                 where r.document_version_id = v.id and r.status = 'APPROVED') then 'APPROVED'
    when exists (select 1 from public.reviews r
                 where r.document_version_id = v.id and r.status = 'REJECTED') then 'REJECTED'
    when exists (select 1 from public.document_versions newer
                 where newer.document_id = v.document_id
                   and newer.version_number > v.version_number) then 'SUPERSEDED'
    else 'PENDING'
  end as approval_status
from public.document_versions v;

comment on view public.document_version_approvals is
  'Situação de aprovação derivada por versão. Aprovação nunca é herdada pela versão seguinte.';
