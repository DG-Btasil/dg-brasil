# Etapa 4.3.1 — Guia de validação (correções do QA 4.3 + restauração de funcionalidades)

Valida de uma vez: as correções do QA da 4.3 (BUG-01 a 06) e as nove
funcionalidades da 4.3.1. Tudo no **Supabase DEV**, com dados **fictícios**
(`@dgbrasil.test`, CPF `999…`). Nunca em produção.

Commits (em `master`): `56a76b8` (correções do QA + migration 032),
`00723eb` (D, 033), `b4666ae` (C, 034), `8a442f0` (E/F/G, 035),
`b316af4` (H/I, 036), `503b29c` (A/B, 037), `cec9dcb` (conferência de
catálogo), `c8cad03` (validar:real), mais o commit desta documentação.

> **Deixe o worker de agentes PARADO** (`apps/agentes`) durante toda a
> validação. Nada nesta etapa executa IA.

---

## 1. Atualizar o código

```bash
git pull origin master
cd supabase && npm install
cd ../apps/frontend && npm install
cd ../agentes && npm install
```

## 2. Verificações locais (sem banco real)

```bash
cd supabase
npm run verificar            # esperado: "579 verificações, todas passaram."

cd ../apps/frontend
npm run lint                 # sem erros
npm run typecheck            # gera os tipos de rota e roda o tsc: limpo
npm test                     # 38 arquivos, 422 testes
npm run build                # termina sem erro

cd ../agentes
npm test                     # 34 testes (worker contra as migrations reais, no PGlite)
```

## 3. Migrations no Supabase DEV

```bash
cd supabase
npx supabase migration list      # 032 a 037 só em "Local"
npx supabase db push             # aplica as seis, em ordem
npx supabase migration list      # agora também em "Remote"
```

| Migration | O que faz |
|---|---|
| `20261021000032_partner_rls_hot_paths` | QA BUG-06: RLS do portal calculada uma vez por consulta (mesmo acesso) |
| `20261022000033_agent_run_cancellation` | Interromper análise/execução + sincronia análise ← execução |
| `20261023000034_review_manual_revision` | Edição manual na revisão = versão N+1 + revisão nova |
| `20261024000035_finance_schedule_and_views` | Cronograma de parcelas; valores da parceria; contratado por modelo |
| `20261025000036_partner_timeline_and_client_counts` | Histórico do caso no portal; contagens por cliente |
| `20261026000037_notification_producer` | Produtor de notificações; preferências por categoria |

Nenhuma migration antiga foi alterada. Se o `db push` falhar, **pare** e me
mande a saída inteira.

## 4. Validação real

```bash
cd supabase
npm run validar:real
```

Novidades: §41b (interromper execução com o pgmq real), §41c (produtor de
notificações pelo PostgREST), §42 (carteira do parceiro em menos de 2 s, com
o DEV cheio) e §43 (limpeza: execuções de agente de teste canceladas).

## 5. Testes de integração

```bash
cd apps/frontend
npm run test:integration     # esperado: 25 arquivos, 192 casos
```

Novos nesta etapa: `frontend-431-interrupt`, `frontend-431-review-edit`
(Storage real), `frontend-431-finance`, `frontend-431-portal`,
`frontend-431-notifications`; e `frontend-clients` (diretório paginado).

## 6. Preparação para o QA manual

1. Usuários: `cd supabase`, `$env:QA_SENHA = '…'`, `npm run usuarios:qa`
   (o ADMIN é o seu).
2. Agente e modelo fictícios: o SQL do §6.2 de
   [`etapa-4.3-validacao.md`](etapa-4.3-validacao.md) (já corrigido: agora
   cria a versão atual; a conferência mostra `tem_versao`).
3. Para a edição manual (C), a revisão precisa ser de uma **minuta de texto**.
   Sem agente rodando: envie um arquivo `minuta.txt` (texto fictício) pela
   tela, em Caso → Documentos; depois crie a revisão dessa versão:

```sql
-- Revisão PENDING para a versão mais recente de "minuta.txt" (fictícia).
insert into public.reviews (legal_case_id, document_version_id, priority)
select cd.legal_case_id, v.id, 'NORMAL'
from public.document_versions v
join public.case_documents cd on cd.document_id = v.document_id
where v.original_filename = 'minuta.txt'
order by v.created_at desc
limit 1;
```

4. Execução "rodando" (para ver "Interrupção solicitada"), depois de enviar
   uma análise ao agente fictício:

```sql
update public.agent_runs
set status = 'RUNNING', claimed_by = 'qa-manual', claimed_at = now(), started_at = now(), heartbeat_at = now()
where id = '<id da execução na fila>';
```

## 7. QA manual

Checklist em [`docs/frontend-integration.md`](frontend-integration.md):

- **"Situação do QA manual"**: o que já passou está marcado `[x]`.
- Itens **Retestar** (falharam no QA 4.3 e foram corrigidos): F-02, F-03,
  F-04 (estorno), F-05, F-08, T-05 (contrato/recebimento), A-08, B-06, H-05.
- **"QA manual — 4.3.1"**: notificações, preferências, edição manual,
  interromper análise, cronograma, valores da parceria, contratado por
  modelo, histórico e contagens do portal, e os retestes.

## 8. Depois do QA

```sql
-- Nenhuma execução fictícia na fila.
update public.agent_runs set status = 'CANCELLED'
where status in ('QUEUED') and agent_id in (select id from public.agents where slug in ('qa-analise-43') or slug like 'teste-r%');
update public.agents set status = 'INACTIVE' where slug = 'qa-analise-43';
update public.analysis_templates set active = false where name = 'QA 4.3 — com agente';
```

## 9. O que me mandar

1. Última linha do `verificar`, resumo do `npm test`, `build` e testes do worker.
2. `migration list` antes e depois do `db push` (ou o erro inteiro).
3. Resumo do `validar:real` (inclusive o tempo medido no §42).
4. Resumo do `test:integration` (e a saída completa de qualquer falha).
5. Itens do QA que falharam (papel, o que fez, o que viu).
