-- 037 — Produtor de notificações e preferências (Etapa 4.3.1)
--
-- A caixa (sino, página, lida/todas) já existia; nada a enchia. Agora:
--
--   1. private.notify(...) — o ÚNICO ponto que grava notificação. Regras:
--        • não notifica quem fez a ação (auth.uid / dg.actor_user_id);
--        • destinatário com vínculo, organização e perfil ATIVOS;
--        • parceiro só recebe aviso de caso operado pelo PRÓPRIO escritório
--          (conferido aqui também, além de quem calcula o destinatário);
--        • respeita a preferência da CATEGORIA (in-app desligado = não grava),
--          exceto SEGURANÇA, que não se desliga;
--        • chave de evento única por usuário: nova tentativa, gatilho
--          repetido ou corrida não criam duas notificações iguais.
--   2. Gatilhos AFTER nas tabelas de domínio chamam notify na MESMA
--      transação da operação: se ela falhar, a notificação não existe; se a
--      notificação existir, a operação aconteceu. Destinatário calculado
--      AQUI (nunca vem do navegador).
--   3. Lembretes de prazo (próximo / vencido): private.notify_deadline_reminders(),
--      idempotente (uma vez por prazo e tipo), chamada pelo ciclo do worker
--      (dg_worker) e, se o projeto tiver pg_cron, agendada de hora em hora.
--   4. Preferências: a tabela user_notification_preferences (010) passa a
--      guardar uma linha por CATEGORIA. Categoria desconhecida é recusada e
--      SEGURANÇA não aceita in-app desligado. E-mail fica guardado para
--      quando houver envio (nenhum e-mail é enviado nesta etapa).
--
-- Categorias: CASES, DEADLINES, DOCUMENTS, REVIEWS, PARTNER_REQUESTS,
-- ANALYSES, FINANCE e SECURITY (crítica).

-- ───────────────────────────── tabela ─────────────────────────────────────

alter table public.notifications
  add column event_key    text check (event_key is null or length(event_key) between 1 and 200),
  add column related_type text check (related_type is null or related_type in ('review', 'analysis', 'deadline', 'document', 'transfer', 'agent_run')),
  add column related_id   uuid;

create unique index notifications_user_event_key on public.notifications (user_id, event_key) where event_key is not null;

comment on column public.notifications.event_key is
  'Chave do evento de origem: a mesma notificação lógica nunca é gravada duas vezes para o mesmo usuário.';

-- ───────────────────────────── categorias ─────────────────────────────────

