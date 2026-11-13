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

## Exportação de planilhas (CSV)

Onde está ligada: Clientes (`/clientes`), Processos (`/processos`), Prazos
(`/prazos`) e as cinco listas do Financeiro (`/financeiro`: por processo,
contratos, a receber, recebimentos e despesas). As listas de contratos e de
despesas dentro do caso e do processo não têm o botão. Colunas de cada
planilha: `export.ts` do domínio (`clients`, `processes`, `processes/deadlines`,
`finance`). Em recebimentos, cada lançamento sai com a parte do escritório e a
do parceiro (a divisão que o banco gravou); estorno e ajuste para menos saem
com valor negativo, como número.

Em todas: botão "Exportar planilha" (só ADMIN). O
arquivo sai com os filtros e a ordem da tela, em CSV que o Excel brasileiro
abre direto (`;`, BOM UTF-8, datas dd/mm/aaaa, vírgula decimal). Limite de
**5.000 linhas** por arquivo (`EXPORT_MAX_ROWS`); passou disso, sai cortado e a
tela avisa. Toda exportação grava `DATA_EXPORTED` na auditoria ANTES de o
arquivo sair (migration 066): tipo da lista, filtros e quantidade de linhas. O
texto da busca não é gravado (vira `search: true`) e o banco recusa filtro que
pareça CPF, CNPJ ou e-mail. CPF/CNPJ sai completo e com máscara no arquivo
(sem máscara o Excel corta zeros e estraga o CNJ); nunca vai para URL nem log.

Para ligar outra lista (três passos):

```ts
// 1. server/domain/<x>/service.ts — mesmas consultas da lista, até o limite
export async function exportDeadlines(ctx: ServiceContext, input: ListDeadlinesInput): Promise<ExportFileDTO> {
  requirePermission(ctx, "data.export");
  const { rows, total, truncated } = await collectForExport((page) => repo.listDeadlines(ctx.db, filtersOf(input), page, sortOf(input)));
  return exportCsv(ctx, {
    kind: "deadlines",          // vai para a auditoria (minúsculas, sem espaço)
    fileName: "prazos",         // prazos-2026-11-13.csv
    columns: [
      { header: "Prazo", value: (d) => d.title },
      { header: "Vencimento", value: (d) => csvDate(d.due_at) },   // csvDate, csvDateTime, csvMoney
    ],
    rows,
    filters: { q: input.q, status: input.status },   // q nunca é gravado
    total,
    truncated,
  });
}

// 2. server/domain/<x>/actions.ts
export async function exportDeadlinesAction(input: unknown) {
  return runAction({ name: "deadlines.export", permission: "data.export", schema: listDeadlinesSchema, input, handler: service.exportDeadlines });
}

// 3. na tela, com a MESMA entrada da listagem
<ExportButton action={exportDeadlinesAction} input={deadlineQueryToInput(query)} />
```

`collectForExport` pede páginas de 500 (o PostgREST do projeto devolve no
máximo 1000 linhas) e para no limite. Consulta auxiliar com `in (ids)` usa
`chunked(ids, 100)`: os ids vão na URL. Código: `server/domain/exports/`
(`csv.ts` puro, `service.ts`) e `features/export/export-button.tsx`.

## Lixeira e número CNJ de processo excluído (066)

Excluir cliente, processo ou documento é exclusão lógica (`deleted_at`) e não
mexe em mais nada. A Lixeira (`/configuracoes/lixeira`, só ADMIN) lista os três
e restaura. Regras que ficam no banco:

- **CPF/CNPJ**: continua "um CPF/CNPJ = um cliente", contando o excluído. Quem
  tenta cadastrar o documento de um cliente excluído recebe a orientação de
  restaurar (`DELETED_CLIENT_MESSAGE`).
- **CNJ**: o índice único da 008 não mudou. Quando alguém cadastra (ou corrige)
  um processo com o número de um processo EXCLUÍDO, o excluído solta o número
  (`released_cnj_number` guarda o que ele tinha) e o acompanhamento no DataJud
  passa para o novo. Restaurar devolve o número, se nenhum processo ativo o
  estiver usando. Publicações e movimentações que o excluído já tinha ficam
  com ele. Os índices não viraram parciais porque a importação (042) e o
  portal do parceiro (025/045) supõem uma linha por CPF/CNPJ e por CNJ.
