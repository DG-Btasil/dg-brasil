# Banco de dados — DG Brasil V1

Implementação da *DG Brasil — Database Architecture Specification V1*, consolidada
na Etapa 3.2. Postgres no Supabase (São Paulo), com Auth, Storage, RLS e Queues (pgmq).

Uma organização OWNER (Barbara Cardoso Advocacia) e escritórios PARTNER. Cinco
papéis: ADMIN, LAWYER, ASSISTANT (internos); PARTNER_ADMIN, PARTNER_USER.
Domínio central: **Client → LegalCase → LegalProcess**.

> **Regra de migrations.** Migration aplicada **nunca** é reescrita: mudança
> nova é sempre um arquivo novo, com o número seguinte. Em 13/11/2026 o Supabase
> de desenvolvimento tem **68 aplicadas (001–068)**; as da revisão final
> (062–068) entraram no mesmo dia.
> Nenhuma das aplicadas pode ser editada. (As 19 primeiras foram corrigidas no
> lugar só até 2026-10-09, antes do primeiro `db push` real; a conferência de
> que o DEV bate com os arquivos está em
> [organizacao-pre-producao.md](../docs/deploy/organizacao-pre-producao.md).)

## Estrutura

| Caminho | O que é |
|---|---|
| `migrations/` | As migrations, em ordem. As 19 primeiras seguem a seção 100 da especificação |
| `tests/verificar.mjs` | Critérios de aceitação e regras de integridade, com a RLS testada por papel: aplica **todas** as migrations do zero e confere cada uma (os blocos são marcados com o número da migration, de `[020]` a `[065]`). 951 verificações até a 061; cada migration nova acrescenta as suas, e o total aparece no fim de `npm run verificar` |
| `tests/supabase-shim.sql` | Simulação mínima de `auth`, `storage`, `pgmq`, `pg_cron` e roles do Supabase para rodar no PGlite. **Só para teste local** |
| `tests/real/validar-real.mjs` | Validação contra um Supabase **real de desenvolvimento**: Auth, JWT/PostgREST, Storage, pgmq e login do `dg_worker` (`npm run validar:real`, variáveis em `.env.real`, modelo em `.env.real.example`) |
| `scripts/usuarios-qa.mjs` | Usuários **fixos** para QA manual no DEV (LAWYER, ASSISTANT e PARTNER_ADMIN/PARTNER_USER de "Parceiro QA A/B"), senha em `QA_SENHA`; termos e MFA no primeiro login (`npm run usuarios:qa`) |
| `scripts/limpar-contas-de-teste.mjs` | Apaga do DEV as contas das rodadas automáticas (`<rodada>.<papel>@dgbrasil.test`), os escritórios parceiros delas e tudo o que criaram. Sem argumento só **simula** e desfaz; `-- --executar` apaga. Preserva as contas reais e as de QA, e desfaz tudo se sobrar chave órfã ou se sumir linha criada por conta mantida (`npm run limpar:teste`) |
| `scripts/trava-dev.mjs` | A trava dos três scripts acima e dos testes de integração: só rodam com `DG_ENV=development` **e** com todo endereço apontando para o projeto declarado em `DG_DEV_PROJECT_REF` (o identificador do projeto de desenvolvimento). Sem a variável, ou com endereço de outro projeto, recusam |
| `scripts/backup-documentos.mjs` | Cópia de segurança dos arquivos do Storage (o backup do Supabase não cobre): espelha os buckets para uma pasta, só o que é novo ou mudou, com simulação, relatório e restauração. Roteiro em [restauracao-dos-documentos.md](../docs/deploy/restauracao-dos-documentos.md) |
| `scripts/*.test.mjs` | Testes da trava e da cópia de segurança, sem rede (`npm run test:scripts`) |

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

Antes do `db push`, habilite as extensões (Dashboard → Database → Extensions):

- **pgmq**: a fila dos agentes (a migration 018 também tenta habilitar);
- **pg_cron**: os agendamentos do banco (manutenção a cada minuto, lembretes de
  prazo, busca judicial, limpezas, vigia diária). A 040 tenta habilitar; sem
  ele, nada roda sozinho;
- **pg_net**: o agendador do banco chama a rota da busca judicial
  ([producao.md](../docs/deploy/producao.md), item 10).

