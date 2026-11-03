-- DG Brasil — 043: integrações judiciais e prazos (Etapa 8)
--
-- PRINCÍPIO (decisão da Barbara, 2026-11-03): a integração só ATUALIZA processos
-- que já estão no DG Brasil. Ela não importa clientes nem processos da OAB — o
-- DG Brasil não é banco de dados de cliente. O advogado protocola, cadastra o
-- número CNJ, e daí em diante o processo recebe as atualizações sozinho.
--
-- Fontes oficiais e gratuitas, lidas pelo SERVIDOR do DG Brasil (login dg_worker):
--   - DJEN (Comunica API do CNJ): publicações por OAB. Só entram as de processos
--     cadastrados; das outras guarda-se apenas o NÚMERO (último resultado), para o
--     advogado saber que existe publicação em processo que não está no DG Brasil.
--   - DataJud (API pública do CNJ): dados e movimentações por número CNJ, para
--     todo processo cadastrado com CNJ.
--
--   1. judicial_settings          configuração única (fontes ligadas, janela de
--                                 dias revistos, agente que propõe prazos).
--   2. judicial_monitors (013)    OABs acompanhadas. Cada escritório (o
--                                 proprietário e cada parceiro) tem as suas: o
--                                 ADMIN cadastra as do escritório (e pode ver e
--                                 pausar as dos parceiros); o administrador do
--                                 parceiro cadastra as do próprio escritório.
--      judicial_monitor_status    resultado da última busca de cada OAB (fora da
--                                 tabela auditada, para não gerar auditoria diária).
--      judicial_capture_days      prova de diligência: por OAB e por dia, se o DJEN
--                                 foi consultado com sucesso e quantas publicações
--                                 havia. "Assentado" = consultado de novo a partir
--                                 de D+2 (o DJEN libera parte das publicações com
--                                 atraso de mais de 24 h; toda busca revê os
--                                 últimos dias).
--   3. process_external_refs (008) DATAJUD: uma por processo com CNJ, criada e
--                                 mantida por gatilho. A primeira leitura de um
--                                 processo é a "linha de base": grava o histórico
--                                 sem avisar ninguém. Daí em diante, movimentação
--                                 nova avisa.
--   4. judicial_publications      publicação do DJEN ligada a processo cadastrado,
--                                 com a triagem: PENDING → WITH_AGENT (agente
--                                 propondo prazo) → DONE (prazo criado ou "sem
--                                 prazo", sempre por decisão humana). Também vira
--                                 movimentação (process_events, JUDICIAL_INTEGRATION)
--                                 para aparecer na linha do tempo e no portal.
--   5. Sem duplicar: publicação por (DJEN, id da comunicação); movimentação por
--      (DATAJUD, hash calculado no servidor) — índice único da 008.
--   6. Prazos: o agente PROPÕE (agent_proposals CREATE_DEADLINE → Revisões); só a
--      aprovação humana cria o prazo. Sem agente configurado, a publicação fica
--      na fila de triagem e a equipe cria o prazo pela tela, com a contagem em
--      dias úteis calculada aqui (private.judicial_deadline_dates).
--   7. Calendário: fins de semana, feriados nacionais, Sexta-feira Santa e o
--      recesso do art. 220 do CPC (20/12 a 20/01) já entram; feriados locais e
--      suspensões de cada tribunal são cadastrados pelo ADMIN
--      (court_calendar_days). Sem o cadastro, a data calculada pode sair ANTES da
--      real — nunca depois. A contagem é sempre conferida por uma pessoa.
--   8. Avisos: categoria nova JUDICIAL (publicação recebida, movimentação nova,
--      falha na busca).
--
-- Pós-baseline: 001–042 não são alteradas (013/008/037 ganham colunas e
-- restrições por ALTER).

-- ═════════════════════════════ 1. configuração ═══════════════════════════

create table public.judicial_settings (
  id                boolean primary key default true check (id),
  djen_enabled      boolean not null default true,
  datajud_enabled   boolean not null default true,
  -- Quantos dias para trás cada busca revê no DJEN (publicação atrasada).
  -- 5: o DJEN libera parte das publicações com até 5 dias de atraso.
  lookback_days     integer not null default 5 check (lookback_days between 1 and 7),
  -- Agente que propõe prazos a partir da publicação (opcional).
  deadline_agent_id uuid references public.agents (id) on delete restrict,
  updated_by        uuid references public.profiles (id) on delete restrict,
  updated_at        timestamptz not null default now()
);

comment on table public.judicial_settings is
  'Configuração única da integração judicial (043). Alterada só por save_judicial_settings (ADMIN).';

insert into public.judicial_settings default values;

alter table public.judicial_settings enable row level security;
revoke all on public.judicial_settings from public, anon, authenticated, service_role;

-- Conexão DJEN do escritório proprietário (judicial_monitors exige uma).
create or replace function private.judicial_connection_id()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id    uuid;
  v_owner uuid := private.owner_organization_id();
begin
  select c.id into v_id from public.integration_connections c
  where c.provider = 'DJEN' and c.type = 'JUDICIAL' order by c.created_at limit 1;
  if v_id is null then
    if v_owner is null then
      raise exception 'Escritório proprietário não encontrado' using errcode = 'P0002';
    end if;
    insert into public.integration_connections (organization_id, provider, type, status, external_account_label)
    values (v_owner, 'DJEN', 'JUDICIAL', 'CONNECTED', 'DJEN — Comunica API do CNJ (pública)')
    returning id into v_id;
  end if;
  return v_id;
end
$$;

-- ═════════════════════════════ 2. OABs acompanhadas ══════════════════════

alter table public.judicial_monitors
  add column organization_id uuid references public.organizations (id) on delete restrict,
  add column lawyer_name     text check (lawyer_name is null or (btrim(lawyer_name) <> '' and length(lawyer_name) <= 200)),
  add column created_by      uuid references public.profiles (id) on delete restrict;

update public.judicial_monitors m set organization_id = c.organization_id
from public.integration_connections c
where c.id = m.integration_connection_id and m.organization_id is null;

alter table public.judicial_monitors alter column organization_id set not null;
alter table public.judicial_monitors drop constraint judicial_monitors_key;
-- A mesma OAB pode ser acompanhada pelo escritório e por um parceiro: a busca
-- consulta o DJEN uma vez por OAB.
create unique index judicial_monitors_org_oab on public.judicial_monitors (organization_id, oab_number, oab_state);
create index judicial_monitors_oab_active on public.judicial_monitors (oab_number, oab_state) where active;

comment on column public.judicial_monitors.organization_id is
  'Escritório dono desta OAB acompanhada: o proprietário ou um parceiro (043).';

-- Escrita só pelas funções abaixo; leitura também (RPC), para o parceiro.
drop policy if exists judicial_monitors_insert on public.judicial_monitors;
drop policy if exists judicial_monitors_update on public.judicial_monitors;
revoke insert, update on public.judicial_monitors from authenticated;

create table public.judicial_monitor_status (
  judicial_monitor_id uuid primary key references public.judicial_monitors (id) on delete cascade,
  last_attempt_at     timestamptz,
  last_success_at     timestamptz,
  last_error          text check (last_error is null or length(last_error) <= 500),
  last_found          integer,
  last_matched        integer,
  -- Publicações da última busca em processos que NÃO estão no DG Brasil: só o
  -- número CNJ (nunca o teor, nunca partes).
  unmatched_cnjs      text[] not null default '{}',
  updated_at          timestamptz not null default now()
);

alter table public.judicial_monitor_status enable row level security;
revoke all on public.judicial_monitor_status from public, anon, authenticated, service_role;

create table public.judicial_capture_days (
  oab_number    text not null,
  oab_state     public.uf_code not null,
  day           date not null,
  first_ok_at   timestamptz,
  last_ok_at    timestamptz,
  last_error_at timestamptz,
  last_error    text check (last_error is null or length(last_error) <= 500),
  found         integer,
  primary key (oab_number, oab_state, day)
);

comment on table public.judicial_capture_days is
  'Prova de diligência (043): por OAB e dia de disponibilização, quando o DJEN foi consultado com sucesso e quantas publicações havia. Assentado = consulta ok a partir de D+2.';

alter table public.judicial_capture_days enable row level security;
revoke all on public.judicial_capture_days from public, anon, authenticated, service_role;

create table public.judicial_sync_runs (
  id           uuid primary key default gen_random_uuid(),
  trigger      text not null check (trigger in ('CRON', 'MANUAL')),
  requested_by uuid references public.profiles (id) on delete restrict,
  -- ALL: DJEN + DataJud (manhã). DATAJUD: lote extra do DataJud (agendador do
  -- banco, seção 9). PROCESS: um processo, pedido na tela.
  scope        text not null default 'ALL' check (scope in ('ALL', 'DATAJUD', 'PROCESS')),
  status       text not null default 'RUNNING' check (status in ('RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED')),
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  stats        jsonb not null default '{}' check (jsonb_typeof(stats) = 'object'),
  error        text check (error is null or length(error) <= 1000)
);

create index judicial_sync_runs_started_idx on public.judicial_sync_runs (started_at desc);

alter table public.judicial_sync_runs enable row level security;
revoke all on public.judicial_sync_runs from public, anon, authenticated, service_role;

-- ═════════════════════════════ 3. processos acompanhados (DataJud) ════════

alter table public.process_external_refs
  add column sync_enabled    boolean not null default true,
  add column last_attempt_at timestamptz,
  add column last_error      text check (last_error is null or length(last_error) <= 500),
  -- Primeira leitura feita (histórico gravado sem aviso).
  add column baseline_at     timestamptz;

create index process_external_refs_datajud_queue
  on public.process_external_refs (last_attempt_at nulls first)
  where provider = 'DATAJUD' and sync_enabled;

-- Todo processo com CNJ fica acompanhado. Trocou o CNJ: a referência acompanha
-- (e refaz a linha de base). Sem CNJ: nada a acompanhar.
create or replace function private.legal_processes_track_cnj()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ref uuid;
begin
  if new.cnj_number is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.cnj_number is not distinct from old.cnj_number then
    return new;
  end if;
  select r.id into v_ref from public.process_external_refs r
  where r.legal_process_id = new.id and r.provider = 'DATAJUD';
  if v_ref is null then
    insert into public.process_external_refs (legal_process_id, provider, external_id)
    values (new.id, 'DATAJUD', new.cnj_number)
    on conflict (provider, external_id) do nothing;
  else
    update public.process_external_refs
       set external_id = new.cnj_number, baseline_at = null, last_synced_at = null,
           last_attempt_at = null, last_error = null, metadata = '{}'
     where id = v_ref;
  end if;
  return new;
end
$$;

create trigger legal_processes_track_cnj
  after insert or update of cnj_number on public.legal_processes
  for each row execute function private.legal_processes_track_cnj();

insert into public.process_external_refs (legal_process_id, provider, external_id)
select p.id, 'DATAJUD', p.cnj_number from public.legal_processes p
where p.cnj_number is not null
on conflict (provider, external_id) do nothing;

-- ═════════════════════════════ 4. publicações ════════════════════════════

create table public.judicial_publications (
  id                 uuid primary key default gen_random_uuid(),
  provider           text not null default 'DJEN' check (provider in ('DJEN')),
  external_id        text not null check (external_id ~ '^[0-9A-Za-z_-]{1,100}$'),
  legal_process_id   uuid not null references public.legal_processes (id) on delete restrict,
  cnj_number         public.cnj_digits not null,
  court              text check (court is null or length(court) <= 40),
  organ              text check (organ is null or length(organ) <= 300),
  communication_type text check (communication_type is null or length(communication_type) <= 100),
  class_name         text check (class_name is null or length(class_name) <= 300),
  available_on       date not null,
  content            text not null check (length(content) <= 200000),
  link               text check (link is null or length(link) <= 1000),
  -- Hash da comunicação no DJEN: abre a certidão oficial
  -- (comunicaapi.pje.jus.br/api/v1/comunicacao/{hash}/certidao).
  djen_hash          text check (djen_hash is null or djen_hash ~ '^[0-9A-Za-z_-]{8,100}$'),
  -- O tribunal pode cancelar a comunicação depois (o DJEN troca o teor pelo motivo).
  cancelled_at       timestamptz,
  cancel_reason      text check (cancel_reason is null or length(cancel_reason) <= 2000),
  -- OABs acompanhadas que trouxeram esta publicação ("SP 123456").
  found_by           text[] not null default '{}',
  process_event_id   uuid references public.process_events (id) on delete restrict,
  -- Triagem: sempre fechada por uma pessoa.
  triage_status      text not null default 'PENDING' check (triage_status in ('PENDING', 'WITH_AGENT', 'DONE')),
  triage_outcome     text check (triage_outcome in ('DEADLINE', 'NO_DEADLINE')),
  triage_notes       text check (triage_notes is null or length(triage_notes) <= 2000),
  triaged_by         uuid references public.profiles (id) on delete restrict,
  triaged_at         timestamptz,
  deadline_id        uuid references public.deadlines (id) on delete restrict,
  agent_run_id       uuid references public.agent_runs (id) on delete restrict,
  agent_error        text check (agent_error is null or length(agent_error) <= 500),
  captured_at        timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint judicial_publications_key unique (provider, external_id),
  constraint judicial_publications_done check (
    (triage_status = 'DONE') = (triage_outcome is not null)
    and (triage_outcome is distinct from 'DEADLINE' or deadline_id is not null)
  )
);

comment on table public.judicial_publications is
  'Publicação do DJEN em processo cadastrado no DG Brasil (043), com a triagem humana. Só a equipe interna lê; o parceiro vê a movimentação correspondente.';

create index judicial_publications_triage_idx on public.judicial_publications (triage_status, available_on desc);
create index judicial_publications_process_idx on public.judicial_publications (legal_process_id, available_on desc);
create index judicial_publications_run_idx on public.judicial_publications (agent_run_id) where agent_run_id is not null;

create trigger judicial_publications_set_updated_at
  before update on public.judicial_publications
  for each row execute function private.set_updated_at();

alter table public.judicial_publications enable row level security;
revoke all on public.judicial_publications from public, anon, authenticated, service_role;

-- ═════════════════════════════ 7. calendário ═════════════════════════════

create table public.court_calendar_days (
  id          uuid primary key default gen_random_uuid(),
  -- Sigla do tribunal como no DJEN/DataJud (TJSP, TRF3...). NULL = todos.
  court       text check (court is null or court ~ '^[A-Z0-9-]{2,15}$'),
  day         date not null,
  kind        text not null default 'HOLIDAY' check (kind in ('HOLIDAY', 'SUSPENSION')),
  description text not null check (btrim(description) <> '' and length(description) <= 200),
  created_by  uuid references public.profiles (id) on delete restrict,
  created_at  timestamptz not null default now()
);

create unique index court_calendar_days_key on public.court_calendar_days (coalesce(court, '*'), day);

alter table public.court_calendar_days enable row level security;
revoke all on public.court_calendar_days from public, anon, authenticated, service_role;

-- Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher).
create or replace function private.easter_sunday(p_year integer)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  a integer := p_year % 19;
  b integer := p_year / 100;
  c integer := p_year % 100;
  d integer := b / 4;
  e integer := b % 4;
  f integer := (b + 8) / 25;
  g integer := (b - f + 1) / 3;
  h integer := (19 * a + b - d - g + 15) % 30;
  i integer := c / 4;
  k integer := c % 4;
  l integer := (32 + 2 * e + 2 * i - h - k) % 7;
  m integer := (a + 11 * h + 22 * l) / 451;
  v_month integer := (h + l - 7 * m + 114) / 31;
  v_day integer := ((h + l - 7 * m + 114) % 31) + 1;
