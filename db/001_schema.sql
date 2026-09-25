-- Núcleo — schema do CRM próprio
-- Postgres 15+ (Supabase). Executar uma vez, em ordem numérica.

create extension if not exists "pgcrypto";

-- ───────────────────────────── acesso ─────────────────────────────

create type papel as enum ('admin','advogado','estagiario','financeiro','atendimento');

create table usuario (
  id           uuid primary key default gen_random_uuid(),
  auth_id      uuid unique,                   -- id do Supabase Auth
  nome         text not null,
  email        text not null unique,
  papel        papel not null default 'atendimento',
  oab          text,
  ativo        boolean not null default true,
  criado_em    timestamptz not null default now()
);

-- ──────────────────────────── contatos ────────────────────────────

create table contato (
  id            uuid primary key default gen_random_uuid(),
  tipo          text not null default 'pf' check (tipo in ('pf','pj')),
  nome          text not null,
  cpf_cnpj      text unique,                  -- chave natural; normalizado só com dígitos
  nascimento    date,
  telefone      text,                         -- E.164
  email         text,
  endereco      jsonb,
  origem        text,                         -- indicação, anúncio, whatsapp...
  is_cliente    boolean,                      -- true=cliente, false=lead, null=não classificado
  observacao    text,
  advbox_id     bigint unique,                -- espelho durante a migração
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  criado_por    uuid references usuario(id)
);
create index on contato using gin (to_tsvector('portuguese', nome));
create index on contato (is_cliente);

-- benefício do INSS: o nicho do escritório gira em torno dele
create table beneficio (
  id               uuid primary key default gen_random_uuid(),
  contato_id       uuid not null references contato(id) on delete cascade,
  numero_beneficio text not null unique,
  especie          text,
  dib              date,
  valor_mensal     numeric(12,2),
  banco_pagador    text,
  atualizado_em    timestamptz not null default now()
);
create index on beneficio (contato_id);

-- ───────────────────────── casos e processos ──────────────────────

create type status_caso as enum (
  'triagem','analise','aguardando_documento','pronto_para_peticionar',
  'judicializado','encerrado','recusado'
);

create table caso (
  id             uuid primary key default gen_random_uuid(),
  contato_id     uuid not null references contato(id) on delete restrict,
  beneficio_id   uuid references beneficio(id),
  titulo         text not null,
  area           text not null default 'consignado',
  status         status_caso not null default 'triagem',
  responsavel_id uuid references usuario(id),
  valor_causa    numeric(14,2),
  aberto_em      timestamptz not null default now(),
  encerrado_em   timestamptz,
  atualizado_em  timestamptz not null default now()
);
create index on caso (status, responsavel_id);
create index on caso (contato_id);

create table processo (
  id              uuid primary key default gen_random_uuid(),
  caso_id         uuid not null references caso(id) on delete cascade,
  numero_cnj      text unique,
  tribunal        text,
  vara            text,
  comarca         text,
  classe          text,
  assunto         text,
  fase            text,
  valor_causa     numeric(14,2),
  distribuido_em  date,
  segredo_justica boolean not null default false,
  advbox_id       bigint unique,
  atualizado_em   timestamptz not null default now()
);
create index on processo (caso_id);

create table parte_processo (
  id          uuid primary key default gen_random_uuid(),
  processo_id uuid not null references processo(id) on delete cascade,
  contato_id  uuid references contato(id),
  nome        text not null,
  polo        text not null check (polo in ('ativo','passivo','terceiro')),
  tipo        text,
  advogado    text
);
create index on parte_processo (processo_id);

create table movimentacao (
  id          uuid primary key default gen_random_uuid(),
  processo_id uuid not null references processo(id) on delete cascade,
  data        date not null,
  descricao   text not null,
  origem      text not null default 'tribunal' check (origem in ('tribunal','manual')),
  hash        text unique,                    -- evita duplicar na recaptura
  criado_por  uuid references usuario(id),
  criado_em   timestamptz not null default now()
);
create index on movimentacao (processo_id, data desc);

create table publicacao (
  id                    uuid primary key default gen_random_uuid(),
  processo_id           uuid references processo(id) on delete set null,
  numero_cnj            text,
  diario                text,
  data_publicacao       date not null,
  data_disponibilizacao date,
  conteudo              text not null,
  oab_destinatario      text,
  lida                  boolean not null default false,
  tratada               boolean not null default false,
  hash                  text unique,
  capturada_em          timestamptz not null default now()
);
create index on publicacao (data_publicacao desc) where not tratada;

-- ─────────────────────── prazos e tarefas ─────────────────────────
-- prazo é a tabela mais crítica do sistema: é o que faz perder direito

create table prazo (
  id             uuid primary key default gen_random_uuid(),
  processo_id    uuid not null references processo(id) on delete cascade,
  publicacao_id  uuid references publicacao(id),
  tipo           text not null,               -- contestação, réplica, recurso...
  descricao      text,
  data_inicio    date not null,               -- termo inicial já contado
  dias           integer not null,
  dias_uteis     boolean not null default true,
  data_fatal     date not null,
  responsavel_id uuid references usuario(id),
  status         text not null default 'aberto' check (status in ('aberto','cumprido','perdido','cancelado')),
  fonte          text not null default 'manual' check (fonte in ('manual','agente','tribunal')),
  criado_em      timestamptz not null default now(),
  cumprido_em    timestamptz
);
create index on prazo (data_fatal) where status = 'aberto';
create index on prazo (responsavel_id, status);