Depois do `db push`, confira os agendamentos com
`select jobname, schedule from cron.job order by jobname;`
([checklist da virada](../docs/deploy/checklist-da-virada.md), passo 14).

### Primeira administradora

Nenhuma senha fica no código. Depois do `db push`:

1. Dashboard → Authentication → **Add user** (e-mail da Barbara).
2. SQL Editor, como `postgres`:
   ```sql
   select private.bootstrap_owner_admin('<uuid do usuário>');
   ```

Só funciona enquanto não existir ADMIN ativo. Depois disso, papéis e convites
são geridos pelo backend. No primeiro login a pessoa aceita os termos e cadastra o
MFA (obrigatório: sem `aal2` a RLS não devolve nada). Configuração do Auth (sem
cadastro público, senha 8+, TOTP, Redirect URLs, templates de e-mail em
`templates/`): [docs/auth.md](../docs/auth.md).

### Papel do servidor (`dg_worker`)

A migration 016 cria `dg_worker` **sem login**, sem superuser e **sem
BYPASSRLS**. É com ele que o **servidor do DG Brasil** (o painel, na Vercel)
fala com o banco quando não há usuário logado: a API do computador do
escritório, a busca judicial, o Google Drive e a rota `/api/health`. Para ele
conectar, no SQL Editor (senha gerada na hora):

```sql
alter role dg_worker with login password '<senha forte>';
```

A senha fica **só** na variável `DG_WORKER_DB_URL` do servidor (Vercel, ambiente
do projeto; no computador de desenvolvimento, em `apps/frontend/.env.local` e
`supabase/.env.real`), pelo pooler do Supabase. Nunca `postgres`, nunca a
service role. O computador do escritório não recebe essa senha: ele usa o token
gerado no site. (O worker no Fly.io, para quem a senha foi pensada, foi removido
na 040 sem nunca ter rodado.)

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
origem Barbara Cardoso Advocacia continua vendo o caso, sem parceria financeira.

### Financeiro

- `payments` é **obrigação** (valor esperado). Não guarda valor pago nem status.
- `payment_receipts` é o **ledger append-only**: `RECEIPT` (+), `REVERSAL` (−,
  aponta o original), `ADJUSTMENT` (com justificativa). Corrigir = novo lançamento.
  Total líquido nunca negativo nem acima da obrigação.
- `payment_balances` (view) deriva recebido, saldo e status: PENDING, PARTIAL,
  PAID, OVERDUE (vencida com saldo, no fuso de São Paulo), CANCELLED (`cancelled_at`).
- `financial_agreements` mantém ciclo de vida próprio (DRAFT → ACTIVE → COMPLETED/CANCELLED).
  Concluído ou cancelado só muda por **reabertura** (064): volta a ACTIVE, com motivo
  (`reopened_at`, `reopened_by`, `reopen_reason`), só ADMIN, auditado
  (`FINANCIAL_AGREEMENT_REOPENED`); os termos continuam congelados.
- **Todo lançamento exige contrato ACTIVE** (064): recebimento, estorno e ajuste. Para
  estornar depois de concluir, reabre-se o contrato. Assim contrato concluído ou
  cancelado nunca fica com parcela em aberto.
- **Ajuste para menos** exige o lançamento que ele corrige (`original_receipt_id`): a
  parte do parceiro sai da mesma divisão do recebimento corrigido (064).
- **Cancelar obrigação com recebimento líquido** é recusado pela guarda (064), não só
  pelo painel.
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
  `create_partner_transfer` recusa valor acima da soma **líquida** das divisões do
  parceiro, contando as negativas (repasse de um recebimento depois estornado);
  restrito a um caso, vale o menor entre o líquido do caso e o do parceiro (064).
- **Listas e totais no banco** (064, views `security_invoker`): `finance_agreement_list`
  (contratos com cliente, totais e próximo vencimento), `finance_receipt_statement` +
  `finance_receipt_statement_totals` (extrato por período, dia de São Paulo),
  `finance_receivables` + `finance_receivables_totals` (parcelas em aberto) e
  `finance_summary` (totais da visão geral: a mesma conta de `process_finance_totals`,
  com o que fica fora dela em `outside`).
- `process_expenses.idempotency_key`: única por autor, como nas demais tabelas (064).
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

