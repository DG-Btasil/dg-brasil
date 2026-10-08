-- DG Brasil — 014: auditoria (append-only) e acesso a dado pessoal (LGPD)
--
-- Os eventos de domínio são gravados por trigger, na mesma transação da
-- mudança: não existe caminho de escrita que escape da trilha. O backend
-- complementa com eventos que o banco não enxerga (ex.: DOCUMENT_DOWNLOADED),
-- chamando private.record_audit_event com a service role.
--
-- ATOR. Todo evento diz quem agiu (actor_type):
--   USER    usuário logado (auth.uid()), ou o backend agindo por um usuário
--           que ele já autenticou (dg.actor_user_id, ver private.resolve_actor);
--   AGENT   o worker executando/aplicando algo de uma execução de agente
--           (dg.agent_run_id) — agent_run_id fica no evento;
--   SYSTEM  rotina sem usuário nem agente (manutenção, importação).
-- Usuário logado nunca se passa por outro: com auth.uid() presente, as
-- variáveis dg.* de ator são ignoradas.
--
-- Contexto da requisição: o backend pode declarar, na transação,
--   set_config('dg.request_id', ..., true)
--   set_config('dg.ip_address', ..., true)
--   set_config('dg.user_agent', ..., true)
--
-- metadata guarda IDs, status, valores monetários e NOMES de campos alterados.
-- Nunca CPF, e-mail, telefone, conteúdo de documento, prompt, entrada do
-- agente ou raciocínio do modelo.

