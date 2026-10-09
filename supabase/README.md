# Banco de dados — DG Brasil V1

Implementação da *DG Brasil — Database Architecture Specification V1*, consolidada
na Etapa 3.2. Postgres no Supabase (São Paulo), com Auth, Storage, RLS e Queues (pgmq).

Uma organização OWNER (Bárbara Cardoso Advocacia) e escritórios PARTNER. Cinco
papéis: ADMIN, LAWYER, ASSISTANT (internos); PARTNER_ADMIN, PARTNER_USER.
Domínio central: **Client → LegalCase → LegalProcess**.

> **Regra de migrations.** As 19 migrations ainda não foram aplicadas em nenhum
> Supabase real, por isso foram corrigidas no lugar. A partir do primeiro
> `db push` real, migration aplicada **nunca mais** é reescrita: mudança nova é
> `020+`.

## Estrutura

| Caminho | O que é |
|---|---|
| `migrations/` | As 19 migrations, na ordem da seção 100 da especificação |
| `tests/verificar.mjs` | Critérios de aceitação e regras de integridade: 261 verificações, com a RLS testada por papel |
| `tests/supabase-shim.sql` | Simulação mínima de `auth`, `storage`, `pgmq` e roles do Supabase para rodar no PGlite. **Só para teste local** |
| `tests/real/validar-real.mjs` | Validação contra um Supabase **real de desenvolvimento**: Auth, JWT/PostgREST, Storage, pgmq e login do `dg_worker` (`npm run validar:real`, variáveis em `.env.real`, modelo em `.env.real.example`) |

## Testar localmente

```bash
cd supabase
npm install
npm run verificar
```

Roda as migrations num Postgres 17 real (PGlite, em WASM), sem Docker. Cada
usuário roda com `set role authenticated` e o JWT em `request.jwt.claims`, como o
PostgREST faz. O worker roda como `dg_worker`, o backend como `service_role`.

**Não é coberto aqui:** Auth, Storage e pgmq **reais**. O shim imita a forma do
pgmq (`q_<fila>`, `a_<fila>`, `read`/`set_vt`/`archive`), mas a confirmação é
no projeto (Etapa 3.3).

## Aplicar no Supabase

```bash
npx supabase login
npx supabase init          # só na primeira vez; não mexe em migrations/
npx supabase link --project-ref <ref-do-projeto-sa-east-1>
npx supabase db push
```

Antes do `db push`, habilite a extensão **pgmq** (Dashboard → Database →
Extensions). A migration 018 também tenta habilitar.

### Primeira administradora

Nenhuma senha fica no código. Depois do `db push`:

1. Dashboard → Authentication → **Add user** (e-mail da Bárbara).
2. SQL Editor, como `postgres`:
   ```sql
   select private.bootstrap_owner_admin('<uuid do usuário>');
   ```

Só funciona enquanto não existir ADMIN ativo. Depois disso, papéis e convites
são geridos pelo backend.

### Papel do worker (`dg_worker`)

A migration 016 cria `dg_worker` **sem login**, sem superuser e **sem
BYPASSRLS**. Para o worker conectar, no SQL Editor (senha gerada na hora, guardada
só no secret do Fly.io):

```sql
alter role dg_worker with login password '<senha forte>';
```

`DATABASE_URL` do worker usa esse usuário. Nunca `postgres`, nunca a service role.

## Contrato para o backend (Next.js e worker)

**Service role não é atalho de autorização.** Para operações do usuário, use o
JWT dele (a RLS continua valendo). Operações compostas são funções que o banco
revalida contra o usuário que está agindo:

