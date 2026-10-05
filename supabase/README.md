# Banco de dados — DG Brasil V1

Implementação da *DG Brasil — Database Architecture Specification V1*.
Postgres no Supabase (São Paulo), com Auth, Storage, RLS e Queues (pgmq).

## Estrutura

| Caminho | O que é |
|---|---|
| `migrations/` | As 19 migrations, na ordem da seção 100 da especificação |
| `tests/verificar.mjs` | Critérios de aceitação (seção 105) e regras de integridade: 133 verificações |
| `tests/supabase-shim.sql` | Simulação mínima de `auth`, `storage`, `pgmq` e roles do Supabase para rodar no PGlite. **Só para teste local** |

## Testar localmente

```bash
cd supabase
npm install
npm run verificar
```

Roda as migrations num Postgres 17 real (PGlite, em WASM). Não precisa de Docker.
A RLS é testada de verdade: cada usuário roda com `set role authenticated` e o
JWT em `request.jwt.claims`, como o PostgREST faz. O CI roda o mesmo teste em
todo PR que mexe em `supabase/`.

Não é coberto aqui: Auth, Storage e pgmq **reais**. Confirme isso no projeto.

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

## Contrato para o backend (Next.js e worker)

- **Service role só no servidor.** Para operações normais do usuário, use o JWT
  dele, para a RLS continuar valendo.
- **Contexto de auditoria:** em cada transação, o backend pode declarar
  `set_config('dg.request_id' | 'dg.ip_address' | 'dg.user_agent', valor, true)`.
  Os triggers gravam isso em `audit_events`.
- **Eventos que o banco não vê** (ex.: `DOCUMENT_DOWNLOADED`):
  `select private.record_audit_event(acao, tipo, id, metadata)` com a service role.
- **Upload de documento:** gere o id da versão, monte o caminho com
  `private.legal_document_object_name(client_id, document_id, version_id, arquivo)`,
  gere a signed upload URL e insira `document_versions` com esse mesmo id.
  O banco recusa caminho fora do padrão.
- **Inserção feita por parceiro:** insira sem `RETURNING`/`.select()`. O
  documento só fica visível ao parceiro depois de vinculado ao caso
  (`case_documents`). Gere o UUID no servidor.
- **Fila:** registre `agent_runs` (status `QUEUED`) e chame
  `select private.enqueue_agent_run(id)`. A função monta o payload só com IDs.
  O worker lê com `pgmq.read('agent_execution', ...)` e arquiva com `pgmq.archive`.
- **Transações da seção 94** (aceitar caso, aprovar revisão, registrar
  pagamento) ficam no backend, numa transação só. Os invariantes, porém, o banco
  garante sozinho (próxima seção).

## O que o banco garante sozinho

Mesmo se o backend errar:

- uma única organização OWNER; papel compatível com o tipo de organização;
- CPF/CNPJ únicos, só dígitos, coerentes com PF/PJ; CNJ com dígito verificador;
- caso aceito tem advogado interno ativo; rejeição tem motivo público;
- parceiro só cria/edita caso do próprio escritório, com origem própria ou da Bárbara;
- só ADMIN altera a origem depois do aceite;
- **snapshot da parceria nasce no aceite** de caso com origem parceiro, copiando
  a divisão vigente; mudar a divisão padrão depois não altera casos antigos;
- divisões somam 100; repasse não excede a parte do parceiro;
- versões de documento, de agente, de skill, de tese e de referência são
  sequenciais e imutáveis; aprovação pertence à versão;
- revisão tem exatamente um alvo; o status vem da decisão (append-only);
- proposta de agente que exige revisão humana não é aprovada sem revisão APPROVED;
- toda mudança relevante gera `audit_events` (append-only, sem PII);
- nada apaga histórico jurídico em cascata.

## Onde a implementação difere do texto da especificação

| Especificação | Implementação | Motivo |
|---|---|---|
| `legal_cases.rejection_reason_internal` | Tabela `legal_case_internal_details` | RLS é por linha: parceiro que lê o caso leria a coluna. Separar é a única forma de garantir "nota interna nunca chega ao parceiro" |
| `private.current_role()` | `private.current_user_role()` | `current_role` é palavra reservada do SQL |
| Fila `agent-execution` | `agent_execution` | pgmq cria tabelas `q_<nome>`; hífen em nome de tabela é fonte de erro |
| `payments` sem valor pago | Coluna `paid_amount` | Sem ela, o status `PARTIAL` não tem significado verificável |
| `agent_runs.estimated_cost` | `numeric(14,6)` + moeda `USD` | Custo de API por execução é de centavos de dólar |
| Respostas de solicitação (não especificadas) | `partner_request_messages` (append-only) | O parceiro precisa responder com texto e documento (handoff do front, 13.12) |
| — | Bucket privado `imports` | `import_jobs.storage_object_name` precisa de bucket |
| — | View `document_version_approvals` | Situação de aprovação por versão, derivada e não gravada |
| Algumas tabelas mutáveis sem `updated_at` | `updated_at` adicionado | Seção 91: trigger em toda tabela mutável |

Valores de status que a especificação não lista (processo, tese, skill) seguem
o front-end. Onde especificação e front divergem (ex.: agente `INACTIVE` vs.
`PAUSED`), vale a especificação; o front se ajusta ao ligar no backend.

## Permissões (resumo da RLS)

| | ADMIN | LAWYER | ASSISTANT | PARTNER_ADMIN | PARTNER_USER |
|---|---|---|---|---|---|
| Clientes | todos | todos | todos | com relacionamento | com relacionamento |
| Casos | todos | todos, decide | todos, não decide | `partner_organization_id` = seu | idem |
| Processos | todos | todos | leitura | dos seus casos | idem |
| Documentos | todos | todos | todos | `PARTNER_VISIBLE` dos seus casos | idem |
| Prazos | todos | todos | leitura | — | — |
| Análises e revisões | sim | sim | — | — | — |
| Financeiro | completo | — | — | só a própria parceria | — |
| Agentes, Skills, Teses, Referências | sim | — | — | — | — |
| Auditoria | leitura | — | — | — | — |

Parceiro suspenso/inativo, ou usuário inativado, perde todo o acesso.