- O que não se desfaz: publicações e andamentos que saíram enquanto o processo
  esteve excluído não foram capturados. A tela diz isso antes de restaurar.

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
| `server/domain/imports/storage.ts` (Etapa 7) | `createSignedUploadUrl`, `download` e `remove` no bucket `imports` | Bucket privado com política RESTRICTIVE para o usuário (017) | `import_create_job` / `import_authorize_file` / `import_files_to_delete` (042) com o JWT do ADMIN devolvem o caminho exato (`jobs/{id}/source.{csv\|xlsx}`); o servidor recalcula a regra e só usa esse caminho | Job e conflitos auditados por gatilho (013); resumo `IMPORT_JOB_SUMMARY` ao concluir |

Nenhuma consulta ou gravação de domínio usa a service role. A Etapa 4.3.2
(sessões) **não** acrescentou uso: listar e encerrar as próprias sessões usa o
JWT do usuário (`auth.signOut({ scope: "others" | "global" })` e RPCs da 038). A importação (042) lê e grava tudo com o JWT do ADMIN; só o arquivo no Storage passa pela service role, como os documentos. `grep createSupabaseAdminClient src` lista exatamente estes arquivos.

## Domínios

Cada domínio fica em `src/server/domain/<domínio>/` com `schemas`, `dto`,
`mappers`, `repository`, `service`, `actions` e testes unitários ao lado;
integração em `tests/integration/<domínio>.int.test.ts`.

| Domínio | Operações | Mecanismo no banco |
|---|---|---|
| Clientes | listar/buscar (paginado), ficha (LGPD), consultar CPF/CNPJ, criar, editar, contato/endereço do parceiro, inativar/reativar, excluir (ADMIN), relacionamentos | `client_directory`, `save_client`, `set_client_status`, `partner_lookup_client` (025); representantes/sócios de PJ: `replace_company_people` (028, estado final atômico) |
| Casos | listar, ficha, criar (interno), envio pelo portal, editar rascunho, enviar, pedir documentos, aceitar, rejeitar, iniciar, encerrar, arquivar, advogado, troca de origem, exceção de status | `partner_submit_case`, `change_case_origin`, `override_case_status`; máquina de estados e snapshot por trigger |
| Processos e prazos | processos (CRUD, partes), movimentações (só MANUAL pela tela), prazos (criar com chave de envio, editar, cumprir, cancelar com motivo, perdido, reabrir com motivo, conferir prazo de agente; agenda do escritório com filtros; próximos e vencidos derivados) | `deadline_agenda`, `deadline_transition`, `deadline_mark_checked`, `create_deadline_once` (063); `deadline_status` (026) |
| Documentos | listar, ficha, criar/vincular, preparar e confirmar upload (idempotente), download, visibilidade, arquivar, excluir, verificação; pendências (criar, solicitar, atender com versão, aprovar/rejeitar) | `authorize_document_upload/download` (026) + Storage assinado |
| Solicitações ao parceiro | listar, ficha com mensagens, criar, responder (atômico), resolver/cancelar | `answer_partner_request` + máquina de estados (026) |
| Revisões | listar, ficha (conteúdo do alvo), atribuir, decidir, reabrir | `decide_review` (nunca `UPDATE reviews.status`) |
| Análises | listar, ficha, iniciar, documentos que faltam, enviar ao agente | `legal_analyses` + `request_agent_run_once` |
| Execuções de agente | pedir (idempotente), resumos, cancelar (ADMIN) | `request_agent_run_once` (026), `get_agent_run_summaries` |
| Financeiro | modelos, contratos (com reabertura), parcelas, lançamentos (recebimento, ajuste, estorno — append-only), extrato de recebimentos por período, "a receber", despesas, divisões (leitura), parcerias, repasses, visão do parceiro | ledger + views; chaves de idempotência e `create_partner_transfer` (026, 064); listas e totais somados no banco (`finance_agreement_list`, `finance_receipt_statement`, `finance_receivables`, `finance_summary`, 064) |
| Organizações | escritório proprietário, parceiros (listar, cadastrar atômico, editar, status, divisão padrão), usuários (leitura), divisão do próprio escritório (administrador do parceiro) | `create_partner_office` (026), `get_my_partner_settings` (027); gestão de equipe segue em `server/auth/team-actions.ts` |
| Notificações | listar, contar não lidas, marcar lida(s); preferências por categoria (Segurança e Prazos não desligam) | RLS do próprio usuário (aal2); `private.notify` (037, 063) |
| Integração judicial (043) | visão e configuração; OABs (ADMIN e administrador do parceiro); cobertura; publicações (listar, abrir, criar prazo, sem prazo, reabrir); prévia da contagem; calendário; situação e pausa do processo; buscar agora | RPCs `*_judicial_*` (invoker → definer, papel conferido no banco); busca no DJEN/DataJud pelo servidor com `dg_worker` (`docs/judicial.md`) |
| Conta (`server/domain/account`) | sessões da própria conta (lista, MFA), sair dos outros dispositivos, sair de todos — toda sessão liberada, qualquer papel, sem `userId` no input | `get_my_sessions`, `record_account_security_event` (038) + `auth.signOut({ scope })` com o JWT do usuário |
| Auditoria | eventos e acessos a dado pessoal (ADMIN, paginado, metadata por whitelist, sem IP/navegador) | `audit_events`, `personal_data_access_events` |
| Lixeira (`server/domain/trash`, 066) | listar clientes, processos e documentos excluídos (quem excluiu, quando, busca e página no servidor), restaurar — só ADMIN (`trash.manage`) | `trash_list`, `restore_client`, `restore_process`, `restore_document` (o banco confere o ADMIN, recusa a restauração que deixaria dois registros ativos com o mesmo CPF/CNPJ ou CNJ e grava a auditoria) |
| Exportação (`server/domain/exports`, 066) | CSV das listas com os filtros da tela — só ADMIN (`data.export`); ligada em Clientes, Processos, Prazos e nas cinco listas do Financeiro | `record_data_export` grava `DATA_EXPORTED` (tipo, filtros, quantidade de linhas; nunca o conteúdo) |
| Busca global (`server/domain/search`) | uma action que chama as buscas das listas de clientes, casos e processos, 5 resultados por grupo | nenhuma função própria: permissão e RLS das listas |