| Operação (RPC em `public`) | O que faz, numa transação |
|---|---|
| `decide_review(review, decisão, notas, ator?)` | Grava `review_decisions` → muda a revisão → leva a proposta do agente a APPROVED/REJECTED → audita |
| `request_agent_run(agente, caso?, processo?, pedido?, parâmetros?, operação?, ator?)` | Valida ADMIN/LAWYER e acesso ao caso → cria `agent_runs` (`requested_by`) → guarda o pedido em `agent_run_inputs` → enfileira → audita |
| `change_case_origin(caso, nova_origem, motivo, ator?)` | Troca a origem comercial; após o aceite, só ADMIN e com motivo; cancela/cria o snapshot de parceria → audita |
| `override_case_status(caso, status, motivo, ator?)` | Exceção de status de ADMIN (reabrir encerrado, reconsiderar rejeição), com motivo → audita |
| `record_personal_data_access(cliente, recurso, id, ação, finalidade?, ator?)` | Registra acesso a dado pessoal (LGPD) |
| `get_agent_run_summaries(caso?, limite?)` | Execuções de agente para ADMIN (todas) e LAWYER (casos que acessa), com colunas fixas e sem dado técnico |

`ator` (p_actor) só é usado quando o backend chama com a service role: informa o
usuário que ele já autenticou; o banco confere que é perfil ativo e revalida o
papel. Com JWT de usuário, `ator` diferente do próprio usuário é recusado.

Outras regras do contrato:

- **Contexto de auditoria:** em cada transação, o backend pode declarar
  `set_config('dg.request_id' | 'dg.ip_address' | 'dg.user_agent', valor, true)`.
- **Eventos que o banco não vê** (ex.: `DOCUMENT_DOWNLOADED`):
  `select private.record_audit_event(acao, tipo, id, metadata)` com a service role.
- **Upload de documento:** gere o id da versão, monte o caminho com
  `private.legal_document_object_name(client_id, document_id, version_id, arquivo)`,
  gere a signed upload URL e insira `document_versions` com esse mesmo id.
  Material de referência: `private.reference_material_object_name(...)`, caminho
  `references/{id}/{versão}/{arquivo}`. O banco recusa caminho fora do padrão.
- **Inserção feita por parceiro:** insira sem `RETURNING`/`.select()`. O
  documento só fica visível ao parceiro depois de vinculado ao caso
  (`case_documents`). Gere o UUID no servidor.
- **Cliente criado por parceiro:** pelo backend (service role), para a
  deduplicação por CPF/CNPJ não vazar dado de outro escritório.
- **Objetos órfãos no Storage** (upload feito, insert falhou):
  `private.find_orphan_storage_objects(interval)` lista; nada é apagado
  automaticamente.

## Decisões estruturais

### Gate humano — "IA executa. Humano decide."

O status de uma revisão **nunca** muda por `UPDATE` direto. Três barreiras
independentes:

1. **Grants:** `authenticated` não tem privilégio sobre `reviews.status`/`decided_at`
   nem `INSERT` em `review_decisions`; a service role e o `dg_worker` também não
   inserem decisão.
2. **Trigger:** revisão nasce `PENDING`; status só muda dentro da aplicação de uma
   decisão (marcada na transação).
3. **Trigger de proposta:** `APPROVED` exige revisão `APPROVED`;
   `requires_human_review` não desliga.

Propostas que mudam a **configuração estrutural do DG Brasil** (`UPDATE_AGENT`,
`UPDATE_SKILL` e os futuros `UPDATE_THESIS`, `UPDATE_REFERENCE`, `ADMIN_*` —
`private.proposal_requires_admin`) só são decididas por **ADMIN**. LAWYER decide
resultado jurídico. Revisão de proposta de agente não se reabre: o agente gera
outra proposta.

Não existe `CREATE_DOCUMENT`: minuta de peça vai como versão `INTERNAL` de
documento, com revisão própria (ferramenta `entregar_documento`). Só existem
tipos de proposta com aplicador.

### Máquina de estados do caso

