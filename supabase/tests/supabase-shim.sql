-- Simulação mínima do ambiente Supabase para rodar as migrations no PGlite.
-- SÓ PARA TESTE LOCAL. Nunca executar num projeto Supabase de verdade.
--
-- Reproduz o que as migrations e as políticas usam:
--   roles anon / authenticated / service_role (esta com BYPASSRLS)
--   auth.users e auth.uid() lendo request.jwt.claims, como o PostgREST faz
--   storage.buckets e storage.objects com RLS ligada
--   um pgmq de brinquedo com create/list_queues/send/read/archive
--   os default privileges que o Supabase aplica em public

create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

-- ───────────────────────────── auth ───────────────────────────────────────

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;

create table auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text,
  raw_user_meta_data jsonb not null default '{}',
  created_at         timestamptz not null default now()
);

create function auth.uid() returns uuid
language sql stable
as $$
  select nullif(
    coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
    ), ''
  )::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- ───────────────────────────── storage ────────────────────────────────────

create schema storage;
grant usage on schema storage to anon, authenticated, service_role;

create table storage.buckets (
  id                 text primary key,
  name               text not null,
  public             boolean not null default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz not null default now()
);

create table storage.objects (
  id         uuid primary key default gen_random_uuid(),
  bucket_id  text references storage.buckets (id),
  name       text,
  owner      uuid,
  metadata   jsonb,
  created_at timestamptz not null default now()
);
alter table storage.objects enable row level security;
grant all on storage.buckets, storage.objects to anon, authenticated, service_role;

-- ───────────────────────────── pgmq (simulado) ────────────────────────────

create schema pgmq;

create table pgmq.queues (
  queue_name text primary key,
  created_at timestamptz not null default now()
);

create table pgmq.messages (
  msg_id      bigserial primary key,
  queue_name  text not null references pgmq.queues (queue_name),
  message     jsonb not null,
  read_ct     integer not null default 0,
  enqueued_at timestamptz not null default now(),
  vt          timestamptz not null default now(),
  archived_at timestamptz
);

create function pgmq.create(queue_name text) returns void
language sql as $$ insert into pgmq.queues values (queue_name) on conflict do nothing $$;

create function pgmq.list_queues() returns table (queue_name text, created_at timestamptz)
language sql as $$ select queue_name, created_at from pgmq.queues $$;

create function pgmq.send(queue_name text, msg jsonb, delay integer default 0) returns setof bigint
language sql as $$
  insert into pgmq.messages (queue_name, message, vt)
  values (queue_name, msg, now() + make_interval(secs => delay))
  returning msg_id
$$;

create function pgmq.read(queue_name text, vt integer, qty integer)
returns table (msg_id bigint, read_ct integer, enqueued_at timestamptz, vt timestamptz, message jsonb)
language sql as $$
  update pgmq.messages m
     set read_ct = m.read_ct + 1, vt = now() + make_interval(secs => read.vt)
   where m.msg_id in (
     select x.msg_id from pgmq.messages x
     where x.queue_name = read.queue_name and x.archived_at is null and x.vt <= now()
     order by x.msg_id limit qty
   )
  returning m.msg_id, m.read_ct, m.enqueued_at, m.vt, m.message
$$;

create function pgmq.archive(queue_name text, msg_id bigint) returns boolean
language sql as $$
  update pgmq.messages m set archived_at = now()
  where m.queue_name = archive.queue_name and m.msg_id = archive.msg_id
  returning true
$$;

-- Como numa instalação nova de extensão: aberto por padrão, a 018 fecha.
grant usage on schema pgmq to public;
grant all on all tables in schema pgmq to public;
grant all on all sequences in schema pgmq to public;

create function pgmq.set_vt(queue_name text, msg_id bigint, vt_offset integer)
returns table (msg_id bigint, read_ct integer, enqueued_at timestamptz, vt timestamptz, message jsonb)
language sql as $$
  update pgmq.messages m set vt = now() + make_interval(secs => vt_offset)
  where m.queue_name = set_vt.queue_name and m.msg_id = set_vt.msg_id
  returning m.msg_id, m.read_ct, m.enqueued_at, m.vt, m.message
$$;
grant execute on function pgmq.set_vt(text, bigint, integer) to public;
