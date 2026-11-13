-- 063 · Prazos: reabrir com motivo, lembretes em dias úteis, agenda, conferência
--       do prazo do agente, audiência com hora e local, aplicador mais firme.
--
-- Revisão final antes da produção (13/11/2026). Prazo perdido é o maior risco do
-- escritório. Até a 061:
--   - cumprir e cancelar eram um clique sem volta, e a regra de quem pode mudar
--     a situação do prazo só existia no servidor do painel (o banco aceitava
--     qualquer troca de situação feita por ADMIN ou advogado);
--   - o lembrete (037) era UM aviso "em até 48 h corridas" e UM "vencido", só
--     para o responsável (ou o advogado do caso). Não rearmava quando a data
--     mudava e não chegava a ninguém se o destinatário estivesse inativo, vazio
--     ou tivesse desligado a categoria Prazos;
--   - não havia como listar os prazos do escritório com cliente e processo;
--   - o prazo que nasceu de proposta de agente não tinha marca nem conferência,
--     e saía sempre como "Prazo interno";
--   - audiência não guardava modalidade, local nem link;
--   - o aplicador de propostas (018) criava prazo em processo excluído, lia
--     "2026-12-01" como 30/11 às 21h de Brasília e, quando a proposta APROVADA
--     falhava ao aplicar, ninguém ficava sabendo;
--   - criar prazo à mão não tinha chave de envio (o reenvio duplicava).
--
-- Agora:
--
--   1. Colunas novas em deadlines: status_reason, status_changed_at,
--      status_changed_by (a última mudança de situação e o motivo), checked_at,
--      checked_by (conferência do prazo do agente), hearing_mode,
--      hearing_location, hearing_link (audiência).
--   2. Situação do prazo no banco (gatilho deadlines_transition_guard): em
--      aberto → cumprido, cancelado ou perdido; cumprido, cancelado ou perdido →
--      em aberto (reabrir). Qualquer outra troca é recusada. Cancelar e reabrir
--      exigem motivo. Reabrir limpa a data de cumprimento. Vale para qualquer
--      caminho, inclusive UPDATE direto pela API.
--   3. public.deadline_transition(prazo, ação, motivo): COMPLETE, CANCEL, MISS e
--      REOPEN, só ADMIN e advogado, com a linha travada. Cancelar, perder e
--      reabrir ficam na auditoria com o motivo (DEADLINE_CANCELLED,
--      DEADLINE_MISSED, DEADLINE_REOPENED); cumprir já é auditado pelo gatilho
--      da 014 (DEADLINE_COMPLETED). Reabrir avisa quem cuida do prazo.
--   4. public.deadline_mark_checked(prazo): "Conferido" no prazo que nasceu de
--      proposta de agente (source = 'AGENT'). Grava quem e quando, uma vez só, e
--      audita (DEADLINE_CHECKED).
--   5. public.create_deadline_once(chave, prazo): criação manual com chave de
--      envio, no padrão da 027 (mesma chave + mesmo pedido = o mesmo prazo).
--   6. View public.deadline_agenda (security_invoker: vale a RLS de quem lê): uma
--      linha por prazo com situação efetiva, data local, cliente, caso, processo
--      e CNJ. É o que a tela Prazos e a Home leem. deadline_status (026) não muda.
--   7. Avisos de prazo:
--        a) lembretes em 5, 3 e 1 dia ÚTIL antes e no dia do vencimento. Dia
--           útil = private.non_business_reason (043): fins de semana, feriados
--           nacionais, Sexta-feira Santa, recesso de 20/12 a 20/01 e os dias
--           cadastrados para todos os tribunais. Dia cadastrado só para UM
--           tribunal não entra nesta conta;
--        b) destinatário de reserva (private.deadline_recipients): responsável
--           ativo → advogado do caso ativo → ADMINs ativos do escritório;
--        c) prazo vencido avisa quem cuida do prazo E os ADMINs, e repete uma
--           vez por dia útil enquanto estiver em aberto (em fim de semana ou
--           feriado sai só o primeiro aviso);
--        d) a data do vencimento entra na chave do aviso: mudou a data, os
--           lembretes rearmam;
--        e) a categoria Prazos não se desliga mais (como Segurança):
--           private.notify ignora a preferência e a tabela de preferências
--           recusa in_app = false para DEADLINES. Quem tinha desligado volta a
--           receber;
--        f) prazo de caso ou de processo excluído não gera lembrete.
--      O agendamento não muda: 'dg-lembretes-de-prazo', a cada 15 min (040).
--      E-mail continua fora (não há envio configurado).
--   8. Aplicador de propostas (018):
--        - CREATE_DEADLINE grava o deadline_type da proposta quando ele é um dos
--          tipos válidos; senão fica o padrão (INTERNAL);
--        - não cria prazo em caso ou processo excluído (a proposta vira FAILED);
--        - due_at só com a data ("2026-12-01") = fim do dia em Brasília; data e
--          hora sem fuso = horário de Brasília; com fuso, como veio;
--        - proposta aprovada que falha ao aplicar avisa quem aprovou e os
--          ADMINs. Se era prazo, o aviso é da categoria Prazos (não se desliga).
--      As garantias do prazo direto (059) e do prazo que vira tarefa (061) não
--      mudam: as funções delas não são tocadas, só o aplicador que elas chamam.
--
-- 001–062 não são alteradas (008 ganha colunas por ALTER; funções da 018, 037 e
-- 059 são redefinidas aqui, sempre a partir da definição mais recente). Rodar de
-- novo não quebra nem duplica.