begin
  return make_date(p_year, v_month, v_day);
end
$$;

-- Motivo de o dia NÃO contar como dia útil para prazo (null = conta).
create or replace function private.non_business_reason(p_day date, p_court text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_md  text := to_char(p_day, 'MM-DD');
  v_own text;
begin
  if extract(isodow from p_day) in (6, 7) then
    return 'Fim de semana';
  end if;
  if v_md >= '12-20' or v_md <= '01-20' then
    return 'Recesso forense (art. 220 do CPC)';
  end if;
  if v_md in ('01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25') then
    return 'Feriado nacional';
  end if;
  if p_day = private.easter_sunday(extract(year from p_day)::integer) - 2 then
    return 'Sexta-feira Santa';
  end if;
  select d.description into v_own from public.court_calendar_days d
  where d.day = p_day and (d.court is null or d.court = upper(p_court))
  order by d.court nulls last limit 1;
  return v_own;
end
$$;

create or replace function private.next_business_day(p_day date, p_court text)
returns date
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v date := p_day + 1;
begin
  while private.non_business_reason(v, p_court) is not null loop
    v := v + 1;
  end loop;
  return v;
end
$$;

-- Contagem do DJEN (Lei 11.419/2006, art. 4º, §§ 3º e 4º; CPC, art. 219):
-- publicação = 1º dia útil depois da disponibilização; o prazo começa no 1º dia
-- útil depois da publicação e conta só dias úteis. Devolve os primeiros
-- p_list dias úteis (para o agente e a tela escolherem) e o vencimento em
-- p_days dias úteis, com os dias pulados e o motivo.
create or replace function private.judicial_deadline_dates(
  p_available_on date, p_court text, p_days integer default 15, p_list integer default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_pub     date;
  v_day     date;
  v_n       integer := 0;
  v_target  integer := least(greatest(coalesce(p_days, 15), 1), 120);
  v_limit   integer := greatest(least(greatest(coalesce(p_list, 30), 0), 120), v_target);
  v_days    jsonb := '[]';
  v_skipped jsonb := '[]';
  v_due     date;
  v_reason  text;
begin
  if p_available_on is null then
    raise exception 'Informe a data de disponibilização' using errcode = '22023';
  end if;
  v_pub := private.next_business_day(p_available_on, p_court);
  v_day := v_pub;
  while v_n < v_limit loop
    v_day := v_day + 1;
    if v_day > p_available_on + 730 then
      raise exception 'Calendário sem dias úteis suficientes: confira os dias cadastrados' using errcode = '22023';
    end if;
    v_reason := private.non_business_reason(v_day, p_court);
    if v_reason is null then
      v_n := v_n + 1;
      if v_n <= coalesce(p_list, 30) then
        v_days := v_days || to_jsonb(v_day);
      end if;
      if v_n = v_target then
        v_due := v_day;
      end if;
    elsif v_n < v_target and v_reason <> 'Fim de semana' then
      v_skipped := v_skipped || jsonb_build_object('day', v_day, 'reason', v_reason);
    end if;
  end loop;
  return jsonb_build_object(
    'available_on', p_available_on, 'published_on', v_pub, 'first_day', v_days -> 0,
    'business_days', v_target, 'due_on', v_due, 'list', v_days, 'skipped', v_skipped,
    'court', upper(p_court),
    'note', 'Contagem em dias úteis com feriados nacionais, Sexta-feira Santa, recesso do art. 220 do CPC e os dias cadastrados para o tribunal. Confira feriados locais e suspensões antes de confirmar.');
end
$$;

-- ═════════════════════════════ 8. avisos (categoria JUDICIAL) ════════════

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
    when p_type in ('PUBLICATION_RECEIVED', 'PUBLICATION_CANCELLED', 'PROCESS_MOVEMENT', 'JUDICIAL_SYNC_FAILED') then 'JUDICIAL'
    else 'OTHER'
  end
$$;

alter table public.user_notification_preferences drop constraint user_notification_preferences_category;
alter table public.user_notification_preferences
  add constraint user_notification_preferences_category
    check (notification_type in ('CASES', 'DEADLINES', 'DOCUMENTS', 'REVIEWS', 'PARTNER_REQUESTS', 'ANALYSES',
                                 'FINANCE', 'SECURITY', 'JUDICIAL')) not valid;

alter table public.notifications drop constraint notifications_related_type_check;
alter table public.notifications
  add constraint notifications_related_type_check
    check (related_type is null or related_type in ('review', 'analysis', 'deadline', 'document', 'transfer', 'agent_run', 'publication'));

-- Quem recebe novidade de um processo: o responsável, o advogado do caso e a
-- equipe do parceiro do caso. Sem ninguém interno: os ADMIN.
create or replace function private.judicial_recipients(p_process uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  with p as (
    select lp.responsible_user_id, c.assigned_lawyer_id, c.partner_organization_id
    from public.legal_processes lp join public.legal_cases c on c.id = lp.legal_case_id
    where lp.id = p_process
  ), internos as (
    select x from p, unnest(array[p.responsible_user_id, p.assigned_lawyer_id]) x where x is not null
  )
  select distinct u from (
    select x as u from internos
    union all
    select a from private.active_admin_ids() a where not exists (select 1 from internos)
    union all
    select m from p, private.org_member_ids(p.partner_organization_id) m where p.partner_organization_id is not null
  ) s
$$;

-- ═════════════════════════════ helpers de acesso ═════════════════════════

create or replace function private.judicial_require_internal(p_manage boolean default false)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_manage and not private.is_admin() then
    raise exception 'Somente ADMIN configura a integração judicial' using errcode = '42501';
  end if;
  if not p_manage and not (select private.has_internal_role('ADMIN', 'LAWYER')) then
    raise exception 'Somente advogado ou ADMIN do escritório' using errcode = '42501';
  end if;
  return auth.uid();
end
$$;

-- OAB digitada → só dígitos e letras, sem zeros à esquerda.
create or replace function private.normalize_oab(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(ltrim(upper(regexp_replace(coalesce(p_value, ''), '[^0-9A-Za-z]', '', 'g')), '0'), '')
$$;

create or replace function private.judicial_monitor_json(m public.judicial_monitors, p_with_org boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', m.id, 'oab_number', m.oab_number, 'oab_state', m.oab_state, 'lawyer_name', m.lawyer_name,
    'active', m.active, 'responsible_user_id', m.responsible_user_id, 'created_at', m.created_at,
    'organization_id', m.organization_id,
    'organization_name', case when p_with_org then (select o.name from public.organizations o where o.id = m.organization_id) end,
    'organization_type', case when p_with_org then (select o.type::text from public.organizations o where o.id = m.organization_id) end,
    'last_attempt_at', s.last_attempt_at, 'last_success_at', s.last_success_at, 'last_error', s.last_error,
    'last_found', s.last_found, 'last_matched', s.last_matched,
    'unmatched_cnjs', coalesce(to_jsonb(s.unmatched_cnjs), '[]'::jsonb))
  from (select 1) one
  left join public.judicial_monitor_status s on s.judicial_monitor_id = m.id
$$;

-- ═════════════════════════════ telas: OABs ═══════════════════════════════

-- ADMIN: OAB de qualquer escritório (padrão: o proprietário). Administrador do
-- parceiro: só do próprio escritório (organização vem da sessão). Já existe
-- (mesmo escritório): reativa e atualiza o nome.
create or replace function private.save_judicial_monitor(
  p_oab_number text, p_oab_state text, p_lawyer_name text default null,
  p_organization_id uuid default null, p_responsible_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org   uuid;
  v_oab   text := private.normalize_oab(p_oab_number);
  v_uf    text := upper(btrim(coalesce(p_oab_state, '')));
  v_name  text := nullif(btrim(coalesce(p_lawyer_name, '')), '');
  v_resp  uuid := p_responsible_user_id;
  v_id    uuid;
  v_count integer;
begin
  if private.is_admin() then
    v_org := coalesce(p_organization_id, private.owner_organization_id());
    if not exists (select 1 from public.organizations o where o.id = v_org and o.deleted_at is null) then
      raise exception 'Escritório não encontrado' using errcode = 'P0002';
    end if;
  elsif private.is_partner_admin() then
    v_org := private.current_partner_organization_id();
    if p_organization_id is not null and p_organization_id <> v_org then
      raise exception 'O parceiro só cadastra OAB do próprio escritório' using errcode = '42501';
    end if;
    v_resp := null;
  else
    raise exception 'Somente o ADMIN do escritório ou o administrador do parceiro cadastra OAB' using errcode = '42501';
  end if;

  if v_oab is null or v_oab !~ '^[0-9]{1,8}[A-Z]?$' then
    raise exception 'Número de OAB inválido: use só os números (e a letra, se houver)' using errcode = '22023';
  end if;
  if v_uf !~ '^[A-Z]{2}$' then
    raise exception 'Informe a UF da OAB' using errcode = '22023';
  end if;
  if v_resp is not null and not private.is_active_internal_user(v_resp) then
    raise exception 'O responsável precisa ser usuário interno ativo' using errcode = '23514';
  end if;

  select m.id into v_id from public.judicial_monitors m
  where m.organization_id = v_org and m.oab_number = v_oab and m.oab_state = v_uf;
  if v_id is null then
    select count(*) into v_count from public.judicial_monitors m where m.organization_id = v_org and m.active;
    if v_count >= 50 then
      raise exception 'Limite de 50 OABs ativas por escritório' using errcode = '23514';
    end if;
    insert into public.judicial_monitors
      (integration_connection_id, organization_id, oab_number, oab_state, lawyer_name, responsible_user_id, created_by)
    values (private.judicial_connection_id(), v_org, v_oab, v_uf::public.uf_code, v_name, v_resp, auth.uid())
    returning id into v_id;
    insert into public.judicial_monitor_status (judicial_monitor_id) values (v_id);
    return jsonb_build_object('id', v_id, 'created', true);
  end if;

  update public.judicial_monitors
     set active = true, lawyer_name = coalesce(v_name, lawyer_name),
         responsible_user_id = case when private.is_admin() then v_resp else responsible_user_id end
   where id = v_id;
  return jsonb_build_object('id', v_id, 'created', false);
end
$$;

create or replace function private.set_judicial_monitor_active(p_id uuid, p_active boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select m.organization_id into v_org from public.judicial_monitors m where m.id = p_id;
  if v_org is null then
    raise exception 'OAB não encontrada' using errcode = 'P0002';
  end if;
  if not (private.is_admin() or (private.is_partner_admin() and v_org = private.current_partner_organization_id())) then
    raise exception 'OAB não encontrada' using errcode = 'P0002';
  end if;
  update public.judicial_monitors set active = coalesce(p_active, false) where id = p_id;
  return jsonb_build_object('id', p_id, 'active', coalesce(p_active, false));
end
$$;

-- Parceiro (qualquer usuário do parceiro): as OABs do próprio escritório.
create or replace function private.get_my_judicial_monitors()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_partner_organization_id();
begin
  if v_org is null or not private.is_partner_user() then
    raise exception 'Disponível só no portal do parceiro' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'can_manage', private.is_partner_admin(),
    'monitors', coalesce((select jsonb_agg(private.judicial_monitor_json(m, false) order by m.active desc, m.oab_state, m.oab_number)
                          from public.judicial_monitors m where m.organization_id = v_org), '[]'::jsonb),
    'last_run_at', (select max(r.finished_at) from public.judicial_sync_runs r where r.status in ('COMPLETED', 'PARTIAL')));
end
$$;

-- Prova de diligência de uma OAB (dia a dia). Parceiro: só OAB do próprio escritório.
create or replace function private.get_judicial_coverage(p_oab_number text, p_oab_state text, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_oab  text := private.normalize_oab(p_oab_number);
  v_uf   text := upper(btrim(coalesce(p_oab_state, '')));
  v_from date := coalesce(p_from, (now() at time zone 'America/Sao_Paulo')::date - 14);
  v_to   date := coalesce(p_to, (now() at time zone 'America/Sao_Paulo')::date);
begin
  if not (select private.has_internal_role('ADMIN', 'LAWYER')) then
    if not (private.is_partner_user() and exists (
      select 1 from public.judicial_monitors m
      where m.organization_id = private.current_partner_organization_id() and m.oab_number = v_oab and m.oab_state = v_uf)) then
      raise exception 'OAB não encontrada' using errcode = 'P0002';
    end if;
  end if;
  if v_to < v_from or v_to - v_from > 92 then
    raise exception 'Período de até 92 dias' using errcode = '22023';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'day', d::date,
      'checked', c.last_ok_at is not null,
      'settled', case when c.last_ok_at is null then false
                      else (c.last_ok_at at time zone 'America/Sao_Paulo')::date >= d::date + 2 end,
      'found', c.found,
      'last_ok_at', c.last_ok_at,
      'last_error', case when c.last_error_at is not null and (c.last_ok_at is null or c.last_error_at > c.last_ok_at) then c.last_error end)
      order by d)
    from generate_series(v_from, v_to, interval '1 day') d
    left join public.judicial_capture_days c on c.oab_number = v_oab and c.oab_state = v_uf and c.day = d::date), '[]'::jsonb);
end
$$;

-- ═════════════════════════════ telas: visão geral e configuração ═════════

create or replace function private.get_judicial_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_s public.judicial_settings;
begin
  perform private.judicial_require_internal(false);
  select * into v_s from public.judicial_settings where id;
  return jsonb_build_object(
    'can_manage', private.is_admin(),
    'settings', jsonb_build_object(
      'djen_enabled', v_s.djen_enabled, 'datajud_enabled', v_s.datajud_enabled, 'lookback_days', v_s.lookback_days,
      'deadline_agent_id', v_s.deadline_agent_id,
      'deadline_agent_name', (select a.name from public.agents a where a.id = v_s.deadline_agent_id),
      'updated_at', v_s.updated_at),
    'monitors', coalesce((select jsonb_agg(private.judicial_monitor_json(m, true)
                                           order by (o.type = 'OWNER') desc, o.name, m.active desc, m.oab_state, m.oab_number)
                          from public.judicial_monitors m join public.organizations o on o.id = m.organization_id), '[]'::jsonb),
    'runs', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'trigger', r.trigger, 'scope', r.scope, 'status', r.status,
                                                          'started_at', r.started_at, 'finished_at', r.finished_at,
                                                          'stats', r.stats, 'error', r.error) order by r.started_at desc)
                      from (select * from public.judicial_sync_runs order by started_at desc limit 10) r), '[]'::jsonb),
    'processes', (select jsonb_build_object(
                    'tracked', count(*) filter (where r.sync_enabled),
                    'paused', count(*) filter (where not r.sync_enabled),
                    'never_synced', count(*) filter (where r.sync_enabled and r.last_synced_at is null),
                    'with_error', count(*) filter (where r.sync_enabled and r.last_error is not null))
                  from public.process_external_refs r
                  join public.legal_processes p on p.id = r.legal_process_id and p.deleted_at is null and p.cnj_number = r.external_id
                  where r.provider = 'DATAJUD'),
    'publications', (select jsonb_build_object(
                       'pending', count(*) filter (where triage_status = 'PENDING'),
                       'with_agent', count(*) filter (where triage_status = 'WITH_AGENT'),
                       'done_last_30_days', count(*) filter (where triage_status = 'DONE' and triaged_at > now() - interval '30 days'))
                     from public.judicial_publications),
    'agents', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name) order by a.name)
                        from public.agents a where a.status = 'ACTIVE' and a.deleted_at is null), '[]'::jsonb),
    'calendar', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'court', d.court, 'day', d.day, 'kind', d.kind,
                                                              'description', d.description) order by d.day, d.court nulls first)
                          from public.court_calendar_days d where d.day >= (now() at time zone 'America/Sao_Paulo')::date - 31), '[]'::jsonb));
