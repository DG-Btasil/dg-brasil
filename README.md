# DG Brasil

Sistema interno da **Barbara Cardoso Advocacia**: CRM próprio + agentes de IA
rodando na nuvem, com a equipe acessando pelo navegador.

Substitui a ADVBOX ao final da migração. Um escritório, uma base, uso interno.

- **[ARQUITETURA.md](ARQUITETURA.md)** — as três camadas, a stack escolhida e por quê
- **[ROADMAP.md](ROADMAP.md)** — as seis fases até o desligamento da ADVBOX
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
| `supabase/` | **Banco V1** (especificação DG Brasil V1): 19 migrations, RLS, Storage, fila pgmq e 133 verificações. Ver [supabase/README.md](supabase/README.md) |
| `apps/agentes/` | O worker. Consome a fila e roda os agentes com o Claude Agent SDK |
| `apps/frontend/` | **Front-end SaaS (protótipo navegável, dados fictícios).** Multi-escritório, RBAC, Revisões, DG Brasil. Ver [apps/frontend/README.md](apps/frontend/README.md) |
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

Depois, crie um projeto no [Supabase](https://supabase.com) na região **São Paulo
(sa-east-1)** e aplique com `supabase db push`. Passo a passo e bootstrap da
primeira administradora em [supabase/README.md](supabase/README.md).

### 2. Front-end

```bash
cd apps/frontend
npm install
npm run dev     # http://localhost:3000
```

Protótipo navegável com dados fictícios. Detalhes em
[apps/frontend/README.md](apps/frontend/README.md).

### 3. Worker

```bash
cp .env.example .env     # DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY
cd apps/agentes
npm install
npm test                 # 25 testes contra o banco V1 (PGlite), sem chamar a API
npm start
```

O worker fica em laço: lê a fila `agent_execution` (pgmq), roda o agente,
manda propostas e minutas para Revisões e aplica o que um advogado aprovou.
Vários podem rodar em paralelo: mensagem lida fica invisível para os outros e,
se o worker morrer, reaparece sozinha.

### 4. Disparar um agente para testar

```sql
-- execução registrada no domínio, depois enfileirada (a mensagem leva só IDs)
with r as (
  insert into agent_runs (agent_id, agent_version_id, legal_case_id, metadata)
  select a.id, a.current_version_id, '<id do caso>', '{"input":{"pedido":"teste"}}'
  from agents a where a.slug = '<slug do agente>'
  returning id
)
select private.enqueue_agent_run(id) from r;
```

Acompanhe em `agent_runs` (status, tokens, custo), `agent_proposals` e `reviews`.
Detalhes em [docs/adicionar-agente.md](docs/adicionar-agente.md).

## O contrato que não se quebra

Uma regra estrutura o sistema inteiro:

> **O agente propõe. O humano confirma. Só a confirmação aplica.**

Ela está em três lugares e precisa continuar nos três:

1. `apps/agentes/src/ferramentas.ts` — o agente tem muitas ferramentas de
   leitura e duas de escrita, ambas presas a revisão: `propor` (ação) e
   `entregar_documento` (minuta INTERNA).
2. `supabase/migrations/…_agents.sql` — `agent_proposals` e o trigger que
   recusa aprovar proposta sem revisão humana aprovada.
3. `apps/agentes/src/aplicar.ts` — o único lugar que transforma proposta
   aprovada em linha no banco.

Se alguém der ao agente uma ferramenta que escreve direto, o sistema continua
funcionando e a garantia some sem aviso. É o tipo de mudança que merece
conversa, não commit.

## Estado atual

| Componente | Situação |
|---|---|
| Banco V1 (`supabase/`) | 19 migrations aplicadas em Postgres 17 (PGlite) — 133 verificações passando. Falta rodar no Supabase |
| Worker (fila pgmq, ferramentas, aplicador) | Migrado para o banco V1. 25 testes passando contra as migrations reais (PGlite), com o Claude simulado. **Não executado contra a API nem contra um Supabase real** |
| WhatsApp, leads, esteira, honorários por agente | Fora do banco V1 (seção 101 da especificação); voltam quando entrarem no schema |
| Disparador dos gatilhos (`cron`, `evento`) | **Não existe.** Execução só entra na fila por insert manual — fase 2 |
| Front-end (`apps/frontend`) | Protótipo navegável com dados fictícios. Ainda não conectado ao banco |
| Login (Supabase Auth) | **Não existe** |
| Importação da ADVBOX, `packages/dominio` | Não começados |
