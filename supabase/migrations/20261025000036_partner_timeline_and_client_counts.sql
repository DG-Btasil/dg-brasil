-- 036 — Portal do parceiro: histórico do caso e contagens por cliente (Etapa 4.3.1)
--
-- 1. get_partner_case_timeline(caso, deslocamento, limite)
--    Histórico SANITIZADO de um caso do próprio escritório. NÃO expõe
--    audit_events: lê as fontes (caso, processos, movimentações oficiais,
--    documentos compartilhados, pendências, solicitações) e, para mudanças de
--    situação, a trilha de auditoria SÓ dentro da função, devolvendo um item
--    montado aqui (tipo, título, descrição segura, quando, quem — rótulo
--    sanitizado). Nunca: notas internas, motivo interno, revisões, análises,
--    execuções de agente, metadata de auditoria, IP/user agent.
--    Situações internas de análise viram "Em análise" (como o parceiro já vê);
--    mudança que não muda o rótulo do parceiro não aparece. Paginado.
--
-- 2. get_partner_client_counts(ids de cliente)
--    Para a lista de clientes do portal: casos, processos, solicitações em
--    aberto e documentos pedidos — SÓ no escopo do escritório (casos operados
--    por ele). "Este cliente tem 8 casos no total" nunca vaza: casos de outros
--    escritórios ou internos não entram em nenhuma contagem. Uma consulta para
--    a página inteira (sem N+1). Cliente fora da carteira não volta linha.

-- ───────────────────────────── rótulos ────────────────────────────────────