| De | Para |
|---|---|
| DRAFT | SUBMITTED, WAITING_DOCUMENTS, READY_FOR_ANALYSIS, ARCHIVED |
| SUBMITTED | WAITING_DOCUMENTS, READY_FOR_ANALYSIS, ANALYZING, ACCEPTED, REJECTED, ARCHIVED |
| WAITING_DOCUMENTS | SUBMITTED, READY_FOR_ANALYSIS, ANALYZING, ACCEPTED, REJECTED, ARCHIVED |
| READY_FOR_ANALYSIS | WAITING_DOCUMENTS, ANALYZING, ACCEPTED, REJECTED, ARCHIVED |
| ANALYZING | WAITING_DOCUMENTS, READY_FOR_ANALYSIS, WAITING_REVIEW, ACCEPTED, REJECTED |
| WAITING_REVIEW | WAITING_DOCUMENTS, ANALYZING, ACCEPTED, REJECTED |
| ACCEPTED | IN_PROGRESS, CLOSED |
| IN_PROGRESS | CLOSED |
| REJECTED | ARCHIVED |
| CLOSED | ARCHIVED |
| ARCHIVED | — (terminal) |

Exceções, só por `override_case_status` (ADMIN, motivo, auditado):
CLOSED → IN_PROGRESS e REJECTED → SUBMITTED. Nada mais — nem para ADMIN.
ACCEPTED exige advogado; REJECTED exige motivo público; as datas de cada estado
são preenchidas pelo banco. Usuário só cria caso em DRAFT, SUBMITTED,
WAITING_DOCUMENTS, READY_FOR_ANALYSIS, ACCEPTED ou IN_PROGRESS.
Excluir/restaurar caso, processo ou cliente (soft delete) é de ADMIN.

### Organização no caso

`partner_organization_id` (acesso operacional do parceiro — é a única regra de
visibilidade), `origin_organization_id` (atribuição comercial / parceria),
`created_by_organization_id` (auditoria) e `clients.origin_organization_id`
(origem do cadastro) são conceitos diferentes. Parceiro que cria um caso com
origem Bárbara continua vendo o caso, sem parceria financeira.

### Financeiro

- `payments` é **obrigação** (valor esperado). Não guarda valor pago nem status.
- `payment_receipts` é o **ledger append-only**: `RECEIPT` (+), `REVERSAL` (−,
  aponta o original), `ADJUSTMENT` (com justificativa). Corrigir = novo lançamento.
  Total líquido nunca negativo nem acima da obrigação.
- `payment_balances` (view) deriva recebido, saldo e status: PENDING, PARTIAL,
  PAID, OVERDUE (vencida com saldo, no fuso de São Paulo), CANCELLED (`cancelled_at`).
- `financial_agreements` mantém ciclo de vida próprio (DRAFT → ACTIVE → COMPLETED/CANCELLED).
- **Snapshot de parceria** (`case_partnership_agreements`) nasce no aceite de
  caso com origem parceiro e é imutável. Troca de origem **cancela** o ativo
  (`cancelled_at`, `cancelled_by`, `cancellation_reason`) e, se a nova origem for
  parceiro, cria outro. Um ativo por caso (índice único parcial).
- **Divisão por recebimento** (`partner_revenue_allocations`) é gerada pelo
  banco para cada lançamento: `round(valor × % / 100, 2)` com o percentual
  congelado do snapshot; o escritório fica com a diferença. Ninguém digita divisão.
  Estorno gera divisão inversa no **mesmo** acordo do lançamento original.
- **Histórico não se move:** o que foi recebido, dividido e repassado antes de
  uma troca de origem continua no acordo antigo; só recebimento novo segue o
  acordo ativo.
- **Repasses:** PENDING → PAID → CANCELLED (com motivo) ou PENDING → CANCELLED.
  Repasse cancelado fica no histórico e **não consome** saldo
  (`private.allocation_available_amount`, view `partner_allocation_balances`).
- Os triggers financeiros conferem ADMIN **antes** de qualquer regra: trigger
  roda antes do WITH CHECK da RLS, e a mensagem de erro não pode revelar valores
  a quem não é do financeiro.
- `legal_processes.case_value` é valor da causa: nunca honorário, receita nem base de divisão.

### Documentos

