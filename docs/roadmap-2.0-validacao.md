# Validação: Roadmap 2.0 — fechamento do MVP

**Para o agente validador na outra máquina.** Siga na ordem, sem pular parte, e
devolva o relatório no formato da última seção. O plano e as decisões estão em
[roadmap-2.0.md](roadmap-2.0.md).

- **Escopo:** migrations **045 a 049**, o código dos blocos 1 a 8 (commits
  `97415ee` até o último "roadmap-2.0"), o instalador do computador do
  escritório (`/executor/instalar.ps1`) e as telas.
- **Regras:**
  - Só o **Supabase DEV** (`DG_ENV=development`) e só dados fictícios.
  - Não digite a senha da Barbara. Telas pelo Playwright, como antes: ela faz o
    login (ADMIN, com MFA) e você navega.
  - Não mexa em dados que não foram criados por esta validação.
  - **Atenção (045):** a migration apaga duas colunas — `clients.responsible_user_id`
    e `individual_client_details.stable_union` — e troca status/fases antigos do
    processo (WAITING_* → ACTIVE, CLOSED → ARCHIVED, PLEADINGS/EVIDENCE/JUDGMENT →
    PROCEEDINGS). No DEV os dados são fictícios; anote no relatório quantas linhas
    mudaram (Parte 1).

---

## Skills do projeto: use em cada parte

O repositório traz skills em `.claude/skills/` (cópia do ECC, licença MIT). O
Claude Code as carrega sozinho ao abrir o projeto: chame pelo nome (ex.:
`/ecc-browser-qa`) ou peça "use a skill ecc-browser-qa". Em cada parte abaixo,
**carregue a skill indicada antes de começar** e siga o método dela, sem trocar
o que este guia manda verificar.

| Parte | Skill | Para quê |
|---|---|---|
| 1 — Migrations no DEV | `ecc-database-migrations` | Conferir o push com segurança: dry-run, o que cada migration apaga ou converte, e o que fazer se falhar no meio |
| 1 — Migrations no DEV | `ecc-postgres-patterns` | Revisar RLS, índices e as funções novas (`get_dashboard_metrics`, visões do financeiro) |
| 2 — Testes automáticos | `ecc-verification-loop` | Rodar build, tipos, lint, testes e revisão do diff, com o veredito PASS/FAIL por fase |
| 3 — Telas | `ecc-browser-qa` | Navegar pelo Playwright (a Barbara faz o login), erros no console, telas em 3 larguras e acessibilidade |
| 3 — Telas | `ecc-e2e-testing` | Organizar os roteiros das telas (passos, prints, telas que falham de vez em quando) |
| 3 — Segurança | `ecc-security-review` | Conferir convites e primeiro acesso do parceiro, OABs, consultas de CEP/CNPJ, instalador público `/executor/` e o que o parceiro consegue ver |
| Relatório | `ecc-production-audit` | Fechar com "o que quebra em produção?" e listar o que falta antes de dado real |

`ecc-nextjs-turbopack`, `ecc-react-patterns` e `ecc-typescript-patterns` são de
apoio: use só se precisar entender o código de um achado. Não corrija código
de produção nesta validação; registre o achado.

## Parte 0: Preparar

1. `git pull`; o último commit tem "roadmap-2.0" na mensagem.
2. Caminho do repositório **sem acento**; Node 24; Supabase CLI logada no DEV;
   `supabase/.env.real` e `apps/frontend/.env.local` como antes.
3. **Nenhuma variável nova é obrigatória.** A consulta de CPF na Receita (Serpro)
   é atualização futura (produção, `docs/deploy/producao.md` item 12): **não**
   configure `SERPRO_CPF_*` nesta validação.

## Parte 1: Migrations 045–049 no DEV

Antes do push, guarde as contagens (para o relatório):

```sql
select status, count(*) from legal_processes group by status order by 1;
select phase, count(*) from legal_processes group by phase order by 1;
select count(*) filter (where responsible_user_id is not null) com_responsavel from clients;
```