## Prazos (063)

Tela: aba Prazos do processo e a agenda `/prazos` (todos os prazos do
escritório, agrupados por dia, vencidos no topo; mesma permissão de ver
processos; parceiro não entra). Prazo de caso sem processo aparece e é tratado
na agenda.

- **Leitura**: tudo sai da view `deadline_agenda` (security_invoker): prazo +
  situação efetiva (`OVERDUE` derivado) + cliente, caso, processo e CNJ. Filtros
  no servidor: responsável (`me`), situação gravada ou derivada, tipo, período
  (datas do fuso do escritório), "do agente, não conferidos", caso e processo.
- **Situação**: o banco é quem decide (gatilho `deadlines_transition_guard` e
  `deadline_transition`): em aberto → cumprido, cancelado ou perdido; e de volta
  para em aberto ao **reabrir**. Cancelar e reabrir exigem motivo. Cancelar,
  perder e reabrir gravam auditoria própria com o motivo (`DEADLINE_CANCELLED`,
  `DEADLINE_MISSED`, `DEADLINE_REOPENED`). O service só chama a função: não repete
  a regra. A edição continua só em prazo em aberto.
- **Prazo de agente**: `source = 'AGENT'` (prazo direto ou aprovado em Revisões)
  aparece com o selo "Agente, sem conferência" até alguém clicar em "Conferido"
  (`deadline_mark_checked`: quem, quando, uma vez só, auditado). O aplicador
  grava o `deadline_type` da proposta quando vem (o contrato do computador do
  escritório aceita a chave opcional `deadline_type`).
- **Audiência**: tipo `HEARING` guarda hora (em `due_at`), modalidade, local e
  link (`hearing_mode`, `hearing_location`, `hearing_link`). Nos outros tipos o
  vencimento continua sendo o fim do dia em Brasília.
- **Avisos** (`private.notify_deadline_reminders`, a cada 15 min): 5, 3 e 1 dia
  útil antes, no dia, e vencido uma vez por dia útil enquanto estiver em aberto
  (vencido avisa também os ADMINs). Destinatário de reserva: responsável ativo →
  advogado do caso ativo → ADMINs. A data entra na chave do aviso (mudou a data,
  rearma). Dia útil = `private.non_business_reason` sem tribunal (feriados
  nacionais, recesso e dias cadastrados para todos os tribunais). A categoria
  Prazos não se desliga. **Não há envio por e-mail**: os avisos são só no
  sistema.
