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

1. Resumo: APROVADO / APROVADO COM PENDÊNCIAS / REPROVADO.
2. Contagens da Parte 1 (antes e depois) e resultado de cada comando da Parte 2.
3. Tabela de achados: `R2-01, R2-02…` — o quê, onde, como reproduzir, gravidade
   (bloqueia / incomoda / cosmético), print.
4. Prints em `docs/qa/roadmap-2.0/`.

Faça commit só da pasta `docs/qa/roadmap-2.0/` e envie.
