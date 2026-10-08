-- DG Brasil — 010: solicitações a parceiros e notificações

create table public.partner_requests (
  id                      uuid primary key default gen_random_uuid(),
  partner_organization_id uuid not null references public.organizations (id) on delete restrict,
  legal_case_id           uuid not null references public.legal_cases (id) on delete restrict,
  legal_process_id        uuid,
  type                    text not null check (type in ('DOCUMENT', 'INFORMATION', 'CORRECTION', 'GENERAL')),
  title                   text not null check (btrim(title) <> ''),
  description             text,
  due_at                  timestamptz,
  status                  text not null default 'OPEN' check (status in ('OPEN', 'ANSWERED', 'RESOLVED', 'CANCELLED')),
  created_by              uuid references public.profiles (id) on delete restrict,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  answered_at             timestamptz,
  resolved_at             timestamptz,
  constraint partner_requests_process_fkey
    foreign key (legal_process_id, legal_case_id)
    references public.legal_processes (id, legal_case_id) on delete restrict,
  constraint partner_requests_answered_has_date check (status <> 'ANSWERED' or answered_at is not null),
  constraint partner_requests_resolved_has_date check (status <> 'RESOLVED' or resolved_at is not null)
);

create index partner_requests_partner_status_idx on public.partner_requests (partner_organization_id, status);
create index partner_requests_case_idx on public.partner_requests (legal_case_id);

create trigger partner_requests_set_updated_at
  before update on public.partner_requests
  for each row execute function private.set_updated_at();

create or replace function private.partner_requests_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A solicitação vai para o parceiro operacional do caso, e só para ele.
  if (tg_op = 'INSERT'
      or new.legal_case_id is distinct from old.legal_case_id
      or new.partner_organization_id is distinct from old.partner_organization_id)
     and not exists (
       select 1 from public.legal_cases c
       where c.id = new.legal_case_id and c.partner_organization_id = new.partner_organization_id
     ) then
    raise exception 'A solicitação precisa ir para o parceiro do caso' using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
  elsif private.is_partner_user() then
    -- Parceiro só responde: muda status/answered_at e nada mais.
    if (to_jsonb(new) - array['status', 'answered_at', 'updated_at'])
       <> (to_jsonb(old) - array['status', 'answered_at', 'updated_at']) then
      raise exception 'Parceiro só pode responder a solicitação' using errcode = '42501';
    end if;
  end if;

  if new.status = 'ANSWERED' and new.answered_at is null then
    new.answered_at := now();
  end if;
  if new.status = 'RESOLVED' and new.resolved_at is null then
    new.resolved_at := now();
  end if;
  return new;
end
$$;

create trigger partner_requests_guard
  before insert or update on public.partner_requests
  for each row execute function private.partner_requests_guard();

-- Conversa da solicitação (append-only). A resposta do parceiro mora aqui;
-- se vier com documento, o documento fica vinculado à mensagem.
create table public.partner_request_messages (
  id                 uuid primary key default gen_random_uuid(),
  partner_request_id uuid not null references public.partner_requests (id) on delete restrict,
  author_id          uuid references public.profiles (id) on delete restrict,
  body               text not null check (btrim(body) <> ''),
  document_id        uuid references public.documents (id) on delete restrict,
  created_at         timestamptz not null default now()
);

create index partner_request_messages_request_idx
  on public.partner_request_messages (partner_request_id, created_at);

create or replace function private.partner_request_messages_fill_author()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.author_id := coalesce(new.author_id, auth.uid());
  if auth.uid() is not null and new.author_id <> auth.uid() then
    raise exception 'Mensagem só em nome do próprio usuário' using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger partner_request_messages_fill_author
  before insert on public.partner_request_messages
  for each row execute function private.partner_request_messages_fill_author();

create trigger partner_request_messages_append_only
  before update or delete on public.partner_request_messages
  for each row execute function private.prevent_mutation();

-- ───────────────────────────── notificações ───────────────────────────────

create table public.notifications (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles (id) on delete restrict,
  type               text not null check (type ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  title              text not null check (btrim(title) <> ''),
  message            text,
  severity           text not null default 'INFO' check (severity in ('INFO', 'WARNING', 'URGENT', 'CRITICAL')),
  legal_case_id      uuid references public.legal_cases (id) on delete restrict,
  legal_process_id   uuid references public.legal_processes (id) on delete restrict,
  partner_request_id uuid references public.partner_requests (id) on delete restrict,
  read_at            timestamptz,
  created_at         timestamptz not null default now()
);

create index notifications_user_read_created_idx
  on public.notifications (user_id, read_at, created_at desc);

-- ───────────────────────────── preferências do usuário ────────────────────
-- Preferências NÃO são perfil: ficam aqui, uma linha por usuário. O envio real
-- (e-mail, resumo) é do backend; isto só guarda a escolha.

create table public.user_preferences (
  user_id           uuid primary key references public.profiles (id) on delete cascade,
  digest            text not null default 'NONE' check (digest in ('NONE', 'DAILY', 'WEEKLY')),
  tour_completed_at timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create trigger user_preferences_set_updated_at
  before update on public.user_preferences
  for each row execute function private.set_updated_at();

-- Por tipo de notificação: canal in-app e e-mail. Sem linha = padrão do sistema.
create table public.user_notification_preferences (
  user_id           uuid not null references public.profiles (id) on delete cascade,
  notification_type text not null check (notification_type ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  in_app            boolean not null default true,
  email             boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  primary key (user_id, notification_type)
);

create trigger user_notification_preferences_set_updated_at
  before update on public.user_notification_preferences
  for each row execute function private.set_updated_at();
