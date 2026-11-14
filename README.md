# DG Brasil

Sistema interno da **Barbara Cardoso Advocacia**: CRM próprio + agentes de IA
executados pelo Claude Code do escritório, com a equipe e os escritórios
parceiros acessando pelo navegador.

Uma organização proprietária (OWNER), escritórios parceiros (PARTNER), cinco
papéis (ADMIN, LAWYER, ASSISTANT, PARTNER_ADMIN, PARTNER_USER). Domínio central:
**Client → LegalCase → LegalProcess**. Não é SaaS multi-tenant.

- **[ARQUITETURA.md](ARQUITETURA.md)** — as três camadas, a stack escolhida e por quê
- **[ROADMAP.md](ROADMAP.md)** — as etapas até a operação completa
- **[supabase/README.md](supabase/README.md)** — o contrato do banco (RLS, gate humano, ledger, fila, auditoria)
- **[docs/adicionar-agente.md](docs/adicionar-agente.md)** — como pôr um agente do Claude Code para trabalhar no DG Brasil
- **[docs/mcp/](docs/mcp/)** — a arquitetura com Claude Code + MCP: diagnóstico, instalação no computador do escritório, Google Drive, validação
- **[docs/deploy/](docs/deploy/)** — publicação: o [checklist do dia da virada](docs/deploy/checklist-da-virada.md), a lista do que mudar quando o DG Brasil entrar em produção (planos pagos, e-mail, domínios, variáveis, cópia de segurança, monitoramento) e o passo a passo do deploy de teste

## A ideia em um parágrafo

Os agentes do escritório (Lucas, Clara, réplica…) continuam no **Claude Code do
computador do escritório**. O DG Brasil guarda clientes, casos, documentos e uma
**fila de trabalhos**; alguém no escritório abre o Claude Code e manda processar
a fila (`/mcp__dg-brasil__trabalhos`). O Claude Code fala com o DG Brasil por um
**servidor MCP local** (`apps/executor`) com um catálogo fechado de ferramentas:
cada trabalho lê só o caso dele e **não escreve nada direto** — análise, minuta e
proposta vão para Revisões, e um advogado aprova ou rejeita. Só a aprovação
produz efeito.

## Estrutura

| Caminho | Papel |
|---|---|
| `supabase/` | **Banco:** as migrations (001–061 aplicadas no Supabase de desenvolvimento; 062–068, da revisão final, ainda não aplicadas), RLS, Storage, fila pgmq, agendador (pg_cron), as verificações do `npm run verificar` e os scripts de operação (cópia de segurança dos documentos, trava dos scripts de teste). Ver [supabase/README.md](supabase/README.md) |
| `apps/executor/` | O pacote do **computador do escritório**: servidor MCP local `dg-brasil` para o Claude Code (catálogo fechado de ferramentas) e o diagnóstico `doctor`. Ver [docs/mcp/instalacao.md](docs/mcp/instalacao.md) |
| `apps/frontend/` | **O painel** (Next.js 16, na Vercel): escritório proprietário e portal do parceiro, com o backend de domínio dentro (Server Actions), a API do computador do escritório e as rotas agendadas. Lê e grava no banco real. Ver [apps/frontend/README.md](apps/frontend/README.md) |
| `docs/` | Um documento por assunto. Publicação e operação em [docs/deploy/](docs/deploy/) |

## Como subir

### 1. Banco

Antes de tocar no Supabase, confira o schema localmente:

```bash
cd supabase
npm install
npm run verificar
```

Isso aplica as migrations num Postgres de verdade (PGlite, em WASM) e roda os
critérios de aceitação da especificação, com a RLS testada por papel. Rode isso
sempre que mexer em `supabase/`.

> **Migration aplicada nunca é reescrita.** Nenhuma das 61 aplicadas no
> Supabase de desenvolvimento pode ser editada: mudança de banco é sempre um
> arquivo novo, com o número seguinte.