-- ═════════════════════════════ 1. colunas ════════════════════════════════

alter table public.deadlines
  add column if not exists status_reason     text check (status_reason is null or length(status_reason) <= 1000),
  add column if not exists status_changed_at timestamptz,
  add column if not exists status_changed_by uuid references public.profiles (id) on delete restrict,
  add column if not exists checked_at        timestamptz,
  add column if not exists checked_by        uuid references public.profiles (id) on delete restrict,
  add column if not exists hearing_mode      text check (hearing_mode is null or hearing_mode in ('IN_PERSON', 'VIDEO')),
  add column if not exists hearing_location  text check (hearing_location is null or length(hearing_location) <= 500),
  add column if not exists hearing_link      text check (hearing_link is null or (length(hearing_link) <= 1000 and hearing_link ~* '^https?://'));

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'deadlines_checked_pair' and conrelid = 'public.deadlines'::regclass) then
    alter table public.deadlines
      add constraint deadlines_checked_pair check ((checked_at is null) = (checked_by is null));
  end if;
end
$$;

comment on column public.deadlines.status_reason is
  'Motivo da última mudança de situação (063). Obrigatório ao cancelar e ao reabrir.';
comment on column public.deadlines.checked_at is
  'Conferência humana do prazo que nasceu de proposta de agente (063). Vazio = ainda não conferido.';
comment on column public.deadlines.hearing_mode is
  'Audiência (063): IN_PERSON (presencial) ou VIDEO (videoconferência). Só faz sentido com deadline_type = HEARING.';

create index if not exists deadlines_agent_unchecked_idx
  on public.deadlines (due_at) where source = 'AGENT' and checked_at is null and status = 'OPEN';

-- ═════════════════════════════ 2. situação do prazo ══════════════════════

-- Trocas de situação aceitas, para qualquer caminho de gravação. As mensagens
-- chegam à tela (código 23514).
create or replace function private.deadlines_transition_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := coalesce(auth.uid(), nullif(current_setting('dg.actor_user_id', true), '')::uuid);
begin
  if new.status is distinct from old.status then
    if old.status = 'OPEN' and new.status in ('COMPLETED', 'CANCELLED', 'MISSED') then
      if new.status = 'CANCELLED' and nullif(btrim(coalesce(new.status_reason, '')), '') is null then
        raise exception 'Informe o motivo do cancelamento do prazo' using errcode = '23514';
      end if;
    elsif old.status in ('COMPLETED', 'CANCELLED', 'MISSED') and new.status = 'OPEN' then
      if nullif(btrim(coalesce(new.status_reason, '')), '') is null then
        raise exception 'Informe o motivo para reabrir o prazo' using errcode = '23514';
      end if;
      new.completed_at := null;
    elsif old.status = 'OPEN' then
      raise exception 'Situação de prazo inválida' using errcode = '23514';
    else
      raise exception 'Só é possível alterar um prazo em aberto. Reabra o prazo antes' using errcode = '23514';
    end if;
    new.status_reason := nullif(btrim(coalesce(new.status_reason, '')), '');
    new.status_changed_at := now();
    new.status_changed_by := v_actor;
  end if;

  -- Conferência: uma vez só, em nome de quem está logado.
  if new.checked_at is distinct from old.checked_at or new.checked_by is distinct from old.checked_by then
    if old.checked_at is not null then
      raise exception 'A conferência deste prazo já foi registrada' using errcode = '23514';
    end if;
    if new.source <> 'AGENT' then
      raise exception 'Só o prazo criado por agente tem conferência' using errcode = '23514';
    end if;
    new.checked_at := now();
    new.checked_by := coalesce(auth.uid(), new.checked_by);
  end if;
  return new;
end
$$;

drop trigger if exists deadlines_transition_guard on public.deadlines;
create trigger deadlines_transition_guard
  before update on public.deadlines
  for each row execute function private.deadlines_transition_guard();

-- Quem cuida do prazo: responsável ativo; senão o advogado do caso ativo; senão
-- os ADMINs ativos do escritório. Nunca fica sem ninguém enquanto houver ADMIN.
create or replace function private.deadline_recipients(p_responsible uuid, p_case uuid)
returns setof uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_lawyer uuid;
begin
  if p_responsible is not null and private.is_active_internal_user(p_responsible) then
    return next p_responsible;
    return;
  end if;
  select c.assigned_lawyer_id into v_lawyer from public.legal_cases c where c.id = p_case;
  if v_lawyer is not null and private.is_active_internal_user(v_lawyer) then
    return next v_lawyer;
    return;
  end if;
  return query select private.active_admin_ids();
end
$$;

