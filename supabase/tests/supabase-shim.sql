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
-- Mesma forma do pgmq real: cada fila tem pgmq.q_<nome> (mensagens) e
-- pgmq.a_<nome> (arquivo); read/set_vt/archive são SECURITY INVOKER e operam
-- nessas tabelas por SQL dinâmico. Assim os grants da 018 são testados como
-- seriam no Supabase. (Simplificação: sem headers, sem partição.)

create schema pgmq;

create table pgmq.meta (
  queue_name text primary key,
  created_at timestamptz not null default now()
);

create function pgmq.create(queue_name text) returns void
language plpgsql as $$
begin
  execute format('create table if not exists pgmq.%I (
    msg_id bigint generated always as identity primary key,
    read_ct integer not null default 0,
    enqueued_at timestamptz not null default now(),
    vt timestamptz not null default now(),
    message jsonb)', 'q_' || queue_name);
  execute format('create table if not exists pgmq.%I (
    msg_id bigint primary key,
    read_ct integer not null default 0,
    enqueued_at timestamptz not null default now(),
    archived_at timestamptz not null default now(),
    vt timestamptz not null,
    message jsonb)', 'a_' || queue_name);
  insert into pgmq.meta values (queue_name) on conflict do nothing;
end
$$;

create function pgmq.list_queues() returns table (queue_name text, created_at timestamptz)
language sql as $$ select queue_name, created_at from pgmq.meta $$;

create function pgmq.send(queue_name text, msg jsonb, delay integer default 0) returns setof bigint
language plpgsql as $$
begin
  return query execute format(
    'insert into pgmq.%I (vt, message) values (now() + make_interval(secs => $1), $2) returning msg_id',
    'q_' || queue_name) using delay, msg;
end
$$;

create type pgmq.message_record as (
  msg_id bigint, read_ct integer, enqueued_at timestamptz, vt timestamptz, message jsonb
);

create function pgmq.read(queue_name text, vt integer, qty integer)
returns setof pgmq.message_record
language plpgsql as $$
begin
  return query execute format(
    'with c as (select q.msg_id from pgmq.%1$I q where q.vt <= now() order by q.msg_id limit $2 for update skip locked)
     update pgmq.%1$I m set read_ct = m.read_ct + 1, vt = now() + make_interval(secs => $1)
     from c where m.msg_id = c.msg_id
     returning m.msg_id, m.read_ct, m.enqueued_at, m.vt, m.message', 'q_' || queue_name) using vt, qty;
end
$$;

create function pgmq.set_vt(queue_name text, msg_id bigint, vt integer)
returns setof pgmq.message_record
language plpgsql as $$
begin
  return query execute format(
    'update pgmq.%I m set vt = now() + make_interval(secs => $1) where m.msg_id = $2
     returning m.msg_id, m.read_ct, m.enqueued_at, m.vt, m.message', 'q_' || queue_name) using vt, msg_id;
end
$$;

create function pgmq.archive(queue_name text, msg_id bigint) returns boolean
language plpgsql as $$
declare
  n integer;
begin
  execute format(
    'with d as (delete from pgmq.%1$I where msg_id = $1 returning msg_id, read_ct, enqueued_at, vt, message)
     insert into pgmq.%2$I (msg_id, read_ct, enqueued_at, vt, message) select * from d',
    'q_' || queue_name, 'a_' || queue_name) using msg_id;
  get diagnostics n = row_count;
  return n > 0;
end
$$;

-- pgmq 1.5 também tem archive(text, bigint[]): chamada sem tipo
-- (pgmq.archive('fila', $1)) é ambígua no Supabase real. A sobrecarga aqui faz
-- o teste local pegar isso também.
create function pgmq.archive(queue_name text, msg_ids bigint[]) returns setof bigint
language plpgsql as $$
declare
  m bigint;
begin
  foreach m in array msg_ids loop
    if pgmq.archive(queue_name, m) then
      return next m;
    end if;
  end loop;
end
$$;

-- Como numa instalação nova de extensão: aberto por padrão, a 018 fecha.
grant usage on schema pgmq to public;
grant all on all tables in schema pgmq to public;
alter default privileges in schema pgmq grant all on tables to public;
