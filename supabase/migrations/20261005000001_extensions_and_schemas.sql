-- DG Brasil — 001: extensões, schemas e utilitários genéricos
--
-- gen_random_uuid() é nativo desde o Postgres 13: não precisa de pgcrypto.
-- pgmq (Supabase Queues) é habilitado em 018_queues.

-- ───────────────────────────── schema private ─────────────────────────────
-- Helpers de autorização e funções SECURITY DEFINER. Não é exposto pela Data
-- API (só `public` é). Os papéis recebem EXECUTE função a função.

create schema if not exists private;
comment on schema private is
  'Helpers de autorização e funções internas. Nunca exposto pela Data API.';

revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- Funções nascem com EXECUTE para PUBLIC. Aqui não: cada função recebe o grant
-- explícito de que precisa.
alter default privileges in schema private revoke execute on functions from public;

-- ───────────────────────────── updated_at ─────────────────────────────────

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

-- ───────────────────────────── append-only ────────────────────────────────
-- Tabelas de histórico (auditoria, decisões, versões) não aceitam UPDATE.
-- DELETE físico só em operação administrativa explícita, fora dos papéis da
-- aplicação: `set local dg.allow_physical_delete = 'on'` numa sessão de dono.

create or replace function private.prevent_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception '% é append-only: UPDATE não é permitido', tg_table_name
      using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then
    if current_user in ('anon', 'authenticated', 'service_role')
       or coalesce(current_setting('dg.allow_physical_delete', true), '') <> 'on' then
      raise exception '% é append-only: DELETE não é permitido', tg_table_name
        using errcode = '42501';
    end if;
    return old;
  end if;

  return new;
end
$$;

-- ───────────────────────────── versões sequenciais ────────────────────────
-- Atribui version_number = max + 1 dentro do pai (coluna em TG_ARGV[0]).
-- Se a aplicação informar o número, ele precisa ser exatamente o próximo.
-- O advisory lock serializa inserções concorrentes no mesmo pai.

create or replace function private.assign_version_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent_col text := tg_argv[0];
  v_parent     uuid;
  v_next       integer;
begin
  v_parent := (to_jsonb(new) ->> v_parent_col)::uuid;
  perform pg_advisory_xact_lock(hashtextextended(tg_table_name || ':' || v_parent::text, 0));

  execute format(
    'select coalesce(max(version_number), 0) + 1 from %I.%I where %I = $1',
    tg_table_schema, tg_table_name, v_parent_col
  ) into v_next using v_parent;

  if new.version_number is null then
    new.version_number := v_next;
  elsif new.version_number <> v_next then
    raise exception 'versão % fora de sequência em %: a próxima é %',
      new.version_number, tg_table_name, v_next
      using errcode = '23514';
  end if;

  return new;
end
$$;
