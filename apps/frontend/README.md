# DG Brasil — Painel (front-end e servidor)

O painel do DG Brasil: o que a equipe da **Barbara Cardoso Advocacia** e os
escritórios parceiros usam pelo navegador. Um único app Next.js, publicado na
Vercel, que atende dois endereços: `app.dgbrasil.adv.br` (equipe) e
`portal.dgbrasil.adv.br` (parceiros).

> **O agente propõe. O humano confirma. Só a confirmação aplica.**

Não é só tela. Dentro deste app também rodam:

- o **backend de domínio** (Server Actions → services → repositories), com o
  JWT do usuário e a RLS do banco como segunda barreira
  ([docs/backend.md](../../docs/backend.md));
- a **API do computador do escritório** (`/api/executor/v1`), por onde o Claude
  Code do escritório lê o trabalho reservado e entrega para Revisões;
- as **rotas agendadas** (`/api/cron/*`: Google Drive e busca judicial);
- a rota de situação **`/api/health`**, para um monitor externo.

**Os dados são reais.** Identidade (Supabase Auth: convite, senha, MFA
obrigatório, termos, papel lido do banco a cada requisição) e todos os módulos
jurídicos leem e gravam no banco do projeto Supabase configurado. No
desenvolvimento e no site de teste, esse projeto é o de **desenvolvimento**, só
com dados fictícios. O estado de cada domínio está em
[docs/frontend-integration.md](../../docs/frontend-integration.md). O que ainda
é demonstração (parte das integrações em Configurações) traz o próprio aviso na
tela.

## Como rodar

Requer Node.js 24 (`engines: "24.x"` no `package.json`, o mesmo que a Vercel usa
no build).

```bash
cd apps/frontend
cp .env.example .env.local   # Supabase de DESENVOLVIMENTO; o arquivo explica cada variável
npm install
npm run dev                  # http://localhost:3000
```

Sem `.env.local` as páginas autenticadas não sobem. A primeira administradora e
a configuração do Supabase Auth estão em [docs/auth.md](../../docs/auth.md).

**Antes de escrever código Next, leia [AGENTS.md](AGENTS.md):** esta versão do
Next.js tem convenções diferentes das anteriores (por exemplo, `proxy.ts` no
lugar de `middleware.ts`).

| Script | O que faz |
|---|---|
| `npm run dev` | Servidor de desenvolvimento (Turbopack) |
| `npm run lint` | ESLint (flat config do Next 16) |
| `npm run typecheck` | Gera os tipos de rota (`next typegen`) e roda `tsc --noEmit` |
| `npm test` | Testes unitários (vitest), sem rede e sem Supabase |
| `npm run test:integration` | Testes de integração contra o Supabase de **desenvolvimento**. Recusam rodar sem `DG_ENV=development` e fora do projeto declarado em `DG_DEV_PROJECT_REF` (`supabase/.env.real`) |
| `npm run build` | Build de produção |
| `npm run check` | lint + typecheck + test + build. **Rode antes de dar por pronto** |

No Windows, entre na pasta com a letra da unidade em maiúscula
(`cd C:\…\apps\frontend`): com `c:\` em minúscula os testes do Vitest falham ao
carregar a configuração.

## Stack

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript estrito · Tailwind
CSS v4 · Supabase (`@supabase/ssr`, `@supabase/supabase-js`) e `pg` (conexão do
servidor como `dg_worker`) · React Hook Form + Zod · Radix UI (Dialog, Tooltip)
com identidade visual própria · Recharts · Lucide · Zustand (estado de
interface).

## Papéis

Login, papel e escritório vêm do banco. Quem decide o que cada pessoa vê e faz
é o papel, validado no servidor a cada requisição e, de novo, pela RLS. O
endereço (`app.` ou `portal.`) só ajusta textos e atalhos.

| Papel | Onde | Acessa |
|---|---|---|
| ADMIN | `app.` | Tudo: clientes, casos, processos, revisões, financeiro, parceiros, DG Brasil, configurações, auditoria |
| LAWYER | `app.` | Clientes, casos (aceita e rejeita), processos e prazos, revisões |
| ASSISTANT | `app.` | Clientes, casos e processos, sem decidir |
| PARTNER_ADMIN | `portal.` | Os clientes e casos do próprio escritório, pendências e a própria parceria financeira |
| PARTNER_USER | `portal.` | O mesmo, sem os valores da parceria |

A matriz completa está em `src/lib/permissions/` (com teste).

## Estrutura

```
src/
  app/                  rotas (App Router), arquivos finos, nomes em português
    (app)/              área autenticada: o layout confere sessão, MFA e termos
    api/                executor/v1 (computador do escritório), cron/*, health
    not-found.tsx, error.tsx, global-error.tsx   página de endereço inexistente e de erro
  features/<x>/         telas e hooks de cada assunto (nomes em inglês)
  server/
    core/               base de todo domínio: runAction, contexto, erros, logger,
                        limite de taxa, conferência do ambiente, aviso de erros
    domain/<x>/         actions → service → repository, com schemas, dto e testes
    auth/               sessão e autorização no servidor
    executor/           lado servidor da API do computador do escritório
    integrations/       Google Drive, DJEN e DataJud, consulta de CPF/CNPJ/CEP
  lib/                  puro e compartilhado: permissões, rótulos, formatação, Supabase
  components/ui/        primitives visuais (Button, Panel, Field, Dialog…)
  instrumentation.ts    subida do servidor: aviso de erros e conferência das variáveis
  proxy.ts              primeira barreira: sessão renovada e redirecionamento ao login
tests/integration/      testes contra o Supabase de desenvolvimento (*.int.test.ts)
public/executor/        instalador e conector do computador do escritório
docs/                   CONVENTIONS.md, FRONTEND_ARCHITECTURE.md, BACKEND_HANDOFF.md
```

O mapa rota → feature → domínio está no [CLAUDE.md](../../CLAUDE.md) da raiz.

## O que sobrou da fase de protótipo

- `src/mocks/`, `src/repositories/` e parte de `src/store/` vêm do protótipo.
  Alguns tipos e utilitários deles ainda são usados. As telas de clientes,
  casos, processos, documentos, revisões, financeiro e parceiros não leem dado
  fictício deles. As áreas que ainda são demonstração mostram o aviso
  `components/feedback/demo-area-notice.tsx`.
- **Ferramentas de demonstração** (menu da administradora, "Restaurar áreas de
  demonstração"): só aparecem com `NEXT_PUBLIC_DEMO_MODE=true`. Em produção essa
  variável deve estar ausente; o servidor registra erro na subida se estiver
  ligada.
- `docs/FRONTEND_ARCHITECTURE.md` e `docs/BACKEND_HANDOFF.md` descrevem o
  protótipo. Para o que vale hoje, use [docs/backend.md](../../docs/backend.md),
  [docs/auth.md](../../docs/auth.md) e
  [docs/frontend-integration.md](../../docs/frontend-integration.md).

## Operação

- **Variáveis de ambiente:** `.env.example` lista todas. Em produção, a tabela
  do que é obrigatório, opcional ou proibido está em
  [docs/deploy/producao.md](../../docs/deploy/producao.md), item 8. Na subida, o
  servidor confere e registra no log o que falta.
- **Erros:** todo erro do servidor sai como uma linha JSON no log, sem dado
  pessoal. Com `ERROR_WEBHOOK_URL`, vai também para um webhook
  ([docs/deploy/producao.md](../../docs/deploy/producao.md), item 16).
- **Publicação:** [docs/deploy/](../../docs/deploy/).