```bash
cd supabase
npx supabase db push --remote --dry-run   # deve listar SÓ 045, 046, 047, 048 e 049
npx supabase db push --remote
```

- [ ] **Push sem erro.**
- [ ] **Status e fases traduzidos** (nenhum valor antigo sobrou):
  ```sql
  select count(*) from legal_processes
   where status in ('WAITING_CLIENT','WAITING_DEADLINE','CLOSED') or phase in ('PLEADINGS','EVIDENCE','JUDGMENT');  -- 0
  ```
- [ ] **Colunas removidas** (0 linhas):
  ```sql
  select table_name, column_name from information_schema.columns
   where (table_name = 'clients' and column_name = 'responsible_user_id')
      or (table_name = 'individual_client_details' and column_name = 'stable_union');
  ```
- [ ] **Contratos ligados a processo:** rascunhos/ativos de casos com um único
  processo ganharam `legal_process_id`; os demais ficam como "contrato do caso":
  ```sql
  select status, count(*) filter (where legal_process_id is null) sem_processo, count(*) total
    from financial_agreements group by status;
  ```
- [ ] **Objetos novos existem:** `process_expenses`, `process_finance_overview`,
  `process_finance_totals`, `process_tasks`, `process_task_settings`,
  `profile_oabs`, funções `get_dashboard_metrics`, `get_process_status_counts`,
  `create_process_task`, `create_partner_invite_office`, `complete_partner_office_profile`.

## Parte 2: Testes automáticos

```bash
cd supabase && npm run verificar              # esperado: 833 verificações, todas passaram
cd supabase && npm run validar:real           # contra o DEV (o teste de ledger agora usa o processo do caso)
cd apps/frontend && npm run typecheck && npm run lint && npm test   # esperado: 598 testes
cd apps/frontend && npm run test:integration  # contra o DEV
cd apps/executor && npm test                  # 13 testes
```

- [ ] `verificar` 833/833. Seções novas: "[045]" cadastros, "[046]" financeiro por
  processo, "[047]" tarefas, "[048]" OABs/convites/parceiro, "[049]" indicadores.
- [ ] `validar:real` sem falha.
- [ ] Unitários 598/598; lint sem erro; typecheck limpo.
- [ ] Integração: os testes de financeiro foram ajustados para criar o contrato
  num processo (`processForCase`). Anote qualquer falha com o nome do teste e a
  mensagem — **não corrija código de produção**, só registre.
- [ ] **PostgREST (o PGlite não cobre):** as leituras novas usam embeds
  `legal_processes!financial_agreements_process_fkey`,
  `legal_processes!process_expenses_process_fkey` e
  `legal_cases!legal_processes_legal_case_id_fkey`. Abrir `/financeiro?aba=processos`
  e `/financeiro?aba=despesas` sem erro confirma.

## Parte 3: Telas (Playwright, logado como ADMIN)

Para cada item: print em `docs/qa/roadmap-2.0/` e OK/FALHA.

**Bloco 1 — correções e velocidade**
- [ ] `/login`: o "olhinho" mostra e esconde a senha (também em nova senha e primeiro acesso).
- [ ] Clicar em cada indicador da Início abre a tela **na hora** (esqueleto de carregamento) e já filtrada: "Casos ativos" → `/casos?situacao=ativos`; "aguardando" → `?situacao=aguardando`.
- [ ] Ficha de cliente → Documentos: a área ocupa a tela, cresce com a lista e tem alça de redimensionar; o menu "Mais" abre inteiro por cima (não fica cortado).
- [ ] Novo cliente PF: com tipo/emissor/UF preenchidos e **sem número** do documento, salva sem erro.
- [ ] Prazos do processo: rótulo "Data do prazo" (não "Vencimento").
- [ ] Novo caso (escritório e portal): **não** existe o campo "Tipo".

