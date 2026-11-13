# DG Brasil: guia de navegação

Sistema interno da Barbara Cardoso Advocacia: painel Next.js + banco Supabase + executor MCP
no computador do escritório. Visão geral em [README.md](README.md) e [ARQUITETURA.md](ARQUITETURA.md).
Este arquivo só diz **onde as coisas ficam**; não repita aqui o que os docs já explicam.

## Como localizar código gastando pouco

1. O bloco "Repo map" do início da sessão (plugin armap) lista os arquivos mais usados. Comece por ele.
2. Antes de `Grep` amplo ou de ler arquivo inteiro, use o comando da linha `Query before reading files:` do mapa:
   - `deps <arquivo>`: o que o arquivo usa e quem o usa.
   - `refs <símbolo>`: onde é definido e todos os arquivos que o referenciam.
   - `map --budget 3500`: mapa maior, quando a área não apareceu.
3. Leia só a região em volta da linha `L<n>` indicada, não o arquivo todo.
4. Para função do banco, `refs <nome>` acha a definição e as migrations que a citam, mas não quem a
   chama do TypeScript (o nome vai em string, `db.rpc("...")`): para isso, `Grep` do nome em `apps/`.

## Mapa das pastas

| Caminho | O que tem |
|---|---|
| `apps/frontend/` | Painel (Next.js 16, Vercel). Tem regras próprias em `apps/frontend/AGENTS.md`: leia antes de escrever código Next |
| `apps/frontend/src/app/` | Rotas, arquivos finos, nomes em português (`clientes`, `casos`, `revisoes`...) |
| `apps/frontend/src/features/<x>/` | UI e hooks da feature, nomes em inglês |
| `apps/frontend/src/server/domain/<x>/` | Backend do domínio: `actions.ts` → `service.ts` → `repository.ts`, mais `schemas.ts`, `dto.ts`, `mappers.ts` e `<x>.test.ts` |
| `apps/frontend/src/server/core/` | Base de todo domínio: `action.ts` (`runAction`), `context.ts`, `errors.ts`, `db-errors.ts`, `validation.ts`, `pagination.ts` |
| `apps/frontend/src/server/auth/` | Sessão e autorização no servidor (`session.ts`), ações de login e de equipe |
| `apps/frontend/src/server/executor/` | Lado servidor da API `/api/executor/v1` (rota em `src/app/api/executor/v1/[...path]/route.ts`) |
| `apps/frontend/src/server/integrations/` | Google Drive, judicial (DJEN, DataJud), consulta de CPF/CNPJ/CEP |
| `apps/frontend/src/lib/` | Puro e compartilhado: `permissions/` (matriz RBAC, `can`), `constants/status.ts` (rótulos e status), `formatting/`, `auth/`, `supabase/` |
| `apps/frontend/src/components/ui/` | Primitives visuais (Button, Panel, Field...) |
| `apps/frontend/tests/integration/` | Testes de integração contra o Supabase de desenvolvimento (`*.int.test.ts`, `npm run test:integration`) |
| `apps/executor/src/` | Servidor MCP `dg-brasil` do computador do escritório: `index.ts` (entrada), `ferramentas.ts` (catálogo fechado), `ponte.ts`, `trabalhos.ts`, `doctor.ts` |
| `supabase/migrations/` | Schema, numerado `NNN` no fim do timestamp (`..._000040_office_executor.sql` = migration 040). Aplicada nunca é reescrita |
| `supabase/tests/` | `verificar.mjs` (PGlite local, enorme: nunca leia inteiro) e `real/validar-real.mjs` |
| `docs/` | Um doc por assunto: `backend.md`, `auth.md`, `judicial.md`, `importacao.md`, `ponte.md`, `mcp/`, `deploy/` |
| `docs/qa/` | Evidências de QA (relatórios e capturas). Só abra se a tarefa for sobre QA |

## Rota → feature → domínio

| Rota (`src/app/(app)/`) | `features/` | `server/domain/` |
|---|---|---|
| `clientes` | `clients` | `clients` |
| `casos` | `cases`, `analyses` | `cases`, `analyses` |
| `processos` | `processes`, `process-tasks` | `processes` (prazos em `processes/deadlines`), `process-tasks` |
| `revisoes` | `reviews` | `reviews` |
| `financeiro` | `finance` | `finance` |
| `parceiros` | `partners`, `metrics` | `organizations`, `metrics` |
| `publicacoes` | `judicial` | `judicial` + `server/integrations/judicial` |
| `pendencias`, `minha-conta`, `home` do parceiro | `partner-portal`, `partner-requests` | `partner-requests`, `account` |
| `dg-brasil` | `dg-brasil`, `agent-runs` | `dg`, `agents` |
| `configuracoes` | `settings`, `data-import`, `integrations` | `organizations`, `imports` |
| `notificacoes` | `notifications` | `notifications` |
| login, MFA, termos (fora de `(app)`) | `auth` | `server/auth/` |

## Receita: mexer num domínio

`schemas.ts` (entrada Zod) → `actions.ts` (permissão via `runAction`) → `service.ts` (regra) →
`repository.ts` (query/RPC) → migration nova se o banco mudar. Camadas e modelo de erro em
[docs/backend.md](docs/backend.md); contrato do banco em [supabase/README.md](supabase/README.md).

## Conferir antes de dar por pronto

| Onde | Comando |
|---|---|
| `apps/frontend` | `npm run check` (lint + typecheck + test + build) |
| `apps/executor` | `npm run typecheck && npm test` |
| `supabase` | `npm run verificar` (sempre que tocar em `supabase/`) |

## Não quebre

O agente propõe, o humano confirma, só a confirmação aplica. Os quatro lugares que seguram
essa regra estão em "O contrato que não se quebra" do [README.md](README.md).