Depois, crie um projeto no [Supabase](https://supabase.com) na região **São Paulo
(sa-east-1)** e aplique com `supabase db push`. Passo a passo e bootstrap da
primeira administradora em [supabase/README.md](supabase/README.md).

### 2. Front-end

```bash
cd apps/frontend
npm install
npm run dev     # http://localhost:3000
```

Login real (Supabase Auth de **desenvolvimento**, `apps/frontend/.env.local` a partir de
`.env.example`) com MFA obrigatório; as telas leem e gravam no banco desse projeto.
Detalhes em [apps/frontend/README.md](apps/frontend/README.md) e
[docs/auth.md](docs/auth.md) (primeiro ADMIN, configuração do Auth).

### 3. Computador do escritório

Os agentes rodam no Claude Code de um computador do escritório (modo assistido:
uma pessoa abre o Claude Code e manda processar a fila). Instalação, token do
computador e registro do MCP: [docs/mcp/instalacao.md](docs/mcp/instalacao.md).

```bash
cd apps/executor
npm ci && npm run build
npm test                 # MCP de verdade contra um DG Brasil de mentira
node dist/index.js doctor
```

O servidor do DG Brasil fala com o banco como `dg_worker` (`DG_WORKER_DB_URL`,
pelo pooler) e expõe `/api/executor/v1` ao computador. O que o antigo worker
fazia sem IA (aplicar propostas aprovadas, fechar execuções decididas, devolver
à fila o trabalho de um computador que parou, lembretes de prazo) roda no
próprio banco, pelo `pg_cron` (migration 040).

### 4. Disparar um agente para testar

Pela tela: "Enviar análise" no caso, ou DG Brasil → Agentes → "Executar em um
caso". Por SQL, a execução só nasce por `request_agent_run` (ADMIN ou LAWYER; o
banco revalida o papel e o acesso ao caso, cria a execução e enfileira — a
mensagem leva só IDs):

```sql
-- no SQL Editor, como o backend faria em nome de um usuário
select public.request_agent_run(
  (select id from agents where slug = '<slug do agente>'),
  '<id do caso>', null, 'Pedido em texto para o agente', '{}', 'EXECUTE',
  '<uuid do usuário ADMIN ou LAWYER>'
);
```

Acompanhe em `agent_runs` (ADMIN: status, tokens, custo) ou pela RPC
`get_agent_run_summaries` (LAWYER), `agent_proposals` e `reviews`.
Detalhes em [docs/adicionar-agente.md](docs/adicionar-agente.md).

## O contrato que não se quebra

Uma regra estrutura o sistema inteiro:

> **O agente propõe. O humano confirma. Só a confirmação aplica.**

Ela está em quatro lugares e precisa continuar nos quatro:

1. `apps/executor/src/ferramentas.ts` e `supabase/migrations/…_office_executor.sql`
   — o Claude Code tem ferramentas de leitura do caso reservado e três de
   entrega, todas presas a revisão: `propor` (ação), `entregar_minuta` (minuta
   INTERNA) e `entregar_analise`. Não existe ferramenta de apagar, aprovar,
   enviar mensagem, SQL ou shell; e o banco confere a reserva em cada chamada.
2. `supabase/migrations/…_analyses_and_reviews.sql` — o status de uma revisão só
   muda por `decide_review` (grants + trigger); proposta estrutural (agente,
   skill) só ADMIN decide.
3. `supabase/migrations/…_agents.sql` — `agent_proposals` e o trigger que
   recusa aprovar proposta sem revisão humana aprovada.
4. `supabase/migrations/…_queues.sql` — `private.worker_apply_next_proposal`, o
   único lugar que transforma proposta aprovada em linha no banco (chamado pelo
   `pg_cron`, migration 040). O servidor fala com o banco como `dg_worker`, sem
   bypass de RLS e sem SELECT em dado de cliente: só enxerga, por funções
   escopadas, o contexto do trabalho que o computador reservou.

**Uma exceção, decidida pela dona do escritório em 13/11/2026: o prazo direto**
(migration 059, [docs/judicial.md](docs/judicial.md), "Prazo direto"). O prazo
que o agente de prazos calcula a partir de uma publicação do DJEN entra na
agenda do processo sem revisão humana. É a única proposta que se aplica
sozinha, e só quando:

- o trabalho nasceu daquela publicação (o banco confere o vínculo, não o texto
  do pedido) e a data é um dos dias úteis que o próprio banco calculou;
- a opção "Prazo entra direto na agenda" está ligada em DG Brasil →
  Integrações (desligada, volta a valer a regra geral).

"Sem prazo", minutas, análises e todas as outras propostas continuam presas à
revisão. Não crie outra exceção sem decisão expressa da dona, registrada aqui.

**O que o prazo lançado dispara, também por decisão da dona do escritório em
13/11/2026** (migration 061, [docs/judicial.md](docs/judicial.md)): quando o
prazo do agente de prazos entra na agenda, o sistema escreve sozinho uma tarefa
na lista do processo (por exemplo, "Preparar a réplica") e chama o orquestrador,
sem clique humano. Isso encadeia **trabalho de agente**; não aplica nada. A
minuta que o agente chamado produzir continua parando em Revisões, e só a
aprovação de um advogado produz efeito. Desliga-se em DG Brasil → Integrações.

**"Corrigir e aprovar" é uma decisão humana** (migration 069): quem decide a
revisão muda os dados da proposta e aprova a versão corrigida no mesmo ato; o
banco guarda o que o agente propôs, e o aplicador continua aplicando só
proposta aprovada. **"Pedir para o agente refazer" nunca aplica nada sozinho**
(migration 070): a revisão é encerrada como rejeitada, o agente recebe um
trabalho novo com o recado, e o que ele refizer volta para Revisões (inclusive
o prazo, que no refazer não entra direto na agenda).

