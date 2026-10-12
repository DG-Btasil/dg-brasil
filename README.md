# DG Brasil

Sistema interno da **Barbara Cardoso Advocacia**: CRM próprio + agentes de IA
rodando na nuvem, com a equipe e os escritórios parceiros acessando pelo navegador.

Uma organização proprietária (OWNER), escritórios parceiros (PARTNER), cinco
papéis (ADMIN, LAWYER, ASSISTANT, PARTNER_ADMIN, PARTNER_USER). Domínio central:
**Client → LegalCase → LegalProcess**. Não é SaaS multi-tenant.

- **[ARQUITETURA.md](ARQUITETURA.md)** — as três camadas, a stack escolhida e por quê
- **[ROADMAP.md](ROADMAP.md)** — as etapas até a operação completa
- **[supabase/README.md](supabase/README.md)** — o contrato do banco (RLS, gate humano, ledger, fila, auditoria)
- **[docs/adicionar-agente.md](docs/adicionar-agente.md)** — como cadastrar um agente novo

## A ideia em um parágrafo

Os agentes que hoje rodam no computador da Barbara (Lucas, esteira, réplica,
radar) passam a rodar num servidor, 24 horas por dia, disparados por horário ou
por evento. Eles leem o banco do escritório à vontade, mas **não escrevem nada**:
tudo que querem fazer vira uma *proposta* na fila do painel, que um advogado
aprova ou rejeita. Só a aprovação produz efeito.

## Estrutura

| Caminho | Papel |
|---|---|
| `supabase/` | **Banco V1** (especificação DG Brasil V1, consolidado na Etapa 3.2): 19 migrations, RLS, Storage, fila pgmq e 248 verificações. Ver [supabase/README.md](supabase/README.md) |
| `apps/agentes/` | O worker (papel `dg_worker`). Consome a fila e roda os agentes com o Claude Agent SDK |
| `apps/frontend/` | **Front-end V1 (protótipo navegável, dados fictícios).** Escritório proprietário + portal do parceiro, RBAC, Revisões, DG Brasil. Ver [apps/frontend/README.md](apps/frontend/README.md) |
| `packages/dominio/` | Motor de classificação da esteira, vindo do `esteira-consignado` *(fase 3)* |
| `agentes-claude/` | `.claude/` do escritório: agentes e skills versionados, carregados pelo worker |

## Como subir

### 1. Banco

Antes de tocar no Supabase, confira o schema localmente:

```bash
cd supabase
npm install
npm run verificar
```

Isso aplica as 19 migrations num Postgres de verdade (PGlite, em WASM) e roda os
critérios de aceitação da especificação, com a RLS testada por papel. Rode isso
sempre que mexer em `supabase/`.

> Até o primeiro `db push` real, as migrations 001–019 podem ser corrigidas no
> lugar. Depois dele, migration aplicada nunca mais é reescrita: mudança é `020+`.

