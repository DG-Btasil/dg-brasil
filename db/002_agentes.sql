-- DG Brasil — motor de agentes: catálogo, fila, propostas e auditoria.

-- ─────────────────────── catálogo de agentes ──────────────────────

create table agente (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,         -- lucas, esteira, triagem, radar, peca
  nome          text not null,
  descricao     text,
  modelo        text not null default 'claude-opus-5',
  prompt_sistema text not null,
  ferramentas   text[] not null default '{}', -- allowlist; vazio = nenhuma
  politica_aprovacao text not null default 'humana'
                check (politica_aprovacao in ('auto','humana','humana_se')),
  limite_auto   numeric(14,2),                -- só para humana_se
  gatilho       jsonb not null default '{}',  -- {"cron":"0 8 * * 1-5"} | {"evento":"..."} | {}
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- ───────────────────────────── a fila ─────────────────────────────

create type status_execucao as enum (
  'pendente','executando','aguardando_aprovacao','concluida','falhou','cancelada'
);

create table execucao (
  id             uuid primary key default gen_random_uuid(),
  agente_id      uuid not null references agente(id) on delete restrict,
  gatilho        text not null,               -- manual, cron, evento, webhook
  solicitado_por uuid references usuario(id),
  caso_id        uuid references caso(id) on delete set null,
  entrada        jsonb not null default '{}',
  status         status_execucao not null default 'pendente',
  prioridade     integer not null default 100, -- menor roda antes
  tentativas     integer not null default 0,
  max_tentativas integer not null default 3,
  reservado_por  text,                        -- id do worker que pegou
  reservado_ate  timestamptz,                 -- expira e volta pra fila se o worker morrer
  disponivel_em  timestamptz not null default now(),
  iniciado_em    timestamptz,
  terminado_em   timestamptz,
  tokens_entrada bigint,
  tokens_saida   bigint,
  custo_usd      numeric(10,4),
  erro           text,
  criado_em      timestamptz not null default now()
);
create index on execucao (status, prioridade, disponivel_em)
  where status = 'pendente';
create index on execucao (agente_id, criado_em desc);
create index on execucao (caso_id);

-- rastro completo: cada passo que o agente deu, para a equipe auditar a proposta
create table passo_execucao (
  id          uuid primary key default gen_random_uuid(),
  execucao_id uuid not null references execucao(id) on delete cascade,
  ordem       integer not null,
  tipo        text not null check (tipo in ('texto','ferramenta','raciocinio','erro')),
  ferramenta  text,
  entrada     jsonb,
  saida       jsonb,
  em          timestamptz not null default now(),
  unique (execucao_id, ordem)
);

-- ──────────────────────── propostas (o gate) ──────────────────────
-- O agente NUNCA aplica efeito irreversível. Ele grava uma proposta,
-- que um humano aprova no painel. A aprovação é que aplica.

create table proposta (
  id           uuid primary key default gen_random_uuid(),
  execucao_id  uuid not null references execucao(id) on delete cascade,
  tipo         text not null,                 -- criar_documento, abrir_prazo,
                                              -- enviar_mensagem, lancar_honorario,
                                              -- classificar_lead, atualizar_caso
  resumo       text not null,                 -- uma linha, para a fila do painel
  payload      jsonb not null,                -- o que será aplicado, já validado
  alvo_tabela  text,
  alvo_id      uuid,
  status       text not null default 'pendente'
               check (status in ('pendente','aprovada','rejeitada','aplicada','falhou')),
  revisado_por uuid references usuario(id),
  revisado_em  timestamptz,
  comentario   text,                          -- por que rejeitou — vira treino
  aplicado_em  timestamptz,
  erro_aplicacao text,
  criado_em    timestamptz not null default now()
);
create index on proposta (status, criado_em) where status = 'pendente';
create index on proposta (execucao_id);

-- documento.gerado_por_execucao só pôde apontar para `execucao` agora
alter table documento
  add constraint documento_execucao_fk
  foreign key (gerado_por_execucao) references execucao(id) on delete set null;

-- ─────────────────── auditoria / LGPD ─────────────────────────────

create table evento_auditoria (
  id          uuid primary key default gen_random_uuid(),
  usuario_id  uuid references usuario(id),
  execucao_id uuid references execucao(id),
  acao        text not null,                  -- insert, update, delete, aprovar, rejeitar
  tabela      text not null,
  registro_id uuid,
  antes       jsonb,
  depois      jsonb,
  ip          inet,
  em          timestamptz not null default now()
);
create index on evento_auditoria (tabela, registro_id, em desc);
create index on evento_auditoria (usuario_id, em desc);

-- quem abriu a ficha de qual cliente: exigível sob a LGPD, e os titulares aqui
-- são idosos em situação de vulnerabilidade
create table acesso_dado_pessoal (
  id         bigserial primary key,
  usuario_id uuid not null references usuario(id),
  contato_id uuid not null references contato(id) on delete cascade,
  finalidade text,
  em         timestamptz not null default now()
);
create index on acesso_dado_pessoal (contato_id, em desc);

-- ───────────────── reserva de execução pelo worker ────────────────
-- SKIP LOCKED: vários workers podem rodar em paralelo sem pegar a mesma linha.

create or replace function reservar_execucao(p_worker text, p_segundos integer default 900)
returns execucao
language plpgsql
as $$
declare
  e execucao;
begin
  select * into e
  from execucao
  where status = 'pendente'
    and disponivel_em <= now()
  order by prioridade, disponivel_em
  for update skip locked
  limit 1;

  if not found then
    return null;
  end if;

  update execucao
  set status        = 'executando',
      reservado_por = p_worker,
      reservado_ate = now() + make_interval(secs => p_segundos),
      tentativas    = tentativas + 1,
      iniciado_em   = coalesce(iniciado_em, now())
  where id = e.id
  returning * into e;

  return e;
end;
$$;

-- Worker morto deixa a linha travada em 'executando'. Esta função devolve à fila
-- o que passou da reserva, respeitando max_tentativas. Rodar a cada minuto
-- (pg_cron no Supabase, ou o próprio worker no laço ocioso).
create or replace function liberar_execucoes_expiradas()
returns integer
language plpgsql
as $$
declare
  n integer;
begin
  with expiradas as (
    update execucao
    set status = case
          when tentativas >= max_tentativas then 'falhou'::status_execucao
          else 'pendente'::status_execucao
        end,
        erro = case
          when tentativas >= max_tentativas
          then coalesce(erro, 'worker não respondeu dentro da reserva')
          else erro
        end,
        reservado_por = null,
        reservado_ate = null,
        disponivel_em = now() + make_interval(secs => 30 * tentativas)
    where status = 'executando'
      and reservado_ate < now()
    returning 1
  )
  select count(*) into n from expiradas;
  return n;
end;
$$;