Se alguém der ao agente uma ferramenta que escreve direto, o sistema continua
funcionando e a garantia some sem aviso. É o tipo de mudança que merece
conversa, não commit.

## Estado atual

Em 13/11/2026, na revisão final antes da produção. O sistema roda em teste, em
`app.dgbrasil.adv.br` e `portal.dgbrasil.adv.br`, ligado ao Supabase de
**desenvolvimento**, só com dados fictícios. A produção (projeto Supabase novo)
ainda não existe: o que falta está em
[docs/deploy/checklist-da-virada.md](docs/deploy/checklist-da-virada.md).

| Componente | Situação |
|---|---|
| Banco (`supabase/`) | **61 migrations aplicadas no Supabase de desenvolvimento** (001–061), idênticas aos arquivos. As da revisão final (062–068) estão no repositório e **ainda não foram aplicadas em nenhum Supabase**. Nenhuma migration aplicada pode ser reescrita. `npm run verificar` aplica todas do zero e confere as regras (951 verificações até a 061; cada migration nova acrescenta as suas, e o total aparece no fim do comando) |
| Painel (`apps/frontend`) | Identidade real (convite, senha, **MFA obrigatório**, termos com texto **provisório**) e telas ligadas ao banco real: clientes, casos, processos e prazos, documentos, revisões, financeiro, parceiros, publicações, DG Brasil, importações, notificações. Validado no DEV por etapa ([docs/qa/](docs/qa/)). As ferramentas de demonstração só aparecem com `NEXT_PUBLIC_DEMO_MODE=true` |
| Backend de domínio | Server Actions → services → repositories, com o JWT do usuário e a RLS como segunda barreira. Ver [docs/backend.md](docs/backend.md) |
| Auth | Supabase Auth: convite, senha (8+), MFA TOTP (a RLS exige `aal2`), sessões, gestão de equipe, redefinição de MFA pelo ADMIN. Ver [docs/auth.md](docs/auth.md) |
| Agentes pelo computador do escritório (040 em diante) | Claude Code do escritório + conector MCP (`apps/executor`, versão 1.3.4) + API `/api/executor/v1`. Sessão "Vigia" processa a fila sozinha enquanto aberta, e na hora com "Verificar agora" (052). **Ponte** com os agentes da máquina aprovada no DEV com ressalvas (11/11/2026) e **clones `-dg`** da esteira bancária validados no DEV (12/11/2026): [docs/ponte.md](docs/ponte.md), [docs/qa/ponte/](docs/qa/ponte/), [docs/qa/clones/](docs/qa/clones/). Falta a validação na produção |
| O que entra na fila sem alguém pedir | Existe, sempre por regra do banco: publicação nova do DJEN vira trabalho do agente de prazos (058); análise aprovada chama os próximos agentes do caso (056); prazo lançado vira tarefa do processo para o orquestrador (061). Não há agendador genérico de agentes por horário |
| Integração judicial (043 em diante) | DJEN (publicações por OAB) e DataJud (andamentos por CNJ), só para processos cadastrados. Validada no DEV ([docs/qa/etapa-8/](docs/qa/etapa-8/)). Prazo direto (059) e prazo que vira tarefa (061) aplicados no DEV; falta ver o prazo direto ao vivo. Ver [docs/judicial.md](docs/judicial.md) |
| Importação de planilhas (042) | CSV/XLSX: mapeamento, simulação sem gravar, conflitos, confirmação, gravação em lotes e relatório por linha. Só ADMIN. Validada no DEV em 2026-11-03 ([docs/importacao.md](docs/importacao.md)) |
| Google Drive (041) | Pasta do cliente pelo ID, importação sem duplicata, exportação do aprovado, pelo servidor. **Falta validar com a credencial do Google** ([docs/mcp/google-drive.md](docs/mcp/google-drive.md)) |
| Consulta de CPF na Receita (Serpro) | No código; liga só na produção, com contrato do escritório ([docs/deploy/producao.md](docs/deploy/producao.md), item 12) |
| Operação (revisão final) | Página de erro e de endereço inexistente, `/api/health`, aviso de erros por webhook, conferência das variáveis na subida, vigia diária no banco (065), cópia de segurança dos documentos (testada só com Storage simulado). Ver [docs/deploy/producao.md](docs/deploy/producao.md), itens 15 a 18 |
| Domínio consignado (HISCON, benefício, esteira como código), WhatsApp, leads | Fora do MVP. A análise do HISCON continua com o agente e a skill do escritório ([docs/futuro/dominio-consignado.md](docs/futuro/dominio-consignado.md)) |

O schema legado em português (`db/`, com auth própria, fila artesanal e papéis
antigos) existiu antes do banco V1 e foi removido; está só no histórico do Git.
Não reintroduza nada dele.
