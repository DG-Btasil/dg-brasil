# Núcleo

Sistema interno da **Barbara Cardoso Advocacia**: CRM próprio + agentes de IA
rodando na nuvem, com a equipe acessando pelo navegador.

Substitui a ADVBOX ao final da migração. Um escritório, uma base, uso interno.

- **[ARQUITETURA.md](ARQUITETURA.md)** — as três camadas, a stack escolhida e por quê
- **[ROADMAP.md](ROADMAP.md)** — as seis fases até o desligamento da ADVBOX

## A ideia em um parágrafo

Os agentes que hoje rodam no computador da Barbara (Lucas, esteira, réplica,
radar) passam a rodar num servidor, 24 horas por dia, disparados por horário ou
por evento. Eles leem o banco do escritório à vontade, mas **não escrevem nada**:
tudo que querem fazer vira uma *proposta* na fila do painel, que um advogado
aprova ou rejeita. Só a aprovação produz efeito.

## Estrutura

| Caminho | Papel |
|---|---|
| `db/001_schema.sql` | CRM: contatos, benefícios, casos, processos, prazos, documentos, esteira, financeiro, WhatsApp |
| `db/002_agentes.sql` | Motor: catálogo de agentes, fila de execuções, propostas, auditoria |
| `db/003_rls.sql` | Permissões por papel (admin, advogado, estagiário, financeiro, atendimento) |
| `db/004_seed_agentes.sql` | Os cinco agentes iniciais |
| `db/verificar.mjs` | Roda os quatro arquivos num Postgres em WASM e testa o motor. Sem Docker |
| `apps/agentes/` | O worker. Consome a fila e roda os agentes com o Claude Agent SDK |
| `apps/web/` | Painel Next.js *(fase 1)* |
| `packages/dominio/` | Motor de classificação da esteira, vindo do `esteira-consignado` *(fase 3)* |
| `agentes-claude/` | `.claude/` do escritório: agentes e skills versionados, carregados pelo worker |

## Como subir

### 1. Banco

Antes de tocar no Supabase, confira o schema localmente:

```bash
cd db
npm install
npm run verificar
```

Isso executa os quatro arquivos num Postgres de verdade (PGlite, em WASM) e roda
19 asserções sobre o motor de agentes. Rode isso sempre que mexer em `db/`.

Depois, crie um projeto no [Supabase](https://supabase.com) na região **São Paulo
(sa-east-1)** e cole os quatro arquivos, em ordem, no SQL Editor.

### 2. Worker

```bash
cp .env.example .env     # preencha DATABASE_URL e ANTHROPIC_API_KEY
cd apps/agentes
npm install
npm start
```

O worker fica em laço: pega execução pendente, roda o agente, grava as
propostas, aplica as que foram aprovadas no painel. Vários podem rodar em
paralelo — a fila usa `FOR UPDATE SKIP LOCKED`.

### 3. Disparar um agente para testar

```sql
insert into execucao (agente_id, gatilho, entrada)
select id, 'manual', '{"observacao":"teste de fumaça"}'::jsonb
from agente where slug = 'lucas';
```

Acompanhe em `passo_execucao` (o rastro) e `proposta` (o resultado).

## O contrato que não se quebra

Uma regra estrutura o sistema inteiro:

> **O agente propõe. O humano confirma. Só a confirmação aplica.**

Ela está em três lugares e precisa continuar nos três:

1. `apps/agentes/src/ferramentas.ts` — o agente tem muitas ferramentas de
   leitura e **uma** de escrita, `propor`.
2. `db/002_agentes.sql` — a tabela `proposta` e sua máquina de estados.
3. `apps/agentes/src/aplicar.ts` — o único lugar que transforma proposta
   aprovada em linha no banco.

Se alguém der ao agente uma ferramenta que escreve direto, o sistema continua
funcionando e a garantia some sem aviso. É o tipo de mudança que merece
conversa, não commit.

## Estado atual

| Componente | Situação |
|---|---|
| Schema, RLS, seed | Executados em Postgres (PGlite) — 19 asserções passando. Falta rodar no Supabase |
| Worker (fila, executor, ferramentas, aplicador) | Escrito, `tsc --noEmit` passa limpo. **Não executado** (sem `DATABASE_URL`) |
| Aplicador `enviar_mensagem` | Lança erro de propósito — ponte de WhatsApp é fase 4 |
| Painel, importação da ADVBOX, `packages/dominio` | Não começados (fases 1 e 3) |
