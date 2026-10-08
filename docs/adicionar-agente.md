# Como adicionar um agente

Três níveis, com custos bem diferentes. Antes de começar, descubra em qual você
está: **o agente novo precisa de alguma informação ou de algum efeito que os
agentes atuais ainda não têm?**

---

## Nível 1 — Só cadastro (minutos, sem deploy)

O agente usa ferramentas que já existem e propõe tipos que já existem. É o caso
da grande maioria. Pela Central DG Brasil, ou em SQL:

```sql
with a as (
  insert into agents (slug, name, description, status)
  values ('conferencia-hiscon', 'Conferência do HISCON',
          'Confere o extrato e pede o que faltar.', 'ACTIVE')
  returning id
), v as (
  insert into agent_versions (agent_id, instructions, configuration)
  select id,
         'Você confere o extrato HISCON do caso. Se faltar documento, peça com REQUEST_DOCUMENT.',
         '{"model":"claude-opus-5-5","tools":["ver_caso","baixar_documento"],"max_turns":30}'
  from a
  returning id, agent_id
)
update agents set current_version_id = v.id from v where agents.id = v.agent_id;
```

O worker que já está rodando atende o agente novo na próxima execução, sem
redeploy. Alterar instruções ou configuração = **nova versão** em
`agent_versions` (as anteriores ficam no histórico).

**`configuration`** (validada pelo worker; se inválida, a execução falha com `INVALID_CONFIGURATION`):

| Campo | O que decidir |
|---|---|
| `model` | Padrão `claude-opus-5-5` |
| `tools` | Allowlist das ferramentas de **leitura**: `buscar_cliente`, `ver_caso`, `ver_processo`, `baixar_documento`, `teses_do_agente`, `referencias_do_agente`. Vazia = todas. Prefira o mínimo. `propor` e `entregar_documento` entram sempre |
| `max_turns` | Padrão 40 |
| `max_budget_usd` | Teto por execução. Sem valor, vale `TETO_USD` do ambiente |
| `effort` | `low` a `max`. Padrão `high` |

Skills vinculadas (`agent_skill_bindings`) entram no system prompt. Teses e
referências vinculadas ficam disponíveis pelas ferramentas `teses_do_agente` e
`referencias_do_agente`.

`status = 'INACTIVE'` desliga o agente sem apagar o histórico.

### O que o agente pode propor

| Tipo | Efeito depois da aprovação |
|---|---|
| `CREATE_DEADLINE` | Cria prazo no caso (origem `AGENT`) |
| `REQUEST_DOCUMENT` | Cria pendência de documento; em caso de parceiro, também uma solicitação ao parceiro |
| `UPDATE_CASE` | Título, resumo ou status de triagem. Nunca aceita, rejeita ou encerra caso |
| `CREATE_PROCESS` | Cria processo em preparação no caso |
| `UPDATE_SKILL` / `UPDATE_AGENT` | Cria versão nova e a torna corrente. **Só ADMIN aprova** (configuração estrutural) |
| `OTHER` | Nenhum efeito automático: aprovado, vira providência da equipe |

Não existe `CREATE_DOCUMENT`: minuta é entregue com `entregar_documento`.
A mesma proposta repetida na mesma execução não vira duas (`idempotency_key`).

Minuta de peça não é proposta: o agente usa `entregar_documento`, que cria uma
versão INTERNA do documento no caso, com revisão pendente.

---

## Nível 2 — Roteiro longo em arquivo (uma hora, com deploy)

Skills cadastradas no DG Brasil já cobrem a maioria dos roteiros. Se precisar de
skill em arquivo (com anexos, modelos), ela vai em
`agentes-claude/.claude/skills/<nome>/SKILL.md` e o worker a carrega via
`settingSources: ['project']`. Arquivo novo exige redeploy do worker.

---

## Nível 3 — Agente que precisa de algo novo (é código, com revisão)

**a) Ele precisa LER algo que nenhuma ferramenta expõe.**
→ Nova ferramenta de leitura em [`apps/agentes/src/ferramentas.ts`](../apps/agentes/src/ferramentas.ts),
com `annotations: { readOnlyHint: true }` e o nome em `FERRAMENTAS_LEITURA`. Se
ela lê dado de cliente, a leitura é uma função `private.worker_*` nova (migration
`020+`) que recebe a execução, confere a reserva e deriva o caso dela — o
`dg_worker` não tem SELECT em tabela de domínio, de propósito.

**b) Ele precisa PRODUZIR um efeito que ainda não existe.**
→ Novo tipo em `agent_proposals.proposal_type` (migration `020+`), o schema do
payload em [`propostas.ts`](../apps/agentes/src/propostas.ts) e o ramo do
aplicador em `private.apply_proposal_effect` (no banco, na mesma migration).
Tipo sem aplicador não entra no CHECK.
Se o efeito altera configuração do DG Brasil, confira que
`private.proposal_requires_admin` o cobre.

O aplicador é a parte séria: é ele que transforma proposta aprovada em fato.
Ele roda numa transação e, se não puder cumprir, **falha alto**: a proposta fica
`FAILED` com o erro em `application_error`, visível na tela. Proposta que "não
deu erro" e também não produziu efeito é o pior resultado possível.

Nenhuma ferramenta pode escrever direto no que tem efeito. Toda escrita passa
por revisão humana.

---

## Quanto custa ter muitos agentes

Agente parado **não custa nada**: é uma linha numa tabela. O custo é por
execução (tokens da Anthropic), com teto por execução.

Crescer é subir mais um worker. O gargalo prático é a fila de Revisões:
**quanto a equipe consegue revisar por dia**. Um agente que produz propostas que
ninguém revisa não está ajudando.

---

## Como uma execução começa

Só por `public.request_agent_run` (ADMIN ou LAWYER; LAWYER só com caso). O banco
revalida papel e acesso, cria `agent_runs` com `requested_by`, guarda o pedido em
texto em `agent_run_inputs` (nunca em `metadata`) e enfileira. Ninguém insere em
`agent_runs` direto.

## Ainda não existe: o disparador automático

Agendamento por horário e por evento (ex.: "todo dia útil às 9h") ainda não
existe: é um despachante pequeno, previsto para o deploy do worker, que também
chamará `request_agent_run` em nome de um usuário responsável.
