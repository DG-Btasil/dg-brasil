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
`BUSINESS_RULE`, `RATE_LIMITED` (≈ HTTP 429), `INTERNAL`. O navegador recebe:

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

### Inventário da service role (completo)

| Onde | Operação | Por que não dá com o JWT | Pré-validação | Auditoria |
|---|---|---|---|---|
| `server/auth/team-actions.ts` → `inviteUser` | `create_invitation` com `p_actor` | A RPC foi fechada ao navegador (023: impedia sondar quais e-mails têm conta) | `authorizeAction` (aal2) + papel; o banco revalida o papel do ator | `USER_INVITED` com o ator |
| `server/auth/team-actions.ts` → envio do convite | `auth.admin.inviteUserByEmail` / `updateUserById` / `resetPasswordForEmail` | Admin API do Auth | Convite já criado e autorizado pelo banco | Convite auditado |
| `server/auth/team-actions.ts` → `resetUserMfa` | `auth.admin.mfa.listFactors/deleteFactor` + `record_auth_event` | Admin API do Auth | Só ADMIN, nunca a si mesmo; o banco revalida | `MFA_RESET_REQUESTED/COMPLETED` |
| `server/domain/documents/signed-storage.ts` | `createSignedUploadUrl`, `info`, `createSignedUrl(60 s)` no bucket `legal-documents` | Buckets privados sem política para o usuário (017) | `authorize_document_upload/download` com o JWT do usuário devolve o caminho exato; o servidor confere e só assina esse caminho | `DOCUMENT_DOWNLOADED` + acesso LGPD gravados pela RPC, ator USER |

Nenhuma consulta ou gravação de domínio usa a service role. `grep createSupabaseAdminClient src` lista exatamente estes arquivos.

## Domínios

Cada domínio fica em `src/server/domain/<domínio>/` com `schemas`, `dto`,
`mappers`, `repository`, `service`, `actions` e testes unitários ao lado;
integração em `tests/integration/<domínio>.int.test.ts`.

| Domínio | Operações | Mecanismo no banco |
|---|---|---|
| Clientes | listar/buscar (paginado), ficha (LGPD), consultar CPF/CNPJ, criar, editar, contato/endereço do parceiro, inativar/reativar, excluir (ADMIN), relacionamentos | `client_directory`, `save_client`, `set_client_status`, `partner_lookup_client` (025); representantes/sócios de PJ: `replace_company_people` (028, estado final atômico) |
| Casos | listar, ficha, criar (interno), envio pelo portal, editar rascunho, enviar, pedir documentos, aceitar, rejeitar, iniciar, encerrar, arquivar, advogado, troca de origem, exceção de status | `partner_submit_case`, `change_case_origin`, `override_case_status`; máquina de estados e snapshot por trigger |
| Processos e prazos | processos (CRUD, partes), movimentações (só MANUAL pela tela), prazos (criar, cumprir, cancelar, perdido; próximos e vencidos derivados) | `deadline_status` (026: responsável e escopo excluído) |
| Documentos | listar, ficha, criar/vincular, preparar e confirmar upload (idempotente), download, visibilidade, arquivar, excluir, verificação; pendências (criar, solicitar, atender com versão, aprovar/rejeitar) | `authorize_document_upload/download` (026) + Storage assinado |
| Solicitações ao parceiro | listar, ficha com mensagens, criar, responder (atômico), resolver/cancelar | `answer_partner_request` + máquina de estados (026) |
| Revisões | listar, ficha (conteúdo do alvo), atribuir, decidir, reabrir | `decide_review` (nunca `UPDATE reviews.status`) |
| Análises | listar, ficha, iniciar, documentos que faltam, enviar ao agente | `legal_analyses` + `request_agent_run_once` |
| Execuções de agente | pedir (idempotente), resumos, cancelar (ADMIN) | `request_agent_run_once` (026), `get_agent_run_summaries` |
| Financeiro | modelos, acordos, obrigações, lançamentos (recebimento, ajuste, estorno — append-only), divisões (leitura), parcerias, repasses, visão do parceiro | ledger + views; chaves de idempotência e `create_partner_transfer` (026) |
| Organizações | escritório proprietário, parceiros (listar, cadastrar atômico, editar, status, divisão padrão), usuários (leitura), divisão do próprio escritório (administrador do parceiro) | `create_partner_office` (026), `get_my_partner_settings` (027); gestão de equipe segue em `server/auth/team-actions.ts` |
| Notificações | listar, contar não lidas, marcar lida(s) | RLS do próprio usuário (aal2) |
| Auditoria | eventos e acessos a dado pessoal (ADMIN, paginado, metadata por whitelist, sem IP/navegador) | `audit_events`, `personal_data_access_events` |