create table public.audit_events (
  id                    uuid primary key default gen_random_uuid(),
  actor_type            text not null check (actor_type in ('USER', 'AGENT', 'SYSTEM')),
  actor_user_id         uuid references public.profiles (id) on delete restrict,
  actor_organization_id uuid references public.organizations (id) on delete restrict,
  agent_run_id          uuid references public.agent_runs (id) on delete restrict,
  action                text not null check (action ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  entity_type           text not null,
  entity_id             uuid,
  request_id            text,
  metadata              jsonb not null default '{}',
  ip_address            inet,
  user_agent            text,
  created_at            timestamptz not null default now(),
  constraint audit_events_user_has_actor check (actor_type <> 'USER' or actor_user_id is not null),
  constraint audit_events_agent_has_run check (actor_type <> 'AGENT' or agent_run_id is not null)
);

create index audit_events_entity_idx on public.audit_events (entity_type, entity_id);
create index audit_events_actor_created_idx on public.audit_events (actor_user_id, created_at);
create index audit_events_agent_run_idx on public.audit_events (agent_run_id) where agent_run_id is not null;
create index audit_events_created_idx on public.audit_events (created_at desc);

create trigger audit_events_append_only
  before update or delete on public.audit_events
  for each row execute function private.prevent_mutation();

-- ───────────────────────────── quem está agindo ───────────────────────────

create or replace function private.current_actor()
returns table (actor_type text, actor_user_id uuid, actor_organization_id uuid, agent_run_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_user uuid;
  v_run  uuid := nullif(current_setting('dg.agent_run_id', true), '')::uuid;
begin
  if v_uid is not null then
    return query select 'USER'::text, v_uid, private.current_organization_id(), null::uuid;
    return;
  end if;

  v_user := nullif(current_setting('dg.actor_user_id', true), '')::uuid;
  if v_run is not null then
    return query select 'AGENT'::text, v_user, private.user_organization_id(v_user), v_run;
  elsif v_user is not null then
    return query select 'USER'::text, v_user, private.user_organization_id(v_user), null::uuid;
  else
    return query select 'SYSTEM'::text, null::uuid, null::uuid, null::uuid;
  end if;
end
$$;

-- ───────────────────────────── gravação ───────────────────────────────────

create or replace function private.record_audit_event(
  p_action      text,
  p_entity_type text,
  p_entity_id   uuid,
  p_metadata    jsonb default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id    uuid;
  v_actor record;
begin
  select * into v_actor from private.current_actor();

  insert into public.audit_events (
    actor_type, actor_user_id, actor_organization_id, agent_run_id,
    action, entity_type, entity_id, request_id, metadata, ip_address, user_agent
  ) values (
    v_actor.actor_type,
    v_actor.actor_user_id,
    v_actor.actor_organization_id,
    v_actor.agent_run_id,
    p_action,
    p_entity_type,
    p_entity_id,
    nullif(current_setting('dg.request_id', true), ''),
    coalesce(p_metadata, '{}'),
    nullif(current_setting('dg.ip_address', true), '')::inet,
    nullif(current_setting('dg.user_agent', true), '')
  )
  returning id into v_id;
  return v_id;
end
$$;

grant execute on function private.record_audit_event(text, text, uuid, jsonb) to service_role;

-- Nomes das colunas alteradas (sem os valores).
create or replace function private.changed_columns(p_old jsonb, p_new jsonb)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(n.key order by n.key), '{}')
  from jsonb_each(p_new) n
  where n.key not in ('updated_at', 'created_at')
    and n.value is distinct from p_old -> n.key
$$;

-- Remove elementos de um array de texto.
create or replace function private.text_array_minus(p_left text[], p_right text[])
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(x order by x), '{}')
  from unnest(p_left) x
  where not (x = any (p_right))
$$;

-- ───────────────────────────── trigger único ──────────────────────────────

create or replace function private.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  t       text := tg_table_name;
  o       jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  n       jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_cols  text[];
  v_id    uuid := coalesce((n ->> 'id')::uuid, (o ->> 'id')::uuid);
begin
  if tg_op = 'UPDATE' then
    v_cols := private.changed_columns(o, n);
    if cardinality(v_cols) = 0 then
      return null;
    end if;
  end if;

  case t
  -- ── clientes ───────────────────────────────────────────────────────────
  when 'clients' then
    if tg_op = 'INSERT' then
      perform private.record_audit_event('CLIENT_CREATED', t, v_id,
        jsonb_build_object('kind', n ->> 'kind', 'origin_organization_id', n ->> 'origin_organization_id'));
    else
      if 'origin_organization_id' = any (v_cols) then
        perform private.record_audit_event('CLIENT_ORIGIN_CHANGED', t, v_id,
          jsonb_build_object('from', o ->> 'origin_organization_id', 'to', n ->> 'origin_organization_id'));
      end if;
      if 'deleted_at' = any (v_cols) then
        perform private.record_audit_event(
          case when n ->> 'deleted_at' is null then 'CLIENT_RESTORED' else 'CLIENT_DELETED' end, t, v_id, '{}');
      end if;
      v_cols := private.text_array_minus(v_cols, array['origin_organization_id', 'deleted_at']);
      if cardinality(v_cols) > 0 then
        perform private.record_audit_event('CLIENT_UPDATED', t, v_id, jsonb_build_object('fields', v_cols));
      end if;
    end if;

  when 'individual_client_details', 'company_client_details', 'company_representatives',
       'company_shareholders', 'client_contacts', 'client_addresses' then
    perform private.record_audit_event('CLIENT_UPDATED', 'clients', (n ->> 'client_id')::uuid,
      jsonb_build_object('table', t, 'operation', tg_op, 'fields', coalesce(v_cols, '{}')));

  when 'client_internal_details' then
    perform private.record_audit_event(
      case
        when n ->> 'inactivation_reason' is not null
             and (tg_op = 'INSERT' or 'inactivation_reason' = any (v_cols)) then 'CLIENT_INACTIVATED'
        else 'CLIENT_INTERNAL_DETAILS_UPDATED'
      end,
      'clients', (n ->> 'client_id')::uuid,
      jsonb_build_object('fields', coalesce(v_cols, '{}'), 'inactivation_reason', n ->> 'inactivation_reason'));

  when 'client_organization_relationships' then
    perform private.record_audit_event(
      case when tg_op = 'INSERT' then 'CLIENT_RELATIONSHIP_CREATED' else 'CLIENT_RELATIONSHIP_CHANGED' end,
      'clients', (n ->> 'client_id')::uuid,
      jsonb_build_object('organization_id', n ->> 'organization_id', 'status', n ->> 'status'));

  -- ── casos ──────────────────────────────────────────────────────────────
  when 'legal_cases' then
    if tg_op = 'INSERT' then
      perform private.record_audit_event('CASE_CREATED', t, v_id, jsonb_build_object(
        'status', n ->> 'status',
        'client_id', n ->> 'client_id',
        'partner_organization_id', n ->> 'partner_organization_id',
        'origin_organization_id', n ->> 'origin_organization_id',
        'created_by_organization_id', n ->> 'created_by_organization_id'));
    else
      if 'status' = any (v_cols) then
        perform private.record_audit_event(
          case n ->> 'status'
            when 'SUBMITTED' then 'CASE_SUBMITTED'
            when 'ACCEPTED'  then 'CASE_ACCEPTED'
            when 'REJECTED'  then 'CASE_REJECTED'
            else 'CASE_STATUS_CHANGED'
          end,
          t, v_id,
          jsonb_build_object('from', o ->> 'status', 'to', n ->> 'status',
                             'assigned_lawyer_id', n ->> 'assigned_lawyer_id'));
      end if;
      if 'origin_organization_id' = any (v_cols) then
        perform private.record_audit_event('CASE_ORIGIN_CHANGED', t, v_id,
          jsonb_build_object('from', o ->> 'origin_organization_id', 'to', n ->> 'origin_organization_id',
                             'after_acceptance', (o ->> 'accepted_at') is not null,
                             'reason', nullif(current_setting('dg.case_origin_change_reason', true), '')));
      end if;
      if 'assigned_lawyer_id' = any (v_cols) then
        perform private.record_audit_event('CASE_LAWYER_ASSIGNED', t, v_id,
          jsonb_build_object('from', o ->> 'assigned_lawyer_id', 'to', n ->> 'assigned_lawyer_id'));
      end if;
      if 'partner_organization_id' = any (v_cols) then
        perform private.record_audit_event('CASE_PARTNER_CHANGED', t, v_id,
          jsonb_build_object('from', o ->> 'partner_organization_id', 'to', n ->> 'partner_organization_id'));
      end if;
      if 'deleted_at' = any (v_cols) then
        perform private.record_audit_event(
          case when n ->> 'deleted_at' is null then 'CASE_RESTORED' else 'CASE_DELETED' end, t, v_id, '{}');
      end if;
      v_cols := private.text_array_minus(v_cols, array['status', 'origin_organization_id',
                                     'assigned_lawyer_id', 'partner_organization_id', 'deleted_at']);
      if cardinality(v_cols) > 0 then
        perform private.record_audit_event('CASE_UPDATED', t, v_id, jsonb_build_object('fields', v_cols));
      end if;
    end if;

  when 'legal_case_internal_details' then
    perform private.record_audit_event('CASE_INTERNAL_DETAILS_UPDATED', 'legal_cases',
      (n ->> 'legal_case_id')::uuid, jsonb_build_object('operation', tg_op, 'fields', coalesce(v_cols, '{}')));

  when 'case_document_requirements' then
    if tg_op = 'INSERT' then
      perform private.record_audit_event('DOCUMENT_REQUIREMENT_CREATED', 'legal_cases',
        (n ->> 'legal_case_id')::uuid, jsonb_build_object('requirement_id', v_id,
          'category', n ->> 'category', 'status', n ->> 'status'));
    elsif 'status' = any (v_cols) or 'satisfied_by_document_version_id' = any (v_cols) then
      perform private.record_audit_event('DOCUMENT_REQUIREMENT_STATUS_CHANGED', 'legal_cases',
        (n ->> 'legal_case_id')::uuid, jsonb_build_object('requirement_id', v_id,
          'from', o ->> 'status', 'to', n ->> 'status',
          'satisfied_by_document_version_id', n ->> 'satisfied_by_document_version_id'));
    end if;

  -- ── processos ──────────────────────────────────────────────────────────
  when 'legal_processes' then
    perform private.record_audit_event(
      case
        when tg_op = 'INSERT' then 'PROCESS_CREATED'
        when 'deleted_at' = any (v_cols) and n ->> 'deleted_at' is not null then 'PROCESS_DELETED'
        else 'PROCESS_UPDATED'
      end,
      t, v_id,
      jsonb_build_object('legal_case_id', n ->> 'legal_case_id',
                         'technical_origin', n ->> 'technical_origin',
                         'fields', coalesce(v_cols, '{}')));

  when 'legal_process_internal_details' then
    perform private.record_audit_event('PROCESS_INTERNAL_DETAILS_UPDATED', 'legal_processes',
      (n ->> 'legal_process_id')::uuid, jsonb_build_object('operation', tg_op, 'fields', coalesce(v_cols, '{}')));

  -- Movimentação de tribunal/importação chega em volume e já tem procedência
  -- (integração, import_job): só se audita o que a equipe, um agente ou o
  -- sistema registraram, e qualquer alteração.
  when 'process_events' then
    if tg_op = 'UPDATE' or n ->> 'source' in ('MANUAL', 'AGENT', 'SYSTEM') then
      perform private.record_audit_event(
        case when tg_op = 'INSERT' then 'PROCESS_EVENT_CREATED' else 'PROCESS_EVENT_UPDATED' end,
        'legal_processes', (n ->> 'legal_process_id')::uuid,
        jsonb_build_object('process_event_id', v_id, 'source', n ->> 'source',
                           'event_type', n ->> 'event_type', 'fields', coalesce(v_cols, '{}')));
    end if;

  when 'deadlines' then
    perform private.record_audit_event(
      case
        when tg_op = 'INSERT' then 'DEADLINE_CREATED'
        when 'status' = any (v_cols) and n ->> 'status' = 'COMPLETED' then 'DEADLINE_COMPLETED'
        when 'status' = any (v_cols) then 'DEADLINE_STATUS_CHANGED'
        else 'DEADLINE_UPDATED'
      end,
      t, v_id,
      jsonb_build_object('legal_case_id', n ->> 'legal_case_id', 'legal_process_id', n ->> 'legal_process_id',
                         'source', n ->> 'source', 'from', o ->> 'status', 'to', n ->> 'status',
                         'fields', coalesce(v_cols, '{}')));

  -- ── documentos ─────────────────────────────────────────────────────────
  when 'documents' then
    if tg_op = 'INSERT' then
      perform private.record_audit_event('DOCUMENT_CREATED', t, v_id, jsonb_build_object(
        'client_id', n ->> 'client_id', 'category', n ->> 'category', 'visibility', n ->> 'visibility'));
    elsif 'visibility' = any (v_cols) then
      perform private.record_audit_event('DOCUMENT_VISIBILITY_CHANGED', t, v_id,
        jsonb_build_object('from', o ->> 'visibility', 'to', n ->> 'visibility'));
    else
      perform private.record_audit_event('DOCUMENT_UPDATED', t, v_id, jsonb_build_object('fields', v_cols));
    end if;

  when 'document_versions' then
    perform private.record_audit_event(
      case when n ->> 'source' = 'UPLOAD' then 'DOCUMENT_UPLOADED' else 'DOCUMENT_VERSION_CREATED' end,
      'documents', (n ->> 'document_id')::uuid,
      jsonb_build_object('document_version_id', v_id,
                         'version_number', (n ->> 'version_number')::int,
                         'source', n ->> 'source'));

  when 'document_version_verifications' then
    perform private.record_audit_event(
      case n ->> 'status' when 'VERIFIED' then 'DOCUMENT_VERIFIED' else 'DOCUMENT_VERIFICATION_FAILED' end,
      'document_versions', (n ->> 'document_version_id')::uuid,
      jsonb_build_object('verification_id', v_id, 'source', n ->> 'verification_source'));

  when 'case_documents' then
    perform private.record_audit_event('DOCUMENT_LINKED_TO_CASE', 'documents', (n ->> 'document_id')::uuid,
      jsonb_build_object('legal_case_id', n ->> 'legal_case_id'));

  when 'process_documents' then
    perform private.record_audit_event('DOCUMENT_LINKED_TO_PROCESS', 'documents', (n ->> 'document_id')::uuid,
      jsonb_build_object('legal_process_id', n ->> 'legal_process_id'));

  -- ── análises e revisões ────────────────────────────────────────────────
  when 'legal_analyses' then
    perform private.record_audit_event(
      case
        when tg_op = 'INSERT' then 'ANALYSIS_STARTED'
        when 'status' = any (v_cols) then 'ANALYSIS_STATUS_CHANGED'
        else 'ANALYSIS_UPDATED'
      end,
      t, v_id,
      jsonb_build_object('legal_case_id', n ->> 'legal_case_id', 'from', o ->> 'status', 'to', n ->> 'status',
                         'agent_run_id', n ->> 'agent_run_id', 'fields', coalesce(v_cols, '{}')));

  -- O status da revisão é auditado pela decisão (review_decisions).
  when 'reviews' then
    if tg_op = 'INSERT' then
      perform private.record_audit_event('REVIEW_CREATED', t, v_id, jsonb_build_object(
        'legal_case_id', n ->> 'legal_case_id',
        'document_version_id', n ->> 'document_version_id',
        'legal_analysis_id', n ->> 'legal_analysis_id',
        'agent_proposal_id', n ->> 'agent_proposal_id',
        'priority', n ->> 'priority'));
    else
      v_cols := private.text_array_minus(v_cols, array['status', 'decided_at']);
      if cardinality(v_cols) > 0 then
        perform private.record_audit_event('REVIEW_UPDATED', t, v_id, jsonb_build_object('fields', v_cols));
      end if;
    end if;

  when 'review_decisions' then
    perform private.record_audit_event(
      case n ->> 'decision'
        when 'APPROVE'         then 'REVIEW_APPROVED'
        when 'REJECT'          then 'REVIEW_REJECTED'
        when 'REQUEST_CHANGES' then 'REVIEW_CHANGES_REQUESTED'
        when 'REOPEN'          then 'REVIEW_REOPENED'
      end,
      'reviews', (n ->> 'review_id')::uuid,
      jsonb_build_object('review_decision_id', v_id, 'decided_by', n ->> 'decided_by'));

  -- ── agentes: execuções e propostas ─────────────────────────────────────
  when 'agent_runs' then
    if tg_op = 'INSERT' then
      perform private.record_audit_event('AGENT_RUN_REQUESTED', t, v_id, jsonb_build_object(
        'agent_id', n ->> 'agent_id', 'agent_version_id', n ->> 'agent_version_id',
        'legal_case_id', n ->> 'legal_case_id', 'requested_by', n ->> 'requested_by',
        'operation', n ->> 'operation'));
    elsif 'status' = any (v_cols) then
      -- Só mudança de estado. Batimento (heartbeat) e métricas não viram evento.
      perform private.record_audit_event('AGENT_RUN_' || (n ->> 'status'), t, v_id,
        jsonb_build_object('from', o ->> 'status', 'attempt', (n ->> 'attempt')::int,
                           'error_code', n ->> 'error_code'));
    end if;

  when 'agent_proposals' then
    if tg_op = 'INSERT' then
      perform private.record_audit_event('AGENT_PROPOSAL_CREATED', t, v_id, jsonb_build_object(
        'agent_run_id', n ->> 'agent_run_id', 'proposal_type', n ->> 'proposal_type',
        'legal_case_id', n ->> 'legal_case_id'));
    elsif 'status' = any (v_cols) then
      perform private.record_audit_event('AGENT_PROPOSAL_' || (n ->> 'status'), t, v_id,
        jsonb_build_object('from', o ->> 'status', 'proposal_type', n ->> 'proposal_type',
                           'applied_entity_type', n ->> 'applied_entity_type',
                           'applied_entity_id', n ->> 'applied_entity_id'));
    end if;

  -- ── parceiros ──────────────────────────────────────────────────────────
  when 'partner_requests' then
    if tg_op = 'INSERT' then
      perform private.record_audit_event('PARTNER_REQUEST_CREATED', t, v_id, jsonb_build_object(
        'partner_organization_id', n ->> 'partner_organization_id', 'legal_case_id', n ->> 'legal_case_id'));
    elsif 'status' = any (v_cols) then
      perform private.record_audit_event('PARTNER_REQUEST_' || (n ->> 'status'), t, v_id,
        jsonb_build_object('from', o ->> 'status'));
    end if;

  when 'partner_office_settings' then
    if tg_op = 'INSERT' then
      perform private.record_audit_event('PARTNER_SETTINGS_CREATED', 'organizations',
        (n ->> 'organization_id')::uuid, jsonb_build_object(
          'partner_percentage', n -> 'default_partner_percentage',
          'owner_percentage', n -> 'default_owner_percentage'));
    elsif 'default_partner_percentage' = any (v_cols) or 'default_owner_percentage' = any (v_cols) then
      perform private.record_audit_event('PARTNER_SHARE_CHANGED', 'organizations',
        (n ->> 'organization_id')::uuid, jsonb_build_object(
          'before', jsonb_build_object('partner', o -> 'default_partner_percentage',
                                       'owner', o -> 'default_owner_percentage'),
          'after', jsonb_build_object('partner', n -> 'default_partner_percentage',
                                      'owner', n -> 'default_owner_percentage'),
          'preserved_agreements', (select count(*) from public.case_partnership_agreements a
                                   where a.partner_organization_id = (n ->> 'organization_id')::uuid
                                     and a.cancelled_at is null)));
    else
      perform private.record_audit_event('PARTNER_SETTINGS_UPDATED', 'organizations',
        (n ->> 'organization_id')::uuid, jsonb_build_object('fields', v_cols));
    end if;

  -- ── financeiro ─────────────────────────────────────────────────────────
  when 'case_partnership_agreements' then
    perform private.record_audit_event(
      case when tg_op = 'INSERT' then 'PARTNERSHIP_AGREEMENT_CREATED' else 'PARTNERSHIP_AGREEMENT_CANCELLED' end,
      t, v_id,
      jsonb_build_object('legal_case_id', n ->> 'legal_case_id',
                         'partner_organization_id', n ->> 'partner_organization_id',
                         'partner_percentage', n -> 'partner_percentage',
                         'owner_percentage', n -> 'owner_percentage',
                         'cancellation_reason', n ->> 'cancellation_reason'));

  when 'financial_agreements' then
    perform private.record_audit_event(
      case when tg_op = 'INSERT' then 'FINANCIAL_AGREEMENT_CREATED' else 'FINANCIAL_AGREEMENT_UPDATED' end,
      t, v_id,
      jsonb_build_object('legal_case_id', n ->> 'legal_case_id', 'status', n ->> 'status',
                         'fields', coalesce(v_cols, '{}')));

  when 'payments' then
    perform private.record_audit_event(
      case
        when tg_op = 'INSERT' then 'PAYMENT_REGISTERED'
        when 'cancelled_at' = any (v_cols) then 'PAYMENT_CANCELLED'
        when 'due_date' = any (v_cols) then 'PAYMENT_DUE_DATE_CHANGED'
        else 'PAYMENT_UPDATED'
      end,
      t, v_id,
      jsonb_build_object('financial_agreement_id', n ->> 'financial_agreement_id',
                         'amount', n -> 'amount', 'fields', coalesce(v_cols, '{}')));

  when 'payment_receipts' then
    perform private.record_audit_event(
      case n ->> 'kind'
        when 'RECEIPT'  then 'PAYMENT_RECEIPT_RECORDED'
        when 'REVERSAL' then 'PAYMENT_RECEIPT_REVERSED'
        else 'PAYMENT_RECEIPT_ADJUSTED'
      end,
      'payments', (n ->> 'payment_id')::uuid,
      jsonb_build_object('receipt_id', v_id, 'kind', n ->> 'kind', 'amount', n -> 'amount',
                         'original_receipt_id', n ->> 'original_receipt_id'));

  when 'partner_revenue_allocations' then
    perform private.record_audit_event('PARTNER_REVENUE_ALLOCATED', 'case_partnership_agreements',
      (n ->> 'case_partnership_agreement_id')::uuid,
      jsonb_build_object('allocation_id', v_id, 'receipt_id', n ->> 'receipt_id',
                         'base_amount', n -> 'base_amount', 'partner_amount', n -> 'partner_amount',
                         'owner_amount', n -> 'owner_amount'));

  when 'partner_transfers' then
    perform private.record_audit_event(
      case
        when tg_op = 'INSERT' then 'PARTNER_TRANSFER_REGISTERED'
        when 'status' = any (v_cols) and n ->> 'status' = 'CANCELLED' then 'PARTNER_TRANSFER_CANCELLED'
        when 'status' = any (v_cols) and n ->> 'status' = 'PAID' then 'PARTNER_TRANSFER_PAID'
        else 'PARTNER_TRANSFER_UPDATED'
      end,
      t, v_id,
      jsonb_build_object('partner_organization_id', n ->> 'partner_organization_id',
                         'amount', n -> 'amount', 'status', n ->> 'status'));

  when 'partner_transfer_items' then
    perform private.record_audit_event('PARTNER_TRANSFER_ITEM_ADDED', 'partner_transfers',
      (n ->> 'transfer_id')::uuid,
      jsonb_build_object('allocation_id', n ->> 'allocation_id', 'amount', n -> 'amount'));

  -- ── DG Brasil ──────────────────────────────────────────────────────────
  when 'agents', 'skills', 'legal_theses', 'reference_materials' then
    perform private.record_audit_event(
      case
        when t = 'reference_materials' and tg_op = 'INSERT' then 'REFERENCE_CREATED'
        when t = 'reference_materials' then 'REFERENCE_UPDATED'
        when t = 'agents' then case when tg_op = 'INSERT' then 'AGENT_CREATED' else 'AGENT_UPDATED' end
        when t = 'skills' then case when tg_op = 'INSERT' then 'SKILL_CREATED' else 'SKILL_UPDATED' end
        else case when tg_op = 'INSERT' then 'THESIS_CREATED' else 'THESIS_UPDATED' end
      end,
      t, v_id, jsonb_build_object('fields', coalesce(v_cols, '{}'), 'status', n ->> 'status'));

  when 'agent_versions' then
    perform private.record_audit_event('AGENT_UPDATED', 'agents', (n ->> 'agent_id')::uuid,
      jsonb_build_object('agent_version_id', v_id, 'version_number', (n ->> 'version_number')::int));
  when 'skill_versions' then
    perform private.record_audit_event('SKILL_UPDATED', 'skills', (n ->> 'skill_id')::uuid,
      jsonb_build_object('skill_version_id', v_id, 'version_number', (n ->> 'version_number')::int));
  when 'legal_thesis_versions' then
    perform private.record_audit_event('THESIS_UPDATED', 'legal_theses', (n ->> 'legal_thesis_id')::uuid,
      jsonb_build_object('legal_thesis_version_id', v_id, 'version_number', (n ->> 'version_number')::int));
  when 'reference_material_versions' then
    perform private.record_audit_event('REFERENCE_UPDATED', 'reference_materials',
      (n ->> 'reference_material_id')::uuid,
      jsonb_build_object('reference_material_version_id', v_id, 'version_number', (n ->> 'version_number')::int));

  -- Vínculos da configuração de IA (sem id próprio: entidade = primeiro lado).
  when 'agent_skill_bindings', 'agent_thesis_bindings', 'agent_reference_bindings' then
    perform private.record_audit_event('AGENT_BINDING_CHANGED', 'agents', (n ->> 'agent_id')::uuid,
      jsonb_build_object('table', t, 'operation', tg_op, 'enabled', n -> 'enabled',
                         'fields', coalesce(v_cols, '{}')));
  when 'thesis_skill_bindings', 'thesis_reference_bindings' then
    perform private.record_audit_event('THESIS_BINDING_CHANGED', 'legal_theses', (n ->> 'legal_thesis_id')::uuid,
      jsonb_build_object('table', t, 'operation', tg_op, 'enabled', n -> 'enabled'));
  when 'skill_reference_bindings' then
    perform private.record_audit_event('SKILL_BINDING_CHANGED', 'skills', (n ->> 'skill_id')::uuid,
      jsonb_build_object('table', t, 'operation', tg_op, 'enabled', n -> 'enabled'));

  -- ── integrações e importação ───────────────────────────────────────────
  when 'integration_connections' then
    perform private.record_audit_event(
      case when tg_op = 'INSERT' then 'INTEGRATION_CREATED' else 'INTEGRATION_UPDATED' end,
      t, v_id, jsonb_build_object('type', n ->> 'type', 'provider', n ->> 'provider',
                                  'status', n ->> 'status', 'fields', coalesce(v_cols, '{}')));

  when 'judicial_monitors' then
    perform private.record_audit_event('JUDICIAL_SOURCE_CONFIGURED', 'integration_connections',
      (n ->> 'integration_connection_id')::uuid,
      jsonb_build_object('judicial_monitor_id', v_id, 'active', n -> 'active', 'fields', coalesce(v_cols, '{}')));

  when 'import_jobs' then
    if tg_op = 'INSERT' then
      perform private.record_audit_event('IMPORT_JOB_CREATED', t, v_id,
        jsonb_build_object('file_type', n ->> 'file_type'));
    elsif 'status' = any (v_cols) then
      perform private.record_audit_event('IMPORT_JOB_' || (n ->> 'status'), t, v_id,
        jsonb_build_object('from', o ->> 'status', 'total_rows', n -> 'total_rows',
                           'successful_rows', n -> 'successful_rows', 'failed_rows', n -> 'failed_rows'));
    end if;

  when 'import_conflicts' then
    if tg_op = 'UPDATE' and 'resolution' = any (v_cols) then
      perform private.record_audit_event('IMPORT_CONFLICT_RESOLVED', 'import_jobs', (n ->> 'import_job_id')::uuid,
        jsonb_build_object('conflict_id', v_id, 'kind', n ->> 'conflict_kind', 'resolution', n ->> 'resolution'));
    end if;

  -- ── usuários e organizações ────────────────────────────────────────────
  when 'profiles' then
    if tg_op = 'INSERT' then
      perform private.record_audit_event('PROFILE_CREATED', t, v_id, '{}');
    else
      if 'active' = any (v_cols) then
        perform private.record_audit_event(
          case when (n ->> 'active')::boolean then 'USER_REACTIVATED' else 'USER_DEACTIVATED' end, t, v_id, '{}');
      end if;
      v_cols := private.text_array_minus(v_cols, array['active']);
      if cardinality(v_cols) > 0 then
        perform private.record_audit_event('PROFILE_UPDATED', t, v_id, jsonb_build_object('fields', v_cols));
      end if;
    end if;

  when 'user_invitations' then
    perform private.record_audit_event(
      case
        when tg_op = 'INSERT' then 'USER_INVITED'
        when 'accepted_at' = any (v_cols) then 'INVITATION_ACCEPTED'
        when 'revoked_at' = any (v_cols) then 'INVITATION_REVOKED'
        else 'INVITATION_UPDATED'
      end,
      t, v_id,
      jsonb_build_object('organization_id', n ->> 'organization_id', 'role', n ->> 'role'));

  when 'organization_memberships' then
    if tg_op = 'INSERT' then
      perform private.record_audit_event('MEMBERSHIP_CREATED', t, v_id, jsonb_build_object(
        'organization_id', n ->> 'organization_id', 'user_id', n ->> 'user_id', 'role', n ->> 'role'));
    else
      if 'role' = any (v_cols) then
        perform private.record_audit_event('ROLE_CHANGED', t, v_id, jsonb_build_object(
          'user_id', n ->> 'user_id', 'from', o ->> 'role', 'to', n ->> 'role'));
      end if;
      if 'status' = any (v_cols) then
        perform private.record_audit_event('MEMBERSHIP_STATUS_CHANGED', t, v_id, jsonb_build_object(
          'user_id', n ->> 'user_id', 'from', o ->> 'status', 'to', n ->> 'status'));
      end if;
    end if;

  when 'organizations' then
    if tg_op = 'INSERT' then
      perform private.record_audit_event('ORGANIZATION_CREATED', t, v_id,
        jsonb_build_object('type', n ->> 'type', 'status', n ->> 'status'));
    elsif 'status' = any (v_cols) then
      perform private.record_audit_event('ORGANIZATION_STATUS_CHANGED', t, v_id,
        jsonb_build_object('from', o ->> 'status', 'to', n ->> 'status'));
    else
      perform private.record_audit_event('ORGANIZATION_UPDATED', t, v_id, jsonb_build_object('fields', v_cols));
    end if;

  when 'owner_office_settings' then
    perform private.record_audit_event('ORGANIZATION_UPDATED', 'organizations', (n ->> 'organization_id')::uuid,
      jsonb_build_object('table', t, 'fields', coalesce(v_cols, '{}')));

  else
    raise exception 'audit_row_change sem regra para %', t;
  end case;

  return null;
end
$$;

-- ───────────────────────────── ligação dos triggers ───────────────────────
-- Fora da trilha, de propósito: notificações (volume alto, sem valor de prova),
-- preferências do usuário, catálogo (áreas, categorias, templates) e
-- agent_run_inputs (conteúdo livre; a execução já é auditada).

do $$
declare
  t text;
begin
  foreach t in array array[
    'organizations', 'owner_office_settings', 'partner_office_settings', 'organization_memberships',
    'user_invitations', 'profiles',
    'clients', 'client_internal_details', 'individual_client_details', 'company_client_details',
    'company_representatives', 'company_shareholders', 'client_contacts', 'client_addresses',
    'client_organization_relationships',
    'legal_cases', 'legal_case_internal_details', 'case_document_requirements',
    'legal_processes', 'legal_process_internal_details', 'process_events', 'deadlines',
    'documents', 'document_versions', 'document_version_verifications', 'case_documents', 'process_documents',
    'legal_analyses', 'reviews', 'review_decisions', 'agent_runs', 'agent_proposals', 'partner_requests',
    'case_partnership_agreements', 'financial_agreements', 'payments', 'payment_receipts',
    'partner_revenue_allocations', 'partner_transfers', 'partner_transfer_items',
    'agents', 'skills', 'legal_theses', 'reference_materials',
    'agent_versions', 'skill_versions', 'legal_thesis_versions', 'reference_material_versions',
    'agent_skill_bindings', 'agent_thesis_bindings', 'agent_reference_bindings',
    'thesis_skill_bindings', 'thesis_reference_bindings', 'skill_reference_bindings',
    'integration_connections', 'judicial_monitors', 'import_jobs', 'import_conflicts'
  ]
  loop
    execute format(
      'create trigger %I after insert or update on public.%I
         for each row execute function private.audit_row_change()',
      t || '_audit', t);
  end loop;
end
$$;

-- ───────────────────────────── acesso a dado pessoal (LGPD) ───────────────
-- Quem abriu a ficha de qual titular, baixou qual documento, exportou o quê.
-- Só IDs e a ação: nunca o dado em si. Append-only. Abertura repetida da mesma
-- ficha pelo mesmo usuário em 10 minutos não gera evento novo (evita milhões de
-- linhas sem valor de prova).

create table public.personal_data_access_events (
  id              uuid primary key default gen_random_uuid(),
  actor_type      text not null check (actor_type in ('USER', 'AGENT', 'SYSTEM')),
  actor_user_id   uuid references public.profiles (id) on delete restrict,
  organization_id uuid references public.organizations (id) on delete restrict,
  agent_run_id    uuid references public.agent_runs (id) on delete restrict,
  client_id       uuid not null references public.clients (id) on delete restrict,
  resource_type   text not null check (resource_type in (
                    'CLIENT', 'DOCUMENT', 'DOCUMENT_VERSION', 'LEGAL_CASE', 'LEGAL_PROCESS', 'EXPORT', 'REPORT')),
  resource_id     uuid,
  action          text not null check (action in ('VIEW_DETAIL', 'DOWNLOAD', 'EXPORT', 'PRINT', 'ADMIN_ACCESS')),
  purpose         text check (purpose is null or length(purpose) <= 500),
  request_id      text,
  created_at      timestamptz not null default now(),
  constraint personal_data_access_events_user_has_actor
    check (actor_type <> 'USER' or actor_user_id is not null)
);

create index personal_data_access_events_client_idx
  on public.personal_data_access_events (client_id, created_at desc);
create index personal_data_access_events_actor_idx
  on public.personal_data_access_events (actor_user_id, created_at desc);

create trigger personal_data_access_events_append_only
  before update or delete on public.personal_data_access_events
  for each row execute function private.prevent_mutation();

create or replace function private.record_personal_data_access(
  p_client_id     uuid,
  p_resource_type text,
  p_resource_id   uuid,
  p_action        text,
  p_purpose       text default null,
  p_actor         uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_user uuid;
  v_actor      record;
  v_existing   uuid;
  v_id         uuid;
begin
  -- Usuário logado registra o próprio acesso; backend informa o usuário.
  if auth.uid() is not null or p_actor is not null then
    v_actor_user := private.resolve_actor(p_actor);
  end if;
  select * into v_actor from private.current_actor();

  -- Usuário logado só registra acesso a titular que ele pode acessar.
  if auth.uid() is not null and not private.can_access_client(p_client_id) then
    raise exception 'Sem acesso a este cliente' using errcode = '42501';
  end if;

  if p_action = 'VIEW_DETAIL' then
    select e.id into v_existing
    from public.personal_data_access_events e
    where e.client_id = p_client_id
      and e.actor_user_id is not distinct from v_actor.actor_user_id
      and e.resource_type = p_resource_type
      and e.resource_id is not distinct from p_resource_id
      and e.action = 'VIEW_DETAIL'
      and e.created_at > now() - interval '10 minutes'
    order by e.created_at desc
    limit 1;
    if v_existing is not null then
      return v_existing;
    end if;
  end if;

  insert into public.personal_data_access_events
    (actor_type, actor_user_id, organization_id, agent_run_id, client_id,
     resource_type, resource_id, action, purpose, request_id)
  values
    (v_actor.actor_type, v_actor.actor_user_id, v_actor.actor_organization_id, v_actor.agent_run_id, p_client_id,
     p_resource_type, p_resource_id, p_action, p_purpose, nullif(current_setting('dg.request_id', true), ''))
  returning id into v_id;
  return v_id;
end
$$;
