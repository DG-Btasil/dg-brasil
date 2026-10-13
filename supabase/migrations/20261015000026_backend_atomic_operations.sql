-- DG Brasil — 026: operações atômicas, idempotência e Storage autorizado (Etapa 4.2)
--
-- Achados ao construir o backend de domínio. Nada aqui muda regra existente:
-- só fecha operações que o TypeScript faria em várias escritas soltas.
--
--   1. Storage. Os buckets são privados e o usuário não assina URL (017). O
--      backend assina com a service role SÓ depois destas funções — chamadas
--      com o JWT do usuário — autorizarem, registrarem LGPD/auditoria (ator
--      USER) e devolverem o caminho EXATO do objeto. A service role não decide
--      nada: assina o caminho que o banco autorizou.
--   2. Idempotência. Clique duplo/nova tentativa não duplica lançamento,
--      obrigação, acordo, repasse nem execução de agente: chave UUID por
--      formulário, única por autor.
--   3. Repasse ao parceiro atômico (consome divisões com saldo, travadas).
--   4. Cadastro de parceiro atômico (organização + configuração).
--   5. Solicitações ao parceiro: resposta atômica (mensagem + status),
--      máquina de estados e nada de mensagem em solicitação encerrada.
--   6. deadline_status: indica prazo de processo/caso excluído e o responsável.
--
-- Pós-baseline: 001–025 não são alteradas.

-- ───────────────────────────── 1. Storage autorizado ──────────────────────

