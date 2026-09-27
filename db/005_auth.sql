-- DG Brasil — contas da equipe, sessões e convites.
--
-- DECISÃO: a verificação de senha é nossa, não do Supabase Auth.
--
-- A arquitetura previa Supabase Auth. Trocamos por três razões concretas:
--
--  1. As consultas do painel são SQL com junções e agregados. Usar o cliente do
--     Supabase (PostgREST) exigiria reescrevê-las como views ou RPC. Com sessão
--     própria, o painel continua falando SQL e a RLS continua valendo — via
--     `app.usuario_id`, abaixo.
--  2. `auth.uid()` amarrava o schema ao Supabase. Com a função trocada, o mesmo
--     banco roda em Supabase, em VPS ou no PGlite dos testes.
--  3. Dava para testar hoje, de ponta a ponta. Auth não testada é pior que auth
--     simples.
--
-- O QUE ISSO CUSTA, e você deve saber: não temos MFA, nem e-mail de
-- recuperação de senha, nem detecção de vazamento — coisas que o Supabase Auth
-- traz prontas. Para cinco pessoas num escritório, com convite por link e
-- bloqueio por tentativa, é um custo aceitável. Se um dia virarem vinte, ou se
-- alguém acessar de fora do escritório com frequência, vale migrar: o ponto de
-- troca é uma função só, `verificarCredencial` em apps/web/src/servidor/auth.ts.

-- As funções de identidade (`usuario_atual`, `papel_atual`) vivem em
-- 003_rls.sql e leem `app.usuario_id`. Nada aqui as redefine.

-- ── credenciais ───────────────────────────────────────────────────

alter table usuario add column if not exists senha_hash text;
alter table usuario add column if not exists senha_definida_em timestamptz;
alter table usuario add column if not exists ultimo_acesso timestamptz;

-- ── sessões ───────────────────────────────────────────────────────
--
-- Guardamos o SHA-256 do token, nunca o token. Quem ler o banco não consegue
-- se passar por ninguém.

create table if not exists sessao (
  id            uuid primary key default gen_random_uuid(),
  usuario_id    uuid not null references usuario(id) on delete cascade,
  token_hash    text not null unique,
  criado_em     timestamptz not null default now(),
  expira_em     timestamptz not null,
  ultimo_uso_em timestamptz not null default now(),
  ip            inet,
  agente_usuario text,
  encerrada_em  timestamptz
);
create index if not exists sessao_ativa on sessao (usuario_id)
  where encerrada_em is null;

-- ── convites ──────────────────────────────────────────────────────
--
-- Ninguém digita senha de outra pessoa. O admin cadastra a pessoa e entrega um
-- link de uso único; ela define a própria senha.

create table if not exists convite (
  id         uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references usuario(id) on delete cascade,
  token_hash text not null unique,
  criado_por uuid references usuario(id),
  criado_em  timestamptz not null default now(),
  expira_em  timestamptz not null,
  usado_em   timestamptz
);
create index if not exists convite_aberto on convite (usuario_id)
  where usado_em is null;

-- ── travar força bruta ────────────────────────────────────────────

create table if not exists tentativa_login (
  id      bigserial primary key,
  email   text not null,
  ip      inet,
  sucesso boolean not null,
  em      timestamptz not null default now()
);
create index if not exists tentativa_recente on tentativa_login (email, em desc);

-- Conta as falhas recentes de um e-mail. O painel bloqueia a partir de 5 em 15
-- minutos. Uma tentativa bem-sucedida zera a contagem (só contamos depois dela).
create or replace function falhas_recentes(p_email text, p_minutos integer default 15)
returns integer
language sql stable as $$
  select count(*)::integer from tentativa_login t
  where t.email = lower(p_email)
    and t.em > now() - make_interval(mins => p_minutos)
    and not t.sucesso
    and t.em > coalesce(
      (select max(s.em) from tentativa_login s
       where s.email = lower(p_email) and s.sucesso),
      '-infinity'::timestamptz)
$$;

-- ── RLS das tabelas novas ─────────────────────────────────────────
--
-- Sessão e convite nunca são lidos pelo painel sob a identidade do usuário
-- (a leitura acontece ANTES de existir identidade). Ficam sem política, o que
-- com RLS ligada significa: ninguém lê, exceto a conexão dona do banco.

alter table sessao enable row level security;
alter table convite enable row level security;
alter table tentativa_login enable row level security;

-- A equipe é visível para todos; mexer nela, só admin.
alter table usuario enable row level security;

drop policy if exists usuario_ler on usuario;
create policy usuario_ler on usuario for select
  using (papel_atual() is not null);

drop policy if exists usuario_admin on usuario;
create policy usuario_admin on usuario for all
  using (papel_atual() = 'admin')
  with check (papel_atual() = 'admin');

-- ── o papel que o painel usa ──────────────────────────────────────
--
-- Detalhe que quase passou: o dono das tabelas IGNORA row level security.
-- Como a string de conexão do Supabase é do papel `postgres`, dono de tudo,
-- as políticas de 003_rls.sql não teriam efeito nenhum — permissão decorativa.
--
-- Por isso existe `painel`: um papel comum, sem bypass. O painel abre a
-- transação, faz `set local role painel`, e só então consulta. A partir daí a
-- RLS vale de verdade, e estagiário realmente não enxerga caso alheio.
--
-- O worker de agentes continua conectando como dono, de propósito: ele não tem
-- identidade de usuário e precisa ler tudo. A contenção dele é a allowlist de
-- ferramentas, não o banco.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'painel') then
    create role painel nologin;
  end if;
end $$;

grant usage on schema public to painel;
grant select, insert, update, delete on all tables in schema public to painel;
grant usage, select on all sequences in schema public to painel;
grant execute on all functions in schema public to painel;

alter default privileges in schema public
  grant select, insert, update, delete on tables to painel;

-- Sessão, convite e tentativa de login são lidos ANTES de existir identidade —
-- o painel consulta essas três como dono, fora do escopo do usuário. O papel
-- `painel` não precisa delas, e não as recebe.
revoke all on sessao, convite, tentativa_login from painel;