> **Desde a 040, não existe mais worker na nuvem.** Quem executa é o Claude Code
> do computador do escritório, pelas portas `private.executor_*` (token do
> computador e reserva por trabalho). O que o worker fazia sem IA (aplicar
> proposta aprovada, fechar execução decidida, devolver à fila a reserva de um
> computador que parou) roda no próprio banco, pelo `pg_cron`
> (`private.maintenance_tick`). O texto abaixo descreve a base da 012 e da 018,
> que continua valendo para a fila, as propostas e o papel `dg_worker`; a
> arquitetura atual está em [docs/mcp/](../docs/mcp/).

- `request_agent_run` (acima) é a única porta de entrada. ADMIN e LAWYER; LAWYER
  só com caso. ASSISTANT e parceiros, não.
- O pedido em texto fica em `agent_run_inputs` (ADMIN e o próprio solicitante
  leem; retenção de 180 dias: `private.purge_expired_agent_run_inputs()` apaga
  o texto vencido todo dia, agendada pela 065 como `dg-expurgo-de-pedidos`).
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
Recusa rodar sem `DG_ENV=development` e fora do projeto declarado em
`DG_DEV_PROJECT_REF` (`scripts/trava-dev.mjs`), e só cria dados fictícios.

**Baseline: 001–019, aplicadas no Supabase real de desenvolvimento em
2026-10-08.** Desde então nada nelas muda: correção é `020+`.

**Exceção ao baseline (2026-10-09, aprovada):** a guarda do pgmq na `018`
verificava o *schema* `pgmq`; o `supabase db reset` remove a extensão e deixa o
schema para trás com as tabelas de fila (`q_*`/`a_*`, que não pertencem à
extensão), então a 018 pulava o `create extension` e o banco não se
reconstruía só pelo repositório. A guarda passou a verificar a *extensão*; um
schema `pgmq` órfão nunca é apagado: é renomeado para `pgmq_orfao_<data>` e a
extensão nasce limpa. As tabelas `q_*`/`a_*` do órfão ganham o prefixo
`orfao_`, porque o `pgmq.create` procura a tabela da fila só pelo nome em
`pg_class` (sem schema) e falhava com *more than one row returned by a
subquery* ao achar `q_agent_execution` no órfão. Não há correção possível em `020+`, porque todo reset
passa pela 018 antes. Único ambiente afetado: o projeto de desenvolvimento, que
foi resetado em seguida.