-- A versão de um destinatário só (037) continua existindo: o primeiro da reserva.
create or replace function private.deadline_recipient(p_responsible uuid, p_case uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u from private.deadline_recipients(p_responsible, p_case) u limit 1
$$;

-- Cumprir, cancelar, marcar como perdido e reabrir. Só ADMIN e advogado. A
-- linha fica travada até o fim: dois cliques não passam juntos.
create or replace function private.deadline_transition(p_deadline_id uuid, p_action text, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_d      public.deadlines;
  v_to     text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  u        uuid;
begin
  if not private.has_internal_role('ADMIN', 'LAWYER') then
    raise exception 'Só administrador ou advogado altera a situação do prazo' using errcode = '42501';
  end if;
  v_to := case upper(coalesce(p_action, ''))
            when 'COMPLETE' then 'COMPLETED' when 'CANCEL' then 'CANCELLED'
            when 'MISS' then 'MISSED' when 'REOPEN' then 'OPEN' end;
  if v_to is null then
    raise exception 'Ação de prazo desconhecida' using errcode = '22023';
  end if;
  if length(v_reason) > 1000 then
    raise exception 'O motivo pode ter até 1000 caracteres' using errcode = '22023';
  end if;

  -- Prazo de caso ou processo excluído = não encontrado, como nas listagens.
  select d.* into v_d
  from public.deadlines d
  join public.legal_cases c on c.id = d.legal_case_id and c.deleted_at is null
  left join public.legal_processes p on p.id = d.legal_process_id
  where d.id = p_deadline_id and (d.legal_process_id is null or p.deleted_at is null)
  for update of d;
  if v_d.id is null then
    raise exception 'Prazo não encontrado' using errcode = 'P0002';
  end if;

  if v_to = 'OPEN' and v_d.status = 'OPEN' then
    raise exception 'O prazo já está em aberto' using errcode = '23514';
  end if;
  if v_to <> 'OPEN' and v_d.status <> 'OPEN' then
    raise exception 'Só é possível alterar um prazo em aberto. Reabra o prazo antes' using errcode = '23514';
  end if;

  -- O gatilho confere a troca (e exige o motivo de cancelar e reabrir).
  update public.deadlines
     set status = v_to, status_reason = v_reason,
         completed_at = case when v_to = 'COMPLETED' then now() else null end
   where id = v_d.id;

  if v_to <> 'COMPLETED' then
    perform private.record_audit_event(
      case v_to when 'OPEN' then 'DEADLINE_REOPENED' when 'CANCELLED' then 'DEADLINE_CANCELLED' else 'DEADLINE_MISSED' end,
      'deadlines', v_d.id,
      jsonb_build_object('legal_case_id', v_d.legal_case_id, 'legal_process_id', v_d.legal_process_id,
                         'from', v_d.status, 'to', v_to, 'reason', v_reason));
  end if;

  if v_to = 'OPEN' then
    for u in select private.deadline_recipients(v_d.responsible_user_id, v_d.legal_case_id) loop
      perform private.notify(u, 'DEADLINE', 'Prazo reaberto: ' || left(v_d.title, 150),
        'Vence em ' || to_char(v_d.due_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY') || '. Motivo: ' || left(v_reason, 600),
        case when v_d.due_at < now() then 'URGENT' else 'WARNING' end,
        'deadline-reopened:' || v_d.id || ':' || to_char(now(), 'YYYYMMDDHH24MISSUS'),
        v_d.legal_case_id, v_d.legal_process_id, null, 'deadline', v_d.id);
    end loop;
  end if;

  return jsonb_build_object('id', v_d.id, 'from', v_d.status, 'status', v_to);
end
$$;

-- "Conferido": uma pessoa conferiu o prazo que o agente lançou.
create or replace function private.deadline_mark_checked(p_deadline_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_d public.deadlines;
begin
  if not private.has_internal_role('ADMIN', 'LAWYER') then
    raise exception 'Só administrador ou advogado confere o prazo' using errcode = '42501';
  end if;
  select d.* into v_d
  from public.deadlines d
  join public.legal_cases c on c.id = d.legal_case_id and c.deleted_at is null
  left join public.legal_processes p on p.id = d.legal_process_id
  where d.id = p_deadline_id and (d.legal_process_id is null or p.deleted_at is null)
  for update of d;
  if v_d.id is null then
    raise exception 'Prazo não encontrado' using errcode = 'P0002';
  end if;
  if v_d.source <> 'AGENT' then
    raise exception 'Só o prazo criado por agente tem conferência' using errcode = '23514';
  end if;
  if v_d.checked_at is not null then
    return jsonb_build_object('id', v_d.id, 'checked_at', v_d.checked_at, 'checked_by', v_d.checked_by, 'already', true);
  end if;
  update public.deadlines set checked_at = now(), checked_by = auth.uid() where id = v_d.id
  returning * into v_d;
  perform private.record_audit_event('DEADLINE_CHECKED', 'deadlines', v_d.id,
    jsonb_build_object('legal_case_id', v_d.legal_case_id, 'legal_process_id', v_d.legal_process_id, 'source', v_d.source));
  return jsonb_build_object('id', v_d.id, 'checked_at', v_d.checked_at, 'checked_by', v_d.checked_by, 'already', false);
end
$$;

create or replace function public.deadline_transition(p_deadline_id uuid, p_action text, p_reason text default null)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.deadline_transition(p_deadline_id, p_action, p_reason) $$;

create or replace function public.deadline_mark_checked(p_deadline_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.deadline_mark_checked(p_deadline_id) $$;

-- ═════════════════════════════ 3. criar com chave de envio ═══════════════

-- Criação manual de prazo (padrão da 027). SECURITY INVOKER: a RLS de deadlines
-- vale (só ADMIN e advogado inserem). p_deadline: colunas de deadlines
-- (legal_case_id, legal_process_id, title, deadline_type, description, due_at,
-- priority, responsible_user_id, hearing_mode, hearing_location, hearing_link).
-- O id é gerado aqui e a origem é sempre MANUAL.
create or replace function public.create_deadline_once(p_key uuid, p_deadline jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_prev jsonb;
  v_id   uuid := gen_random_uuid();
  v_d    public.deadlines;
begin
  v_prev := private.idempotency_begin('deadline.create', p_key, jsonb_build_object('deadline', p_deadline - 'id'));
  if v_prev is not null then
    return jsonb_build_object('deadline_id', v_prev ->> 'resource_id', 'deduplicated', true);
  end if;

  v_d := jsonb_populate_record(null::public.deadlines, p_deadline - 'id');
  insert into public.deadlines
    (id, legal_case_id, legal_process_id, title, deadline_type, description, due_at, priority, responsible_user_id, source,
     hearing_mode, hearing_location, hearing_link)
  values
    (v_id, v_d.legal_case_id, v_d.legal_process_id, v_d.title, coalesce(v_d.deadline_type, 'INTERNAL'), v_d.description,
     v_d.due_at, coalesce(v_d.priority, 'NORMAL'), v_d.responsible_user_id, 'MANUAL',
     v_d.hearing_mode, v_d.hearing_location, v_d.hearing_link);

  perform private.idempotency_complete('deadline.create', p_key, 'deadlines', v_id, null);
  return jsonb_build_object('deadline_id', v_id, 'deduplicated', false);
end
$$;

-- ═════════════════════════════ 4. agenda ═════════════════════════════════

-- Uma linha por prazo, com o que a tela Prazos mostra. security_invoker: quem
-- lê só vê o que a RLS de cada tabela deixa (prazo é só da equipe interna).
create or replace view public.deadline_agenda
with (security_invoker = true)
as
select
  d.id,
  d.legal_case_id,
  d.legal_process_id,
  d.title,
  d.deadline_type,
  d.description,
  d.due_at,
  (d.due_at at time zone 'America/Sao_Paulo')::date as due_date_local,
  d.priority,
  d.status,
  case when d.status = 'OPEN' and d.due_at < now() then 'OVERDUE' else d.status end as effective_status,
  d.responsible_user_id,
  d.source,
  d.created_at,
  d.updated_at,
  d.completed_at,
  d.status_reason,
  d.status_changed_at,
  d.status_changed_by,
  d.checked_at,
  d.checked_by,
  (d.source = 'AGENT' and d.checked_at is null) as agent_unchecked,
  d.hearing_mode,
  d.hearing_location,
  d.hearing_link,
  (c.deleted_at is not null or p.deleted_at is not null) as scope_deleted,
  c.title as case_title,
  c.client_id,
  coalesce(i.full_name, co.legal_name) as client_name,
  p.title as process_title,
  p.cnj_number::text as process_cnj,
  p.court as process_court
from public.deadlines d
join public.legal_cases c on c.id = d.legal_case_id
left join public.legal_processes p on p.id = d.legal_process_id
left join public.individual_client_details i on i.client_id = c.client_id
left join public.company_client_details co on co.client_id = c.client_id;

comment on view public.deadline_agenda is
  'Agenda de prazos (063): prazo + situação efetiva + cliente, caso e processo. Só equipe interna (RLS de deadlines).';

revoke all on public.deadline_agenda from public, anon;
grant select on public.deadline_agenda to authenticated, service_role;

-- ═════════════════════════════ 5. avisos ═════════════════════════════════

-- Prazos não se desliga mais. Quem tinha desligado volta a receber.
update public.user_notification_preferences set in_app = true where notification_type = 'DEADLINES' and not in_app;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'user_notification_preferences_deadlines_in_app'
                   and conrelid = 'public.user_notification_preferences'::regclass) then
    alter table public.user_notification_preferences
      add constraint user_notification_preferences_deadlines_in_app
        check (notification_type <> 'DEADLINES' or in_app);
  end if;
end
$$;

comment on table public.user_notification_preferences is
  'Uma linha por CATEGORIA de aviso (037): canal in-app (respeitado pelo produtor) e e-mail (guardado; envio em etapa futura). Sem linha = padrão: in-app ligado, e-mail desligado. SECURITY e DEADLINES (063) são sempre in-app.';

-- O produtor (037). Única mudança (063): a categoria DEADLINES passa a ser como
-- SECURITY, a preferência não desliga o aviso.
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
  -- Preferência da categoria (segurança e prazos não se desligam).
  if v_cat not in ('SECURITY', 'DEADLINES') and exists (
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

-- Aviso de prazo novo (037, com a regra do prazo direto da 059). Única mudança
-- (063): o "Novo prazo" vai para quem cuida do prazo, com a reserva (responsável
-- → advogado do caso → ADMINs), em vez de sumir quando não há responsável ativo.
create or replace function private.notify_deadlines()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  u      uuid;
  v_sev  text := case new.priority when 'URGENT' then 'URGENT' when 'HIGH' then 'WARNING' else 'INFO' end;
  v_when text := to_char(new.due_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY');
begin
  if new.status <> 'OPEN' then
    return null;
  end if;
  if tg_op = 'INSERT' and current_setting('dg.prazo_direto', true) = 'on' then
    return null;
  end if;
  if tg_op = 'INSERT' then
    for u in select private.deadline_recipients(new.responsible_user_id, new.legal_case_id) loop
      perform private.notify(u, 'DEADLINE_CREATED', 'Novo prazo: ' || new.title, 'Vence em ' || v_when || '.', v_sev,
                             'deadline-created:' || new.id, new.legal_case_id, new.legal_process_id, null, 'deadline', new.id);
    end loop;
  elsif new.responsible_user_id is not null and new.responsible_user_id is distinct from old.responsible_user_id then
    perform private.notify(new.responsible_user_id, 'DEADLINE_ASSIGNED', 'Prazo atribuído a você: ' || new.title, 'Vence em ' || v_when || '.', v_sev,
                           'deadline-assigned:' || new.id || ':' || new.responsible_user_id, new.legal_case_id, new.legal_process_id, null, 'deadline', new.id);
  end if;
  return null;
end
$$;

-- Lembretes de prazo (037), reescritos (063). Chamada a cada 15 min pelo
-- agendamento 'dg-lembretes-de-prazo' (040). Idempotente: cada aviso tem uma
-- chave por prazo + data do vencimento + etapa (ou dia, no vencido).
--   D5, D3, D1  faltam até 5, 3 e 1 dia útil (contando hoje, sem contar o dia
--               do vencimento). Se o agendamento falhar num dia, a etapa sai
--               atrasada no dia seguinte; etapa já passada não sai duas vezes.
--   D0          vence hoje.
--   vencido     quem cuida do prazo + ADMINs, uma vez por dia útil enquanto
--               estiver em aberto. Em dia não útil sai só o primeiro aviso.
create or replace function private.notify_deadline_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  d       record;
  u       uuid;
  n       integer := 0;
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_days  date[];
  v_open  boolean;
  v_left  integer;
  v_stage text;
  v_title text;
  v_when  text;
  v_due   text;
  v_now   text;
begin
  -- Dias úteis de hoje em diante. 75 dias cobrem 5 dias úteis mesmo atravessando
  -- o recesso de 20/12 a 20/01.
  select coalesce(array_agg(g::date order by g), '{}') into v_days
  from generate_series(v_today::timestamp, (v_today + 75)::timestamp, interval '1 day') g
  where private.non_business_reason(g::date, null) is null;
  v_open := v_today = any (v_days);

  for d in
    select dl.id, dl.title, dl.due_at, dl.legal_case_id, dl.legal_process_id, dl.responsible_user_id,
           (dl.due_at at time zone 'America/Sao_Paulo')::date as due_day,
           dl.due_at < now() as overdue
    from public.deadlines dl
    join public.legal_cases c on c.id = dl.legal_case_id and c.deleted_at is null
    left join public.legal_processes p on p.id = dl.legal_process_id
    where dl.status = 'OPEN'
      and (dl.legal_process_id is null or p.deleted_at is null)
      and dl.due_at < now() + interval '75 days'
    order by dl.due_at, dl.id
  loop
    v_title := case when length(d.title) > 140 then left(d.title, 139) || '…' else d.title end;
    v_when  := to_char(d.due_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY "às" HH24:MI');
    v_due   := to_char(d.due_day, 'YYYY-MM-DD');
    v_now   := to_char(v_today, 'YYYY-MM-DD');

    if d.overdue then
      for u in
        select r.x from (select private.deadline_recipients(d.responsible_user_id, d.legal_case_id) as x
                         union
                         select private.active_admin_ids()) r
      loop
        if v_open or not exists (
             select 1 from public.notifications nt
             where nt.user_id = u and nt.event_key like 'deadline-overdue:' || d.id || ':' || v_due || ':%') then
          if private.notify(u, 'DEADLINE_OVERDUE', 'Prazo vencido: ' || v_title,
               'Venceu em ' || v_when || ' e continua em aberto. Abra Prazos para cumprir, cancelar ou marcar como perdido.',
               'URGENT', 'deadline-overdue:' || d.id || ':' || v_due || ':' || v_now,
               d.legal_case_id, d.legal_process_id, null, 'deadline', d.id) then
            n := n + 1;
          end if;
        end if;
      end loop;
    else
      if d.due_day = v_today then
        v_stage := 'D0';
        v_left := 0;
      else
        select count(*) into v_left from unnest(v_days) x where x < d.due_day;
        v_stage := case when v_left <= 1 then 'D1' when v_left <= 3 then 'D3' when v_left <= 5 then 'D5' end;
      end if;
      if v_stage is not null then
        for u in select private.deadline_recipients(d.responsible_user_id, d.legal_case_id) loop
          if private.notify(u, 'DEADLINE_DUE_SOON',
               case when v_stage = 'D0' then 'Prazo vence hoje: '
                    when v_left <= 0 then 'Prazo vence no próximo dia útil: '
                    when v_left = 1 then 'Prazo vence em 1 dia útil: '
                    else 'Prazo vence em ' || v_left || ' dias úteis: ' end || v_title,
               'Vencimento: ' || v_when || '.',
               case when v_stage in ('D0', 'D1') then 'URGENT' else 'WARNING' end,
               'deadline-reminder:' || d.id || ':' || v_due || ':' || v_stage,
               d.legal_case_id, d.legal_process_id, null, 'deadline', d.id) then
            n := n + 1;
          end if;
        end loop;
      end if;
    end if;
  end loop;
  return n;
end
$$;

-- ═════════════════════════════ 6. aplicador de propostas ═════════════════

-- Vencimento vindo de proposta. Só a data = fim do dia em Brasília; data e hora
-- sem fuso = horário de Brasília; com fuso, como veio. Qualquer outra coisa, o
-- Postgres tenta ler (e a proposta falha se não for data).
create or replace function private.proposal_due_at(p_text text)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  v text := btrim(coalesce(p_text, ''));
begin
  if v ~ '^\d{4}-\d{2}-\d{2}$' then
    return (v::date + time '23:59:59') at time zone 'America/Sao_Paulo';
  elsif v ~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$' then
    return v::timestamp at time zone 'America/Sao_Paulo';
  end if;
  return v::timestamptz;
end
$$;

-- O aplicador (018). Só o ramo CREATE_DEADLINE muda (063): tipo do prazo vindo
-- da proposta, caso e processo não excluídos, vencimento lido em Brasília. Os
-- outros ramos são os da 018, sem mudança.
create or replace function private.apply_proposal_effect(
  p_type             text,
  p_data             jsonb,
  p_legal_case_id    uuid,
  p_legal_process_id uuid
)
returns table (entity_type text, entity_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id      uuid;
  v_target  uuid;
  v_status  text;
  v_process uuid;
begin
  if p_type in ('CREATE_DEADLINE', 'REQUEST_DOCUMENT', 'UPDATE_CASE', 'CREATE_PROCESS') and p_legal_case_id is null then
    raise exception 'proposta sem caso';
  end if;

  case p_type
  when 'CREATE_DEADLINE' then
    if nullif(btrim(p_data ->> 'title'), '') is null or p_data ->> 'due_at' is null then
      raise exception 'CREATE_DEADLINE exige title e due_at';
    end if;
    v_process := coalesce((p_data ->> 'legal_process_id')::uuid, p_legal_process_id);
    if not exists (select 1 from public.legal_cases c where c.id = p_legal_case_id and c.deleted_at is null) then
      raise exception 'O caso deste prazo foi excluído: o prazo não foi criado';
    end if;
    if v_process is not null and not exists (
         select 1 from public.legal_processes lp
         where lp.id = v_process and lp.legal_case_id = p_legal_case_id and lp.deleted_at is null) then
      raise exception 'O processo deste prazo foi excluído ou não é deste caso: o prazo não foi criado';
    end if;
    insert into public.deadlines
      (legal_case_id, legal_process_id, title, deadline_type, description, due_at, priority, responsible_user_id, source)
    values
      (p_legal_case_id, v_process,
       p_data ->> 'title',
       case when p_data ->> 'deadline_type' in ('MANIFESTATION', 'REPLY', 'APPEAL', 'HEARING', 'DOCUMENT_DELIVERY', 'FILING', 'INTERNAL')
            then p_data ->> 'deadline_type' else 'INTERNAL' end,
       p_data ->> 'description', private.proposal_due_at(p_data ->> 'due_at'),
       coalesce(p_data ->> 'priority', 'NORMAL'), (p_data ->> 'responsible_user_id')::uuid, 'AGENT')
    returning id into v_id;
    return query select 'deadlines'::text, v_id;

  when 'REQUEST_DOCUMENT' then
    insert into public.case_document_requirements
      (legal_case_id, requirement_label, category, required, status, requested_at)
    values
      (p_legal_case_id, p_data ->> 'label', p_data ->> 'category',
       coalesce((p_data ->> 'required')::boolean, true), 'REQUESTED', now())
    returning id into v_id;
    -- Caso de parceiro: o pedido chega ao parceiro como solicitação.
    if nullif(btrim(p_data ->> 'message_to_partner'), '') is not null then
      insert into public.partner_requests
        (partner_organization_id, legal_case_id, type, title, description, due_at)
      select c.partner_organization_id, c.id, 'DOCUMENT', p_data ->> 'label', p_data ->> 'message_to_partner',
             (p_data ->> 'due_at')::timestamptz
      from public.legal_cases c
      where c.id = p_legal_case_id and c.partner_organization_id is not null;
    end if;
    return query select 'case_document_requirements'::text, v_id;

  when 'UPDATE_CASE' then
    if p_data ? 'status' and p_data ->> 'status' not in
       ('WAITING_DOCUMENTS', 'READY_FOR_ANALYSIS', 'ANALYZING', 'WAITING_REVIEW') then
      raise exception 'Agente não põe o caso em %', p_data ->> 'status';
    end if;
    update public.legal_cases
       set title = coalesce(p_data ->> 'title', title),
           summary = coalesce(p_data ->> 'summary', summary),
           status = coalesce(p_data ->> 'status', status)
     where id = p_legal_case_id
       and status in ('DRAFT', 'SUBMITTED', 'WAITING_DOCUMENTS', 'READY_FOR_ANALYSIS', 'ANALYZING', 'WAITING_REVIEW')
    returning id into v_id;
    if v_id is null then
      raise exception 'O caso já foi decidido: agente não altera caso aceito, rejeitado ou encerrado';
    end if;
    return query select 'legal_cases'::text, v_id;

  when 'CREATE_PROCESS' then
    insert into public.legal_processes
      (legal_case_id, cnj_number, technical_origin, court, court_unit, district, state,
       legal_class, subject, client_side, adverse_party_summary, case_value, status)
    values
      (p_legal_case_id, p_data ->> 'cnj_number', 'AGENT', p_data ->> 'court', p_data ->> 'court_unit',
       p_data ->> 'district', p_data ->> 'state', p_data ->> 'legal_class', p_data ->> 'subject',
       p_data ->> 'client_side', p_data ->> 'adverse_party_summary', (p_data ->> 'case_value')::numeric, 'PREPARING')
    returning id into v_id;
    return query select 'legal_processes'::text, v_id;

  when 'UPDATE_SKILL' then
    select s.id into v_target from public.skills s where s.slug = p_data ->> 'skill_slug' and s.deleted_at is null;
    if v_target is null then
      raise exception 'skill % não existe', p_data ->> 'skill_slug';
    end if;
    insert into public.skill_versions (skill_id, instructions, configuration)
    values (v_target, p_data ->> 'instructions', coalesce(p_data -> 'configuration', '{}'::jsonb))
    returning id into v_id;
    update public.skills set current_version_id = v_id where id = v_target;
    return query select 'skills'::text, v_target;

  when 'UPDATE_AGENT' then
    select a.id into v_target from public.agents a where a.slug = p_data ->> 'agent_slug' and a.deleted_at is null;
    if v_target is null then
      raise exception 'agente % não existe', p_data ->> 'agent_slug';
    end if;
    if jsonb_typeof(coalesce(p_data -> 'configuration', '{}'::jsonb)) <> 'object' then
      raise exception 'configuration precisa ser objeto';
    end if;
    insert into public.agent_versions (agent_id, instructions, configuration)
    values (v_target, p_data ->> 'instructions', coalesce(p_data -> 'configuration', '{}'::jsonb))
    returning id into v_id;
    update public.agents set current_version_id = v_id where id = v_target;
    return query select 'agents'::text, v_target;

  when 'OTHER' then
    -- Sem efeito automático: aprovado, vira providência da equipe.
    return;

  else
    raise exception 'Tipo de proposta sem aplicador: %', p_type;
  end case;
end
$$;

-- Avisa que uma proposta APROVADA não pôde ser aplicada: quem aprovou e os
-- ADMINs. Prazo = categoria Prazos (não se desliga). Nunca derruba o aplicador.
create or replace function private.notify_proposal_failed(p_proposal_id uuid, p_error text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p      record;
  v_review uuid;
  v_by     uuid;
  v_what   text;
  u        uuid;
  n        integer := 0;
begin
  select p.id, p.proposal_type, p.payload, p.legal_case_id, p.legal_process_id into v_p
  from public.agent_proposals p where p.id = p_proposal_id;
  if v_p.id is null then
    return 0;
  end if;
  select rv.id into v_review from public.reviews rv
   where rv.agent_proposal_id = v_p.id order by rv.created_at desc limit 1;
  select rd.decided_by into v_by from public.review_decisions rd
   where rd.review_id = v_review and rd.decision = 'APPROVE' order by rd.created_at desc limit 1;
  v_what := left(coalesce(nullif(btrim(v_p.payload -> 'data' ->> 'title'), ''), nullif(btrim(v_p.payload ->> 'summary'), ''), 'proposta do agente'), 140);

  for u in select r.x from (select v_by as x union select private.active_admin_ids()) r where r.x is not null loop
    if private.notify(u,
         case when v_p.proposal_type = 'CREATE_DEADLINE' then 'DEADLINE' else 'AGENT_RUN_ATTENTION' end,
         case when v_p.proposal_type = 'CREATE_DEADLINE' then 'Prazo aprovado não foi criado: ' else 'Proposta aprovada não foi aplicada: ' end || v_what,
         case when v_p.proposal_type = 'CREATE_DEADLINE'
              then 'A proposta foi aprovada em Revisões, mas o sistema não conseguiu criar o prazo. Crie o prazo à mão no processo. Motivo: '
              else 'A proposta foi aprovada em Revisões, mas o sistema não conseguiu aplicar. Faça a providência à mão. Motivo: ' end
           || left(coalesce(p_error, 'erro não informado'), 500),
         'URGENT', 'proposal-failed:' || v_p.id,
         v_p.legal_case_id, v_p.legal_process_id, null,
         case when v_review is not null then 'review' end, v_review) then
      n := n + 1;
    end if;
  end loop;
  return n;
end
$$;

-- O ciclo do aplicador (018). Única mudança (063): quando a aplicação falha, a
-- proposta fica FAILED como antes E as pessoas são avisadas.
create or replace function private.worker_apply_next_proposal(p_worker text)
returns table (proposal_id uuid, agent_run_id uuid, status text, error text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p      record;
  v_effect record;
  v_error  text;
begin
  select p.id, p.agent_run_id, p.legal_case_id, p.legal_process_id, p.proposal_type, p.payload, p.status,
         (select rv.status from public.reviews rv where rv.agent_proposal_id = p.id
          order by rv.created_at desc limit 1) as review_status
    into v_p
  from public.agent_proposals p
  where p.status = 'APPROVED'
     or (p.status = 'PENDING' and exists (
           select 1 from public.reviews rv
           where rv.agent_proposal_id = p.id and rv.status in ('APPROVED', 'REJECTED')))
  order by p.created_at
  for update of p skip locked
  limit 1;

  if v_p.id is null then
    return;
  end if;

  perform set_config('dg.agent_run_id', v_p.agent_run_id::text, true);
  perform set_config('dg.request_id', v_p.agent_run_id::text, true);

  if v_p.status = 'PENDING' and v_p.review_status = 'REJECTED' then
    update public.agent_proposals set status = 'REJECTED' where id = v_p.id;
    perform private.worker_close_run_if_decided(v_p.agent_run_id);
    return query select v_p.id, v_p.agent_run_id, 'REJECTED'::text, null::text;
    return;
  end if;
  if v_p.status = 'PENDING' then
    update public.agent_proposals set status = 'APPROVED' where id = v_p.id;
  end if;

  begin
    select * into v_effect
    from private.apply_proposal_effect(v_p.proposal_type, v_p.payload -> 'data', v_p.legal_case_id, v_p.legal_process_id);
    update public.agent_proposals
       set status = 'APPLIED', applied_entity_type = v_effect.entity_type, applied_entity_id = v_effect.entity_id
     where id = v_p.id;
    if v_effect.entity_id is not null then
      perform private.record_audit_event('AGENT_PROPOSAL_EFFECT', v_effect.entity_type, v_effect.entity_id,
        jsonb_build_object('agent_proposal_id', v_p.id, 'proposal_type', v_p.proposal_type));
    end if;
  exception when others then
    v_error := left(sqlerrm, 2000);
    update public.agent_proposals set status = 'FAILED', application_error = v_error where id = v_p.id;
  end;

  -- Falhou: avisa quem aprovou e os ADMINs. O aviso nunca derruba o ciclo.
  if v_error is not null then
    begin
      perform private.notify_proposal_failed(v_p.id, v_error);
    exception when others then
      raise warning 'Aviso de proposta com falha (%) não saiu: %', v_p.id, sqlerrm;
    end;
  end if;

  perform private.worker_close_run_if_decided(v_p.agent_run_id);
  return query select v_p.id, v_p.agent_run_id,
                      case when v_error is null then 'APPLIED' else 'FAILED' end, v_error;
end
$$;

-- ═════════════════════════════ 7. permissões ═════════════════════════════

-- As funções redefinidas aqui (notify, notify_deadlines, notify_deadline_reminders,
-- deadline_recipient, apply_proposal_effect, worker_apply_next_proposal) mantêm as
-- permissões que já tinham (018, 037): create or replace não mexe nelas.

-- Blocos internos e função de gatilho novos: ninguém chama direto.
revoke all on function private.deadlines_transition_guard() from public, anon, authenticated, service_role;
revoke all on function private.deadline_recipients(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function private.proposal_due_at(text) from public, anon, authenticated, service_role;
revoke all on function private.notify_proposal_failed(uuid, text) from public, anon, authenticated, service_role;
-- Tela: pública (invoker) → privada (definer); a privada confere o papel.
revoke all on function private.deadline_transition(uuid, text, text) from public, anon, service_role;
revoke all on function private.deadline_mark_checked(uuid) from public, anon, service_role;
grant execute on function private.deadline_transition(uuid, text, text) to authenticated;
grant execute on function private.deadline_mark_checked(uuid) to authenticated;
revoke all on function public.deadline_transition(uuid, text, text) from public, anon, service_role;
revoke all on function public.deadline_mark_checked(uuid) from public, anon, service_role;
revoke all on function public.create_deadline_once(uuid, jsonb) from public, anon, service_role;
grant execute on function public.deadline_transition(uuid, text, text) to authenticated;
grant execute on function public.deadline_mark_checked(uuid) to authenticated;
grant execute on function public.create_deadline_once(uuid, jsonb) to authenticated;
