# DG Brasil

Sistema interno da **Barbara Cardoso Advocacia**: CRM próprio + agentes de IA
executados pelo Claude Code do escritório, com a equipe e os escritórios
parceiros acessando pelo navegador.

Uma organização proprietária (OWNER), escritórios parceiros (PARTNER), cinco
papéis (ADMIN, LAWYER, ASSISTANT, PARTNER_ADMIN, PARTNER_USER). Domínio central:
**Client → LegalCase → LegalProcess**. Não é SaaS multi-tenant.

- **[ARQUITETURA.md](ARQUITETURA.md)** — as três camadas, a stack escolhida e por quê
- **[ROADMAP.md](ROADMAP.md)** — as etapas até a operação completa
- **[supabase/README.md](supabase/README.md)** — o contrato do banco (RLS, gate humano, ledger, fila, auditoria)
- **[docs/adicionar-agente.md](docs/adicionar-agente.md)** — como pôr um agente do Claude Code para trabalhar no DG Brasil
- **[docs/mcp/](docs/mcp/)** — a arquitetura com Claude Code + MCP: diagnóstico, instalação no computador do escritório, Google Drive, validação

## A ideia em um parágrafo

Os agentes do escritório (Lucas, Clara, réplica…) continuam no **Claude Code do
computador do escritório**. O DG Brasil guarda clientes, casos, documentos e uma
**fila de trabalhos**; alguém no escritório abre o Claude Code e manda processar
a fila (`/mcp__dg-brasil__trabalhos`). O Claude Code fala com o DG Brasil por um
**servidor MCP local** (`apps/executor`) com um catálogo fechado de ferramentas:
cada trabalho lê só o caso dele e **não escreve nada direto** — análise, minuta e
proposta vão para Revisões, e um advogado aprova ou rejeita. Só a aprovação
produz efeito.

## Estrutura

| Caminho | Papel |
|---|---|
| `supabase/` | **Banco** (migrations 001–041): RLS, Storage, fila pgmq, manutenção no pg_cron e 673 verificações. Ver [supabase/README.md](supabase/README.md) |
| `apps/executor/` | O pacote do **computador do escritório**: servidor MCP local `dg-brasil` para o Claude Code (catálogo fechado de ferramentas) e o diagnóstico `doctor`. Ver [docs/mcp/instalacao.md](docs/mcp/instalacao.md) |
| `apps/frontend/` | **Front-end V1 (protótipo navegável, dados fictícios).** Escritório proprietário + portal do parceiro, RBAC, Revisões, DG Brasil. Ver [apps/frontend/README.md](apps/frontend/README.md) |
| `packages/dominio/` | Motor de classificação da esteira, vindo do `esteira-consignado` *(fase 3)* |

## Como subir

### 1. Banco

Antes de tocar no Supabase, confira o schema localmente:

```bash
cd supabase
npm install
npm run verificar
```

Isso aplica as migrations num Postgres de verdade (PGlite, em WASM) e roda os
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

### 3. Computador do escritório

Os agentes rodam no Claude Code de um computador do escritório (modo assistido:
uma pessoa abre o Claude Code e manda processar a fila). Instalação, token do
computador e registro do MCP: [docs/mcp/instalacao.md](docs/mcp/instalacao.md).

```bash
cd apps/executor
npm ci && npm run build
npm test                 # 13 testes: MCP de verdade contra um DG Brasil de mentira
node dist/index.js doctor
```

O servidor do DG Brasil fala com o banco como `dg_worker` (`DG_WORKER_DB_URL`,
pelo pooler) e expõe `/api/executor/v1` ao computador. O que o antigo worker
fazia sem IA (aplicar propostas aprovadas, fechar execuções decididas, devolver
à fila o trabalho de um computador que parou, lembretes de prazo) roda no
próprio banco, pelo `pg_cron` (migration 040).

### 4. Disparar um agente para testar