**Bloco 2 — cadastros**
- [ ] Novo cliente PF exige nacionalidade, estado civil, profissão, e-mail, CEP e endereço completo; **não** tem "Responsável" nem "União estável".
- [ ] PJ: sem situação cadastral, CNAEs e site; e-mail e endereço obrigatórios.
- [ ] Bloco "De onde o cliente veio": escritório de origem + canal (lista) + detalhe. Lista de clientes filtra por **Canal** e mostra a coluna Canal.
- [ ] Ficha do caso: "Canal (como o cliente chegou)" e "Escritório de origem" separados; caso novo sem canal herda o do cliente.
- [ ] Novo processo: sem "Nome resumido" e sem a seção de vencimento; tem "Honorários (R$)" e "Honorários de êxito (%)" ao lado do valor da causa. O processo aparece com o nome do caso.
- [ ] Status de condução e fases com os nomes novos (Com sentença, Recurso, Trânsito em julgado, Execução, Recebido, Arquivado; Processual, Recursal, Cumprimento de sentença...).
- [ ] Iniciar análise: passo "Dados específicos" tem a caixa **"Informações adicionais para os agentes"**; depois de enviar, o texto aparece no detalhe da análise.

**Bloco 3 — financeiro por processo**
- [ ] `/financeiro`: abas Visão geral, Por processo, Contratos, Despesas, Modelos de honorários. Visão geral com os indicadores novos (valor total das ações, honorários escritório/parceiro, recebido, em aberto, despesas, resultado).
- [ ] Processo → aba Financeiro: cartões do processo, contratos do processo, "Nova despesa", "Marcar como paga", "Cancelar" (pede motivo).
- [ ] Novo contrato a partir do processo (`/financeiro/contratos/novo?processo=…`) grava ligado a ele; um segundo contrato ATIVO no mesmo processo é recusado com mensagem clara.
- [ ] Configurações **não** tem mais "Honorários"; `/configuracoes?secao=honorarios` leva ao Financeiro → Modelos.

**Bloco 4 — tarefas para os agentes**
- [ ] DG Brasil → Conexões, cartão "Agentes e orquestrador": escolher um agente de
  teste como **orquestrador** (sem escolha, vale o agente ativo de identificador
  `orquestrador`, se existir).
- [ ] Processo → aba "Tarefas para os agentes" → Nova tarefa → "Criar e enviar": fica "Na fila do orquestrador"; aparece na aba Movimentações (só para a equipe).
- [ ] No banco, simular a execução (como `postgres`): `update agent_runs set status='RUNNING', started_at=now(), claimed_by='qa', claimed_at=now() where id = '<agent_run_id da tarefa>';` → tela mostra "Agente trabalhando"; `... set status='WAITING_HUMAN'` → "Para revisar" com o botão **Concluir**.
- [ ] Concluir com nota → tarefa riscada como "Concluída" e movimentação "Tarefa concluída".
- [ ] "Devolver ao agente" com observação cria nova execução (2ª tentativa); "Cancelar" pede motivo.
- [ ] (Se o computador do escritório estiver disponível) `/mcp__dg-brasil__trabalhos` lista a tarefa como "tarefa do processo".

**Bloco 5 — parceiros, equipe e OABs**
- [ ] Configurações → Conta e portal → Minha Conta: painel **Minhas OABs** (adicionar duas seccionais, tornar principal, remover).
- [ ] Equipe → Convidar: papel Advogado exige OAB; Administrador tem "É advogado(a)" e OAB opcional.
- [ ] Parceiros → **Convidar parceiro** (nome do contato + e-mail + %): cria escritório "Convite: …" pendente e envia o e-mail. Abrir o link num navegador anônimo: o primeiro acesso pede, além de nome e senha, **OAB** e **dados do escritório** (nome, razão social, CNPJ ou CPF, telefone). Depois: termos → MFA → Início do portal. Conferir no banco `partner_office_settings.profile_completed_at` preenchido e `profile_oabs` com a OAB.
- [ ] Portal → Documentos e Pendências → abrir uma solicitação → **Anexar documento** (envio padrão) → a mensagem aparece com "Documento anexado" e o documento está no caso.
- [ ] Configurações → Geral → Atuação: sem "Unidades".