-- Rótulo do parceiro para a situação do caso (igual a PARTNER_CASE_STATUS_LABEL do front).
create or replace function private.partner_case_status_label(p_status text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_status
    when 'DRAFT'              then 'Rascunho'
    when 'SUBMITTED'          then 'Enviado'
    when 'WAITING_DOCUMENTS'  then 'Aguardando documentos'
    when 'READY_FOR_ANALYSIS' then 'Em análise'
    when 'ANALYZING'          then 'Em análise'
    when 'WAITING_REVIEW'     then 'Em análise'
    when 'ACCEPTED'           then 'Aceito'
    when 'REJECTED'           then 'Não aceito'
    when 'IN_PROGRESS'        then 'Em andamento'
    when 'CLOSED'             then 'Concluído'
    when 'ARCHIVED'           then 'Arquivado'
  end
$$;

-- Quem fez, como o parceiro pode ver: pessoa do PRÓPRIO escritório pelo nome;
-- equipe interna como o nome do escritório responsável; o resto, nada.
create or replace function private.partner_actor_label(p_user uuid, p_partner_org uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_user is null then null
    when private.user_organization_id(p_user) = p_partner_org then (select p.full_name from public.profiles p where p.id = p_user)
    when private.is_active_internal_user(p_user)
      then (select o.name from public.organizations o where o.type = 'OWNER' and o.deleted_at is null limit 1)
    else null
  end
$$;

revoke all on function private.partner_case_status_label(text) from public, anon, service_role;
revoke all on function private.partner_actor_label(uuid, uuid) from public, anon, authenticated, service_role;

-- ───────────────────────────── 1. histórico do caso ───────────────────────

create or replace function private.get_partner_case_timeline(p_legal_case_id uuid, p_offset integer default 0, p_limit integer default 25)
returns table (
  event_id     text,
  kind         text,
  title        text,
  description  text,
  occurred_at  timestamptz,
  actor_label  text,
  related_type text,
  related_id   uuid,
  total_count  bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org  uuid := private.current_partner_organization_id();
  v_case record;
begin
  if auth.uid() is null or not exists (select 1 from private.current_membership()) then
    raise exception 'Sem sessão liberada' using errcode = '42501';
  end if;
  if v_org is null then
    raise exception 'Histórico do portal é só do escritório parceiro' using errcode = '42501';
  end if;
  select c.id, c.created_at, c.created_by, c.submitted_at, c.status, c.rejection_reason_public into v_case
  from public.legal_cases c
  where c.id = p_legal_case_id and c.partner_organization_id = v_org and c.deleted_at is null;
  if not found then
    raise exception 'Caso não encontrado' using errcode = 'P0002';
  end if;

  return query
  with events as (
    -- Caso cadastrado.
    select 'case-created:' || v_case.id::text as event_id, 'CASE' as kind, 'Caso cadastrado' as title,
           null::text as description, v_case.created_at as occurred_at,
           private.partner_actor_label(v_case.created_by, v_org) as actor_label,
           'case' as related_type, v_case.id as related_id
    union all
    -- Envio para análise quando o caso já nasceu enviado (sem evento de mudança).
    select 'case-submitted:' || v_case.id::text, 'CASE', 'Caso enviado para análise', null,
           v_case.submitted_at, private.partner_actor_label(v_case.created_by, v_org), 'case', v_case.id
    where v_case.submitted_at is not null
      and not exists (select 1 from public.audit_events a
                      where a.entity_type = 'legal_cases' and a.entity_id = v_case.id and a.action = 'CASE_SUBMITTED')
    union all
    -- Mudanças de situação: da trilha, só o que muda o rótulo do parceiro.
    select 'case-status:' || a.id::text, 'CASE_STATUS',
           case a.metadata ->> 'to'
             when 'SUBMITTED' then 'Caso enviado para análise'
             when 'ACCEPTED'  then 'Caso aceito'
             when 'REJECTED'  then 'Caso não aceito'
             when 'CLOSED'    then 'Caso concluído'
             when 'ARCHIVED'  then 'Caso arquivado'
             else 'Situação: ' || private.partner_case_status_label(a.metadata ->> 'to')
           end,
           -- Motivo PÚBLICO (o interno fica em legal_case_internal_details e nunca sai daqui).
           case when a.metadata ->> 'to' = 'REJECTED' then v_case.rejection_reason_public end,
           a.created_at,
           private.partner_actor_label(a.actor_user_id, v_org),
           'case', v_case.id
    from public.audit_events a
    where a.entity_type = 'legal_cases' and a.entity_id = v_case.id
      and a.action in ('CASE_SUBMITTED', 'CASE_ACCEPTED', 'CASE_REJECTED', 'CASE_STATUS_CHANGED')
      and private.partner_case_status_label(a.metadata ->> 'to') is distinct from private.partner_case_status_label(a.metadata ->> 'from')
    union all
    -- Processos do caso.
    select 'process:' || p.id::text, 'PROCESS', 'Processo cadastrado',
           coalesce(nullif(btrim(p.title), ''), p.cnj_number), p.created_at, null, 'process', p.id
    from public.legal_processes p
    where p.legal_case_id = v_case.id and p.deleted_at is null
    union all
    -- Movimentações oficiais / do sistema (as mesmas que o parceiro já lê).
    select 'process-event:' || e.id::text, 'PROCESS_EVENT',
           coalesce(nullif(btrim(e.title), ''), 'Movimentação processual'), left(e.description, 500), e.occurred_at,
           null, 'process', p.id
    from public.process_events e
    join public.legal_processes p on p.id = e.legal_process_id
    where p.legal_case_id = v_case.id and p.deleted_at is null
      and e.source in ('JUDICIAL_INTEGRATION', 'IMPORT', 'SYSTEM')
    union all
    -- Documentos compartilhados (cada versão disponível ao parceiro).
    select 'document-version:' || v.id::text, 'DOCUMENT',
           case when v.version_number = 1 then 'Documento disponível' else format('Nova versão do documento (v%s)', v.version_number) end,
           d.title, v.created_at, private.partner_actor_label(v.created_by, v_org), 'document', d.id
    from public.document_versions v
    join public.documents d on d.id = v.document_id
    where d.id in (select private.partner_document_ids())
      and (exists (select 1 from public.case_documents cd where cd.document_id = d.id and cd.legal_case_id = v_case.id)
           or exists (select 1 from public.process_documents pd join public.legal_processes p on p.id = pd.legal_process_id
                      where pd.document_id = d.id and p.legal_case_id = v_case.id))
    union all
    -- Pendências de documento: pedida e atendida.
    select 'requirement-requested:' || r.id::text, 'REQUIREMENT', 'Documento solicitado', r.requirement_label,
           r.requested_at, null, 'case', v_case.id
    from public.case_document_requirements r
    where r.legal_case_id = v_case.id and r.requested_at is not null
    union all
    select 'requirement-satisfied:' || r.id::text, 'REQUIREMENT',
           case r.status when 'APPROVED' then 'Documento aprovado' else 'Documento recebido' end,
           r.requirement_label, r.satisfied_at, null, 'case', v_case.id
    from public.case_document_requirements r
    where r.legal_case_id = v_case.id and r.satisfied_at is not null and r.status in ('RECEIVED', 'APPROVED')
    union all
    -- Solicitações ao parceiro: aberta, respostas, resolvida.
    select 'request:' || q.id::text, 'REQUEST', 'Solicitação aberta', q.title, q.created_at,
           private.partner_actor_label(q.created_by, v_org), 'request', q.id
    from public.partner_requests q
    where q.legal_case_id = v_case.id and q.partner_organization_id = v_org
    union all
    select 'request-message:' || m.id::text, 'REQUEST_MESSAGE', 'Nova resposta na solicitação', q.title, m.created_at,
           private.partner_actor_label(m.author_id, v_org), 'request', q.id
    from public.partner_request_messages m
    join public.partner_requests q on q.id = m.partner_request_id
    where q.legal_case_id = v_case.id and q.partner_organization_id = v_org
    union all
    select 'request-resolved:' || q.id::text, 'REQUEST', 'Solicitação resolvida', q.title, q.resolved_at, null, 'request', q.id
    from public.partner_requests q
    where q.legal_case_id = v_case.id and q.partner_organization_id = v_org and q.resolved_at is not null
  )
  select e.event_id, e.kind, e.title, e.description, e.occurred_at, e.actor_label, e.related_type, e.related_id,
         count(*) over () as total_count
  from events e
  where e.occurred_at is not null
  order by e.occurred_at desc, e.event_id
  offset greatest(coalesce(p_offset, 0), 0)
  limit least(greatest(coalesce(p_limit, 25), 1), 100);
end
$$;

create or replace function public.get_partner_case_timeline(p_legal_case_id uuid, p_offset integer default 0, p_limit integer default 25)
returns table (
  event_id text, kind text, title text, description text, occurred_at timestamptz,
  actor_label text, related_type text, related_id uuid, total_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$ select * from private.get_partner_case_timeline(p_legal_case_id, p_offset, p_limit) $$;

revoke all on function private.get_partner_case_timeline(uuid, integer, integer) from public, anon, service_role;
grant execute on function private.get_partner_case_timeline(uuid, integer, integer) to authenticated;
revoke all on function public.get_partner_case_timeline(uuid, integer, integer) from public, anon;
grant execute on function public.get_partner_case_timeline(uuid, integer, integer) to authenticated;

-- ───────────────────────────── 2. contagens por cliente ───────────────────

create or replace function private.get_partner_client_counts(p_client_ids uuid[])
returns table (client_id uuid, case_count integer, process_count integer, open_request_count integer, requested_document_count integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_partner_organization_id();
begin
  if auth.uid() is null or not exists (select 1 from private.current_membership()) then
    raise exception 'Sem sessão liberada' using errcode = '42501';
  end if;
  if v_org is null then
    raise exception 'Contagens do portal são só do escritório parceiro' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_client_ids), 0) > 100 then
    raise exception 'No máximo 100 clientes por consulta' using errcode = '22023';
  end if;

  return query
  with mine as (
    -- Só clientes da carteira do escritório (relacionamento ATIVO).
    select x.id from unnest(p_client_ids) as x(id) where x.id in (select private.partner_client_ids())
  ),
  cases as (
    -- Só casos OPERADOS pelo escritório: casos de outros escritórios ou internos nunca contam.
    select c.id, c.client_id from public.legal_cases c
    where c.client_id in (select id from mine) and c.partner_organization_id = v_org and c.deleted_at is null
  )
  select m.id,
         (select count(*)::int from cases c where c.client_id = m.id),
         (select count(*)::int from public.legal_processes p join cases c on c.id = p.legal_case_id
           where c.client_id = m.id and p.deleted_at is null),
         (select count(*)::int from public.partner_requests q join cases c on c.id = q.legal_case_id
           where c.client_id = m.id and q.partner_organization_id = v_org and q.status = 'OPEN'),
         (select count(*)::int from public.case_document_requirements r join cases c on c.id = r.legal_case_id
           where c.client_id = m.id and r.status = 'REQUESTED')
  from mine m;
end
$$;

create or replace function public.get_partner_client_counts(p_client_ids uuid[])
returns table (client_id uuid, case_count integer, process_count integer, open_request_count integer, requested_document_count integer)
language sql
stable
security invoker
set search_path = ''
as $$ select * from private.get_partner_client_counts(p_client_ids) $$;

revoke all on function private.get_partner_client_counts(uuid[]) from public, anon, service_role;
grant execute on function private.get_partner_client_counts(uuid[]) to authenticated;
revoke all on function public.get_partner_client_counts(uuid[]) from public, anon;
grant execute on function public.get_partner_client_counts(uuid[]) to authenticated;
