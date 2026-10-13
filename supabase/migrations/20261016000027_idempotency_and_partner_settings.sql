-- DG Brasil — 027: idempotência genérica e configuração do parceiro (Etapa 4.2.1)
--
--   1. Mecanismo GENÉRICO de idempotência (private.idempotency_operations).
--      Uma chave UUID = UMA tentativa lógica de comando, gerada pela tela uma
--      vez por intenção de envio (retry usa a mesma). Nada de deduplicar por
--      título, cliente, área ou CNJ: dois registros parecidos podem ser
--      legítimos. Escopo único: usuário + operação + chave.
--        mesma chave + mesmo pedido   → devolve o recurso já criado;
--        mesma chave + pedido diferente → conflito (nunca reaproveita calado).
--      O hash do pedido leva a própria chave como sal: não dá para testar
--      CPFs contra ele fora daquela linha. A tabela fica no schema private
--      (fora da API), sem grant para ninguém: só as funções abaixo a tocam.
--   2. Criação idempotente e ATÔMICA de caso (interno e portal) e de processo
--      (com dados internos e prazo inicial na mesma transação). As funções de
--      criação são SECURITY INVOKER: a RLS de legal_cases/legal_processes vale
--      como sempre. Só o registro de idempotência é feito por funções definer.
--      Corrida com a mesma chave: o segundo pedido espera o primeiro (índice
--      único) e devolve o mesmo recurso — um único caso/processo.
--   3. get_my_partner_settings(): o administrador do parceiro lê a PRÓPRIA
--      divisão padrão, sem SELECT em partner_office_settings e sem receber
--      organization_id do navegador. Usuário do parceiro: recusado (financeiro).
--
-- Retenção: o volume é pequeno (uma linha por envio de criação). Sem expurgo
-- nesta etapa; a linha também serve de rastro de "quem criou com qual envio".
--
-- Pós-baseline: 001–026 não são alteradas.

-- ───────────────────────────── 1. mecanismo genérico ──────────────────────

create table private.idempotency_operations (
  id                    uuid primary key default gen_random_uuid(),
  actor_user_id         uuid not null references public.profiles (id) on delete restrict,
  actor_organization_id uuid references public.organizations (id) on delete restrict,
  operation             text not null check (operation ~ '^[a-z][a-z0-9_.]{2,63}$'),
  idempotency_key       uuid not null,
  request_hash          text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  resource_type         text,
  resource_id           uuid,
  -- Resposta pequena para repetir sem reconsultar (só IDs e flags, nunca PII).
  response              jsonb,
  created_at            timestamptz not null default now(),
  completed_at          timestamptz,
  constraint idempotency_operations_scope_key unique (actor_user_id, operation, idempotency_key)
);

comment on table private.idempotency_operations is
  'Idempotência de comandos (uma chave = uma tentativa lógica). Fora da Data API; só funções private.idempotency_*.';

alter table private.idempotency_operations enable row level security;
revoke all on private.idempotency_operations from public, anon, authenticated, service_role;