**Bloco 6 — preenchimento automático**
- [ ] Novo cliente: digitar o CEP `01001-000` → logradouro, bairro, município e UF preenchidos; foco vai para o número.
- [ ] Novo cliente PJ: CNPJ `00.000.000/0001-91` → razão social, nome fantasia, telefone e sede preenchidos.
- [ ] CPF: **nada** é consultado nem aparece aviso (atualização futura, produção).
- [ ] Portal → Novo caso → cliente novo: os mesmos preenchimentos funcionam.

**Bloco 7 — Central DG Brasil**
- [ ] Menu DG Brasil abre em **Conexões**: cartões do computador do escritório, esteira, agentes/orquestrador, DJEN, DataJud e Google Drive, com a situação de cada um.
- [ ] Abas novas "Computador do escritório" e "Integrações" (as mesmas telas que eram de Configurações). Configurações não tem mais essas seções; `?secao=ia` e `?secao=integracoes` levam para a DG Brasil.
- [ ] Autorizar computador → o diálogo mostra **um comando** do PowerShell e o token para colar.
- [ ] `https://app.dgbrasil.adv.br/executor/instalar.ps1` e `/executor/dg-executor.mjs` abrem **sem login**.
- [ ] (Opcional, num Windows de teste) rodar o comando: o instalador confere Node/Claude, pede o token, grava `%APPDATA%\DGBrasil\executor.json`, cria `C:\DGBrasil\sessao` e roda o diagnóstico com tudo OK.

**Bloco 8 — números e gráficos**
- [ ] Início: abaixo da distribuição dos processos, o gráfico "Entradas nos últimos 30 dias"; a distribuição mostra os status novos, cada um com sua cor; seção "O escritório em números" com filtro de período.
- [ ] Clientes, Casos, Processos e Parceiros: bloco "Indicadores" com filtro (7/30/90 dias, 12 meses, desde o início) — trocar o filtro atualiza os números.
- [ ] Portal do parceiro (logar como PARTNER_ADMIN de teste): Início com "Seu escritório em números"; Financeiro com "Participação no período" (barras horizontais). Os números são só do escritório do parceiro.

## Parte 4 (opcional, com uma pessoa no computador do escritório): orquestrador ponta a ponta

Só se a Barbara estiver no computador do escritório. Senão, marque "não feito".

1. Copiar `docs/mcp/pilotos/agentes/orquestrador.md` para
   `%USERPROFILE%\.claudegents\orquestrador.md` e conferir a tabela de agentes
   locais dentro dele.
2. No DG Brasil → Agentes → Novo agente: nome "Orquestrador", identificador
   `orquestrador`, agente local `orquestrador`, ativo.
3. DG Brasil → Conexões: o cartão "Agentes e orquestrador" mostra o Orquestrador
   (sozinho, sem escolher) e o computador do escritório "Conectado".
4. Processo de teste → Tarefas para os agentes → "Redigir uma procuração para o
   cliente" → Criar e enviar.
5. No computador: `cd C:\DGBrasil\sessao`, `claude`, `/mcp__dg-brasil__trabalhos`.
   A lista mostra "tarefa do processo"; o orquestrador responde
   `AGENTE: lucas …` e a sessão chama o Lucas.
6. A entrega aparece em Revisões; a tarefa fica "Para revisar"; concluir dá o check.

## Relatório

Crie `docs/qa/roadmap-2.0/qa-roadmap-2.0.md` com:

1. Resumo: APROVADO / APROVADO COM PENDÊNCIAS / REPROVADO, e quais skills foram
   usadas em cada parte (com o veredito do `ecc-verification-loop` e do
   `ecc-browser-qa`).
2. Contagens da Parte 1 (antes e depois) e resultado de cada comando da Parte 2.
3. Tabela de achados: `R2-01, R2-02…` — o quê, onde, como reproduzir, gravidade
   (bloqueia / incomoda / cosmético), print.