end
$$;

create or replace function private.save_judicial_settings(p_settings jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent uuid := nullif(p_settings ->> 'deadline_agent_id', '')::uuid;
begin
  perform private.judicial_require_internal(true);
  if v_agent is not null and not exists (
    select 1 from public.agents a where a.id = v_agent and a.status = 'ACTIVE' and a.deleted_at is null) then
    raise exception 'Agente inexistente ou inativo' using errcode = '23514';
  end if;
  update public.judicial_settings
     set djen_enabled = coalesce((p_settings ->> 'djen_enabled')::boolean, djen_enabled),
         datajud_enabled = coalesce((p_settings ->> 'datajud_enabled')::boolean, datajud_enabled),
         lookback_days = coalesce((p_settings ->> 'lookback_days')::integer, lookback_days),
         deadline_agent_id = case when p_settings ? 'deadline_agent_id' then v_agent else deadline_agent_id end,
         updated_by = auth.uid(), updated_at = now()
   where id;
  perform private.record_audit_event('JUDICIAL_SETTINGS_UPDATED', 'judicial_settings', null,
    jsonb_build_object('fields', (select coalesce(jsonb_agg(k), '[]') from jsonb_object_keys(coalesce(p_settings, '{}')) k)));
  return jsonb_build_object('ok', true);
end
$$;

create or replace function private.save_court_calendar_day(p_court text, p_day date, p_kind text, p_description text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id    uuid;
  v_court text := nullif(upper(btrim(coalesce(p_court, ''))), '');
begin
  perform private.judicial_require_internal(true);
  if p_day is null then
    raise exception 'Informe o dia' using errcode = '22023';
  end if;
  insert into public.court_calendar_days (court, day, kind, description, created_by)
  values (v_court, p_day, coalesce(p_kind, 'HOLIDAY'), btrim(coalesce(p_description, '')), auth.uid())
  on conflict (coalesce(court, '*'), day) do update set kind = excluded.kind, description = excluded.description
  returning id into v_id;
  perform private.record_audit_event('COURT_CALENDAR_DAY_SAVED', 'court_calendar_days', v_id,
    jsonb_build_object('court', v_court, 'day', p_day, 'kind', coalesce(p_kind, 'HOLIDAY')));
  return jsonb_build_object('id', v_id);
end
$$;

create or replace function private.delete_court_calendar_day(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.court_calendar_days;
begin
  perform private.judicial_require_internal(true);
  delete from public.court_calendar_days where id = p_id returning * into v_row;
  if v_row.id is null then
    raise exception 'Dia não encontrado' using errcode = 'P0002';
  end if;
  perform private.record_audit_event('COURT_CALENDAR_DAY_DELETED', 'court_calendar_days', p_id,
    jsonb_build_object('court', v_row.court, 'day', v_row.day));
  return jsonb_build_object('ok', true);
end
$$;

-- Prévia da contagem (tela "criar prazo").
create or replace function private.judicial_deadline_preview(p_available_on date, p_court text, p_days integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_internal_user() then
    raise exception 'Somente a equipe do escritório' using errcode = '42501';
  end if;
  return private.judicial_deadline_dates(p_available_on, p_court, p_days, 0);
end
$$;

-- ═════════════════════════════ telas: publicações ════════════════════════

create or replace function private.judicial_publication_json(p public.judicial_publications, p_full boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id, 'external_id', p.external_id, 'legal_process_id', p.legal_process_id, 'cnj_number', p.cnj_number,
    'process_title', lp.title, 'legal_case_id', lp.legal_case_id, 'case_title', c.title,
    'client_name', coalesce((select i.full_name from public.individual_client_details i where i.client_id = c.client_id),
                            (select co.legal_name from public.company_client_details co where co.client_id = c.client_id)),
    'responsible_user_id', coalesce(lp.responsible_user_id, c.assigned_lawyer_id),
    'court', p.court, 'organ', p.organ, 'communication_type', p.communication_type, 'class_name', p.class_name,
    'available_on', p.available_on, 'found_by', to_jsonb(p.found_by),
    'excerpt', left(regexp_replace(p.content, '\s+', ' ', 'g'), 280),
    'content', case when p_full then p.content end,
    'link', p.link,
    'certificate_url', case when p.djen_hash is not null then 'https://comunicaapi.pje.jus.br/api/v1/comunicacao/' || p.djen_hash || '/certidao' end,
    'cancelled_at', p.cancelled_at, 'cancel_reason', p.cancel_reason,
    'triage_status', p.triage_status, 'triage_outcome', p.triage_outcome, 'triage_notes', p.triage_notes,
    'triaged_by', p.triaged_by, 'triaged_at', p.triaged_at, 'deadline_id', p.deadline_id,
    'deadline', case when p.deadline_id is not null then
      (select jsonb_build_object('id', d.id, 'title', d.title, 'due_at', d.due_at, 'status', d.status)
       from public.deadlines d where d.id = p.deadline_id) end,
    'agent_run_id', p.agent_run_id, 'agent_error', p.agent_error,
    'agent_run_status', (select r.status from public.agent_runs r where r.id = p.agent_run_id),
    'pending_review_id', (select rv.id from public.agent_proposals ap join public.reviews rv on rv.agent_proposal_id = ap.id
                          where ap.agent_run_id = p.agent_run_id
                            and rv.status in ('PENDING', 'CHANGES_REQUESTED', 'REOPENED') order by rv.created_at desc limit 1),
    'captured_at', p.captured_at)
  from public.legal_processes lp
  join public.legal_cases c on c.id = lp.legal_case_id
  where lp.id = p.legal_process_id
$$;

create or replace function private.list_judicial_publications(p_filter jsonb default '{}')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_status  text := nullif(p_filter ->> 'status', '');
  v_process uuid := nullif(p_filter ->> 'legal_process_id', '')::uuid;
  v_page    integer := greatest(coalesce((p_filter ->> 'page')::integer, 1), 1);
  v_size    integer := least(greatest(coalesce((p_filter ->> 'page_size')::integer, 25), 1), 50);
  v_mine    boolean := coalesce((p_filter ->> 'mine')::boolean, false);
  v_uid     uuid := auth.uid();
begin
  if not private.is_internal_user() then
    raise exception 'Somente a equipe do escritório' using errcode = '42501';
  end if;
  if v_status is not null and v_status not in ('PENDING', 'WITH_AGENT', 'DONE', 'OPEN') then
    raise exception 'Filtro inválido' using errcode = '22023';
  end if;
  return (
    with f as (
      select p.id, p.available_on, p.captured_at from public.judicial_publications p
      join public.legal_processes lp on lp.id = p.legal_process_id and lp.deleted_at is null
      join public.legal_cases c on c.id = lp.legal_case_id
      where (v_status is null or (v_status = 'OPEN' and p.triage_status <> 'DONE') or p.triage_status = v_status)
        and (v_process is null or p.legal_process_id = v_process)
        and (not v_mine or coalesce(lp.responsible_user_id, c.assigned_lawyer_id) = v_uid)
    ), pagina as (
      select f.id from f order by f.available_on desc, f.captured_at desc
      limit v_size offset (v_page - 1) * v_size
    )
    select jsonb_build_object(
      'total', (select count(*) from f),
      'items', coalesce((select jsonb_agg(private.judicial_publication_json(x, false) order by x.available_on desc, x.captured_at desc)
                         from public.judicial_publications x where x.id in (select id from pagina)), '[]'::jsonb)));
end
$$;

create or replace function private.get_judicial_publication(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_p public.judicial_publications;
begin
  if not private.is_internal_user() then
    raise exception 'Somente a equipe do escritório' using errcode = '42501';
  end if;
  select * into v_p from public.judicial_publications where id = p_id;
  if v_p.id is null then
    raise exception 'Publicação não encontrada' using errcode = 'P0002';
  end if;
  return private.judicial_publication_json(v_p, true)
      || jsonb_build_object('suggestion', private.judicial_deadline_dates(v_p.available_on, v_p.court, 15, 0));
end
$$;

-- "Sem prazo" (fecha) ou "Reabrir" (volta para triagem).
create or replace function private.judicial_publication_decide(p_id uuid, p_action text, p_notes text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.judicial_publications;
begin
  perform private.judicial_require_internal(false);
  select * into v_p from public.judicial_publications where id = p_id for update;
  if v_p.id is null then
    raise exception 'Publicação não encontrada' using errcode = 'P0002';
  end if;
  if p_action = 'NO_DEADLINE' then
    if v_p.triage_status = 'DONE' then
      raise exception 'Esta publicação já foi tratada' using errcode = '55000';
    end if;
    if nullif(btrim(coalesce(p_notes, '')), '') is null then
      raise exception 'Diga por que esta publicação não tem prazo' using errcode = '22023';
    end if;
    update public.judicial_publications
       set triage_status = 'DONE', triage_outcome = 'NO_DEADLINE', triage_notes = left(btrim(p_notes), 2000),
           triaged_by = auth.uid(), triaged_at = now()
     where id = p_id;
  elsif p_action = 'REOPEN' then
    if v_p.triage_status <> 'DONE' then
      raise exception 'Só publicação já tratada pode ser reaberta' using errcode = '55000';
    end if;
    -- O prazo criado continua existindo (cancele-o em Prazos, se for o caso).
    update public.judicial_publications
       set triage_status = 'PENDING', triage_outcome = null, deadline_id = null,
           triage_notes = left(nullif(btrim(coalesce(p_notes, '')), ''), 2000), triaged_by = auth.uid(), triaged_at = now()
     where id = p_id;
  else
    raise exception 'Ação inválida' using errcode = '22023';
  end if;
  perform private.record_audit_event('JUDICIAL_PUBLICATION_' || p_action, 'judicial_publications', p_id,
    jsonb_build_object('legal_process_id', v_p.legal_process_id));
  return jsonb_build_object('id', p_id, 'action', p_action);
end
$$;

-- Prazo criado pela equipe a partir da publicação (prazo + triagem, juntos).
create or replace function private.create_deadline_from_publication(p_id uuid, p_deadline jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p     public.judicial_publications;
  v_case  uuid;
  v_title text := nullif(btrim(coalesce(p_deadline ->> 'title', '')), '');
  v_due   timestamptz;
  v_resp  uuid := nullif(p_deadline ->> 'responsible_user_id', '')::uuid;
  v_id    uuid;
begin
  perform private.judicial_require_internal(false);
  select * into v_p from public.judicial_publications where id = p_id for update;
  if v_p.id is null then
    raise exception 'Publicação não encontrada' using errcode = 'P0002';
  end if;
  if v_p.triage_status = 'DONE' then
    raise exception 'Esta publicação já foi tratada' using errcode = '55000';
  end if;
  if v_title is null then
    raise exception 'Informe o título do prazo' using errcode = '22023';
  end if;
  if p_deadline ->> 'due_on' is not null then
    v_due := ((p_deadline ->> 'due_on')::date + time '23:59') at time zone 'America/Sao_Paulo';
  elsif p_deadline ->> 'due_at' is not null then
    v_due := (p_deadline ->> 'due_at')::timestamptz;
  else
    raise exception 'Informe o vencimento' using errcode = '22023';
  end if;
  select lp.legal_case_id, coalesce(v_resp, lp.responsible_user_id, c.assigned_lawyer_id)
    into v_case, v_resp
  from public.legal_processes lp join public.legal_cases c on c.id = lp.legal_case_id
  where lp.id = v_p.legal_process_id;

  insert into public.deadlines
    (legal_case_id, legal_process_id, title, deadline_type, description, due_at, priority, responsible_user_id, source)
  values
    (v_case, v_p.legal_process_id, left(v_title, 200), coalesce(nullif(p_deadline ->> 'deadline_type', ''), 'MANIFESTATION'),
     coalesce(nullif(btrim(coalesce(p_deadline ->> 'description', '')), ''),
              'Publicação do DJEN disponibilizada em ' || to_char(v_p.available_on, 'DD/MM/YYYY')
              || coalesce(' (' || v_p.court || ')', '') || '.'),
     v_due, coalesce(nullif(p_deadline ->> 'priority', ''), 'HIGH'), v_resp, 'JUDICIAL_INTEGRATION')
  returning id into v_id;

  update public.judicial_publications
     set triage_status = 'DONE', triage_outcome = 'DEADLINE', deadline_id = v_id,
         triage_notes = left(nullif(btrim(coalesce(p_deadline ->> 'notes', '')), ''), 2000),
         triaged_by = auth.uid(), triaged_at = now()
   where id = p_id;
  perform private.record_audit_event('JUDICIAL_PUBLICATION_DEADLINE', 'judicial_publications', p_id,
    jsonb_build_object('deadline_id', v_id, 'legal_process_id', v_p.legal_process_id));
  return jsonb_build_object('deadline_id', v_id, 'publication_id', p_id);
end
$$;

-- ═════════════════════════════ telas: processo ═══════════════════════════

-- Situação do acompanhamento automático de um processo. Parceiro: só os campos
-- de situação (sem erro técnico).
create or replace function private.get_process_judicial_status(p_process_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_internal boolean := private.is_internal_user();
  v_p        record;
  v_r        public.process_external_refs;
begin
  if not v_internal and not private.can_access_process(p_process_id) then
    raise exception 'Processo não encontrado' using errcode = 'P0002';
  end if;
  select lp.id, lp.cnj_number, lp.deleted_at into v_p from public.legal_processes lp where lp.id = p_process_id;
  if v_p.id is null or (not v_internal and v_p.deleted_at is not null) then
    raise exception 'Processo não encontrado' using errcode = 'P0002';
  end if;
  select * into v_r from public.process_external_refs r
  where r.legal_process_id = p_process_id and r.provider = 'DATAJUD';
  return jsonb_build_object(
    'has_cnj', v_p.cnj_number is not null,
    'tracked', v_r.id is not null and v_r.sync_enabled and v_p.cnj_number is not null and v_r.external_id = v_p.cnj_number,
    'sync_enabled', coalesce(v_r.sync_enabled, false),
    'last_synced_at', v_r.last_synced_at,
    'baseline_at', v_r.baseline_at,
    'court_alias', v_r.metadata ->> 'alias',
    'last_error', case when v_internal then v_r.last_error end,
    'last_attempt_at', case when v_internal then v_r.last_attempt_at end,
    'can_manage', (select private.has_internal_role('ADMIN', 'LAWYER')),
    'publications', case when v_internal then (
      select jsonb_build_object('total', count(*), 'open', count(*) filter (where pb.triage_status <> 'DONE'))
      from public.judicial_publications pb where pb.legal_process_id = p_process_id) end);
end
$$;

create or replace function private.set_process_judicial_sync(p_process_id uuid, p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ref uuid;
begin
  perform private.judicial_require_internal(false);
  update public.process_external_refs set sync_enabled = coalesce(p_enabled, false)
  where legal_process_id = p_process_id and provider = 'DATAJUD'
  returning id into v_ref;
  if v_ref is null then
    raise exception 'Processo sem número CNJ: não há o que acompanhar' using errcode = 'P0002';
  end if;
  perform private.record_audit_event(case when p_enabled then 'PROCESS_SYNC_ENABLED' else 'PROCESS_SYNC_PAUSED' end,
    'legal_processes', p_process_id, '{}');
  return jsonb_build_object('legal_process_id', p_process_id, 'sync_enabled', coalesce(p_enabled, false));
end
$$;

-- ═════════════════════════════ servidor (dg_worker) ══════════════════════

-- Abre uma rodada. Outra rodada em andamento há menos de 15 min: devolve
-- busy (cron e botão não rodam juntos). Mais antiga: marcada como interrompida.
-- MANUAL exige quem pediu (ADMIN ou advogado ativo; o servidor já conferiu a sessão).
create or replace function private.judicial_sync_begin(
  p_trigger text, p_requested_by uuid default null, p_process_id uuid default null, p_only_datajud boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s   public.judicial_settings;
  v_run uuid;
begin
  if p_trigger not in ('CRON', 'MANUAL') then
    raise exception 'Origem inválida' using errcode = '22023';
  end if;
  if p_trigger = 'MANUAL' and (p_requested_by is null
     or coalesce(private.user_internal_role(p_requested_by)::text, '') not in ('ADMIN', 'LAWYER')
     or not coalesce(private.is_active_internal_user(p_requested_by), false)) then
    raise exception 'Busca manual só por ADMIN ou advogado ativo' using errcode = '42501';
  end if;
  if p_process_id is not null and p_trigger <> 'MANUAL' then
    raise exception 'Busca de um processo só é manual' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('dg-judicial-sync'));
  update public.judicial_sync_runs
     set status = 'FAILED', finished_at = now(), error = 'Interrompida (sem conclusão em 15 min).'
   where status = 'RUNNING' and started_at < now() - interval '15 minutes';
  if p_process_id is null and exists (
    select 1 from public.judicial_sync_runs r
    where r.status = 'RUNNING' and (r.scope = 'ALL' or (coalesce(p_only_datajud, false) and r.scope = 'DATAJUD'))) then
    return jsonb_build_object('busy', true);
  end if;

  select * into v_s from public.judicial_settings where id;
  -- Lote extra do DataJud sem nada vencido: não abre rodada (não polui o histórico).
  if coalesce(p_only_datajud, false) and p_process_id is null
     and (not v_s.datajud_enabled or jsonb_array_length(private.judicial_datajud_queue(1, null)) = 0) then
    return jsonb_build_object('busy', false, 'idle', true);
  end if;
  insert into public.judicial_sync_runs (trigger, requested_by, scope)
  values (p_trigger, p_requested_by,
          case when p_process_id is not null then 'PROCESS' when coalesce(p_only_datajud, false) then 'DATAJUD' else 'ALL' end)
  returning id into v_run;

  return jsonb_build_object(
    'busy', false, 'idle', false, 'run_id', v_run,
    'djen_enabled', v_s.djen_enabled and p_process_id is null and not coalesce(p_only_datajud, false),
    'datajud_enabled', v_s.datajud_enabled or p_process_id is not null,
    'lookback_days', v_s.lookback_days,
    'today', (now() at time zone 'America/Sao_Paulo')::date,
    -- Uma consulta por OAB, mesmo que vários escritórios a acompanhem.
    'oabs', case when p_process_id is null and not coalesce(p_only_datajud, false) then coalesce((
      -- A OAB consultada há mais tempo primeiro: se o tempo da rodada acabar,
      -- a próxima começa pelas que ficaram de fora.
      select jsonb_agg(jsonb_build_object('oab_number', x.oab_number, 'oab_state', x.oab_state)
                       order by x.last_attempt nulls first, x.oab_state, x.oab_number)
      from (select m.oab_number, m.oab_state::text as oab_state, min(s.last_attempt_at) as last_attempt
            from public.judicial_monitors m
            join public.organizations o on o.id = m.organization_id and o.status = 'ACTIVE' and o.deleted_at is null
            left join public.judicial_monitor_status s on s.judicial_monitor_id = m.id
            where m.active
            group by m.oab_number, m.oab_state) x), '[]'::jsonb) else '[]'::jsonb end);
end
$$;

-- Processos a ler no DataJud: os que estão há mais tempo sem tentativa.
create or replace function private.judicial_datajud_queue(p_limit integer default 50, p_process_id uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('ref_id', x.id, 'legal_process_id', x.legal_process_id,
                                               'cnj', x.external_id, 'baseline', x.baseline_at is not null)), '[]'::jsonb)
  from (select r.* from public.process_external_refs r
        join public.legal_processes p on p.id = r.legal_process_id and p.deleted_at is null and p.cnj_number = r.external_id
        where r.provider = 'DATAJUD'
          and (p_process_id is null and r.sync_enabled or r.legal_process_id = p_process_id)
          -- Uma vez por dia basta: a cópia do DataJud é atualizada de madrugada.
          and (p_process_id is not null or r.last_attempt_at is null or r.last_attempt_at < now() - interval '20 hours')
        order by r.last_attempt_at nulls first
        limit least(greatest(coalesce(p_limit, 50), 1), 500)) x
$$;

-- Resultado do DataJud para um processo. p_meta: campos que o DG Brasil só
-- preenche se estiverem VAZIOS (nunca sobrescreve o que a equipe digitou).
-- p_movements: [{external_id (hash do servidor), occurred_at, code, name,
-- description, grau}]. Primeira leitura = linha de base, sem aviso.
create or replace function private.judicial_ingest_datajud(
  p_run_id uuid, p_ref_id uuid, p_ok boolean, p_error text, p_meta jsonb, p_movements jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ref      public.process_external_refs;
  v_proc     record;
  v_inserted integer := 0;
  v_baseline boolean;
  v_last     record;
  v_to       uuid;
  m          jsonb;
  v_id       uuid;
begin
  select * into v_ref from public.process_external_refs r where r.id = p_ref_id and r.provider = 'DATAJUD' for update;
  if v_ref.id is null then
    raise exception 'Referência não encontrada' using errcode = 'P0002';
  end if;
  if not coalesce(p_ok, false) then
    update public.process_external_refs
       set last_attempt_at = now(), last_error = left(coalesce(nullif(btrim(p_error), ''), 'Falha sem detalhe'), 500)
     where id = p_ref_id;
    return jsonb_build_object('ok', false);
  end if;

  select lp.id, lp.legal_case_id, lp.cnj_number, lp.title into v_proc
  from public.legal_processes lp where lp.id = v_ref.legal_process_id and lp.deleted_at is null;
  if v_proc.id is null or v_proc.cnj_number is distinct from v_ref.external_id then
    update public.process_external_refs set last_attempt_at = now(), last_error = 'Processo excluído ou com outro CNJ' where id = p_ref_id;
    return jsonb_build_object('ok', false);
  end if;
  v_baseline := v_ref.baseline_at is null;

  -- Preenche só o que está vazio.
  if p_meta is not null and jsonb_typeof(p_meta) = 'object' then
    update public.legal_processes lp
       set court = coalesce(lp.court, left(nullif(p_meta ->> 'court', ''), 100)),
           court_unit = coalesce(lp.court_unit, left(nullif(p_meta ->> 'court_unit', ''), 300)),
           legal_class = coalesce(lp.legal_class, left(nullif(p_meta ->> 'legal_class', ''), 300)),
           subject = coalesce(lp.subject, left(nullif(p_meta ->> 'subject', ''), 500)),
           distribution_date = coalesce(lp.distribution_date, nullif(p_meta ->> 'distribution_date', '')::date)
     where lp.id = v_proc.id
       and ((lp.court is null and nullif(p_meta ->> 'court', '') is not null)
         or (lp.court_unit is null and nullif(p_meta ->> 'court_unit', '') is not null)
         or (lp.legal_class is null and nullif(p_meta ->> 'legal_class', '') is not null)
         or (lp.subject is null and nullif(p_meta ->> 'subject', '') is not null)
         or (lp.distribution_date is null and nullif(p_meta ->> 'distribution_date', '') is not null));
  end if;

  for m in select * from jsonb_array_elements(coalesce(p_movements, '[]'::jsonb)) limit 3000 loop
    if coalesce(m ->> 'external_id', '') !~ '^[0-9a-f]{64}$' or m ->> 'occurred_at' is null or nullif(btrim(m ->> 'name'), '') is null then
      continue;
    end if;
    insert into public.process_events
      (legal_process_id, external_provider, external_id, event_type, title, description, occurred_at, source, raw_data)
    values
      (v_proc.id, 'DATAJUD', m ->> 'external_id', 'MOVEMENT', left(m ->> 'name', 300),
       left(coalesce(nullif(btrim(m ->> 'description'), ''), m ->> 'name'), 4000), (m ->> 'occurred_at')::timestamptz,
       'JUDICIAL_INTEGRATION',
       jsonb_build_object('code', m -> 'code', 'grau', m -> 'grau', 'run_id', p_run_id))
    on conflict (external_provider, external_id) where external_provider is not null and external_id is not null do nothing
    returning id into v_id;
    if v_id is not null then
      v_inserted := v_inserted + 1;
      v_id := null;
    end if;
  end loop;

  update public.process_external_refs
     set last_attempt_at = now(), last_synced_at = now(), last_error = null,
         baseline_at = coalesce(baseline_at, now()),
         metadata = metadata || jsonb_strip_nulls(jsonb_build_object(
           'alias', p_meta ->> 'alias', 'graus', p_meta -> 'graus', 'source_updated_at', p_meta ->> 'source_updated_at'))
   where id = p_ref_id;

  if not v_baseline and v_inserted > 0 then
    select e.title, e.occurred_at into v_last from public.process_events e
    where e.legal_process_id = v_proc.id and e.external_provider = 'DATAJUD'
    order by e.occurred_at desc limit 1;
    for v_to in select * from private.judicial_recipients(v_proc.id) loop
      perform private.notify(v_to, 'PROCESS_MOVEMENT',
        'Movimentação nova: ' || coalesce(nullif(btrim(v_proc.title), ''), private.format_cnj(v_proc.cnj_number)),
        coalesce(v_last.title, 'Andamento') || case when v_inserted > 1 then ' (+' || (v_inserted - 1) || ')' else '' end,
        'INFO', 'mov:' || v_proc.id || ':' || coalesce(p_run_id::text, now()::text), v_proc.legal_case_id, v_proc.id);
    end loop;
  end if;
  return jsonb_build_object('ok', true, 'inserted', v_inserted, 'baseline', v_baseline);
end
$$;

create or replace function private.format_cnj(p_cnj text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_cnj ~ '^[0-9]{20}$' then
    substr(p_cnj, 1, 7) || '-' || substr(p_cnj, 8, 2) || '.' || substr(p_cnj, 10, 4) || '.' ||
    substr(p_cnj, 14, 1) || '.' || substr(p_cnj, 15, 2) || '.' || substr(p_cnj, 17, 4)
  else p_cnj end
$$;

-- Pede ao agente configurado a proposta de prazo de UMA publicação. Quem
-- "pede" é o responsável do processo, o advogado do caso ou quem configurou o
-- agente (o primeiro que for ADMIN/LAWYER ativo). Falha não derruba a captura.
create or replace function private.judicial_request_deadline_proposal(p_publication_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s     public.judicial_settings;
  v_p     public.judicial_publications;
  v_proc  record;
  v_actor uuid;
  v_run   uuid;
  v_dates jsonb;
  v_list  text;
begin
  select * into v_s from public.judicial_settings where id;
  if v_s.deadline_agent_id is null then
    return null;
  end if;
  select * into v_p from public.judicial_publications where id = p_publication_id;
  select lp.id, lp.legal_case_id, lp.title, lp.responsible_user_id, c.assigned_lawyer_id into v_proc
  from public.legal_processes lp join public.legal_cases c on c.id = lp.legal_case_id
  where lp.id = v_p.legal_process_id and lp.deleted_at is null and c.deleted_at is null;
  if v_proc.id is null then
    return null;
  end if;
  select u into v_actor from unnest(array[v_proc.responsible_user_id, v_proc.assigned_lawyer_id, v_s.updated_by]) with ordinality t(u, o)
  where u is not null and private.is_active_internal_user(u) and private.user_internal_role(u) in ('ADMIN', 'LAWYER')
  order by o limit 1;
  if v_actor is null then
    update public.judicial_publications set agent_error = 'Nenhum advogado ativo para pedir a proposta ao agente.' where id = p_publication_id;
    return null;
  end if;

  v_dates := private.judicial_deadline_dates(v_p.available_on, v_p.court, 15, 30);
  -- O executor mostra ao agente o TEXTO do pedido: a contagem vai nele.
  select string_agg('  dia ' || t.n || ': ' || to_char(t.d::date, 'DD/MM/YYYY'), E'\n' order by t.n) into v_list
  from jsonb_array_elements_text(v_dates -> 'list') with ordinality t(d, n);
  begin
    v_run := private.request_agent_run(
      v_s.deadline_agent_id, v_proc.legal_case_id, v_proc.id,
      -- agent_run_inputs aceita até 20 mil caracteres; teor maior vai cortado
      -- (o agente lê a íntegra pelo link, se precisar).
      left('Publicação do DJEN no processo ' || private.format_cnj(v_p.cnj_number)
        || ' (' || coalesce(v_p.court, 'tribunal não informado') || coalesce(' — ' || v_p.organ, '')
        || '), disponibilizada em ' || to_char(v_p.available_on, 'DD/MM/YYYY')
        || ', publicada em ' || to_char((v_dates ->> 'published_on')::date, 'DD/MM/YYYY')
        || '. Tipo: ' || coalesce(v_p.communication_type, '—') || E'.\n\n'
        || 'O QUE FAZER: leia o teor e diga se ele abre prazo para o nosso cliente. Se abrir, chame a ferramenta propor '
        || 'UMA vez, tipo CREATE_DEADLINE, dados {title, due_at (ISO 8601, fim do dia do vencimento, -03:00), description '
        || '(fundamento legal e a contagem: quantos dias úteis e por quê), priority}. Se não houver prazo, chame propor '
        || 'tipo OTHER, resumo começando com "Sem prazo:" e o motivo em dados.description — quem decide é a equipe.' || E'\n\n'
        || 'DIAS ÚTEIS a partir da publicação (dia 1 = primeiro dia do prazo; já descontados fins de semana, feriados nacionais, '
        || 'Sexta-feira Santa, recesso de 20/12 a 20/01 e os dias cadastrados para o tribunal; feriado local não cadastrado '
        || 'NÃO está descontado — avise na descrição se suspeitar de um):' || E'\n' || coalesce(v_list, '(indisponível)')
        || coalesce(E'\n\nÍntegra: ' || v_p.link, '') || E'\n\nTEOR:\n' || v_p.content, 20000),
      jsonb_build_object('kind', 'JUDICIAL_PUBLICATION', 'publication_id', v_p.id, 'cnj', v_p.cnj_number,
                         'content_truncated', length(v_p.content) > 18000,
                         'court', v_p.court, 'available_on', v_p.available_on,
                         'published_on', v_dates -> 'published_on', 'first_day', v_dates -> 'first_day',
                         'business_days', v_dates -> 'list', 'skipped_days', v_dates -> 'skipped',
                         'calendar_note', v_dates -> 'note'),
      'EXECUTE', v_actor);
    update public.judicial_publications set agent_run_id = v_run, triage_status = 'WITH_AGENT', agent_error = null
    where id = p_publication_id and triage_status = 'PENDING';
  exception when others then
    update public.judicial_publications set agent_error = left('Agente não acionado: ' || sqlerrm, 500) where id = p_publication_id;
    v_run := null;
  end;
  -- request_agent_run fixa o ator da transação: limpa para os próximos avisos.
  perform set_config('dg.actor_user_id', '', true);
  return v_run;
end
$$;

-- Resultado do DJEN para uma OAB num período. p_items (normalizados no
-- servidor): [{external_id, cnj, court, organ, communication_type, class_name,
-- available_on, content, link}]. Só entra publicação de processo cadastrado.
create or replace function private.judicial_ingest_djen(
  p_run_id uuid, p_oab_number text, p_oab_state text, p_from date, p_to date,
  p_ok boolean, p_error text, p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_oab       text := private.normalize_oab(p_oab_number);
  v_uf        text := upper(p_oab_state);
  v_tag       text;
  v_err       text := left(coalesce(nullif(btrim(p_error), ''), 'Falha sem detalhe'), 500);
  i           jsonb;
  v_proc      record;
  v_pub       uuid;
  v_event     uuid;
  v_new       integer := 0;
  v_dup       integer := 0;
  v_matched   integer := 0;
  v_found     integer := 0;
  v_unmatched text[] := '{}';
  v_new_ids   uuid[] := '{}';
  v_to        uuid;
  v_old       record;
  v_cancel    boolean;
  d           date;
begin
  if v_oab is null or v_uf !~ '^[A-Z]{2}$' or p_from is null or p_to is null or p_to < p_from or p_to - p_from > 31 then
    raise exception 'Parâmetros inválidos' using errcode = '22023';
  end if;
  v_tag := v_uf || ' ' || v_oab;

  if not coalesce(p_ok, false) then
    for d in select g::date from generate_series(p_from, p_to, interval '1 day') g loop
      insert into public.judicial_capture_days (oab_number, oab_state, day, last_error_at, last_error)
      values (v_oab, v_uf::public.uf_code, d, now(), v_err)
      on conflict (oab_number, oab_state, day) do update set last_error_at = now(), last_error = v_err;
    end loop;
    insert into public.judicial_monitor_status (judicial_monitor_id, last_attempt_at, last_error, updated_at)
    select m.id, now(), v_err, now() from public.judicial_monitors m where m.oab_number = v_oab and m.oab_state = v_uf and m.active
    on conflict (judicial_monitor_id) do update set last_attempt_at = now(), last_error = v_err, updated_at = now();
    return jsonb_build_object('ok', false);
  end if;

  for i in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) limit 5000 loop
    v_found := v_found + 1;
    if coalesce(i ->> 'cnj', '') !~ '^[0-9]{20}$' or nullif(i ->> 'external_id', '') is null or i ->> 'available_on' is null then
      continue;
    end if;
    select lp.id, lp.legal_case_id, lp.title into v_proc
    from public.legal_processes lp where lp.cnj_number = i ->> 'cnj' and lp.deleted_at is null;
    if v_proc.id is null then
      if not (i ->> 'cnj' = any (v_unmatched)) and coalesce(array_length(v_unmatched, 1), 0) < 100 then
        v_unmatched := v_unmatched || (i ->> 'cnj');
      end if;
      continue;
    end if;
    v_matched := v_matched + 1;
    v_cancel := coalesce((i ->> 'cancelled')::boolean, false);

    -- Já capturada (por esta ou por outra OAB): anota quem a trouxe e, se o
    -- tribunal cancelou depois, registra o cancelamento e avisa.
    select p.id, p.cancelled_at into v_old from public.judicial_publications p
    where p.provider = 'DJEN' and p.external_id = i ->> 'external_id' for update;
    if v_old.id is not null then
      update public.judicial_publications
         set found_by = case when v_tag = any (found_by) then found_by else found_by || v_tag end,
             djen_hash = coalesce(djen_hash, nullif(i ->> 'hash', '')),
             cancelled_at = case when v_cancel and cancelled_at is null then now() else cancelled_at end,
             cancel_reason = case when v_cancel and cancelled_at is null then left(nullif(btrim(i ->> 'cancel_reason'), ''), 2000) else cancel_reason end
       where id = v_old.id;
      if v_cancel and v_old.cancelled_at is null then
        for v_to in select * from private.judicial_recipients(v_proc.id) loop
          perform private.notify(v_to, 'PUBLICATION_CANCELLED',
            'Publicação cancelada: ' || coalesce(nullif(btrim(v_proc.title), ''), private.format_cnj(i ->> 'cnj')),
            'O tribunal cancelou a publicação de ' || to_char((i ->> 'available_on')::date, 'DD/MM/YYYY')
              || '. Confira se o prazo criado a partir dela ainda vale.',
            'URGENT', 'pubc:' || v_old.id, v_proc.legal_case_id, v_proc.id, null, 'publication', v_old.id);
        end loop;
      end if;
      v_dup := v_dup + 1;
      continue;
    end if;

    insert into public.process_events
      (legal_process_id, external_provider, external_id, event_type, title, description, occurred_at, source, important, raw_data)
    values
      (v_proc.id, 'DJEN', i ->> 'external_id', 'PUBLICATION',
       left('Publicação' || coalesce(' — ' || nullif(btrim(i ->> 'communication_type'), ''), '') || coalesce(' — ' || nullif(btrim(i ->> 'organ'), ''), ''), 300),
       left(coalesce(nullif(btrim(i ->> 'content'), ''), 'Publicação sem texto.'), 4000),
       ((i ->> 'available_on')::date + time '12:00') at time zone 'America/Sao_Paulo',
       'JUDICIAL_INTEGRATION', true,
       jsonb_build_object('court', i ->> 'court', 'link', i ->> 'link', 'run_id', p_run_id))
    on conflict (external_provider, external_id) where external_provider is not null and external_id is not null do nothing
    returning id into v_event;

    insert into public.judicial_publications
      (external_id, legal_process_id, cnj_number, court, organ, communication_type, class_name, available_on,
       content, link, djen_hash, cancelled_at, cancel_reason, found_by, process_event_id)
    values
      (i ->> 'external_id', v_proc.id, i ->> 'cnj', left(nullif(btrim(i ->> 'court'), ''), 40),
       left(nullif(btrim(i ->> 'organ'), ''), 300), left(nullif(btrim(i ->> 'communication_type'), ''), 100),
       left(nullif(btrim(i ->> 'class_name'), ''), 300), (i ->> 'available_on')::date,
       left(coalesce(nullif(btrim(i ->> 'content'), ''), 'Publicação sem texto.'), 200000),
       left(nullif(btrim(i ->> 'link'), ''), 1000), nullif(i ->> 'hash', ''),
       case when v_cancel then now() end, case when v_cancel then left(nullif(btrim(i ->> 'cancel_reason'), ''), 2000) end,
       array[v_tag], v_event)
    returning id into v_pub;
    v_new := v_new + 1;
    -- Já cancelada ao chegar: fica registrada, sem acionar o agente.
    if not v_cancel then
      v_new_ids := v_new_ids || v_pub;
    end if;

    for v_to in select * from private.judicial_recipients(v_proc.id) loop
      perform private.notify(v_to, 'PUBLICATION_RECEIVED',
        'Publicação: ' || coalesce(nullif(btrim(v_proc.title), ''), private.format_cnj(i ->> 'cnj')),
        coalesce(nullif(btrim(i ->> 'communication_type'), ''), 'Publicação') || ' disponibilizada em '
          || to_char((i ->> 'available_on')::date, 'DD/MM/YYYY') || coalesce(' — ' || nullif(btrim(i ->> 'organ'), ''), '') || '.',
        'WARNING', 'pub:' || v_pub, v_proc.legal_case_id, v_proc.id, null, 'publication', v_pub);
    end loop;
    v_pub := null;
    v_event := null;
  end loop;

  -- Agente depois dos avisos (ele fixa o ator da transação).
  foreach v_pub in array v_new_ids loop
    perform private.judicial_request_deadline_proposal(v_pub);
  end loop;

  -- Prova de diligência: o período inteiro foi consultado com sucesso.
  for d in select g::date from generate_series(p_from, p_to, interval '1 day') g loop
    insert into public.judicial_capture_days (oab_number, oab_state, day, first_ok_at, last_ok_at, found)
    values (v_oab, v_uf::public.uf_code, d, now(), now(),
            (select count(*) from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x where (x ->> 'available_on')::date = d))
    on conflict (oab_number, oab_state, day) do update
      set first_ok_at = coalesce(judicial_capture_days.first_ok_at, now()), last_ok_at = now(), found = excluded.found;
  end loop;

  insert into public.judicial_monitor_status
    (judicial_monitor_id, last_attempt_at, last_success_at, last_error, last_found, last_matched, unmatched_cnjs, updated_at)
  select m.id, now(), now(), null, v_found, v_matched, v_unmatched, now()
  from public.judicial_monitors m where m.oab_number = v_oab and m.oab_state = v_uf and m.active
  on conflict (judicial_monitor_id) do update
    set last_attempt_at = now(), last_success_at = now(), last_error = null, last_found = excluded.last_found,
        last_matched = excluded.last_matched, unmatched_cnjs = excluded.unmatched_cnjs, updated_at = now();

  return jsonb_build_object('ok', true, 'found', v_found, 'matched', v_matched, 'new', v_new, 'duplicates', v_dup,
                            'unmatched', coalesce(array_length(v_unmatched, 1), 0));
end
$$;

-- Fecha a rodada. Com falha: avisa os ADMIN (uma vez por rodada).
create or replace function private.judicial_sync_finish(p_run_id uuid, p_status text, p_stats jsonb, p_error text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_to uuid;
begin
  if p_status not in ('COMPLETED', 'PARTIAL', 'FAILED') then
    raise exception 'Situação inválida' using errcode = '22023';
  end if;
  update public.judicial_sync_runs
     set status = p_status, finished_at = now(), stats = coalesce(p_stats, '{}'),
         error = left(nullif(btrim(coalesce(p_error, '')), ''), 1000)
   where id = p_run_id and status = 'RUNNING';
  if found and p_status in ('PARTIAL', 'FAILED') then
    for v_to in select * from private.active_admin_ids() loop
      perform private.notify(v_to, 'JUDICIAL_SYNC_FAILED',
        case when p_status = 'FAILED' then 'A busca de publicações e andamentos falhou' else 'A busca de publicações e andamentos terminou com falhas' end,
        coalesce(left(nullif(btrim(coalesce(p_error, '')), ''), 300), 'Veja os detalhes em Configurações → Integrações.'),
        'WARNING', 'jsync:' || p_run_id);
    end loop;
  end if;
end
$$;

-- ═════════════════════════════ ligação com Revisões ══════════════════════

-- Proposta de prazo aplicada (aprovada em Revisões) fecha a triagem; rejeitada
-- ou com falha devolve a publicação à triagem quando não sobra outra pendente.
create or replace function private.judicial_publications_follow_proposals()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.proposal_type <> 'CREATE_DEADLINE' or new.status is not distinct from old.status then
    return new;
  end if;
  if new.status = 'APPLIED' and new.applied_entity_type = 'deadlines' and new.applied_entity_id is not null then
    update public.judicial_publications p
       set triage_status = 'DONE', triage_outcome = 'DEADLINE', deadline_id = new.applied_entity_id,
           triaged_by = (select d.decided_by from public.reviews rv join public.review_decisions d on d.review_id = rv.id
                         where rv.agent_proposal_id = new.id and d.decision = 'APPROVE'
                         order by d.created_at desc limit 1),
           triaged_at = now()
     where p.agent_run_id = new.agent_run_id and p.triage_status = 'WITH_AGENT';
  elsif new.status in ('REJECTED', 'FAILED') then
    update public.judicial_publications p
       set triage_status = 'PENDING'
     where p.agent_run_id = new.agent_run_id and p.triage_status = 'WITH_AGENT'
       and not exists (select 1 from public.agent_proposals ap
                       where ap.agent_run_id = new.agent_run_id and ap.id <> new.id
                         and ap.proposal_type = 'CREATE_DEADLINE' and ap.status in ('PENDING', 'APPROVED'));
  end if;
  return new;
end
$$;

create trigger agent_proposals_judicial_publications
  after update of status on public.agent_proposals
  for each row execute function private.judicial_publications_follow_proposals();

-- Execução terminou sem proposta de prazo pendente: volta para a triagem humana.
create or replace function private.judicial_publications_follow_runs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is not distinct from old.status or new.status not in ('COMPLETED', 'FAILED', 'CANCELLED') then
    return new;
  end if;
  update public.judicial_publications p
     set triage_status = 'PENDING',
         agent_error = case when new.status <> 'COMPLETED' then left('Execução do agente: ' || new.status, 500) else p.agent_error end
   where p.agent_run_id = new.id and p.triage_status = 'WITH_AGENT'
     and not exists (select 1 from public.agent_proposals ap
                     where ap.agent_run_id = new.id and ap.proposal_type = 'CREATE_DEADLINE'
                       and ap.status in ('PENDING', 'APPROVED', 'APPLIED'));
  return new;
end
$$;

create trigger agent_runs_judicial_publications
  after update of status on public.agent_runs
  for each row execute function private.judicial_publications_follow_runs();

-- ═════════════════════════════ 9. agendador do banco (DataJud) ══════════

-- A cópia pública do DataJud responde devagar (30–50 s por consulta em alguns
-- tribunais, medido em 2026-11-03) e a rota do servidor tem 60 s no plano
-- Hobby: uma rodada por dia não dá conta de todos os processos. O pg_cron chama
-- a rota a cada 20 min só para o DataJud (cada processo continua sendo lido no
-- máximo uma vez a cada 20 h; sem processo vencido, a rota nem abre rodada).
-- As publicações (DJEN) continuam uma vez por dia, de manhã.
--
-- Precisa de pg_net e de dois segredos no Vault (docs/deploy/producao.md):
--   select vault.create_secret('https://app.dgbrasil.adv.br', 'dg_app_url');
--   select vault.create_secret('<o mesmo CRON_SECRET da Vercel>', 'dg_cron_secret');
-- Sem eles, não faz nada.
create or replace function private.judicial_cron_kick()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url    text;
  v_secret text;
begin
  if to_regnamespace('net') is null or to_regclass('vault.decrypted_secrets') is null then
    return 'pg_net ou Vault indisponível';
  end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1' into v_url using 'dg_app_url';
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1' into v_secret using 'dg_cron_secret';
  if nullif(btrim(coalesce(v_url, '')), '') is null or nullif(btrim(coalesce(v_secret, '')), '') is null then
    return 'segredos dg_app_url/dg_cron_secret ausentes';
  end if;
  if not (select datajud_enabled from public.judicial_settings where id)
     or jsonb_array_length(private.judicial_datajud_queue(1, null)) = 0 then
    return 'nada a ler';
  end if;
  execute 'select net.http_get(url := $1, headers := $2, timeout_milliseconds := 60000)'
    using rtrim(v_url, '/') || '/api/cron/judicial-sync?only=datajud',
          jsonb_build_object('Authorization', 'Bearer ' || v_secret);
  return 'chamado';
end
$$;

do $$
begin
  if to_regnamespace('cron') is not null then
    perform cron.schedule('dg-datajud', '*/20 * * * *', 'select private.judicial_cron_kick()');
  else
    raise notice 'pg_cron indisponível: o DataJud fica só na rodada diária';
  end if;
end
$$;

-- ═════════════════════════════ wrappers públicos (tela) ══════════════════

create or replace function public.save_judicial_monitor(p_oab_number text, p_oab_state text, p_lawyer_name text default null,
                                                        p_organization_id uuid default null, p_responsible_user_id uuid default null)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.save_judicial_monitor(p_oab_number, p_oab_state, p_lawyer_name, p_organization_id, p_responsible_user_id) $$;

create or replace function public.set_judicial_monitor_active(p_id uuid, p_active boolean)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.set_judicial_monitor_active(p_id, p_active) $$;

create or replace function public.get_my_judicial_monitors()
returns jsonb language sql security invoker set search_path = ''
as $$ select private.get_my_judicial_monitors() $$;

create or replace function public.get_judicial_coverage(p_oab_number text, p_oab_state text, p_from date default null, p_to date default null)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.get_judicial_coverage(p_oab_number, p_oab_state, p_from, p_to) $$;

create or replace function public.get_judicial_overview()
returns jsonb language sql security invoker set search_path = ''
as $$ select private.get_judicial_overview() $$;

create or replace function public.save_judicial_settings(p_settings jsonb)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.save_judicial_settings(p_settings) $$;

create or replace function public.save_court_calendar_day(p_court text, p_day date, p_kind text, p_description text)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.save_court_calendar_day(p_court, p_day, p_kind, p_description) $$;

create or replace function public.delete_court_calendar_day(p_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.delete_court_calendar_day(p_id) $$;

create or replace function public.judicial_deadline_preview(p_available_on date, p_court text, p_days integer)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.judicial_deadline_preview(p_available_on, p_court, p_days) $$;

create or replace function public.list_judicial_publications(p_filter jsonb default '{}')
returns jsonb language sql security invoker set search_path = ''
as $$ select private.list_judicial_publications(p_filter) $$;

create or replace function public.get_judicial_publication(p_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.get_judicial_publication(p_id) $$;

create or replace function public.judicial_publication_decide(p_id uuid, p_action text, p_notes text default null)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.judicial_publication_decide(p_id, p_action, p_notes) $$;

create or replace function public.create_deadline_from_publication(p_id uuid, p_deadline jsonb)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.create_deadline_from_publication(p_id, p_deadline) $$;

create or replace function public.get_process_judicial_status(p_process_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.get_process_judicial_status(p_process_id) $$;

create or replace function public.set_process_judicial_sync(p_process_id uuid, p_enabled boolean)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.set_process_judicial_sync(p_process_id, p_enabled) $$;

-- ═════════════════════════════ grants ════════════════════════════════════

do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where (n.nspname = 'private' and p.proname in (
             'judicial_connection_id', 'legal_processes_track_cnj', 'easter_sunday', 'non_business_reason',
             'next_business_day', 'judicial_deadline_dates', 'judicial_recipients', 'judicial_require_internal',
             'normalize_oab', 'judicial_monitor_json', 'save_judicial_monitor', 'set_judicial_monitor_active',
             'get_my_judicial_monitors', 'get_judicial_coverage', 'get_judicial_overview', 'save_judicial_settings',
             'save_court_calendar_day', 'delete_court_calendar_day', 'judicial_deadline_preview',
             'judicial_publication_json', 'list_judicial_publications', 'get_judicial_publication',
             'judicial_publication_decide', 'create_deadline_from_publication', 'get_process_judicial_status',
             'set_process_judicial_sync', 'judicial_sync_begin', 'judicial_datajud_queue', 'judicial_ingest_datajud',
             'format_cnj', 'judicial_request_deadline_proposal', 'judicial_ingest_djen', 'judicial_sync_finish',
             'judicial_publications_follow_proposals', 'judicial_publications_follow_runs', 'judicial_cron_kick'))
       or (n.nspname = 'public' and p.proname in (
             'save_judicial_monitor', 'set_judicial_monitor_active', 'get_my_judicial_monitors', 'get_judicial_coverage',
             'get_judicial_overview', 'save_judicial_settings', 'save_court_calendar_day', 'delete_court_calendar_day',
             'judicial_deadline_preview', 'list_judicial_publications', 'get_judicial_publication',
             'judicial_publication_decide', 'create_deadline_from_publication', 'get_process_judicial_status',
             'set_process_judicial_sync'))
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
  end loop;

  -- Tela: pública (invoker) → privada (definer); cada privada confere o papel.
  for f in
    select p.oid::regprocedure
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('private', 'public') and p.proname in (
             'save_judicial_monitor', 'set_judicial_monitor_active', 'get_my_judicial_monitors', 'get_judicial_coverage',
             'get_judicial_overview', 'save_judicial_settings', 'save_court_calendar_day', 'delete_court_calendar_day',
             'judicial_deadline_preview', 'list_judicial_publications', 'get_judicial_publication',
             'judicial_publication_decide', 'create_deadline_from_publication', 'get_process_judicial_status',
             'set_process_judicial_sync')
  loop
    execute format('grant execute on function %s to authenticated', f);
  end loop;

  -- Servidor do DG Brasil (login dg_worker): só as portas da busca.
  for f in
    select p.oid::regprocedure
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname in (
             'judicial_sync_begin', 'judicial_datajud_queue', 'judicial_ingest_datajud', 'judicial_ingest_djen',
             'judicial_sync_finish')
  loop
    execute format('grant execute on function %s to dg_worker', f);
  end loop;
end
$$;

-- Notificação de categoria JUDICIAL usa o mesmo private.notify (037). Funções
-- auxiliares usadas por dentro (format_cnj, normalize_oab, calendário) rodam
-- como o dono das funções definer: não precisam de grant.
