-- DG Brasil — 014: auditoria (append-only)
--
-- Os eventos de domínio são gravados por trigger, na mesma transação da
-- mudança: não existe caminho de escrita que escape da trilha. O backend
-- complementa com eventos que o banco não enxerga (ex.: DOCUMENT_DOWNLOADED),
-- chamando private.record_audit_event com a service role.
--
-- Contexto da requisição: o backend pode declarar, na transação,
--   set_config('dg.request_id', ..., true)
--   set_config('dg.ip_address', ..., true)
--   set_config('dg.user_agent', ..., true)
--
-- metadata guarda IDs, status e NOMES de campos alterados. Nunca valores de
-- CPF, e-mail, telefone, conteúdo de documento ou prompt.

create table public.audit_events (
  id                    uuid primary key default gen_random_uuid(),
  actor_user_id         uuid references public.profiles (id) on delete restrict,
  actor_organization_id uuid references public.organizations (id) on delete restrict,
  action                text not null check (action ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  entity_type           text not null,
  entity_id             uuid,
  request_id            text,
  metadata              jsonb not null default '{}',
  ip_address            inet,
  user_agent            text,
  created_at            timestamptz not null default now()
);

create index audit_events_entity_idx on public.audit_events (entity_type, entity_id);
create index audit_events_actor_created_idx on public.audit_events (actor_user_id, created_at);
create index audit_events_created_idx on public.audit_events (created_at desc);

create trigger audit_events_append_only
  before update or delete on public.audit_events
  for each row execute function private.prevent_mutation();

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
  v_id uuid;
begin
  insert into public.audit_events (
    actor_user_id, actor_organization_id, action, entity_type, entity_id,
    request_id, metadata, ip_address, user_agent
  ) values (
    auth.uid(),
    private.current_organization_id(),
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
        v_cols := array_remove(v_cols, 'origin_organization_id');
      end if;
      if cardinality(v_cols) > 0 then
        perform private.record_audit_event('CLIENT_UPDATED', t, v_id, jsonb_build_object('fields', v_cols));
      end if;
    end if;

  when 'individual_client_details', 'company_client_details',
       'company_representatives', 'client_contacts', 'client_addresses' then
    perform private.record_audit_event('CLIENT_UPDATED', 'clients', (n ->> 'client_id')::uuid,
      jsonb_build_object('table', t, 'operation', tg_op, 'fields', coalesce(v_cols, '{}')));

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
                             'after_acceptance', (o ->> 'accepted_at') is not null));
      end if;
      if 'assigned_lawyer_id' = any (v_cols) then
        perform private.record_audit_event('CASE_LAWYER_ASSIGNED', t, v_id,
          jsonb_build_object('from', o ->> 'assigned_lawyer_id', 'to', n ->> 'assigned_lawyer_id'));
      end if;
      if 'partner_organization_id' = any (v_cols) then
        perform private.record_audit_event('CASE_PARTNER_CHANGED', t, v_id,
          jsonb_build_object('from', o ->> 'partner_organization_id', 'to', n ->> 'partner_organization_id'));
      end if;
      v_cols := private.text_array_minus(v_cols, array['status', 'origin_organization_id',
                                     'assigned_lawyer_id', 'partner_organization_id']);
      if cardinality(v_cols) > 0 then
        perform private.record_audit_event('CASE_UPDATED', t, v_id, jsonb_build_object('fields', v_cols));
      end if;
    end if;

  -- ── processos ──────────────────────────────────────────────────────────
  when 'legal_processes' then
    perform private.record_audit_event(
      case when tg_op = 'INSERT' then 'PROCESS_CREATED' else 'PROCESS_UPDATED' end,
      t, v_id,
      jsonb_build_object('legal_case_id', n ->> 'legal_case_id',
                         'technical_origin', n ->> 'technical_origin',
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

  -- ── revisões ───────────────────────────────────────────────────────────
  when 'review_decisions' then
    perform private.record_audit_event(
      case n ->> 'decision'
        when 'APPROVE'         then 'REVIEW_APPROVED'
        when 'REJECT'          then 'REVIEW_REJECTED'
        when 'REQUEST_CHANGES' then 'REVIEW_CHANGES_REQUESTED'
        when 'REOPEN'          then 'REVIEW_REOPENED'
      end,
      'reviews', (n ->> 'review_id')::uuid,
      jsonb_build_object('review_decision_id', v_id));

  when 'agent_proposals' then
    if tg_op = 'UPDATE' and 'status' = any (v_cols) then
      perform private.record_audit_event('AGENT_PROPOSAL_' || (n ->> 'status'), t, v_id,
        jsonb_build_object('from', o ->> 'status', 'proposal_type', n ->> 'proposal_type'));
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
                                   where a.partner_organization_id = (n ->> 'organization_id')::uuid)));
    else
      perform private.record_audit_event('PARTNER_SETTINGS_UPDATED', 'organizations',
        (n ->> 'organization_id')::uuid, jsonb_build_object('fields', v_cols));
    end if;

  -- ── financeiro ─────────────────────────────────────────────────────────
  when 'case_partnership_agreements' then
    perform private.record_audit_event(
      case when tg_op = 'INSERT' then 'PARTNERSHIP_AGREEMENT_CREATED' else 'PARTNERSHIP_AGREEMENT_CHANGED' end,
      t, v_id,
      jsonb_build_object('legal_case_id', n ->> 'legal_case_id',
                         'partner_organization_id', n ->> 'partner_organization_id',
                         'partner_percentage', n -> 'partner_percentage',
                         'owner_percentage', n -> 'owner_percentage',
                         'before', case when tg_op = 'UPDATE' then jsonb_build_object(
                                     'partner_percentage', o -> 'partner_percentage',
                                     'owner_percentage', o -> 'owner_percentage') end));

  when 'financial_agreements' then
    perform private.record_audit_event(
      case when tg_op = 'INSERT' then 'FINANCIAL_AGREEMENT_CREATED' else 'FINANCIAL_AGREEMENT_UPDATED' end,
      t, v_id,
      jsonb_build_object('legal_case_id', n ->> 'legal_case_id', 'status', n ->> 'status',
                         'fields', coalesce(v_cols, '{}')));

  when 'payments' then
    perform private.record_audit_event(
      case when tg_op = 'INSERT' then 'PAYMENT_REGISTERED' else 'PAYMENT_UPDATED' end,
      t, v_id,
      jsonb_build_object('financial_agreement_id', n ->> 'financial_agreement_id',
                         'amount', n -> 'amount', 'paid_amount', n -> 'paid_amount',
                         'status', n ->> 'status', 'fields', coalesce(v_cols, '{}')));

  when 'partner_transfers' then
    perform private.record_audit_event(
      case when tg_op = 'INSERT' then 'PARTNER_TRANSFER_REGISTERED' else 'PARTNER_TRANSFER_UPDATED' end,
      t, v_id,
      jsonb_build_object('partner_organization_id', n ->> 'partner_organization_id',
                         'amount', n -> 'amount', 'status', n ->> 'status'));

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

  -- ── usuários e organizações ────────────────────────────────────────────
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

  else
    raise exception 'audit_row_change sem regra para %', t;
  end case;

  return null;
end
$$;

-- Remove elementos de um array de texto (usado acima).
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

-- ───────────────────────────── ligação dos triggers ───────────────────────

do $$
declare
  t text;
begin
  foreach t in array array[
    'organizations', 'partner_office_settings', 'organization_memberships', 'user_invitations',
    'clients', 'individual_client_details', 'company_client_details', 'company_representatives',
    'client_contacts', 'client_addresses', 'client_organization_relationships',
    'legal_cases', 'legal_processes', 'documents', 'document_versions',
    'review_decisions', 'agent_proposals', 'partner_requests',
    'case_partnership_agreements', 'financial_agreements', 'payments', 'partner_transfers',
    'agents', 'skills', 'legal_theses', 'reference_materials',
    'agent_versions', 'skill_versions', 'legal_thesis_versions', 'reference_material_versions'
  ]
  loop
    execute format(
      'create trigger %I after insert or update on public.%I
         for each row execute function private.audit_row_change()',
      t || '_audit', t);
  end loop;
end
$$;