Depois, crie um projeto no [Supabase](https://supabase.com) na região **São Paulo
(sa-east-1)** e aplique com `supabase db push`. Passo a passo e bootstrap da
primeira administradora em [supabase/README.md](supabase/README.md).

### 2. Front-end

```bash
cd apps/frontend
npm install
npm run dev     # http://localhost:3000
```

Login real (Supabase Auth de **desenvolvimento**, `apps/frontend/.env.local` a partir de
`.env.example`) com MFA obrigatório; módulos jurídicos ainda com dados fictícios.
Detalhes em [apps/frontend/README.md](apps/frontend/README.md) e
[docs/auth.md](docs/auth.md) (primeiro ADMIN, configuração do Auth).

### 3. Worker

```bash
cp .env.example .env     # DATABASE_URL (papel dg_worker), SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY
cd apps/agentes
npm install
npm test                 # 29 testes contra o banco V1 (PGlite), como dg_worker, sem chamar a API
npm start
```

O worker fica em laço: lê a fila `agent_execution` (pgmq), reserva a execução
(só um worker ganha), roda o agente com batimento (a mensagem não reaparece
enquanto ele trabalha), manda propostas e minutas para Revisões e aplica o que
um advogado aprovou. Se o worker morrer, o batimento para e outro assume.

### 4. Disparar um agente para testar

Execução só nasce por `request_agent_run` (ADMIN ou LAWYER; o banco revalida o
papel e o acesso ao caso, cria a execução e enfileira — a mensagem leva só IDs):

```sql
-- no SQL Editor, como o backend faria em nome de um usuário
select public.request_agent_run(
  (select id from agents where slug = '<slug do agente>'),
  '<id do caso>', null, 'Pedido em texto para o agente', '{}', 'EXECUTE',
  '<uuid do usuário ADMIN ou LAWYER>'
);
```

Acompanhe em `agent_runs` (ADMIN: status, tokens, custo) ou pela RPC
`get_agent_run_summaries` (LAWYER), `agent_proposals` e `reviews`.
Detalhes em [docs/adicionar-agente.md](docs/adicionar-agente.md).

## O contrato que não se quebra

Uma regra estrutura o sistema inteiro:

> **O agente propõe. O humano confirma. Só a confirmação aplica.**

Ela está em quatro lugares e precisa continuar nos quatro:

1. `apps/agentes/src/ferramentas.ts` — o agente tem muitas ferramentas de
   leitura e duas de escrita, ambas presas a revisão: `propor` (ação) e
   `entregar_documento` (minuta INTERNA).
2. `supabase/migrations/…_analyses_and_reviews.sql` — o status de uma revisão só
   muda por `decide_review` (grants + trigger); proposta estrutural (agente,
   skill) só ADMIN decide.
3. `supabase/migrations/…_agents.sql` — `agent_proposals` e o trigger que
   recusa aprovar proposta sem revisão humana aprovada.
4. `supabase/migrations/…_queues.sql` — `private.worker_apply_next_proposal`, o
   único lugar que transforma proposta aprovada em linha no banco
   (`apps/agentes/src/aplicar.ts` só o chama). O worker roda como `dg_worker`,
   sem bypass de RLS e sem SELECT em dado de cliente: só enxerga, por funções
   escopadas, o contexto da execução que reservou.

Se alguém der ao agente uma ferramenta que escreve direto, o sistema continua
funcionando e a garantia some sem aviso. É o tipo de mudança que merece
conversa, não commit.

## Estado atual

| Componente | Situação |
|---|---|
| Banco V1 (`supabase/`) | **Validado em Supabase real de desenvolvimento (Etapa 3.3, 2026-10-09).** Baseline 001–019 + 020–021; 261 verificações locais e 110 reais (Auth, JWT/PostgREST, Storage, pgmq, `dg_worker`) passando, inclusive depois de `db reset` — o banco se reconstrói só pelo repositório |
| Worker (fila pgmq, ferramentas, aplicador) | 31 testes como `dg_worker` (PGlite) e claim/heartbeat/escopo validados no pgmq real. **Claude ainda não conectado** (Claude simulado nos testes) |
| Domínio consignado (HISCON, benefício, esteira), WhatsApp, leads | Fora do banco V1; entram como migrations `020+` quando especificados |
| Disparador dos gatilhos (`cron`, `evento`) | **Não existe.** Execução entra na fila por `request_agent_run` |
| Front-end (`apps/frontend`) | Identidade real; módulos jurídicos ainda com dados fictícios (mocks recortados pelo papel real) até a Etapa 4.3 |
| Auth (Etapa 4.1) | Supabase Auth: convite, senha (8+), **MFA TOTP obrigatório** (RLS exige `aal2`, migration 022), termos versionados (texto **provisório**), recuperação, gestão de equipe, redefinição de MFA pelo ADMIN. Ver [docs/auth.md](docs/auth.md) |
| Importação | Genérica, CSV/XLSX; schema pronto, parser no backend não começado |
| `packages/dominio` | Não começado |

O schema legado em português (`db/`, com auth própria, fila artesanal e papéis
antigos) existiu antes do banco V1 e foi removido; está só no histórico do Git.
Não reintroduza nada dele.