4. Prints em `docs/qa/roadmap-2.0/`.

Faça commit só da pasta `docs/qa/roadmap-2.0/` e envie.

---

## Rodada 2: correções da validação (2026-11-09)

Confere as correções do relatório [qa/roadmap-2.0/qa-roadmap-2.0.md](qa/roadmap-2.0/qa-roadmap-2.0.md).
Mesmas regras do início. Registre o resultado numa seção nova "Rodada 2" do
mesmo relatório (OK/FALHA por item, com print em `docs/qa/roadmap-2.0/rodada-2/`).

### Banco

```bash
cd supabase
npx supabase db push --remote --dry-run   # deve listar SÓ 20261109000050_roadmap2_qa_fixes.sql
npx supabase db push --remote
npm run verificar                         # esperado: 839 verificações
npm run validar:real
```

- [ ] **E-14 (divisão pela criação do caso):** a seção "[050]" do `verificar` cobre:
  caso criado a 50/50, divisão muda para 60/40, aceite depois → 50/50; caso novo → 60/40.
  No DEV: `select count(*) from legal_cases where accepted_at is null and partner_split_organization_id is not null;`
  (casos de parceiro ainda não aceitos ganharam a divisão vigente no dia do push).
- [ ] **R2-12:** as chaves estrangeiras novas têm índice (teste "[050] chaves estrangeiras novas com índice").

### Testes

- [ ] `cd apps/frontend && npm run lint` — **0 erros** (o conector gerado em `public/executor/` não é mais analisado, R2-04).
- [ ] `npm test` e `npm run typecheck` limpos.
- [ ] `npm run test:integration` — esperado: todos passam **sem** ajustar fixtures (R2-01). Anote qualquer falha com nome e mensagem.

### Telas

- [ ] **R2-03:** novo cliente PF e novo caso no portal: digitar um CPF válido **não** mostra "Consultando…" nem chama o servidor (aba Rede do navegador sem `lookup.cpf`).
- [ ] **R2-05:** janela com ~600 px de altura → Processo → Financeiro → Nova despesa: o corpo do diálogo rola e o botão de confirmar fica visível.
- [ ] **R2-06 / R2-16 / E-12:** Convidar parceiro com nome inválido (ex.: com número) dá erro **sem** criar escritório. O campo se chama "Porcentagem do parceiro (%)", explica quem fica com o quê e mostra a prévia "Parceiro X% · Escritório Y%". O escritório pendente leva o nome do contato. Se o e-mail falhar, a mensagem não diz "Nada foi criado" e uma nova tentativa para o mesmo e-mail reaproveita o mesmo escritório (não cria outro).
- [ ] **E-11:** ficha do parceiro → botão "Alterar divisão da parceria" no cabeçalho → "Revisar" mostra divisão atual → nova → "Confirmar nova divisão".
- [ ] **E-13:** convidar usuário do parceiro (PARTNER_USER): OAB **opcional**. No primeiro acesso aparece "Não sou advogado(a)" (também para o administrador do parceiro que completa o escritório). Advogado do escritório (LAWYER) continua com OAB obrigatória.
- [ ] **R2-13 / R2-14 / E-08:** portal → novo caso → cliente novo: depois do CEP o foco vai para o número; telefone obrigatório.
- [ ] **R2-08 / E-09:** Configurações → Geral → Atuação: descrição sem "e unidades".
- [ ] **E-01 a E-04 e E-10:** Início, Clientes, Casos, Processos, Parceiros e portal (Início e Financeiro): os painéis da mesma linha têm a **mesma altura**; listas longas (Parceiros, com 260+ escritórios) rolam dentro do painel, também pelo teclado; em Casos, "Escritório de origem" é uma faixa larga e baixa embaixo, com a lista em colunas; nenhum buraco na grade (testar com muitos e com poucos dados). Prints em 1440 e 1920 px.
- [ ] **E-05:** Revisões: faixa de indicadores (Aguardando decisão, Urgentes e alta prioridade, Vencendo em até 7 dias, Sem responsável); clicar filtra a lista e clicar de novo limpa. Cada número bate com a lista filtrada ("até 7 dias" = prazo até o fim do 7º dia, no horário de São Paulo). O filtro aparece na barra ("Prazo", "Urgente e alta") e no endereço (`?prazo=7dias`).
- [ ] **E-06:** Financeiro → Visão geral: gráfico "A receber por vencimento" no quarto espaço (em atraso, até 30, 31 a 60, 61 a 90, acima de 90 dias). A soma das barras é igual a "Em aberto"; se houver obrigação sem vencimento, aparece a barra extra "Sem vencimento". Só entram contratos de processo (regra da 046).
- [ ] **R2-09:** axe-core na Início: nenhum elemento focável dentro de `aria-hidden` nos gráficos; o texto cinza-claro passou a ter contraste AA (o número de avisos de contraste deve cair bastante).