create or replace function private.authorize_document_upload(p_document_id uuid, p_version_id uuid, p_filename text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client  uuid;
  v_status  text;
  v_deleted timestamptz;
begin
  if auth.uid() is null or not exists (select 1 from private.current_membership()) then
    raise exception 'Sem sessão liberada' using errcode = '42501';
  end if;
  select d.client_id, d.status, d.deleted_at into v_client, v_status, v_deleted
  from public.documents d where d.id = p_document_id;
  if v_client is null or v_deleted is not null or not private.can_access_document(p_document_id) then
    raise exception 'Documento não encontrado' using errcode = '42501';
  end if;
  if v_status <> 'ACTIVE' then
    raise exception 'Documento arquivado não recebe nova versão' using errcode = '23514';
  end if;
  if exists (select 1 from public.document_versions v where v.id = p_version_id) then
    raise exception 'Versão já registrada' using errcode = '23505';
  end if;
  return private.legal_document_object_name(v_client, p_document_id, p_version_id, p_filename);
end
$$;

-- Download: autoriza, registra o acesso a dado pessoal e a auditoria (ator =
-- o usuário) e devolve o caminho. Sem esta chamada, o servidor não assina.
create or replace function private.authorize_document_download(p_version_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name   text;
  v_doc    uuid;
  v_client uuid;
begin
  if auth.uid() is null or not exists (select 1 from private.current_membership()) then
    raise exception 'Sem sessão liberada' using errcode = '42501';
  end if;
  select v.storage_object_name, d.id, d.client_id into v_name, v_doc, v_client
  from public.document_versions v
  join public.documents d on d.id = v.document_id and d.deleted_at is null
  where v.id = p_version_id;
  if v_doc is null or not private.can_access_document(v_doc) then
    raise exception 'Arquivo não encontrado' using errcode = '42501';
  end if;
  perform private.record_personal_data_access(v_client, 'DOCUMENT_VERSION', p_version_id, 'DOWNLOAD', null, null);
  perform private.record_audit_event('DOCUMENT_DOWNLOADED', 'document_versions', p_version_id,
    jsonb_build_object('document_id', v_doc));
  return v_name;
end
$$;

-- ───────────────────────────── 2. idempotência ────────────────────────────

alter table public.payment_receipts    add column idempotency_key uuid;
alter table public.payments            add column idempotency_key uuid;
alter table public.financial_agreements add column idempotency_key uuid;
alter table public.partner_transfers   add column idempotency_key uuid;
alter table public.agent_runs          add column idempotency_key uuid;

create unique index payment_receipts_idempotency on public.payment_receipts (created_by, idempotency_key) where idempotency_key is not null;
create unique index payments_idempotency on public.payments (created_by, idempotency_key) where idempotency_key is not null;
create unique index financial_agreements_idempotency on public.financial_agreements (created_by, idempotency_key) where idempotency_key is not null;
create unique index partner_transfers_idempotency on public.partner_transfers (registered_by, idempotency_key) where idempotency_key is not null;
create unique index agent_runs_idempotency on public.agent_runs (requested_by, idempotency_key) where idempotency_key is not null;

comment on column public.payment_receipts.idempotency_key is
  'Chave do formulário (UUID). Repetir o envio devolve o lançamento já gravado; não é dado de negócio.';

-- Pedido de execução com chave: repetir devolve a mesma execução (e não
-- enfileira de novo). Corrida entre dois pedidos simultâneos: o segundo cai
-- na unique, a subtransação dele (execução + fila) é desfeita e devolve a
-- execução do primeiro.
create or replace function private.request_agent_run_once(
  p_idempotency_key  uuid,
  p_agent_id         uuid,
  p_legal_case_id    uuid default null,
  p_legal_process_id uuid default null,
  p_request_text     text default null,
  p_parameters       jsonb default '{}',
  p_operation        text default 'EXECUTE'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_run   uuid;
begin
  if v_actor is null or p_idempotency_key is null then
    raise exception 'Pedido de execução precisa de sessão e de chave' using errcode = '42501';
  end if;
  select r.id into v_run from public.agent_runs r where r.requested_by = v_actor and r.idempotency_key = p_idempotency_key;
  if v_run is not null then
    return jsonb_build_object('run_id', v_run, 'deduplicated', true);
  end if;
  begin
    v_run := private.request_agent_run(p_agent_id, p_legal_case_id, p_legal_process_id, p_request_text, p_parameters, p_operation, null);
    update public.agent_runs set idempotency_key = p_idempotency_key where id = v_run;
  exception when unique_violation then
    select r.id into v_run from public.agent_runs r where r.requested_by = v_actor and r.idempotency_key = p_idempotency_key;
    return jsonb_build_object('run_id', v_run, 'deduplicated', true);
  end;
  return jsonb_build_object('run_id', v_run, 'deduplicated', false);
end
$$;

-- ───────────────────────────── 3. repasse atômico ─────────────────────────

create or replace function private.create_partner_transfer(
  p_partner_organization_id uuid,
  p_amount                  numeric,
  p_reference               text default null,
  p_legal_case_id           uuid default null,
  p_idempotency_key         uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor     uuid := auth.uid();
  v_transfer  uuid;
  v_remaining numeric(14,2) := p_amount;
  v_take      numeric(14,2);
  r           record;
begin
  if v_actor is null or not private.is_admin() then
    raise exception 'Somente ADMIN interno registra repasse' using errcode = '42501';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'O valor do repasse precisa ser maior que zero' using errcode = '22023';
  end if;
  if p_idempotency_key is not null then
    select t.id into v_transfer from public.partner_transfers t
    where t.registered_by = v_actor and t.idempotency_key = p_idempotency_key;
    if v_transfer is not null then
      return jsonb_build_object('transfer_id', v_transfer, 'deduplicated', true);
    end if;
  end if;

  insert into public.partner_transfers (partner_organization_id, amount, reference, registered_by, idempotency_key)
  values (p_partner_organization_id, p_amount, nullif(btrim(coalesce(p_reference, '')), ''), v_actor, p_idempotency_key)
  returning id into v_transfer;

  -- Divisões mais antigas primeiro, travadas: dois repasses simultâneos não
  -- consomem o mesmo saldo.
  for r in
    select al.id
    from public.partner_revenue_allocations al
    join public.case_partnership_agreements a on a.id = al.case_partnership_agreement_id
    where a.partner_organization_id = p_partner_organization_id
      and (p_legal_case_id is null or a.legal_case_id = p_legal_case_id)
      and al.reverses_allocation_id is null
    order by al.sequence
    for update of al
  loop
    exit when v_remaining <= 0;
    v_take := least(v_remaining, greatest(private.allocation_available_amount(r.id), 0));
    continue when v_take <= 0;
    insert into public.partner_transfer_items (transfer_id, allocation_id, amount) values (v_transfer, r.id, v_take);
    v_remaining := v_remaining - v_take;
  end loop;

  if v_remaining > 0 then
    raise exception 'Saldo disponível insuficiente para o repasse' using errcode = '23514';
  end if;
  return jsonb_build_object('transfer_id', v_transfer, 'deduplicated', false);
end
$$;

-- ───────────────────────────── 4. cadastro de parceiro ────────────────────

create or replace function private.create_partner_office(p_org jsonb, p_settings jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'Somente ADMIN interno cadastra parceiro' using errcode = '42501';
  end if;
  insert into public.organizations
    (type, status, name, legal_name, trade_name, cnpj, email, phone, website,
     address_postal_code, address_street, address_number, address_complement,
     address_neighborhood, address_city, address_state)
  values
    ('PARTNER', 'PENDING', btrim(p_org ->> 'name'),
     nullif(btrim(coalesce(p_org ->> 'legal_name', '')), ''),
     nullif(btrim(coalesce(p_org ->> 'trade_name', '')), ''),
     nullif(regexp_replace(coalesce(p_org ->> 'cnpj', ''), '\D', '', 'g'), ''),
     nullif(lower(btrim(coalesce(p_org ->> 'email', ''))), ''),
     nullif(btrim(coalesce(p_org ->> 'phone', '')), ''),
     nullif(btrim(coalesce(p_org ->> 'website', '')), ''),
     nullif(regexp_replace(coalesce(p_org ->> 'address_postal_code', ''), '\D', '', 'g'), ''),
     nullif(btrim(coalesce(p_org ->> 'address_street', '')), ''),
     nullif(btrim(coalesce(p_org ->> 'address_number', '')), ''),
     nullif(btrim(coalesce(p_org ->> 'address_complement', '')), ''),
     nullif(btrim(coalesce(p_org ->> 'address_neighborhood', '')), ''),
     nullif(btrim(coalesce(p_org ->> 'address_city', '')), ''),
     nullif(upper(btrim(coalesce(p_org ->> 'address_state', ''))), '')::public.uf_code)
  returning id into v_id;

  insert into public.partner_office_settings
    (organization_id, default_partner_percentage, default_owner_percentage, partnership_active,
     responsible_name, responsible_oab_number, responsible_oab_state, notes)
  values
    (v_id,
     coalesce((p_settings ->> 'default_partner_percentage')::numeric, 50),
     coalesce((p_settings ->> 'default_owner_percentage')::numeric, 50),
     coalesce((p_settings ->> 'partnership_active')::boolean, true),
     nullif(btrim(coalesce(p_settings ->> 'responsible_name', '')), ''),
     nullif(upper(btrim(coalesce(p_settings ->> 'responsible_oab_number', ''))), ''),
     nullif(upper(btrim(coalesce(p_settings ->> 'responsible_oab_state', ''))), '')::public.uf_code,
     nullif(btrim(coalesce(p_settings ->> 'notes', '')), ''));
  return v_id;
end
$$;

-- ───────────────────────────── 5. solicitações ao parceiro ────────────────

-- Máquina de estados: OPEN ↔ ANSWERED; OPEN/ANSWERED → RESOLVED/CANCELLED.
-- Encerrada não reabre. Caso e parceiro não mudam depois de criada.
create or replace function private.partner_requests_transition_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.legal_case_id is distinct from old.legal_case_id
     or new.partner_organization_id is distinct from old.partner_organization_id then
    raise exception 'Caso e parceiro da solicitação não mudam' using errcode = '23514';
  end if;
  if new.status is distinct from old.status and not (
       (old.status = 'OPEN' and new.status in ('ANSWERED', 'RESOLVED', 'CANCELLED'))
    or (old.status = 'ANSWERED' and new.status in ('OPEN', 'RESOLVED', 'CANCELLED'))
  ) then
    raise exception 'Solicitação encerrada não muda de situação' using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger partner_requests_transition_guard
  before update on public.partner_requests
  for each row execute function private.partner_requests_transition_guard();

drop policy if exists partner_request_messages_insert on public.partner_request_messages;
create policy partner_request_messages_insert on public.partner_request_messages for insert to authenticated
  with check (
    private.can_access_partner_request(partner_request_id)
    and author_id = (select auth.uid())
    and (document_id is null or private.can_access_document(document_id))
    and exists (select 1 from public.partner_requests r
                where r.id = partner_request_id and r.status in ('OPEN', 'ANSWERED'))
  );

-- Resposta numa transação: mensagem + situação. Parceiro: OPEN → ANSWERED.
-- Equipe interna com p_reopen: ANSWERED → OPEN. Devolve a situação final.
create or replace function private.answer_partner_request(
  p_request_id  uuid,
  p_message_id  uuid,
  p_body        text,
  p_document_id uuid default null,
  p_reopen      boolean default false
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status   text;
  v_partner  boolean := private.is_partner_user();
  v_internal boolean := private.is_internal_user();
begin
  if auth.uid() is null or not (v_partner or v_internal) then
    raise exception 'Sem sessão liberada' using errcode = '42501';
  end if;
  if not private.can_access_partner_request(p_request_id) then
    raise exception 'Solicitação não encontrada' using errcode = '42501';
  end if;
  select r.status into v_status from public.partner_requests r where r.id = p_request_id for update;
  if v_status is null then
    raise exception 'Solicitação não encontrada' using errcode = '42501';
  end if;
  if v_status not in ('OPEN', 'ANSWERED') then
    raise exception 'Solicitação encerrada não recebe mensagem' using errcode = '23514';
  end if;
  if p_document_id is not null and not private.can_access_document(p_document_id) then
    raise exception 'Documento não encontrado' using errcode = '42501';
  end if;
  if exists (select 1 from public.partner_request_messages m where m.id = p_message_id) then
    -- Repetição do mesmo envio (id gerado pelo servidor): já gravada.
    return v_status;
  end if;

  insert into public.partner_request_messages (id, partner_request_id, author_id, body, document_id)
  values (p_message_id, p_request_id, auth.uid(), btrim(p_body), p_document_id);

  if v_partner and v_status = 'OPEN' then
    update public.partner_requests set status = 'ANSWERED' where id = p_request_id;
    v_status := 'ANSWERED';
  elsif v_internal and p_reopen and v_status = 'ANSWERED' then
    update public.partner_requests set status = 'OPEN' where id = p_request_id;
    v_status := 'OPEN';
  end if;
  return v_status;
end
$$;

-- ───────────────────────────── 6. deadline_status ─────────────────────────
-- Colunas novas no fim (create or replace view só acrescenta).
create or replace view public.deadline_status
with (security_invoker = true)
as
select
  d.id as deadline_id,
  d.legal_case_id,
  d.legal_process_id,
  d.status,
  case when d.status = 'OPEN' and d.due_at < now() then 'OVERDUE' else d.status end as effective_status,
  (d.due_at at time zone 'America/Sao_Paulo')::date as due_date_local,
  d.responsible_user_id,
  (c.deleted_at is not null or p.deleted_at is not null) as scope_deleted
from public.deadlines d
join public.legal_cases c on c.id = d.legal_case_id
left join public.legal_processes p on p.id = d.legal_process_id;

-- ───────────────────────────── RPCs públicas e grants ─────────────────────

create or replace function public.authorize_document_upload(p_document_id uuid, p_version_id uuid, p_filename text)
returns text language sql security invoker set search_path = ''
as $$ select private.authorize_document_upload(p_document_id, p_version_id, p_filename) $$;

create or replace function public.authorize_document_download(p_version_id uuid)
returns text language sql security invoker set search_path = ''
as $$ select private.authorize_document_download(p_version_id) $$;

create or replace function public.request_agent_run_once(
  p_idempotency_key uuid, p_agent_id uuid, p_legal_case_id uuid default null, p_legal_process_id uuid default null,
  p_request_text text default null, p_parameters jsonb default '{}', p_operation text default 'EXECUTE')
returns jsonb language sql security invoker set search_path = ''
as $$ select private.request_agent_run_once(p_idempotency_key, p_agent_id, p_legal_case_id, p_legal_process_id,
                                            p_request_text, p_parameters, p_operation) $$;

create or replace function public.create_partner_transfer(
  p_partner_organization_id uuid, p_amount numeric, p_reference text default null,
  p_legal_case_id uuid default null, p_idempotency_key uuid default null)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.create_partner_transfer(p_partner_organization_id, p_amount, p_reference, p_legal_case_id, p_idempotency_key) $$;

create or replace function public.create_partner_office(p_org jsonb, p_settings jsonb)
returns uuid language sql security invoker set search_path = ''
as $$ select private.create_partner_office(p_org, p_settings) $$;

create or replace function public.answer_partner_request(
  p_request_id uuid, p_message_id uuid, p_body text, p_document_id uuid default null, p_reopen boolean default false)
returns text language sql security invoker set search_path = ''
as $$ select private.answer_partner_request(p_request_id, p_message_id, p_body, p_document_id, p_reopen) $$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'private.authorize_document_upload(uuid, uuid, text)', 'public.authorize_document_upload(uuid, uuid, text)',
    'private.authorize_document_download(uuid)', 'public.authorize_document_download(uuid)',
    'private.request_agent_run_once(uuid, uuid, uuid, uuid, text, jsonb, text)',
    'public.request_agent_run_once(uuid, uuid, uuid, uuid, text, jsonb, text)',
    'private.create_partner_transfer(uuid, numeric, text, uuid, uuid)', 'public.create_partner_transfer(uuid, numeric, text, uuid, uuid)',
    'private.create_partner_office(jsonb, jsonb)', 'public.create_partner_office(jsonb, jsonb)',
    'private.answer_partner_request(uuid, uuid, text, uuid, boolean)', 'public.answer_partner_request(uuid, uuid, text, uuid, boolean)']
  loop
    execute format('revoke all on function %s from public, anon, service_role', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end
$$;