create or replace function private.notification_category(p_type text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_type in ('CASE_SUBMITTED', 'CASE_ASSIGNED', 'CASE_ACCEPTED', 'CASE_REJECTED', 'CASE_UPDATE',
                    'CASE_DOCUMENTS_PENDING', 'CASE_READY_FOR_ANALYSIS', 'CASE_WAITING_REVIEW', 'CASE_LAWYER_REQUIRED') then 'CASES'
    when p_type in ('DEADLINE', 'DEADLINE_CREATED', 'DEADLINE_ASSIGNED', 'DEADLINE_DUE_SOON', 'DEADLINE_OVERDUE', 'TASK_OVERDUE') then 'DEADLINES'
    when p_type in ('DOCUMENT_MISSING', 'DOCUMENT_REQUESTED', 'DOCUMENT_RECEIVED') then 'DOCUMENTS'
    when p_type in ('REVIEW_WAITING', 'REVIEW_ASSIGNED', 'REVIEW_DECIDED') then 'REVIEWS'
    when p_type in ('PARTNER_REQUEST_CREATED', 'PARTNER_REQUEST_REPLY') then 'PARTNER_REQUESTS'
    when p_type in ('ANALYSIS_SENT', 'ANALYSIS_COMPLETED', 'ANALYSIS_FAILED', 'ANALYSIS_READY_FOR_REVIEW',
                    'AGENT_INTERVENTION', 'AGENT_RUN_ATTENTION') then 'ANALYSES'
    when p_type in ('PARTNER_TRANSFER_REGISTERED', 'PARTNER_TRANSFER_PAID') then 'FINANCE'
    when p_type in ('MFA_RESET', 'ROLE_CHANGED', 'SECURITY_NOTICE') then 'SECURITY'
    else 'OTHER'
  end
$$;

-- Preferência por categoria; SEGURANÇA não desliga na plataforma.
alter table public.user_notification_preferences
  add constraint user_notification_preferences_category
    check (notification_type in ('CASES', 'DEADLINES', 'DOCUMENTS', 'REVIEWS', 'PARTNER_REQUESTS', 'ANALYSES', 'FINANCE', 'SECURITY')) not valid,
  add constraint user_notification_preferences_security_in_app
    check (notification_type <> 'SECURITY' or in_app) not valid;

comment on table public.user_notification_preferences is
  'Uma linha por CATEGORIA de aviso (037): canal in-app (respeitado pelo produtor) e e-mail (guardado; envio em etapa futura). Sem linha = padrão: in-app ligado, e-mail desligado. SECURITY é sempre in-app.';

-- ───────────────────────────── o produtor ─────────────────────────────────

create or replace function private.notify(
  p_user         uuid,
  p_type         text,
  p_title        text,
  p_message      text,
  p_severity     text,
  p_event_key    text,
  p_case         uuid default null,
  p_process      uuid default null,
  p_request      uuid default null,
  p_related_type text default null,
  p_related_id   uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := coalesce(auth.uid(), nullif(current_setting('dg.actor_user_id', true), '')::uuid);
  v_org   record;
  v_cat   text := private.notification_category(p_type);
  v_id    uuid;
begin
  if p_user is null or p_user = v_actor then
    return false;
  end if;
  -- Destinatário ativo (vínculo, organização e perfil).
  select m.organization_id, o.type into v_org
  from public.organization_memberships m
  join public.organizations o on o.id = m.organization_id
  join public.profiles p on p.id = m.user_id
  where m.user_id = p_user and m.status = 'ACTIVE' and o.status = 'ACTIVE' and o.deleted_at is null and p.active
  limit 1;
  if not found then
    return false;
  end if;
  -- Parceiro: só caso do próprio escritório.
  if v_org.type = 'PARTNER' and p_case is not null and not exists (
    select 1 from public.legal_cases c where c.id = p_case and c.partner_organization_id = v_org.organization_id and c.deleted_at is null
  ) then
    return false;
  end if;
  -- Preferência da categoria (segurança não se desliga).
  if v_cat <> 'SECURITY' and exists (
    select 1 from public.user_notification_preferences pr
    where pr.user_id = p_user and pr.notification_type = v_cat and not pr.in_app
  ) then
    return false;
  end if;

  insert into public.notifications
    (user_id, type, title, message, severity, legal_case_id, legal_process_id, partner_request_id, event_key, related_type, related_id)
  values
    (p_user, p_type, left(p_title, 200), left(p_message, 1000), coalesce(p_severity, 'INFO'), p_case, p_process, p_request,
     p_event_key, p_related_type, p_related_id)
  on conflict (user_id, event_key) where event_key is not null do nothing
  returning id into v_id;
  return v_id is not null;
end
$$;

revoke all on function private.notify(uuid, text, text, text, text, text, uuid, uuid, uuid, text, uuid) from public, anon, authenticated, service_role;

-- Integrantes ativos de uma organização (opcionalmente por papel).
create or replace function private.org_member_ids(p_org uuid, p_roles public.membership_role[] default null)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.user_id
  from public.organization_memberships m
  join public.profiles p on p.id = m.user_id
  where m.organization_id = p_org and m.status = 'ACTIVE' and p.active
    and (p_roles is null or m.role = any (p_roles))
$$;

-- ADMIN ativos (só quando realmente precisa: triagem de caso sem responsável).
create or replace function private.active_admin_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.user_id
  from public.organization_memberships m
  join public.organizations o on o.id = m.organization_id and o.type = 'OWNER'
  join public.profiles p on p.id = m.user_id
  where m.role = 'ADMIN' and m.status = 'ACTIVE' and p.active
$$;

revoke all on function private.org_member_ids(uuid, public.membership_role[]) from public, anon, authenticated, service_role;
revoke all on function private.active_admin_ids() from public, anon, authenticated, service_role;

-- ───────────────────────────── casos ──────────────────────────────────────

create or replace function private.notify_legal_cases()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  u uuid;
  v_from_partner boolean;
begin
  if new.deleted_at is not null then
    return null;
  end if;
  v_from_partner := exists (select 1 from public.organizations o where o.id = new.created_by_organization_id and o.type = 'PARTNER');

  -- Caso enviado pelo parceiro: advogado responsável; sem responsável, a triagem (ADMIN).
  if new.status = 'SUBMITTED' and v_from_partner
     and (tg_op = 'INSERT' or old.status is distinct from 'SUBMITTED') then
    if new.assigned_lawyer_id is not null then
      perform private.notify(new.assigned_lawyer_id, 'CASE_SUBMITTED', 'Novo caso enviado pelo parceiro', new.title, 'INFO',
                             'case-submitted:' || new.id, new.id);
    else
      for u in select private.active_admin_ids() loop
        perform private.notify(u, 'CASE_SUBMITTED', 'Novo caso enviado pelo parceiro', new.title, 'INFO',
                               'case-submitted:' || new.id, new.id);
      end loop;
    end if;
  end if;

  if tg_op = 'UPDATE' then
    -- Atribuição ao advogado.
    if new.assigned_lawyer_id is not null and new.assigned_lawyer_id is distinct from old.assigned_lawyer_id then
      perform private.notify(new.assigned_lawyer_id, 'CASE_ASSIGNED', 'Caso atribuído a você', new.title, 'INFO',
                             'case-assigned:' || new.id || ':' || new.assigned_lawyer_id, new.id);
    end if;
    -- Decisão comunicada ao escritório parceiro que opera o caso.
    if new.partner_organization_id is not null and new.status is distinct from old.status
       and new.status in ('ACCEPTED', 'REJECTED') then
      for u in select private.org_member_ids(new.partner_organization_id) loop
        if new.status = 'ACCEPTED' then
          perform private.notify(u, 'CASE_ACCEPTED', 'Caso aceito', new.title, 'INFO', 'case-accepted:' || new.id, new.id);
        else
          -- Só o motivo PÚBLICO (o interno nunca sai de legal_case_internal_details).
          perform private.notify(u, 'CASE_REJECTED', 'Caso não aceito: ' || new.title, new.rejection_reason_public, 'WARNING',
                                 'case-rejected:' || new.id, new.id);
        end if;
      end loop;
    end if;
  end if;
  return null;
end
$$;

create trigger legal_cases_notify
  after insert or update of status, assigned_lawyer_id on public.legal_cases
  for each row execute function private.notify_legal_cases();

-- ───────────────────────────── prazos ─────────────────────────────────────

create or replace function private.deadline_recipient(p_responsible uuid, p_case uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p_responsible, (select c.assigned_lawyer_id from public.legal_cases c where c.id = p_case))
$$;
revoke all on function private.deadline_recipient(uuid, uuid) from public, anon, authenticated, service_role;

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

create trigger deadlines_notify
  after insert or update of responsible_user_id on public.deadlines
  for each row execute function private.notify_deadlines();

-- Lembretes: prazo em até 48 h e prazo vencido — uma vez cada, por prazo.
create or replace function private.notify_deadline_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  d record;
  n integer := 0;
begin
  for d in
    select dl.id, dl.title, dl.due_at, dl.legal_case_id, dl.legal_process_id,
           private.deadline_recipient(dl.responsible_user_id, dl.legal_case_id) as recipient,
           dl.due_at < now() as overdue
    from public.deadlines dl
    join public.legal_cases c on c.id = dl.legal_case_id and c.deleted_at is null
    where dl.status = 'OPEN' and dl.due_at < now() + interval '48 hours'
  loop
    if private.notify(d.recipient,
         case when d.overdue then 'DEADLINE_OVERDUE' else 'DEADLINE_DUE_SOON' end,
         case when d.overdue then 'Prazo vencido: ' else 'Prazo próximo: ' end || d.title,
         'Vencimento: ' || to_char(d.due_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') || '.',
         case when d.overdue then 'URGENT' else 'WARNING' end,
         case when d.overdue then 'deadline-overdue:' else 'deadline-due-soon:' end || d.id,
         d.legal_case_id, d.legal_process_id, null, 'deadline', d.id) then
      n := n + 1;
    end if;
  end loop;
  return n;
end
$$;

revoke all on function private.notify_deadline_reminders() from public, anon, authenticated;
grant execute on function private.notify_deadline_reminders() to dg_worker, service_role;

-- ───────────────────────────── documentos pedidos / recebidos ─────────────

create or replace function private.notify_requirements()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  u uuid;
  v_case record;
begin
  select c.id, c.title, c.partner_organization_id, c.assigned_lawyer_id into v_case
  from public.legal_cases c where c.id = new.legal_case_id and c.deleted_at is null;
  if not found then
    return null;
  end if;
  -- Pedido ao parceiro (inclusive pedido de novo depois de uma recusa).
  if new.status = 'REQUESTED' and v_case.partner_organization_id is not null
     and (tg_op = 'INSERT' or old.status is distinct from 'REQUESTED') then
    for u in select private.org_member_ids(v_case.partner_organization_id) loop
      perform private.notify(u, 'DOCUMENT_REQUESTED', 'Documento solicitado: ' || new.requirement_label, v_case.title, 'WARNING',
                             'requirement-requested:' || new.id || ':' || coalesce(new.requested_at::text, ''), v_case.id);
    end loop;
  end if;
  -- Recebido: o advogado responsável confere.
  if tg_op = 'UPDATE' and new.status = 'RECEIVED' and old.status is distinct from 'RECEIVED' then
    perform private.notify(v_case.assigned_lawyer_id, 'DOCUMENT_RECEIVED', 'Documento recebido: ' || new.requirement_label, v_case.title, 'INFO',
                           'requirement-received:' || new.id || ':' || coalesce(new.satisfied_at::text, ''), v_case.id);
  end if;
  return null;
end
$$;

create trigger case_document_requirements_notify
  after insert or update of status on public.case_document_requirements
  for each row execute function private.notify_requirements();

-- ───────────────────────────── revisões ───────────────────────────────────

create or replace function private.notify_reviews()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_subject text;
  v_owner   uuid;
begin
  v_subject := coalesce(
    (select 'Análise: ' || t.name from public.legal_analyses a join public.analysis_templates t on t.id = a.analysis_template_id where a.id = new.legal_analysis_id),
    (select 'Documento: ' || d.title || ' (v' || v.version_number || ')' from public.document_versions v join public.documents d on d.id = v.document_id where v.id = new.document_version_id),
    'Proposta do agente');

  -- Atribuída (na criação ou depois).
  if new.assigned_reviewer_id is not null
     and (tg_op = 'INSERT' or new.assigned_reviewer_id is distinct from old.assigned_reviewer_id)
     and new.status in ('PENDING', 'REOPENED') then
    perform private.notify(new.assigned_reviewer_id, 'REVIEW_ASSIGNED', 'Revisão atribuída a você', v_subject,
                           case when new.priority = 'URGENT' then 'URGENT' else 'INFO' end,
                           'review-assigned:' || new.id || ':' || new.assigned_reviewer_id, new.legal_case_id, new.legal_process_id, null, 'review', new.id);
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

create trigger reviews_notify
  after insert or update of status, assigned_reviewer_id on public.reviews
  for each row execute function private.notify_reviews();

-- ───────────────────────────── solicitações ao parceiro ───────────────────

create or replace function private.notify_partner_requests()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  u uuid;
  v_lawyer uuid;
begin
  if exists (select 1 from public.organization_memberships m join public.organizations o on o.id = m.organization_id
             where m.user_id = new.created_by and m.status = 'ACTIVE' and o.type = 'PARTNER') then
    -- Aberta pelo parceiro: o advogado do caso; sem advogado, a triagem.
    select c.assigned_lawyer_id into v_lawyer from public.legal_cases c where c.id = new.legal_case_id;
    if v_lawyer is not null then
      perform private.notify(v_lawyer, 'PARTNER_REQUEST_CREATED', 'Nova solicitação do parceiro', new.title, 'INFO',
                             'request-created:' || new.id, new.legal_case_id, new.legal_process_id, new.id);
    else
      for u in select private.active_admin_ids() loop
        perform private.notify(u, 'PARTNER_REQUEST_CREATED', 'Nova solicitação do parceiro', new.title, 'INFO',
                               'request-created:' || new.id, new.legal_case_id, new.legal_process_id, new.id);
      end loop;
    end if;
  else
    for u in select private.org_member_ids(new.partner_organization_id) loop
      perform private.notify(u, 'PARTNER_REQUEST_CREATED', 'Nova solicitação: ' || new.title, new.description, 'WARNING',
                             'request-created:' || new.id, new.legal_case_id, new.legal_process_id, new.id);
    end loop;
  end if;
  return null;
end
$$;

create trigger partner_requests_notify
  after insert on public.partner_requests
  for each row execute function private.notify_partner_requests();

create or replace function private.notify_partner_request_messages()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  u uuid;
  v_req record;
  v_partner_author boolean;
begin
  select q.id, q.title, q.legal_case_id, q.legal_process_id, q.partner_organization_id, q.created_by, c.assigned_lawyer_id
    into v_req
  from public.partner_requests q join public.legal_cases c on c.id = q.legal_case_id
  where q.id = new.partner_request_id;
  v_partner_author := private.user_organization_id(new.author_id) = v_req.partner_organization_id;

  if v_partner_author then
    -- Resposta do parceiro: quem abriu a solicitação (se interno) e o advogado do caso.
    for u in select distinct x from unnest(array[v_req.assigned_lawyer_id,
               case when private.is_active_internal_user(v_req.created_by) then v_req.created_by end]) as t(x) where x is not null loop
      perform private.notify(u, 'PARTNER_REQUEST_REPLY', 'Resposta do parceiro', v_req.title, 'INFO',
                             'request-message:' || new.id, v_req.legal_case_id, v_req.legal_process_id, v_req.id);
    end loop;
  else
    for u in select private.org_member_ids(v_req.partner_organization_id) loop
      perform private.notify(u, 'PARTNER_REQUEST_REPLY', 'Nova mensagem na solicitação', v_req.title, 'INFO',
                             'request-message:' || new.id, v_req.legal_case_id, v_req.legal_process_id, v_req.id);
    end loop;
  end if;
  return null;
end
$$;

create trigger partner_request_messages_notify
  after insert on public.partner_request_messages
  for each row execute function private.notify_partner_request_messages();

-- ───────────────────────────── análises e execuções ───────────────────────

create or replace function private.notify_legal_analyses()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case record;
  v_name text;
begin
  if new.status is not distinct from old.status then
    return null;
  end if;
  select c.id, c.title, c.assigned_lawyer_id into v_case from public.legal_cases c where c.id = new.legal_case_id;
  select t.name into v_name from public.analysis_templates t where t.id = new.analysis_template_id;

  if new.status = 'QUEUED' then
    -- Enviada por outra pessoa num caso do advogado responsável.
    perform private.notify(v_case.assigned_lawyer_id, 'ANALYSIS_SENT', 'Análise enviada ao agente', coalesce(v_name, 'Análise') || ' · ' || v_case.title, 'INFO',
                           'analysis-sent:' || new.id || ':' || coalesce(new.agent_run_id::text, ''), v_case.id, null, null, 'analysis', new.id);
  elsif new.status in ('WAITING_REVIEW', 'COMPLETED', 'FAILED') then
    perform private.notify(new.started_by,
                           case new.status when 'WAITING_REVIEW' then 'ANALYSIS_READY_FOR_REVIEW' when 'COMPLETED' then 'ANALYSIS_COMPLETED' else 'ANALYSIS_FAILED' end,
                           case new.status when 'WAITING_REVIEW' then 'Resultado da análise aguardando revisão' when 'COMPLETED' then 'Análise concluída' else 'A análise falhou' end,
                           coalesce(v_name, 'Análise') || ' · ' || v_case.title,
                           case when new.status = 'FAILED' then 'WARNING' else 'INFO' end,
                           'analysis-' || lower(new.status) || ':' || new.id || ':' || coalesce(new.agent_run_id::text, ''),
                           v_case.id, null, null, 'analysis', new.id);
  end if;
  return null;
end
$$;

create trigger legal_analyses_notify
  after update of status on public.legal_analyses
  for each row execute function private.notify_legal_analyses();

-- Execução SEM análise (as de análise já avisam pela análise) que exige atenção.
create or replace function private.notify_agent_runs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status and new.status in ('WAITING_HUMAN', 'FAILED')
     and not exists (select 1 from public.legal_analyses a where a.agent_run_id = new.id) then
    perform private.notify(new.requested_by, 'AGENT_RUN_ATTENTION',
                           case new.status when 'WAITING_HUMAN' then 'Execução do agente aguardando decisão' else 'A execução do agente falhou' end,
                           null, case when new.status = 'FAILED' then 'WARNING' else 'INFO' end,
                           'run:' || new.id || ':' || new.status, new.legal_case_id, new.legal_process_id, null, 'agent_run', new.id);
  end if;
  return null;
end
$$;

create trigger agent_runs_notify
  after update of status on public.agent_runs
  for each row execute function private.notify_agent_runs();

-- ───────────────────────────── financeiro do parceiro ─────────────────────

create or replace function private.notify_partner_transfers()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  u uuid;
begin
  if tg_op = 'INSERT' or (new.status is distinct from old.status and new.status = 'PAID') then
    for u in select private.org_member_ids(new.partner_organization_id, array['PARTNER_ADMIN']::public.membership_role[]) loop
      perform private.notify(u,
                             case when tg_op = 'INSERT' then 'PARTNER_TRANSFER_REGISTERED' else 'PARTNER_TRANSFER_PAID' end,
                             case when tg_op = 'INSERT' then 'Repasse registrado' else 'Repasse pago' end,
                             'Confira em Financeiro.', 'INFO',
                             'transfer:' || new.id || ':' || case when tg_op = 'INSERT' then 'registered' else 'paid' end,
                             null, null, null, 'transfer', new.id);
    end loop;
  end if;
  return null;
end
$$;

create trigger partner_transfers_notify
  after insert or update of status on public.partner_transfers
  for each row execute function private.notify_partner_transfers();

-- ───────────────────────────── segurança (não se desliga) ─────────────────
-- A partir da trilha que já é gravada: MFA redefinido por um ADMIN e troca de
-- perfil de acesso. Avisa a PRÓPRIA pessoa.

create or replace function private.notify_security_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.action = 'MFA_RESET_COMPLETED' and new.entity_type = 'profiles' then
    perform private.notify(new.entity_id, 'MFA_RESET', 'Sua verificação em duas etapas foi redefinida',
                           'Um administrador removeu o seu autenticador. Se você não pediu isso, avise o administrador do escritório.',
                           'WARNING', 'security:' || new.id);
  elsif new.action = 'ROLE_CHANGED' then
    perform private.notify((new.metadata ->> 'user_id')::uuid, 'ROLE_CHANGED', 'Seu perfil de acesso mudou',
                           'As telas e ações disponíveis para você foram atualizadas.', 'WARNING', 'security:' || new.id);
  end if;
  return null;
end
$$;

create trigger audit_events_notify_security
  after insert on public.audit_events
  for each row when (new.action in ('MFA_RESET_COMPLETED', 'ROLE_CHANGED'))
  execute function private.notify_security_events();

-- Funções de gatilho: ninguém as executa direto.
revoke all on function private.notify_legal_cases() from public, anon, authenticated, service_role;
revoke all on function private.notify_deadlines() from public, anon, authenticated, service_role;
revoke all on function private.notify_requirements() from public, anon, authenticated, service_role;
revoke all on function private.notify_reviews() from public, anon, authenticated, service_role;
revoke all on function private.notify_partner_requests() from public, anon, authenticated, service_role;
revoke all on function private.notify_partner_request_messages() from public, anon, authenticated, service_role;
revoke all on function private.notify_legal_analyses() from public, anon, authenticated, service_role;
revoke all on function private.notify_agent_runs() from public, anon, authenticated, service_role;
revoke all on function private.notify_partner_transfers() from public, anon, authenticated, service_role;
revoke all on function private.notify_security_events() from public, anon, authenticated, service_role;
revoke all on function private.notification_category(text) from public, anon, service_role;

-- ───────────────────────────── agendamento (se houver pg_cron) ────────────

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('dg-deadline-reminders', '15 * * * *', 'select private.notify_deadline_reminders()');
  end if;
exception when others then
  raise notice 'pg_cron indisponível: lembretes de prazo pelo ciclo do worker (%).', sqlerrm;
end
$$;
