# Backend de domínio (Etapa 4.2)

Backend real do DG Brasil dentro do próprio Next.js — sem segundo servidor.
A interface (Etapa 4.3) passa a consumir estas operações no lugar dos mocks.

```
Navegador
  → Server Action  (src/server/domain/<domínio>/actions.ts)   "use server"
      → runAction: correlation ID, sessão aal2 + termos + permissão, Zod
  → Service        (service.ts)     regra de negócio, autorização contextual
  → Repository     (repository.ts)  queries/RPCs, colunas explícitas
  → Supabase/Postgres               RLS + funções do banco (segunda barreira)

Operação longa (agentes): Service → request_agent_run → pgmq → worker
```

## Camadas

| Camada | Arquivo | Faz | Não faz |
|---|---|---|---|
| Server Action | `actions.ts` | Recebe `unknown`, chama `runAction` com schema e permissão | SQL, regra de negócio |
| Service | `service.ts` | Permissão por contexto (interno × parceiro), invariantes de aplicação, coordenação | Montar SQL, confiar em id/papel do navegador |
| Repository | `repository.ts` | Queries, RPCs, `unwrap`/`fromDbError` | Regras de negócio |
| Mappers | `mappers.ts` | Banco (snake_case) ↔ domínio (camelCase); payloads de gravação | I/O |
| DTOs | `dto.ts` | Um DTO por superfície (ex.: `ClientInternalDTO` × `ClientPartnerDTO`) | DTO "gigante" compartilhado |
| Schemas | `schemas.ts` | Zod de toda entrada externa | — |

Services e repositories não importam Next.js: recebem um `ServiceContext`
(`src/server/core/context.ts`) com `db` (Supabase com o JWT do **usuário**),
`session` (identidade validada no servidor), `requestId` e `log`. Por isso os
mesmos services rodam na Server Action e no teste de integração.

**Server Actions × Route Handlers.** Operações internas da aplicação são Server
Actions (proteção nativa de origem/CSRF do Next). Route Handler só para HTTP
explícito: callbacks (`/auth/confirm`), integrações futuras, streaming. Nenhuma
operação tem os dois. Não há API pública nem versionamento `/v1`.

## Fronteira de autorização

`runAction` (`src/server/core/action.ts`) para TODA operação:

1. correlation ID novo (`randomUUID`, sem PII);
2. `authorizeAction(permissão)`: sessão válida no Auth, conta/vínculo/escritório
   ativos, termos aceitos, **MFA aal2** e permissão da matriz central — o papel
   vem do banco nesta requisição, nunca do navegador;
3. input validado pelo schema Zod (`VALIDATION` com erros por campo);
4. client Supabase do usuário com cabeçalho `x-dg-request-id`;
5. service; erro → `DomainResult` com mensagem segura.

Dentro do service: `requirePermission`, `requireInternal`, `requireRole`,
`isPartner` (`context.ts`). `organizationId`, `userId` e papel vêm de
`ctx.session`. A RLS e as funções do banco continuam como segunda barreira —
e regras que o banco já garante (máquina de estados, CPF único, snapshot de
parceria, ledger) **não** são reimplementadas em TypeScript.

## Modelo de erro

`src/server/core/errors.ts`: `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`,
`CONFLICT`, `VALIDATION`, `INVALID_STATE`, `DUPLICATE_CLIENT`,
`BUSINESS_RULE`, `INTERNAL`. O navegador recebe:

```ts
{ ok: true, data, requestId } | { ok: false, error: { code, message, fieldErrors? }, requestId }
```

`fromDbError` (`db-errors.ts`) traduz o Postgres: mensagens escritas por nós
nas funções do banco (português) passam; mensagens da plataforma (nomes de
tabela, constraint, RLS) nunca — viram texto genérico. Unique de CPF/CNPJ →
`DUPLICATE_CLIENT` ("Cliente já cadastrado no sistema."); CNJ → `CONFLICT`
amigável; `PGRST116` → `NOT_FOUND`. Registro de outro escritório é sempre
"não encontrado" (não revela que existe).

## Correlation ID, logs e observabilidade

- `requestId` (UUID) em todo log da operação e no cabeçalho `x-dg-request-id`.
  A migration 025 instala uma pré-requisição do PostgREST que copia o cabeçalho
  (só se for UUID) para `dg.request_id`: os eventos de `audit_events` e
  `personal_data_access_events` da operação ficam com o mesmo ID.
- `src/server/core/logger.ts`: uma linha JSON por evento; campos com nome
  sensível (cpf, email, nome, prompt, conteúdo, token…) viram `[oculto]` e
  todo texto passa por redação (CPF, CNPJ, e-mail, JWT). `setLogSink` permite
  plugar Sentry depois sem mudar quem loga.

## Paginação, filtros e colunas

`src/server/core/pagination.ts`: página 1-based, 25 por padrão, máximo 50,
`count: exact`. Ordenação só por whitelist (`sortSchema`): o navegador manda o
nome público (`name`), o servidor escolhe a coluna (`display_name`). Busca
textual escapa curingas do `ILIKE`. Nenhum `select *`: colunas explícitas, e
DTO de parceiro com menos colunas que o interno.

## Cache

Dado jurídico nunca passa por cache compartilhado: o client do servidor usa
`fetch` com `cache: "no-store"` e as rotas autenticadas são dinâmicas.

## Supabase clients e service role

| Client | Onde | Uso |
|---|---|---|
| `createSupabaseServerClient({ requestId })` | Server Actions / Server Components | **Padrão.** JWT do usuário, RLS vale |
| `createSupabaseBrowserClient` | Telas de login/MFA | Só Auth no navegador |
| `createSupabaseAdminClient` | Servidor, `server-only` | Inventário abaixo — qualquer outro uso é bug |

## Testes

- Unitários (`npm test`): mapeamentos, schemas, tradução de erros, redação de
  logs, paginação, DTOs (o do parceiro não tem campo interno).
- Banco (`supabase/: npm run verificar`): RPCs da 025 (envio de caso do
  parceiro, gravação de cliente, busca, correlation ID).
- Integração (`apps/frontend: npm run test:integration`): services contra o
  **Supabase DEV** real (dados fictícios, `supabase/.env.real`,
  `DG_ENV=development`). O setup cria parceiros A e B e um usuário por papel
  com termos aceitos e **MFA TOTP real** (aal2); cada teste usa o service com o
  JWT do papel — RLS e funções do banco reais.

## Proteção adicional futura (rate limit)

Sem limitador genérico nesta etapa. Precisam de limite por usuário/IP antes de
produção: consulta de CPF/CNPJ do parceiro (`partner_lookup_client` — revela
existência), busca de clientes, preparação de upload, pedido de execução de
agente. Recuperação de senha já é limitada pelo Supabase Auth.