Pela tela: "Enviar análise" no caso, ou DG Brasil → Agentes → "Executar em um
caso". Por SQL, a execução só nasce por `request_agent_run` (ADMIN ou LAWYER; o
banco revalida o papel e o acesso ao caso, cria a execução e enfileira — a
mensagem leva só IDs):

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

1. `apps/executor/src/ferramentas.ts` e `supabase/migrations/…_office_executor.sql`
   — o Claude Code tem ferramentas de leitura do caso reservado e três de
   entrega, todas presas a revisão: `propor` (ação), `entregar_minuta` (minuta
   INTERNA) e `entregar_analise`. Não existe ferramenta de apagar, aprovar,
   enviar mensagem, SQL ou shell; e o banco confere a reserva em cada chamada.
2. `supabase/migrations/…_analyses_and_reviews.sql` — o status de uma revisão só
   muda por `decide_review` (grants + trigger); proposta estrutural (agente,
   skill) só ADMIN decide.
3. `supabase/migrations/…_agents.sql` — `agent_proposals` e o trigger que
   recusa aprovar proposta sem revisão humana aprovada.
4. `supabase/migrations/…_queues.sql` — `private.worker_apply_next_proposal`, o
   único lugar que transforma proposta aprovada em linha no banco (chamado pelo
   `pg_cron`, migration 040). O servidor fala com o banco como `dg_worker`, sem
   bypass de RLS e sem SELECT em dado de cliente: só enxerga, por funções
   escopadas, o contexto do trabalho que o computador reservou.

Se alguém der ao agente uma ferramenta que escreve direto, o sistema continua
funcionando e a garantia some sem aviso. É o tipo de mudança que merece
conversa, não commit.

## Estado atual

| Componente | Situação |
|---|---|
| Banco V1 (`supabase/`) | **Validado em Supabase real de desenvolvimento (Etapa 3.3, 2026-10-09).** Baseline 001–019 + 020–021; 261 verificações locais e 110 reais (Auth, JWT/PostgREST, Storage, pgmq, `dg_worker`) passando, inclusive depois de `db reset` — o banco se reconstrói só pelo repositório |
| Execução dos agentes (040, 2026-10-29) | Claude Code do escritório + MCP local (`apps/executor`), API `/api/executor/v1`, reserva por trabalho, linha do tempo, manutenção no `pg_cron`. Código e testes prontos; **validação no DEV pendente** ([docs/mcp/validacao.md](docs/mcp/validacao.md)). O worker na nuvem da Etapa 5 foi removido sem nunca ter rodado |
| Google Drive (041) | Pasta do cliente pelo ID, importação sem duplicata, exportação do aprovado, pelo servidor. **Falta a credencial do Google** ([docs/mcp/google-drive.md](docs/mcp/google-drive.md)) |
| Domínio consignado (HISCON, benefício, esteira), WhatsApp, leads | Fora do banco V1; entram como migrations `020+` quando especificados |
| Disparador dos gatilhos (`cron`, `evento`) | **Não existe.** Trabalho entra na fila por `request_agent_run` e é processado no modo assistido |
| Front-end (`apps/frontend`) | Identidade real; telas jurídicas ainda com dados fictícios (mocks recortados pelo papel real) até a Etapa 4.3 |
| Backend de domínio (Etapa 4.2) | Server Actions + services + repositories reais para clientes, casos, processos/prazos, documentos/Storage, solicitações, revisões, análises, execuções de agente, financeiro, organizações, notificações e auditoria. Ver [docs/backend.md](docs/backend.md) |
| Auth (Etapa 4.1) | Supabase Auth: convite, senha (8+), **MFA TOTP obrigatório** (RLS exige `aal2`, migration 022), termos versionados (texto **provisório**), recuperação, gestão de equipe, redefinição de MFA pelo ADMIN. Ver [docs/auth.md](docs/auth.md) |
| Importação | Genérica, CSV/XLSX; schema pronto, parser no backend não começado |
| `packages/dominio` | Não começado |

O schema legado em português (`db/`, com auth própria, fila artesanal e papéis
antigos) existiu antes do banco V1 e foi removido; está só no histórico do Git.
Não reintroduza nada dele.