## Idempotência

**Contrato com a tela (vale para toda operação com `idempotencyKey`):** a chave
é um UUID aleatório gerado UMA vez por **intenção de envio** (ao abrir/montar o
formulário ou ao clicar em enviar pela primeira vez). Nova tentativa da mesma
intenção — clique duplo, retry após timeout, reenvio por erro de rede — usa a
**mesma** chave. Nova intenção (o usuário muda os dados, ou quer criar outro
registro) = chave nova. Resposta com `deduplicated: true` = nada novo foi criado.

**Mecanismo genérico (027)** — `private.idempotency_operations`, fora da Data
API (schema `private`, sem grant para ninguém; só as funções
`private.idempotency_begin/complete` tocam a tabela):

- escopo único: **usuário + operação + chave** (`actor_organization_id` fica
  registrado para auditoria);
- `request_hash` = SHA-256 de `chave | operação | pedido canônico (jsonb)`. A
  própria chave entra como sal: o hash não permite testar CPFs fora daquela
  linha. Nenhum dado de negócio fica em claro na tabela (a `response` guarda só
  IDs e flags);
- **determinismo do hash** (verificado, testes `[027] determinismo`): o pedido
  é `jsonb`, que o Postgres normaliza — chaves ordenadas em todos os níveis,
  sem espaços, chave duplicada fica com o último valor. Logo a **ordem das
  propriedades não muda o hash**. Continuam sendo conteúdo (de propósito): a
  ordem dos itens de um array, `null` × chave ausente, a escala decimal
  (`1234.5` ≠ `1234.50`) e a forma Unicode (NFC ≠ NFD). Isso não gera falso
  conflito porque o pedido é montado **no servidor** pelos mappers, a partir
  da entrada já validada/normalizada pelo Zod — o mesmo formulário reenviado
  produz sempre o mesmo `jsonb`. Regra para quem mexer nos mappers: manter a
  montagem determinística (sem data/hora "agora", sem id gerado, sem ordem
  variável de arrays);