- **Aplicador de propostas**: não cria prazo em caso ou processo excluído;
  `due_at` só com a data vale como fim do dia em Brasília; proposta aprovada que
  falha ao aplicar avisa quem aprovou e os ADMINs.

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
| Criar prazo (manual) | `create_deadline_once` (063) | SECURITY INVOKER (RLS de `deadlines` vale); o id nasce no banco e a origem é sempre MANUAL |
| Lançamentos, obrigações, acordos, repasses, execução de agente | índices únicos por autor (026) | mesmo contrato da tela |
| Despesa do processo | índice único por autor (064) | `createExpense` devolve a despesa já lançada no reenvio |

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

### Ações de segurança da conta (4.3.2)

`enforceAccountSecurityLimit`: **5/min por usuário** para "sair dos outros
dispositivos" e "sair de todos" (cada uma audita e gera aviso). Mesmo modelo
best-effort em memória; a revogação em si é do Supabase Auth, e o banco
recusa ação fora da lista. Chave `account-security:user:<id>`.

## Hardening pendente por domínio

### Agents / Analysis
Iniciar análise e pedir a execução do agente ainda são duas escritas (a chave
de idempotência torna a repetição segura, mas uma corrida com chaves
diferentes pode deixar execução órfã). **Antes de conectar a execução real do
agente/Claude: tornar atômico** (função que trava a análise, chama
`request_agent_run` e grava QUEUED + `agent_run_id` na mesma transação).
`legal_analyses` também não tem trigger de transição de status.

### Finance
Fechado na revisão final (migration 064, testes `[064]` do verificador):

- Máquina de estados do contrato no banco (030/046) e **reabertura** com motivo
  (064): todo lançamento exige contrato ativo; estornar depois de concluir passa
  por "Reabrir contrato" (ADMIN, auditado). Não há mais saldo "em aberto" preso em
  contrato concluído.
- Ajuste para menos exige o recebimento corrigido; cancelar parcela com
  recebimento é recusado no banco (não só no service).
- Repasse limitado ao saldo **líquido** do parceiro (divisões negativas contam).
- Totais da visão geral e das listas somados no banco (`finance_summary` e as
  funções `*_totals`): a Home e o Financeiro leem a mesma conta. Listas de
  contratos, recebimentos e parcelas a receber filtram e paginam no banco.
- Despesa com chave de idempotência.
- Valor digitado: `readCurrencyInput`/`readPercentInput` (`lib/validation`) aceitam
  só o formato brasileiro e distinguem vazio de inválido; data de lançamento é
  validada pelo dia civil de São Paulo (`zPastDateTime`), e o instante gravado
  nunca fica no futuro (`pastInstant`).

Pendente: acordo financeiro continua sem `cancelled_at/by/reason` próprios (o
motivo do cancelamento do contrato não é pedido; só o das parcelas e o da
reabertura). Totais do parceiro (`shareTotals`) e o "a receber por vencimento"
do gráfico (`getReceivableAging`) ainda são somados no service, com teto de
leitura. Exportação das listas: há um lugar reservado no cabeçalho de cada uma
(`exportAction`), sem implementação.

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
- Busca de processo pelo número CNJ casa por qualquer trecho (`like %dígitos%`),
  na lista e na busca global: sem índice de trigram, lê a coluna inteira. Com
  a carteira atual é imperceptível; reavaliar se passar de dezenas de milhares.
- Busca global (cabeçalho, Ctrl+K): o texto vai no corpo da Server Action e
  nunca para a URL; "Ver todos" só leva a busca para a lista quando não há
  dígitos (mesma regra do `?busca=` das listas). O CPF/CNPJ volta mascarado.

## Testes

- Unitários (`npm test`): mapeamentos, schemas, tradução de erros, redação de
  logs, paginação, DTOs (o do parceiro não tem campo interno).
- Banco (`supabase/: npm run verificar`): 598 verificações (038: sessão
  revogada/vencida/de outro usuário sem dados, reset de MFA, lista só das
  próprias, parser de navegador, auditoria e avisos da conta), inclusive as RPCs
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