| Migration pós-baseline | Motivo |
|---|---|
| `20261009000020_fix_partnership_snapshot_trigger` | Achado na validação real: o aceite pelo caminho normal (PostgREST, só `status`) não criava o snapshot de parceria, porque o trigger era `UPDATE OF accepted_at` e `accepted_at` é preenchido por outro trigger. Teste de regressão em `verificar.mjs` (marcado `[020]`) |
| `20261009000021_revoke_platform_rls_auto_enable` | Security Advisor: `public.rls_auto_enable()` (criada pela plataforma com "RLS automática") era SECURITY DEFINER executável por anon/authenticated via RPC. Revoga EXECUTE se existir. Teste marcado `[021]` |
| `20261010000022_auth_sessions_invitations` | Etapa 4.1 (Auth): **MFA no banco** — `current_membership()` (logo toda a RLS), `resolve_actor`, resumo de execuções e notificações exigem JWT `aal2`; `get_my_session_context()` (pré-MFA); convites (`create_invitation`/`revoke_invitation`/`accept_invitation` idempotente); troca de papel/status/perfil com proteção do último ADMIN e do próprio acesso; `get_team_members`; eventos de MFA; escritório proprietário não suspende/exclui; auditoria de aceite de termos. Testes na seção "Auth (022)" |
| `20261012000023_invitation_hardening` | `create_invitation` só pela service role com `p_actor` (fecha enumeração de contas por PARTNER_ADMIN via API); nome do convidado validado (`private.valid_person_name`, contra texto de golpe no e-mail); devolve `auth_user_id` da conta existente ao servidor. Testes `[023]` |
| `20261013000024_preferences_require_mfa` | `user_preferences` e `user_notification_preferences` passam a exigir `aal2` (antes só `auth.uid()`). `tour_completed_at` (já existente desde a 010) é o estado canônico da introdução do produto, por usuário. Testes `[024]` |
| `20261014000025_backend_domain_support` | Etapa 4.2: pré-requisição do PostgREST leva `x-dg-request-id` (UUID) à auditoria; `partner_lookup_client`/`partner_submit_case` (cliente canônico do parceiro sem vazamento, atômico); `client_directory` (busca paginada, `security_invoker`); `save_client`/`set_client_status` (gravação transacional). Testes `[025]` |
| `20261015000026_backend_atomic_operations` | Etapa 4.2: Storage autorizado pelo banco (`authorize_document_upload/download`, LGPD + `DOCUMENT_DOWNLOADED` com ator USER — o servidor só assina o caminho devolvido); chaves de idempotência (lançamentos, obrigações, acordos, repasses, execuções — `request_agent_run_once`); repasse e cadastro de parceiro atômicos; resposta atômica e máquina de estados das solicitações ao parceiro; `deadline_status` com responsável e escopo excluído. Testes `[026]` |
| `20261016000027_idempotency_and_partner_settings` | Etapa 4.2.1: idempotência genérica (`private.idempotency_operations`, fora da Data API; usuário + operação + chave; hash salgado pela chave; mesma chave + outro pedido = conflito); criação atômica e idempotente de caso (`create_legal_case_once`, `partner_submit_case_once`) e de processo com dados internos e prazo inicial (`create_legal_process_once`); `get_my_partner_settings` (administrador do parceiro lê só a própria divisão). Testes `[027]` |
| `20261017000028_company_people_replace` | Etapa 4.3 (Fase A): edição de representantes e sócios de Cliente PJ por `replace_company_people` — estado final das duas listas, atômico (item com `id` existente do cliente = atualiza; sem `id` = insere; ausente = remove; `id` alheio/repetido = recusa tudo). Equipe interna, aal2, só PJ; parceiro recusado; sem DELETE direto pela API. Auditoria: triggers de linha + resumo `COMPANY_PEOPLE_REPLACED` só com contagens. Testes `[028]` |
| `20261018000029_atomic_analysis_start` | Etapa 4.3 (Fase E): início ATÔMICO e idempotente de análise jurídica. `start_legal_analysis_once` cria a análise e, opcionalmente, pede a execução ao agente do template e liga (análise QUEUED + `agent_runs` + `agent_run_inputs` + fila, por `private.request_agent_run`, inalterada) numa transação; `send_legal_analysis_once` envia/reenvia análise existente travando a linha (outra chave com a análise na fila = recusa; nunca duas execuções). Idempotência pelo mecanismo da 027 (`legal_analysis.start` / `legal_analysis.send`); correlação técnica (`request_id`) fora do hash. SECURITY INVOKER (RLS de `legal_analyses`: ADMIN/LAWYER); auditoria pelos triggers de linha na mesma transação. Nenhuma IA é chamada. Testes `[029]` |
| `20261019000030_financial_agreement_lifecycle` | Etapa 4.3 (Fase F): ciclo de vida do acordo financeiro garantido no banco (antes só no TypeScript). `financial_agreements_guard`: só ADMIN; nasce DRAFT/ACTIVE; transições DRAFT → ACTIVE/CANCELLED e ACTIVE → COMPLETED/CANCELLED; COMPLETED/CANCELLED são histórico; termos só mudam em DRAFT; concluir/cancelar exige nenhuma obrigação em aberto. `payments_require_open_agreement`: obrigação nova ou alteração só em acordo DRAFT/ACTIVE. `payment_receipts_require_active_agreement`: entrada positiva só em acordo ACTIVE (estorno e ajuste para menos são correção e valem sempre). Locks FOR SHARE no acordo fecham a corrida com a conclusão. Nada das guardas existentes muda. Testes `[030]` |
| `20261020000031_agent_run_summaries_page` | Etapa 4.3 (Fase G): `get_agent_run_summaries_page` — resumos de execução de agente PAGINADOS (deslocamento + limite 1..100, mais recentes primeiro com desempate estável) e filtráveis (caso, situação, agente), com `total_count`. Mesmas regras e colunas fixas da versão vigente (022): sessão, MFA, só ADMIN/LAWYER, LAWYER só casos que acessa (nunca execução sem caso), sem metadata/pedido/custo/modelo/erro bruto. A função antiga fica intacta. Testes `[031]` |
| `20261021000032_partner_rls_hot_paths` | QA 4.3 (BUG-06): políticas de leitura de clientes (e filhos PF/PJ, contatos, endereços, representantes, sócios), processos, partes, movimentações, pendências e documentos deixam de chamar `can_access_*` LINHA A LINHA. Funções sem parâmetro `private.partner_{client,case,process,document}_ids()` (security definer, escopo só da sessão) calculam o conjunto acessível ao parceiro UMA vez por consulta; a política usa `coluna in (select …)`. Mesma semântica (provada tabela a tabela contra o critério antigo); 3.000 clientes de outro escritório: 6 ms × 3.980 ms. Testes `[032]` |
| `20261022000033_agent_run_cancellation` | Etapa 4.3.1 (D): interromper análise/execução com segurança. `request_agent_run_cancel` (ADMIN ou LAWYER do caso): QUEUED → CANCELLED na hora e mensagem arquivada; RUNNING → `cancel_requested_at/by` que o worker confirma (`worker_cancel_requested`; `worker_finish_run` aceita CANCELLED só com pedido e recusa concluir com pedido); reserva vencida com pedido vira CANCELLED; WAITING_HUMAN só ADMIN; repetir é idempotente; auditado. UPDATE direto de RUNNING deixa de valer (política restrita). Gatilho mantém `legal_analyses` em sincronia com a execução. `get_agent_run_cancel_state` para a tela. Testes `[033]` |
| `20261023000034_review_manual_revision` | Etapa 4.3.1 (C): edição manual na revisão. `prepare_manual_revision` (ADMIN/LAWYER, revisão de documento aberta, base = versão mais recente, texto) devolve o caminho da versão N+1; `commit_manual_revision_once` grava numa transação a versão MANUAL_EDIT, a decisão REQUEST_CHANGES na revisão N (append-only), a revisão nova (mesmo responsável/prioridade/prazo) e a auditoria `DOCUMENT_MANUALLY_REVISED`. Versão N intacta; aprovação nunca herdada; edições concorrentes serializadas; idempotente. Testes `[034]` |
| `20261024000035_finance_schedule_and_views` | Etapa 4.3.1 (E/F/G): `create_payment_schedule_once` — N obrigações atômicas, centavos exatos (resto nas primeiras), mensal/quinzenal/semanal, só ADMIN e acordo aberto, idempotente, auditado; não toca o ledger. Views `partner_agreement_share_totals` (receita elegível, participação, parte do escritório — só leitura, mesma RLS) e `financial_contracted_by_fee_model` (contratado por modelo, somado no banco). Testes `[035]` (inclui falha forçada no meio do lote) |
| `20261025000036_partner_timeline_and_client_counts` | Etapa 4.3.1 (H/I): `get_partner_case_timeline` — histórico sanitizado e paginado de caso do próprio escritório (fontes que o parceiro pode conhecer; status pela trilha só dentro da função, rótulo do parceiro; nunca nota/motivo interno, revisão, análise, execução, metadata). `get_partner_client_counts` — casos, processos, solicitações abertas e documentos pedidos SÓ no escopo do escritório. Testes `[036]` |
| `20261026000037_notification_producer` | Etapa 4.3.1 (A/B): `private.notify` (único escritor: não avisa o autor, destinatário ativo, parceiro só de caso do próprio escritório, preferência da categoria, SECURITY não desliga, chave de evento única por usuário) + gatilhos de domínio na mesma transação (casos, prazos, pendências, revisões, solicitações, análises, execuções, repasses, segurança). `notify_deadline_reminders` (worker; pg_cron se houver). Preferências por categoria em `user_notification_preferences` (constraints). Testes `[037]` |
| `20261027000038_account_session_security` | Etapa 4.3.2: `private.current_membership()` (base da RLS) passa a exigir que o `session_id` do JWT exista em `auth.sessions`, seja do usuário e não esteja vencido — sessão revogada perde o banco antes de o access token expirar; sessão anterior ao último reset de MFA também (`REAUTH_REQUIRED`). `get_my_session_context()` devolve `session_state`. `get_my_sessions()` (só as próprias, aal2, navegador/sistema/aparelho — user agent cru e IP não saem). `record_account_security_event` (lista fechada) + avisos de segurança para a própria pessoa. Trava: falha ao aplicar se o dono das funções não ler `auth.sessions`. Testes `[038]` |
| `20261028000039_agents_runtime` | Etapa 5: interruptor geral da execução de IA (`ai_runtime_settings`), resultado estruturado de análise, área DG Brasil |
| `20261029000040_office_executor` | **Troca de arquitetura:** o worker na nuvem sai; quem executa é o Claude Code do computador do escritório. Computadores autorizados (token só em hash), reserva por trabalho, portas `private.executor_*`, linha do tempo, manutenção no `pg_cron` (`dg-manutencao`, `dg-lembretes-de-prazo`) |
| `20261030000041_google_drive` | Google Drive: pasta do cliente pelo ID, importação sem duplicata, exportação do aprovado, pelo servidor |
| `20261031000042_spreadsheet_import` | Etapa 7: importação de planilhas CSV/XLSX de ponta a ponta (`import_*`, só ADMIN; `dg-importacoes`) |
| `20261101000043_judicial_monitoring` | Etapa 8: DJEN e DataJud só para processos cadastrados, publicações, contagem de prazo em dias úteis, avisos da categoria JUDICIAL, `dg-judicial` |
| `20261101000044_judicial_sync_fixes` | Correções da validação da Etapa 8 (nova tentativa do DataJud em 1 h, rodada que ficava presa) |
| `20261106000045_roadmap2_registrations` | Roadmap 2.0: canal de aquisição, campos do cadastro, status e fases do processo, honorários |
| `20261106000046_roadmap2_process_finance` | Roadmap 2.0: financeiro por processo (contrato e despesas do processo) |
| `20261106000047_roadmap2_process_tasks` | Roadmap 2.0: lista de afazeres do processo para os agentes, com orquestrador |
| `20261106000048_roadmap2_partners_team` | Roadmap 2.0: várias OABs por pessoa, convite de parceiro só com o e-mail, anexo nas pendências |
| `20261106000049_roadmap2_metrics` | Roadmap 2.0: indicadores e séries para os números e gráficos |
| `20261109000050_roadmap2_qa_fixes` | Correções da validação do Roadmap 2.0 (a divisão do parceiro vale pela criação do caso, entre outras) |
| `20261110000051_ponte_agentes` | Ponte: o computador leva os documentos à pasta do cliente e traz o que os agentes geraram para Revisões |
| `20261111000052_executor_wake` | "Verificar agora": a Vigia processa a fila na hora |
| `20261112000053_ponte_cadastro_completo` | Ponte: cadastro completo do cliente e quem assina |
| `20261112000054_kit_basico_agentes` | Cadastra no site os clones da esteira bancária e o orquestrador |
| `20261112000055_forma_pagamento_contrato` | Forma de pagamento do contrato de honorários no cadastro do cliente |
| `20261112000056_sequencia_automatica` | Análise aprovada em Revisões chama os próximos agentes do caso |
| `20261112000057_judicial_notice_cap_and_cron_history` | Aviso de falha da busca judicial no máximo duas vezes por dia; limpeza do histórico do agendador (`dg-limpeza-do-agendador`); remove o agendamento duplicado |
| `20261113000058_processo_para_agentes` | Publicações e andamentos do processo para os agentes; agente de prazos no kit |
| `20261113000059_prazo_direto` | **Exceção ao gate humano, decidida pela dona:** o prazo do agente de prazos entra na agenda sem Revisões (desliga-se em Integrações) |
| `20261113000060_ponte_origem_do_cliente` | Ponte: a pasta do cliente ganha o nível do escritório de origem |
| `20261113000061_prazo_vira_tarefa` | O prazo do agente de prazos vira tarefa do processo e chama o orquestrador; a minuta continua parando em Revisões |
| `062`–`064`, `066`–`068` | **Revisão final (13/11/2026), aplicadas no DEV no mesmo dia.** Uma por área da revisão; o cabeçalho de cada arquivo diz o que faz |
| `20261113000065_vigia_da_plataforma` | **Revisão final, aplicada no DEV em 13/11/2026.** Vigia diária (`private.platform_watch`, `dg-vigia-da-plataforma`: avisa as administradoras de falha no agendador, fila de agentes parada e computador do escritório sem contato); agenda o expurgo dos pedidos vencidos (`dg-expurgo-de-pedidos`); contador de consultas de CPF no banco (`consume_rate_limit`). Testes `[065]` |

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