create table tarefa (
  id             uuid primary key default gen_random_uuid(),
  caso_id        uuid references caso(id) on delete cascade,
  processo_id    uuid references processo(id) on delete cascade,
  titulo         text not null,
  descricao      text,
  responsavel_id uuid references usuario(id),
  prazo_em       timestamptz,
  prioridade     text not null default 'normal' check (prioridade in ('baixa','normal','alta','urgente')),
  status         text not null default 'aberta' check (status in ('aberta','fazendo','concluida','cancelada')),
  criado_por     uuid references usuario(id),
  criado_em      timestamptz not null default now(),
  concluido_em   timestamptz
);
create index on tarefa (responsavel_id, status, prazo_em);

-- ──────────────────────────── documentos ──────────────────────────

create table documento (
  id              uuid primary key default gen_random_uuid(),
  caso_id         uuid references caso(id) on delete cascade,
  contato_id      uuid references contato(id) on delete cascade,
  processo_id     uuid references processo(id) on delete cascade,
  tipo            text not null,              -- procuracao, declaracao_hipossuficiencia,
                                              -- contrato_honorarios, peticao_inicial,
                                              -- replica, hiscon, rg, comprovante, outro
  nome            text not null,
  caminho_storage text not null,              -- bucket/chave no Supabase Storage
  mime            text,
  tamanho         bigint,
  hash_sha256     text,
  versao          integer not null default 1,
  gerado_por_execucao uuid,                   -- FK adicionada em 003, depois de `execucao`
  assinado        boolean not null default false,
  assinado_em     timestamptz,
  criado_em       timestamptz not null default now(),
  criado_por      uuid references usuario(id)
);
create index on documento (caso_id, tipo);
create index on documento (contato_id, tipo);

-- ───────────────── esteira do consignado (nicho) ──────────────────

create table extrato_hiscon (
  id            uuid primary key default gen_random_uuid(),
  contato_id    uuid not null references contato(id) on delete cascade,
  beneficio_id  uuid references beneficio(id),
  documento_id  uuid references documento(id),
  linhas        integer,
  importado_em  timestamptz not null default now(),
  importado_por uuid references usuario(id)
);

create table contrato_consignado (
  id               uuid primary key default gen_random_uuid(),
  extrato_id       uuid not null references extrato_hiscon(id) on delete cascade,
  numero_contrato  text not null,
  banco_codigo     text,
  banco_nome       text,
  tipo             text check (tipo in ('emprestimo','rmc','rcc')),
  situacao         text,
  data_inclusao    date,
  data_exclusao    date,
  valor_parcela    numeric(12,2),
  qtd_parcelas     integer,
  valor_emprestado numeric(12,2),
  valor_liberado   numeric(12,2),
  taxa             numeric(8,4),
  origem_averbacao text,
  utilizado_mes    jsonb,                     -- {"2023-10": 123.45, ...} para o Bloco D
  bruto            jsonb                      -- linha original, para auditoria
);
create index on contrato_consignado (extrato_id);

-- saída do motor `packages/dominio/classificar.ts`
create table acao_esteira (
  id              uuid primary key default gen_random_uuid(),
  caso_id         uuid not null references caso(id) on delete cascade,
  extrato_id      uuid not null references extrato_hiscon(id) on delete cascade,
  bloco           text,                       -- A,B,C,Caixa,D,E,F ou null se descarte
  rotulo          text not null,
  banco_nome      text,
  ano             integer,
  contratos       uuid[] not null default '{}',
  motivo_descarte text,
  pendencia       text,
  motor_versao    text not null,
  gerado_em       timestamptz not null default now()
);
create index on acao_esteira (caso_id);

-- ──────────────────────────── financeiro ──────────────────────────

create table lancamento (
  id          uuid primary key default gen_random_uuid(),
  tipo        text not null check (tipo in ('receita','despesa')),
  categoria   text not null,
  contato_id  uuid references contato(id),
  caso_id     uuid references caso(id),
  processo_id uuid references processo(id),
  descricao   text not null,
  valor       numeric(14,2) not null,
  vencimento  date,
  pago_em     date,
  forma       text,
  advbox_id   bigint unique,
  criado_por  uuid references usuario(id),
  criado_em   timestamptz not null default now()
);
create index on lancamento (vencimento) where pago_em is null;

-- ───────────────────────────── whatsapp ───────────────────────────

create table conversa (
  id                 uuid primary key default gen_random_uuid(),
  contato_id         uuid references contato(id) on delete set null,
  numero_e164        text not null,
  instancia          text not null,           -- qual número do escritório
  status             text not null default 'aberta',
  responsavel_id     uuid references usuario(id),
  departamento       text,
  agente_ativo       boolean not null default false,
  ultima_mensagem_em timestamptz,
  unique (numero_e164, instancia)
);

create table mensagem (
  id          uuid primary key default gen_random_uuid(),
  conversa_id uuid not null references conversa(id) on delete cascade,
  direcao     text not null check (direcao in ('entrada','saida')),
  remetente   text,
  tipo        text not null default 'texto',
  conteudo    text,
  midia_url   text,
  id_externo  text unique,
  enviada_em  timestamptz not null default now()
);
create index on mensagem (conversa_id, enviada_em desc);

-- ────────────────────────────── funil ─────────────────────────────

create table funil (
  id   uuid primary key default gen_random_uuid(),
  nome text not null
);

create table etapa_funil (
  id       uuid primary key default gen_random_uuid(),
  funil_id uuid not null references funil(id) on delete cascade,
  nome     text not null,
  ordem    integer not null
);

create table contato_etapa (
  contato_id     uuid not null references contato(id) on delete cascade,
  etapa_funil_id uuid not null references etapa_funil(id) on delete cascade,
  entrou_em      timestamptz not null default now(),
  primary key (contato_id, etapa_funil_id)
);