-- Reivindica a chave. Devolve null se a chave é nova (o chamador cria o
-- recurso e chama idempotency_complete na MESMA transação); se já existe com
-- o mesmo pedido, devolve {resource_type, resource_id, response}; com pedido
-- diferente, conflito.
create or replace function private.idempotency_begin(p_operation text, p_key uuid, p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_hash  text;
  v_claim uuid;
  v_row   record;
begin
  if v_actor is null or not exists (select 1 from private.current_membership()) then
    raise exception 'Sem sessão liberada' using errcode = '42501';
  end if;
  if p_key is null then
    raise exception 'Chave de envio obrigatória' using errcode = '22023';
  end if;
  v_hash := encode(sha256(convert_to(p_key::text || '|' || p_operation || '|' || coalesce(p_request, 'null'::jsonb)::text, 'UTF8')), 'hex');

  insert into private.idempotency_operations (actor_user_id, actor_organization_id, operation, idempotency_key, request_hash)
  values (v_actor, private.current_organization_id(), p_operation, p_key, v_hash)
  on conflict (actor_user_id, operation, idempotency_key) do nothing
  returning id into v_claim;

  if v_claim is not null then
    return null;
  end if;

  select o.request_hash, o.resource_type, o.resource_id, o.response into v_row
  from private.idempotency_operations o
  where o.actor_user_id = v_actor and o.operation = p_operation and o.idempotency_key = p_key;

  if v_row.request_hash is distinct from v_hash then
    raise exception 'Esta chave de envio já foi usada com outros dados. Recarregue o formulário e envie de novo.'
      using errcode = '23505';
  end if;
  if v_row.resource_id is null then
    raise exception 'O envio anterior ainda não terminou. Tente novamente em instantes.' using errcode = '55P03';
  end if;
  return jsonb_build_object('resource_type', v_row.resource_type, 'resource_id', v_row.resource_id, 'response', v_row.response);
end
$$;

create or replace function private.idempotency_complete(
  p_operation text, p_key uuid, p_resource_type text, p_resource_id uuid, p_response jsonb default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update private.idempotency_operations o
     set resource_type = p_resource_type, resource_id = p_resource_id, response = p_response, completed_at = now()
   where o.actor_user_id = auth.uid() and o.operation = p_operation and o.idempotency_key = p_key
     and o.resource_id is null;
  if not found then
    raise exception 'Chave de envio não reivindicada nesta transação' using errcode = '55000';
  end if;
end
$$;

revoke all on function private.idempotency_begin(text, uuid, jsonb) from public, anon, service_role;
revoke all on function private.idempotency_complete(text, uuid, text, uuid, jsonb) from public, anon, service_role;
grant execute on function private.idempotency_begin(text, uuid, jsonb) to authenticated;
grant execute on function private.idempotency_complete(text, uuid, text, uuid, jsonb) to authenticated;

-- ───────────────────────────── 2a. caso interno ───────────────────────────
-- p_case: colunas de legal_cases (client_id, legal_area_id, case_type_id,
-- title, summary, opposing_party, status DRAFT|SUBMITTED,
-- origin_organization_id, partner_organization_id, assigned_lawyer_id,
-- partner_notes). O id é gerado aqui. p_internal: { internal_notes }.
create or replace function public.create_legal_case_once(p_key uuid, p_case jsonb, p_internal jsonb default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_prev jsonb;
  v_id   uuid := gen_random_uuid();
  v_c    public.legal_cases;
begin
  v_prev := private.idempotency_begin('legal_case.create', p_key,
    jsonb_build_object('case', p_case - 'id', 'internal', p_internal));
  if v_prev is not null then
    return jsonb_build_object('legal_case_id', v_prev ->> 'resource_id', 'deduplicated', true);
  end if;

  v_c := jsonb_populate_record(null::public.legal_cases, p_case - 'id');
  insert into public.legal_cases
    (id, client_id, legal_area_id, case_type_id, title, summary, opposing_party, status,
     origin_organization_id, partner_organization_id, assigned_lawyer_id, partner_notes)
  values
    (v_id, v_c.client_id, v_c.legal_area_id, v_c.case_type_id, v_c.title, v_c.summary, v_c.opposing_party,
     coalesce(v_c.status, 'DRAFT'), v_c.origin_organization_id, v_c.partner_organization_id,
     v_c.assigned_lawyer_id, v_c.partner_notes);

  if nullif(btrim(coalesce(p_internal ->> 'internal_notes', '')), '') is not null then
    insert into public.legal_case_internal_details (legal_case_id, internal_notes)
    values (v_id, btrim(p_internal ->> 'internal_notes'))
    on conflict (legal_case_id) do update set internal_notes = excluded.internal_notes;
  end if;

  perform private.idempotency_complete('legal_case.create', p_key, 'legal_cases', v_id, null);
  return jsonb_build_object('legal_case_id', v_id, 'deduplicated', false);
end
$$;

-- ───────────────────────────── 2b. caso do portal ─────────────────────────
-- Envolve partner_submit_case (025, inalterada) com a mesma chave.
create or replace function public.partner_submit_case_once(p_key uuid, p_client jsonb, p_case jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_prev   jsonb;
  v_result jsonb;
begin
  v_prev := private.idempotency_begin('partner_case.submit', p_key,
    jsonb_build_object('client', p_client, 'case', p_case));
  if v_prev is not null then
    return (v_prev -> 'response') || jsonb_build_object('deduplicated', true);
  end if;

  v_result := private.partner_submit_case(p_client, p_case);
  perform private.idempotency_complete('partner_case.submit', p_key, 'legal_cases',
    (v_result ->> 'legal_case_id')::uuid, v_result);
  return v_result || jsonb_build_object('deduplicated', false);
end
$$;

-- ───────────────────────────── 2c. processo ───────────────────────────────
-- p_process: colunas de legal_processes (legal_case_id, title, cnj_number,
-- court, court_unit, district, state, legal_class, subject, client_side,
-- adverse_party_summary, distribution_date, case_value, status, phase,
-- responsible_user_id, operational_due_at). Origem sempre MANUAL.
-- p_internal: { summary, notes } (só equipe interna — RLS).
-- p_deadline: colunas de deadlines (title, deadline_type, description, due_at,
-- priority, responsible_user_id) para o prazo inicial, no mesmo processo.
create or replace function public.create_legal_process_once(
  p_key uuid, p_process jsonb, p_internal jsonb default null, p_deadline jsonb default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_prev jsonb;
  v_id   uuid := gen_random_uuid();
  v_p    public.legal_processes;
  v_d    public.deadlines;
  v_deadline uuid;
begin
  v_prev := private.idempotency_begin('legal_process.create', p_key,
    jsonb_build_object('process', p_process - 'id', 'internal', p_internal, 'deadline', p_deadline));
  if v_prev is not null then
    return (case when jsonb_typeof(v_prev -> 'response') = 'object' then v_prev -> 'response' else '{}'::jsonb end)
           || jsonb_build_object('legal_process_id', v_prev ->> 'resource_id', 'deduplicated', true);
  end if;

  v_p := jsonb_populate_record(null::public.legal_processes, p_process - 'id');
  -- Parceiro não define campo interno, nem chamando direto (o banco aplica os defaults).
  if private.is_partner_user() then
    v_p.status := null; v_p.phase := null; v_p.responsible_user_id := null; v_p.operational_due_at := null;
  end if;
  insert into public.legal_processes
    (id, legal_case_id, technical_origin, title, cnj_number, court, court_unit, district, state,
     legal_class, subject, client_side, adverse_party_summary, distribution_date, case_value,
     status, phase, responsible_user_id, operational_due_at)
  values
    (v_id, v_p.legal_case_id, 'MANUAL', v_p.title, v_p.cnj_number, v_p.court, v_p.court_unit, v_p.district, v_p.state,
     v_p.legal_class, v_p.subject, v_p.client_side, v_p.adverse_party_summary, v_p.distribution_date, v_p.case_value,
     coalesce(v_p.status, 'PREPARING'), v_p.phase, v_p.responsible_user_id, v_p.operational_due_at);

  if p_internal is not null and (nullif(btrim(coalesce(p_internal ->> 'summary', '')), '') is not null
                                 or nullif(btrim(coalesce(p_internal ->> 'notes', '')), '') is not null) then
    insert into public.legal_process_internal_details (legal_process_id, summary, notes)
    values (v_id, nullif(btrim(coalesce(p_internal ->> 'summary', '')), ''), nullif(btrim(coalesce(p_internal ->> 'notes', '')), ''));
  end if;

  if p_deadline is not null and jsonb_typeof(p_deadline) = 'object' then
    v_d := jsonb_populate_record(null::public.deadlines, p_deadline - 'id' - 'legal_case_id' - 'legal_process_id');
    v_deadline := gen_random_uuid();
    insert into public.deadlines
      (id, legal_case_id, legal_process_id, title, deadline_type, description, due_at, priority, responsible_user_id, source)
    values
      (v_deadline, v_p.legal_case_id, v_id, v_d.title, coalesce(v_d.deadline_type, 'INTERNAL'), v_d.description,
       v_d.due_at, coalesce(v_d.priority, 'NORMAL'), v_d.responsible_user_id, 'MANUAL');
  end if;

  perform private.idempotency_complete('legal_process.create', p_key, 'legal_processes', v_id,
    case when v_deadline is not null then jsonb_build_object('deadline_id', v_deadline) end);
  return jsonb_build_object('legal_process_id', v_id, 'deadline_id', v_deadline, 'deduplicated', false);
end
$$;

-- ───────────────────────────── 3. divisão do parceiro ─────────────────────

create or replace function private.get_my_partner_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_partner_organization_id();
  v_out jsonb;
begin
  if auth.uid() is null or v_org is null or not private.is_partner_admin() then
    raise exception 'Somente o administrador do parceiro consulta a divisão do próprio escritório' using errcode = '42501';
  end if;
  select jsonb_build_object(
           'organization_id', o.id,
           'organization_name', o.name,
           'partner_percentage', s.default_partner_percentage,
           'owner_percentage', s.default_owner_percentage,
           'activated_at', s.activated_at)
    into v_out
  from public.organizations o
  join public.partner_office_settings s on s.organization_id = o.id
  where o.id = v_org;
  return v_out;
end
$$;

create or replace function public.get_my_partner_settings()
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.get_my_partner_settings() $$;

-- ───────────────────────────── grants ─────────────────────────────────────

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.create_legal_case_once(uuid, jsonb, jsonb)',
    'public.partner_submit_case_once(uuid, jsonb, jsonb)',
    'public.create_legal_process_once(uuid, jsonb, jsonb, jsonb)',
    'private.get_my_partner_settings()', 'public.get_my_partner_settings()']
  loop
    execute format('revoke all on function %s from public, anon, service_role', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end
$$;
