# Como adicionar um agente

Três níveis, com custos bem diferentes. Antes de começar, descubra em qual você
está: **o agente novo precisa de alguma informação ou de algum efeito que os
agentes atuais ainda não têm?**

---

## Nível 1 — Só um INSERT (minutos, sem deploy)

O agente usa ferramentas que já existem e propõe coisas que já existem.
É o caso da grande maioria.

```sql
insert into agente (slug, nome, descricao, modelo, politica_aprovacao,
                    ferramentas, gatilho, prompt_sistema)
values (
  'aniversarios',
  'Felicitações de aniversário',
  'Monta a mensagem de aniversário dos clientes do dia.',
  'claude-opus-5',
  'humana',
  array['buscar_contato'],        -- allowlist. `propor` entra sempre, por padrão
  '{"cron":"0 8 * * *"}'::jsonb,
  'Você prepara felicitações de aniversário para clientes do escritório.
   Tom respeitoso, sem juridiquês e sem mencionar processo ou valor.
   Proponha uma mensagem por cliente — nenhuma é enviada sem aprovação.'
);
```

Pronto. O worker que já está rodando atende o agente novo na próxima volta da
fila, sem redeploy e sem migração. *(Há um teste em `db/verificar.mjs` que
garante essa propriedade.)*

**Campos que merecem atenção:**

| Campo | O que decidir |
|---|---|
| `ferramentas` | Allowlist estrita. Vazio = todas liberadas. Prefira o mínimo: é a única contenção real do agente |
| `politica_aprovacao` | `humana` salvo prova em contrário. `auto` só para o que é reversível |
| `limite_auto` | Com `humana_se`: aprova sozinho abaixo desse valor, pede humano acima |
| `gatilho` | `{"cron":"..."}`, `{"evento":"..."}` ou `{}` para disparo manual |
| `ativo` | `false` desliga o agente sem apagar o histórico dele |

---

## Nível 2 — Agente com roteiro longo (uma hora, com deploy)

Quando as instruções não cabem num parágrafo — uma peça, um protocolo com
etapas — o roteiro vira uma **skill** versionada, e `prompt_sistema` fica só com
o contrato curto (papel, limites, política).

```
agentes-claude/.claude/skills/felicitacao-cliente/SKILL.md
```

O worker carrega isso do `cwd` via `settingSources: ['project']`. Funciona igual
ao que já roda na sua máquina — as skills do escritório são copiadas para lá sem
alteração.

**Limitação de hoje:** esses arquivos viajam junto com o worker, então skill nova
exige redeploy. Se isso incomodar, o conserto é pequeno — o worker puxar
`agentes-claude/` de um bucket ou do Git na inicialização. Vale fazer quando
começar a doer, não antes.

---

## Nível 3 — Agente que precisa de algo novo (é código, com revisão)

Dois casos, e só dois:

**a) Ele precisa LER algo que nenhuma ferramenta expõe.**
Exemplo: um agente financeiro que precisa ver inadimplência.
→ Nova ferramenta de leitura em [`apps/agentes/src/ferramentas.ts`](../apps/agentes/src/ferramentas.ts).
Marque `annotations: { readOnlyHint: true }` e acrescente o nome em
`ferramentasMcp()` no executor.

**b) Ele precisa PRODUZIR um efeito que ainda não existe.**
Exemplo: agendar audiência na agenda do escritório.
→ Novo tipo em `TipoProposta` ([`tipos.ts`](../apps/agentes/src/tipos.ts)), no
`z.enum` da ferramenta `propor`, e um aplicador em
[`aplicar.ts`](../apps/agentes/src/aplicar.ts).

O aplicador é a parte séria: é ele que transforma proposta aprovada em fato.
Escreva-o transacional e faça-o **falhar alto** se não puder cumprir — como faz
hoje o `enviar_mensagem`. Proposta que "não deu erro" e também não produziu
efeito é o pior resultado possível: o escritório acha que a coisa aconteceu.

---

## Quanto custa ter muitos agentes

Agente parado **não custa nada** — é uma linha numa tabela. O custo é por
execução: tokens da Anthropic, com teto por execução em `TETO_USD`.

Quanto à capacidade: a fila usa `FOR UPDATE SKIP LOCKED`, então crescer é subir
mais um worker. Não há nada no desenho que limite o número de agentes; o
gargalo prático vai ser a fila de aprovação — **quanto a equipe consegue
revisar por dia**. Vale lembrar disso antes de cadastrar o décimo agente: um
agente que produz propostas que ninguém revisa não está ajudando.

---

## Ainda não existe: o disparador automático

O campo `gatilho` é lido e guardado, mas **nada ainda o executa**. Hoje, uma
execução só entra na fila por `insert` manual.

Para os `{"cron": "..."}` do seed valerem de verdade, falta um despachante —
um processo que lê os gatilhos e cria as execuções na hora certa. É trabalho
pequeno (a tabela e a fila já existem) e está previsto para a fase 2, junto com
o deploy do worker.