Fica de fora desta rodada, por decisão: layout de celular (R2-07, a confirmar com a Barbara), R2-10 (falha única não reproduzida) e R2-15 (não reproduzido).

---

## Rodada 3: pendências da rodada 2 e alinhamento dos KPIs (2026-11-09)

Confere as pendências da seção 10 do relatório e um pedido da Barbara que não
estava no relatório (faixas de KPI de borda a borda). **Sem migration nova**:
não há `db push` nesta rodada. Registre o resultado numa seção "Rodada 3" do
mesmo relatório, com prints em `docs/qa/roadmap-2.0/rodada-3/`.

### Testes

- [ ] `cd apps/frontend && npm run lint`, `npm run typecheck` e `npm test` limpos (esperado: 618 testes).
- [ ] `npm run test:integration`: nada mudou no servidor; rode só se der tempo.

### Telas (1440 e 1920 px, como ADMIN e no portal)

- [ ] **R3-01:** axe-core na Início: **nenhum** `aria-hidden-focus` (a rosca "Distribuição dos processos" não recebe mais foco pelo teclado: Tab não para nela).
- [ ] **R3-02 e textos da divisão (E-14):** nenhuma tela diz mais que a divisão é "congelada no aceite". Conferir:
  - portal → Financeiro → "Participação por caso": "Percentual definido quando o caso foi criado…";
  - portal → Minha conta → "Divisão padrão": "Vale para os casos criados a partir de agora…";
  - processo de parceiro → aba Financeiro: "(definida quando o caso foi criado)";
  - caso de parceiro → Financeiro → "Parceria", painel "Parceria" do caso e a janela de **aceitar** caso de parceiro;
  - ficha do parceiro → "Divisão padrão" e o aviso depois de alterar a divisão.
- [ ] **E-05 (decisão tomada):** Revisões → "Aguardando decisão" mostra a fila em aberto **inteira**: fica marcado só quando nenhum outro filtro está aplicado; clicar nele limpa os filtros (Prazo, Urgente e alta, Sem responsável, Tipo) e **nunca** leva para "Todas"; clicar de novo não muda nada. Os outros três continuam ligando e desligando o próprio filtro.
- [ ] **KPIs de borda a borda (pedido da Barbara):** a faixa de indicadores ocupa a largura toda, alinhada com as bordas dos painéis de baixo, sem espaço sobrando à direita:
  - Clientes (4 KPIs em 4 colunas), Processos (5 em 5), Casos (6 em 6), portal → Início (5 em 5);
  - portal → Financeiro: "Sua participação no período" ocupa a largura toda, com o rótulo numa linha só;
  - Início: os 5 indicadores numa linha também em telas de 1024 a 1279 px (antes ficavam 2 + 2 + 1);
  - processo → aba Financeiro: 11 indicadores em 4 colunas, com "Resultado" ocupando duas e fechando a última linha;
  - com rótulo de duas linhas, os números da mesma faixa continuam alinhados embaixo.