- **mesma chave + mesmo pedido** → devolve o recurso já criado;
  **mesma chave + pedido diferente** → `CONFLICT` ("Esta chave de envio já foi
  usada com outros dados");
- **atômico**: reivindicar a chave → criar o recurso → associar → responder,
  numa só transação (funções `*_once`). Corrida com a mesma chave: o segundo
  pedido espera o primeiro no índice único e devolve o mesmo recurso. Se a
  criação falha, a reivindicação é desfeita junto (a mesma chave pode tentar de
  novo);
- retenção: uma linha por envio de criação, volume pequeno. Sem expurgo na V1;
  a linha também é rastro de "quem criou, com qual envio". Reavaliar se o
  volume crescer (expurgo de linhas com mais de N meses é seguro: chave velha
  não é reenviada).

| Operação | Função | Observação |
|---|---|---|
| Criar caso (interno) | `create_legal_case_once` | caso + notas internas atômicos; SECURITY INVOKER (RLS de `legal_cases` vale) |
| Enviar caso (portal) | `partner_submit_case_once` | envolve `partner_submit_case` (025, inalterada); repete cliente + caso |
| Criar processo (interno e portal) | `create_legal_process_once` | processo + dados internos + prazo inicial atômicos; não depende do CNJ; parceiro não grava campo interno nem chamando direto |
| Lançamentos, obrigações, acordos, repasses, execução de agente | índices únicos por autor (026) | mesmo contrato da tela |

Outros: upload (id da versão gerado no servidor é a chave natural da
confirmação), resposta a solicitação (id da mensagem), aceite de caso (update
condicionado ao status + índice parcial do snapshot).

## Rate limit (consulta/cadastro por CPF/CNPJ do parceiro)

**Decisão de produto V1: só na aplicação Next.js — best-effort
application-level throttling, NÃO barreira de segurança absoluta.**

- Onde: Server Action → `enforcePartnerTaxIdLimit` (`src/server/core/rate-limit.ts`)
  → service. Aplica a `lookupClientDocumentAction` e `partnerSubmitCaseAction`
  (as duas operações do parceiro que recebem CPF/CNPJ). Equipe interna não é
  limitada aqui.
- Algoritmo: janela deslizante de 60 s, em memória da instância.
- Limites (env, com padrão): `PARTNER_TAX_ID_LIMIT_PER_USER` = **10/min por
  usuário**; `PARTNER_TAX_ID_LIMIT_PER_ORGANIZATION` = **30/min por
  escritório**. Os dois precisam ter folga para o uso consumir.
- Chave: só IDs (`partner-tax-id:user:<id>`, `partner-tax-id:org:<id>`). O
  CPF/CNPJ consultado nunca entra no limitador nem no log.
- Excedeu: `RATE_LIMITED` (equivale a HTTP 429) — "Muitas consultas em pouco
  tempo. Aguarde alguns instantes e tente novamente."
- Sem Redis, KV, tabela, trigger ou contador no Postgres.

**Risco residual ACEITO nesta V1:** em serverless/várias instâncias, cada
instância conta separado; e, como não há limite no banco, um usuário
autenticado tecnicamente sofisticado pode chamar `partner_lookup_client`
direto pela API do Supabase e contornar esta camada. Aceito pelo contexto
fechado (parceiros convidados e conhecidos, poucos usuários, não é SaaS
aberto). As regras de privacidade continuam no banco: a consulta devolve só
NOT_FOUND / ALREADY_RELATED / EXISTS — nunca escritório, caso, processo,
responsável ou origem — e cada consulta de CPF existente fica auditada
(`CLIENT_DUPLICATE_DETECTED`). **Reavaliar** antes de produto aberto, se o
número de parceiros crescer muito, se houver abuso ou antes de exposição
externa relevante.

## Hardening pendente por domínio

### Agents / Analysis
Iniciar análise e pedir a execução do agente ainda são duas escritas (a chave
de idempotência torna a repetição segura, mas uma corrida com chaves
diferentes pode deixar execução órfã). **Antes de conectar a execução real do
agente/Claude: tornar atômico** (função que trava a análise, chama
`request_agent_run` e grava QUEUED + `agent_run_id` na mesma transação).
`legal_analyses` também não tem trigger de transição de status.

### Finance
Acordo financeiro sem `cancelled_at/by/reason` nem máquina de estados no banco
(hoje no service). Revisar ciclo de vida/cancelamento antes de considerar o
financeiro pronto para produção. Totais do parceiro ainda somados no service.

### Agent Runs
`get_agent_run_summaries` sem paginação (limite até 50). Paginar antes de
escala/produção.

### Partner CPF/CNPJ lookup
Rate limit atual é só na aplicação, best-effort (acima). Reavaliar limite
forte/distribuído antes de expansão do produto.

### Outros
- LAWYER não vê o advogado responsável do parceiro (está em
  `partner_office_settings`, só ADMIN).
- Notificação ao parceiro quando uma solicitação é criada (exige RPC/trigger).
- Busca: `*` digitado vira curinga do PostgREST (amplia o resultado, não
  injeta). Sem índice de trigram por enquanto.

## Testes

- Unitários (`npm test`): mapeamentos, schemas, tradução de erros, redação de
  logs, paginação, DTOs (o do parceiro não tem campo interno).
- Banco (`supabase/: npm run verificar`): 579 verificações, inclusive as RPCs
  da 025–028 (envio de caso do parceiro, gravação de cliente, busca,
  correlation ID, Storage autorizado, idempotência, divisão do parceiro,
  bloco societário de PJ) e as da 4.3.1 (032–037: RLS dos caminhos quentes,
  interrupção de execução, edição manual na revisão, cronograma, valores da
  parceria, contratado por modelo, histórico e contagens do portal, produtor
  de notificações), com conferência de catálogo das funções novas.
- Integração (`apps/frontend: npm run test:integration`) — **107/107 no
  Supabase DEV (2026-10-13)**, 11 domínios: services contra o
  **Supabase DEV** real (dados fictícios, `supabase/.env.real`,
  `DG_ENV=development`). O setup cria parceiros A e B e um usuário por papel
  com termos aceitos e **MFA TOTP real** (aal2); cada teste usa o service com o
  JWT do papel — RLS e funções do banco reais.