- `case_document_requirements`: o que falta (MISSING, REQUESTED, RECEIVED,
  APPROVED, REJECTED). Satisfeita por uma **versão** concreta
  (`satisfied_by_document_version_id`), que precisa ser de documento do mesmo
  cliente **e** vinculado ao caso.
- `documents` (lógico) → `document_versions` (arquivo, imutável).
- **Verificação do arquivo** é da versão: `document_version_verifications`
  (append-only, VERIFIED/FAILED). Sem registro = UNVERIFIED. Versão nova nunca
  herda. View `document_version_verification_status`.
- **Aprovação** também é da versão (revisão com alvo `document_version_id`).
  View `document_version_approvals`.
- Categoria de documento: tabela `document_categories`, vocabulário único igual
  ao do front-end (IDENTIFICATION, ADDRESS_PROOF, BENEFIT_STATEMENT...).

### Agentes, fila e worker

- `request_agent_run` (acima) é a única porta de entrada. ADMIN e LAWYER; LAWYER
  só com caso. ASSISTANT e parceiros, não.
- O pedido em texto fica em `agent_run_inputs` (ADMIN e o próprio solicitante
  leem; retenção de 180 dias, `private.purge_expired_agent_run_inputs()`).
  `agent_runs.metadata` recusa a chave `input`: só ids, contagens e nomes de
  ferramentas.
- LAWYER acompanha execuções dos casos que acessa pela RPC
  `get_agent_run_summaries` (SECURITY DEFINER, `search_path` vazio, autorização
  explícita por `auth.uid()`, papel e acesso ao caso; colunas fixas, sem
  metadata, entrada, tokens, custo, modelo nem erro bruto). ASSISTANT, parceiros
  e anon são recusados. A tabela `agent_runs` é de ADMIN. Não existe mais view
  com privilégio do dono (o linter do Supabase apontaria, e um erro de filtro
  viraria vazamento).
- Fila `agent_execution` (pgmq) leva só IDs. Worker: `pgmq.read` →
  `private.claim_agent_run` (reserva atômica: `UPDATE … WHERE status = 'QUEUED'`;
  só um worker ganha; reserva de worker morto — batimento parado — é retomada)
  → `private.heartbeat_agent_run` periódico (estende o VT com `pgmq.set_vt`;
  execução longa não roda em dobro) → `pgmq.archive`.
- `agent_proposals.idempotency_key` + `unique (agent_run_id, idempotency_key)`:
  a mesma proposta repetida não vira duas. A aplicação grava o efeito e
  `APPLIED` (com `applied_entity_*`) na mesma transação; `APPLIED` não volta.
- **dg_worker — "recebe uma execução e só enxerga o contexto dela".** Não tem
  SELECT em **nenhuma** tabela com dado de cliente (clientes, casos, processos,
  documentos, pendências, execuções, entradas, propostas, revisões), nem em
  financeiro, auditoria, usuários, integrações ou importações. Lê diretamente só
  a configuração de IA (agentes, versões, skills, teses, referências, vínculos),
  que não tem dado de cliente. Todo o resto passa por funções `private.worker_*`
  (migration 018), que exigem a reserva da execução (`claimed_by` + RUNNING),
  derivam caso/processo/cliente da própria execução e nunca aceitam
  `client_id`/`case_id` arbitrário:

  | Função | Para |
  |---|---|
  | `claim_agent_run`, `heartbeat_agent_run` | Reservar e manter a reserva |
  | `worker_run_context` | Identidade da execução, cliente do caso, pedido em texto, saída anterior |
  | `worker_find_client`, `worker_get_case`, `worker_get_process`, `worker_get_document_version` | Leituras do caso da execução (download registra acesso LGPD com ator AGENT) |
  | `worker_create_proposal`, `worker_deliver_document` | Proposta + revisão PENDING; minuta INTERNAL + versão + revisão |
  | `worker_finish_run`, `worker_requeue_run` | Fim/nova tentativa, só por quem tem a reserva |
  | `worker_apply_next_proposal`, `worker_close_decided_runs` | Aplicar proposta APROVADA (o aplicador mora no banco: `apply_proposal_effect`) e fechar execuções decididas |

  Fora isso: `pgmq.read`, `set_vt`, `archive` na fila `agent_execution`. Não
  decide revisão, não muda status de revisão, não envia mensagem para a fila e
  não tem superuser nem BYPASSRLS.

### Auditoria e LGPD

- `audit_events` é append-only, gravado por trigger na mesma transação.
  `actor_type`: USER (usuário logado, ou backend agindo por ele via `ator`),
  AGENT (worker numa execução — `agent_run_id` fica no evento), SYSTEM.
  Usuário logado nunca se passa por outro.
- Cobertura: clientes (e dados internos, sócios, contatos, endereços), casos (e
  dados internos, pendências), processos (e dados internos, movimentações não
  oficiais), prazos, documentos, versões, verificações, vínculos, análises,
  revisões e decisões, execuções (mudança de estado) e propostas, solicitações a
  parceiro, financeiro inteiro (obrigações, lançamentos, divisões, acordos,
  cancelamentos, repasses), DG Brasil (agentes, skills, teses, referências,
  versões, vínculos), integrações, importações, usuários e organizações.
  Fora, de propósito: notificações, preferências, catálogo e `agent_run_inputs`.
- metadata guarda IDs, status, valores e nomes de campos. Nunca CPF, e-mail,
  telefone, conteúdo de documento, prompt, entrada do agente ou raciocínio.
- `personal_data_access_events` (append-only): quem abriu a ficha de qual
  titular, baixou qual documento, exportou o quê. Só IDs e ação. Abertura
  repetida da mesma ficha em 10 minutos não gera evento novo. Só ADMIN lê.

### Importação (CSV/XLSX)

Genérica, sem nenhum campo de fornecedor:
`UPLOADED → COLUMNS_DETECTED → MAPPED → VALIDATED` (dry-run) `→ [CONFLICTS_PENDING]
→ CONFIRMED → PROCESSING → COMPLETED | FAILED`. Tabelas: `import_jobs`,
`import_column_mappings`, `import_conflicts` (CPF/CNJ existente nunca vira
registro novo), `import_row_results` (resultado e procedência por linha).
A linha bruta é apagada depois do job (`private.purge_import_raw_data`).
PDF/DOCX não são importação estruturada na V1.

## Onde a implementação difere do texto da especificação

| Especificação | Implementação | Motivo |
|---|---|---|
| `legal_cases.rejection_reason_internal` | Tabela `legal_case_internal_details` (também `accepted_by`) | RLS é por linha: parceiro que lê o caso leria a coluna |
| Notas/resumo do cliente e do processo | `client_internal_details`, `legal_process_internal_details` | Mesmo motivo |
| `private.current_role()` | `private.current_user_role()` | `current_role` é palavra reservada do SQL |
| Fila `agent-execution` | `agent_execution` | pgmq cria tabelas `q_<nome>`; hífen em nome de tabela é fonte de erro |
| `payments.paid_amount` / status gravado | Ledger `payment_receipts` + view `payment_balances` | Decisão da Etapa 3.1: correção vira lançamento, status é derivado |
| `agent_runs.estimated_cost` | `numeric(14,6)` + moeda `USD` | Custo de API por execução é de centavos de dólar |
| Respostas de solicitação (não especificadas) | `partner_request_messages` (append-only) | O parceiro precisa responder com texto e documento |
| — | Bucket privado `imports` | `import_jobs.storage_object_name` precisa de bucket |
| — | Views `document_version_approvals`, `document_version_verification_status`, `deadline_status`, `payment_balances`, `partner_allocation_balances` (todas `security_invoker`) e a RPC `get_agent_run_summaries` | Estado derivado, nunca gravado |
| `CREATE_DOCUMENT` | Removido | Sem aplicador; minuta vai como versão de documento |

Vocabulários canônicos são os do banco; o front mapeia o que ainda difere em
`apps/frontend/src/repositories/api/db-mappings.ts`.

## Permissões (resumo da RLS)

| | ADMIN | LAWYER | ASSISTANT | PARTNER_ADMIN | PARTNER_USER |
|---|---|---|---|---|---|
| Clientes | todos | todos | todos | com relacionamento | com relacionamento |
| Dados internos (cliente, caso, processo) | sim | sim | sim | — | — |
| Casos | todos | todos, decide | todos, não decide | `partner_organization_id` = seu | idem |
| Processos | todos | todos | leitura | dos seus casos | idem |
| Documentos | todos | todos | todos | `PARTNER_VISIBLE` dos seus casos | idem |
| Prazos | todos | todos | leitura | — | — |
| Análises e revisões | sim | sim (exceto proposta estrutural) | — | — | — |
| Execuções de agente | tabela + pedir | RPC dos seus casos + pedir | — | — | — |
| Financeiro | completo | — | — | só a própria parceria (leitura) | — |
| Agentes, Skills, Teses, Referências | sim | — | — | — | — |
| Importação | sim | — | — | — | — |
| Auditoria e acessos LGPD | leitura | — | — | — | — |

Parceiro suspenso/inativo, ou usuário inativado, perde todo o acesso.

## Validação no Supabase real (Etapa 3.3)

`tests/real/validar-real.mjs` cobre o que o PGlite não cobre: `create policy`
em `storage.objects`, pgmq real (assinaturas instaladas, tabelas `q_`/`a_`,
grants do `dg_worker`), login do `dg_worker` pelo método de produção, trigger
`on_auth_user_created`, RPCs pelo PostgREST com JWT real, signed URLs,
isolamento de parceiros com sessões reais e claim concorrente de dois workers.
Recusa rodar sem `DG_ENV=development` e só cria dados fictícios.

**Baseline: 001–019, aplicadas no Supabase real de desenvolvimento em
2026-10-08.** Desde então nada nelas muda: correção é `020+`.

| Migration pós-baseline | Motivo |
|---|---|
| `20261009000020_fix_partnership_snapshot_trigger` | Achado na validação real: o aceite pelo caminho normal (PostgREST, só `status`) não criava o snapshot de parceria, porque o trigger era `UPDATE OF accepted_at` e `accepted_at` é preenchido por outro trigger. Teste de regressão em `verificar.mjs` (marcado `[020]`) |
| `20261009000021_revoke_platform_rls_auto_enable` | Security Advisor: `public.rls_auto_enable()` (criada pela plataforma com "RLS automática") era SECURITY DEFINER executável por anon/authenticated via RPC. Revoga EXECUTE se existir. Teste marcado `[021]` |

### Supabase Advisors (2026-10-09)

| Aviso | Classificação | Destino |
|---|---|---|
| 0028/0029 — `public.rls_auto_enable()` SECURITY DEFINER executável por anon/authenticated | **TRUE ISSUE** (baixo risco; objeto da plataforma, fora do repo) | Corrigido na 021 |
| Auth — proteção contra senha vazada desligada | **DEFERRED** | Configuração de Auth da Etapa 4 (junto com política de senha e MFA); recurso do plano Pro |
| 0006 — múltiplas políticas permissivas (`documents`, `document_versions`, `legal_cases` INSERT/UPDATE, `legal_processes`, `partner_requests`) | **EXPECTED** | Uma política por papel, de propósito: cada regra fica legível e testável isoladamente. Custo irrelevante no volume atual; fundir em uma política com `OR` só se medição em produção mostrar impacto |

Nenhuma das funções SECURITY DEFINER do DG Brasil aparece nos lints 0028/0029:
as RPCs públicas são `security invoker` e delegam a `private.*`, que não fica
exposto pela API.

Diferenças reais encontradas e cobertas: pgmq 1.5.1 tem `archive(text, bigint)`
e `archive(text, bigint[])` — chamada sem tipo é ambígua (o worker sempre tipa;
o shim agora tem a sobrecarga); o timezone do servidor é UTC (OVERDUE usa
`America/Sao_Paulo` explicitamente).
