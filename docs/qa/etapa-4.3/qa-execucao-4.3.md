# QA 4.3 — Execução

Status: **PASS** · **FAIL** · **BLOCKED** · **NOT_RUN**. IDs de [qa-matriz-4.3.md](qa-matriz-4.3.md).
Nenhuma senha, token, cookie ou código MFA é registrado aqui.

## Lote 0 — 2026-10-15 — ambiente e testes automatizados

### Verificação do ambiente

| Verificação | Resultado | Evidência |
|---|---|---|
| Supabase DEV, não produção | OK | `apps/frontend/.env.local` e `supabase/.env.real` apontam para o **mesmo** projeto; `DG_ENV=development` (scripts de integração e `validar:real` recusam outro valor). |
| Dados fictícios | OK | `auth.users`: 126 de 127 contas são `@dgbrasil.test`; a única outra é o ADMIN de QA (`dgbrasil.com`, previsto em VAL:106). Consulta somente leitura, só contagens. |
| Worker de agentes parado | OK | Nenhum processo de `apps/agentes` em execução (lista de processos `node`/`python`). |
| Dev server | OK | `next dev` ativo; `http://localhost:3000/login` → 200. |
| Migrations 028–031 no DEV | OK | `supabase_migrations.schema_migrations` contém `20261017000028`, `…029`, `…030`, `…031` (leitura). |
| Playwright MCP | **BLOCKED** | Servidor `playwright` "Connected" em `claude mcp list`, mas as ferramentas `browser_*` não estão disponíveis nesta sessão (ver BL-01 em pendências). |

### Pré-requisitos automatizados

| ID | Status | Evidência |
|---|---|---|
| P-01 | PASS | `npm run verificar` → "481 verificações, todas passaram." |
| P-02 | PASS (parcial) | `npm test`: 32 arquivos, **388/388**; `npm run lint`: sem erros; `npm run typecheck`: limpo. `npm run build` **NOT_RUN** (não rodado com o dev server ativo, para não disputar o `.next`). |
| P-03 | PASS | Migrations 028–031 presentes no histórico remoto (consulta direta, não pela CLI). |
| P-04 | PASS | `npm run validar:real` → "124 verificações reais, todas passaram." (rodada `rmv9r5unb`). Ver OBS-01 em [qa-bugs-4.3.md](qa-bugs-4.3.md). |
| P-05 | PASS | `npm run test:integration` → **20/20 arquivos, 172/172 testes**, 143,6 s. |
| P-06 | NOT_RUN | 6 contas `qa.*@dgbrasil.test` já existem; termos/MFA de cada uma dependem de você. |
| P-07 | NOT_RUN | Agente `qa-analise-43` existe mas está **INACTIVE** e o modelo, inativo; reativar antes da Fase E. |
| P-08 | NOT_RUN | Antes da Fase H. |
| P-09 | PASS | Worker parado (ver acima). |

### Resumo do lote 0

| PASS | FAIL | BLOCKED | NOT_RUN |
|---|---|---|---|
| 6 | 0 | 0 | 3 |

Itens de UI (A–H, transversais): 0 executados — **BLOCKED** por BL-01.

## Lote 1 — 2026-10-15 — Fase A (Clientes), ADMIN

**Ferramenta:** as ferramentas do Playwright MCP continuaram indisponíveis na
sessão, e um servidor local de controle do navegador foi bloqueado pela política
de segurança da sessão. A execução usou **scripts Playwright por lote** (mesmo
motor do MCP, `playwright-core` do pacote `@playwright/mcp`), com Chrome visível e
perfil persistente próprio. O login e o MFA do ADMIN foram feitos manualmente por
você; nenhum script digita credenciais. Persistência conferida por consulta
**somente leitura** ao banco do DEV.

**Dados criados (fictícios):** PF `QA43 PF ru918` (`b94d78f3-…`), PJ `QA43 PJ rw53t Ltda`
(`7692cf14-…`, CNPJ 99.994.178/0001-62), PF descartável excluída (`f3f85434-…`,
exclusão lógica). CPFs começam com 999.

| ID | Status | Evidência / observação |
|---|---|---|
| A-01 | PASS | A primeira página renderizada no servidor (25 linhas) é idêntica à de depois da hidratação, sem flash; com filtro sem resultado aparece "Nenhum cliente corresponde aos filtros.". Subitem "banco vazio → Nenhum cliente cadastrado." **NOT_RUN** (DEV com mais de 600 clientes). |
| A-02 | PASS | A busca por nome (digitação contínua) vai para a URL (`busca=`). A busca pelo prefixo de 7 dígitos do CPF encontra o cliente, e a URL fica **sem** query. Busca com qualquer dígito nunca vai para a URL (`isUrlSafeSearch`, por design). |
| A-03 | PASS | A ordenação por nome muda a lista. Filtros: total 602 → PJ 37 → +Ativos+Responsável "adm"+Origem → 1. A URL tem `tipo=pj&situacao=ativos&responsavel=…&origem=…&ordem=nome`. Recarregar mantém URL, controles e linhas. |
| A-04 | PASS | "1–25 de 600" → "Próxima" → "26–50 de 600", `pagina=2` na URL, e a recarga mantém. |
| A-05 | PASS | PF com **clique duplo**: o botão fica desabilitado logo após o 1º clique, a ficha do criado abre e a busca pelo nome retorna 1 registro. PJ com representante: idem. |
| A-06 | PASS | CPF já cadastrado → "Cliente já cadastrado no sistema." ligado ao campo CPF (`aria-describedby`), e a tela permanece no cadastro. Captura: `evidencias/fase-A/A-06-cpf-duplicado.png`. |
| A-07 | PASS | Editar nome social e profissão → volta à ficha com os novos valores. Apagar o nome social → "—" após recarregar; no banco, `social_name IS NULL`. |
| A-08 | **FAIL** | A gravação e a limpeza funcionam: nascimento, gênero, estado civil e identidade preenchidos e depois apagados ficam "—" na ficha e **NULL no banco** (os 4 campos de identidade). Porém **tipo de documento sem número (e número sem tipo) não é apontado no campo**: o envio é bloqueado em silêncio, só com foco no campo. Ver **BUG-01**. Captura: `evidencias/fase-A/A-08-tipo-sem-numero.png`. |
| A-09 | PASS | ADMIN corrige o CPF: a ficha mascarada mostra o novo e o banco tem o novo valor. |
| A-10 | PASS | Inativar (diálogo) → ficha "Inativo" e cliente presente em "Inativos". Reativar → "Ativo". |
| A-11 | PASS | Adicionar representante 2, editar o 1, marcar o 2 como principal, adicionar sócio e salvar: o quadro após recarregar é igual (2 representantes, principal = 2, 1 sócio). Erro (CPF `111.111.111-11` após remover o rep. 1): mensagem no campo, digitado mantido e **banco inalterado** (2 representantes após recarregar). "Descartar alterações" volta ao salvo (e fica desabilitado sem mudança). Troca do principal e remoção do sócio persistem. Auditoria: 2× `COMPANY_PEOPLE_REPLACED` (só contagens, com ator e `request_id`); a tentativa recusada não gerou evento. |
| A-12 | PASS | "Excluir definitivamente" fica desabilitado até digitar EXCLUIR. Depois volta para `/clientes`, o cliente some da busca, a ficha dá "Cliente não encontrado." e o banco registra `deleted_at`. |
| A-14 | PASS | `/clientes/<uuid inexistente>` e `/clientes/abc` → "Cliente não encontrado." (sem texto de permissão). |
| A-15 | PASS | Ficha em nova aba e após recarregar: mesma ficha. |
| A-16 | PASS | Rede desligada (emulação Playwright `setOffline`) + troca de filtro → "Não foi possível carregar os clientes." + "Tentar novamente". Religar + tentar → lista volta (25 linhas). Captura: `evidencias/fase-A/A-16-offline.png`. |

Transversais cobertas para **Clientes**: T-01 (ficha), T-04 (IDOR/abc), T-05
(clique duplo no cadastro), T-06 (rede), T-07 (CPF fora da URL), todos PASS. Esses
itens seguem abertos nas demais fases.

### Resumo do lote 1

| PASS | FAIL | BLOCKED | NOT_RUN |
|---|---|---|---|
| 14 | 1 | 0 | 0 (+1 subitem: A-01 "banco vazio") |

## Lote 2 — 2026-10-15 — Fase B (Casos e Processos), ADMIN

**Dados criados (fictícios, cliente `QA43 PF ru918`):** casos `QA43 Caso Rascunho 5uwo` (DRAFT,
f8a5ede2-…), `QA43 Caso Fluxo 5uwo` (ARCHIVED, 3f9dae3a-…), `QA43 Caso Rejeitar 5uwo` (REJECTED,
8f0b5c41-…), `QA43 Caso Processos 5uwo` (IN_PROGRESS, e41da4f1-…), `QA43 Caso Parceiro A 5uwo`
(ACCEPTED, origem e acesso "Parceiro QA A", 574548cf-…; preparação PR-04). Processos
`QA43 Proc CNJ fr5n` (CNJ 9507214-12.2026.8.26.0100) e `QA43 Proc PreAj fr5n` (excluído).

| ID | Status | Evidência / observação |
|---|---|---|
| B-01 | PASS | 503 casos → Situação "Em andamento" 10 → +Área+Responsável 1 → +Cliente (seletor com busca no servidor) 1 → +Origem+Período 1; ordem por título. Tudo na URL (`situacao, area, responsavel, origem, cliente, periodo, ordem, dir`), e recarregar mantém lista e URL. Páginas "1–25" → "26–50 de 503", `?pagina=2`, URL direta também funciona. A página 2 leva ~1,5 s. |
| B-02 | PASS | "Salvar rascunho" e "Enviar para análise" com **clique duplo** → ficha do criado ("Rascunho" / "Enviado") e 1 caso por título. |
| B-03 | PASS | "Editar dados do caso" (parte contrária) persiste após recarregar. "Aceitar" sem advogado → "Defina o advogado responsável antes de aceitar o caso." no campo; com advogado → Aceito → Em andamento → Encerrado → Arquivado (o arquivado fica sem menu Editar). Rejeitar sem motivo → o diálogo não fecha; com motivo → Rejeitado. "Definir advogado responsável" no rascunho → cabeçalho mostra o advogado (persistido). Situações mudam após a resposta. Captura: `evidencias/fase-B/B-03-aceitar-sem-advogado.png`. |
| B-04 | PASS | No caso aceito, o menu mostra "Alterar origem — Somente Administrador, com motivo e confirmação"; o botão fica bloqueado sem marcar "Entendo o impacto…"; sem motivo → campo "Motivo da alteração" exigido; com motivo → origem muda (persistida). Revertido em seguida. Banco: 2× `CASE_ORIGIN_CHANGED` com `reason` e `after_acceptance: true`. |
| B-05 | PASS | Aba Processos do caso → "Cadastrar processo" abre `/processos/novo?caso=…` com o caso já escolhido. |
| B-06 | **FAIL** | Busca pelos 9 primeiros dígitos do CNJ encontra o processo, sem dígitos na URL; a linha mostra cliente e próximo prazo ("Vence em 3 dias · QA43 prazo inicial"); filtros Status+Responsável persistem ao recarregar. **Porém o caso não aparece na linha** quando o processo tem "Tipo de ação" preenchido. Ver **BUG-02**. |
| B-07 | PASS | CNJ com dígito errado → "Número CNJ inválido (confira o dígito verificador)." no campo (`evidencias/fase-B/B-07-cnj-invalido.png`). CNJ válido com **clique duplo** → 1 processo, ficha aberta e prazo inicial em Prazos. Sem CNJ → ficha "Pré-ajuizamento". |
| B-08 | PASS | Editar (Mais ações → Editar) e apagar vara e valor da causa → "—" após recarregar; no banco, `court_unit` e `case_value` ficam NULL. |
| B-09 | PASS | "Registrar andamento" → aparece em Movimentações após recarregar, com origem "Equipe"; banco `source = MANUAL`. |
| B-10 | PASS | Prazo com vencimento passado → "Vencido" (banco `OPEN`: situação derivada, não gravada). Editar prazo muda o título. Cumprir → sai dos abertos (`COMPLETED`). Cancelar → sai dos abertos (`CANCELLED`, sem pedir motivo). Seção "Encerrados 2". Captura: `evidencias/fase-B/B-10-prazos.png`. |
| B-11 | PASS | "Excluir" → volta para o caso; a ficha do processo excluído → "não encontrado"; banco `deleted_at` preenchido e `PROCESS_DELETED` auditado com ator. |
| B-12 | PASS | `/casos/<uuid inexistente>`, `/casos/abc`, `/processos/<uuid inexistente>`, `/processos/abc` → "Caso/Processo não encontrado". |
| PR-04 | OK (preparação) | Caso com origem "Parceiro QA A" e parceiro vinculado, aceito: o diálogo avisou "Acordo de parceria", e a ficha diz "O parceiro tem acesso operacional a este caso." |

Transversais cobertas para **Casos/Processos**: T-04 (IDOR), T-05 (clique duplo em caso e processo) e T-07 (CNJ fora da URL), todos PASS.

### Resumo do lote 2

| PASS | FAIL | BLOCKED | NOT_RUN |
|---|---|---|---|
| 11 | 1 | 0 | 0 |

## Lote 3 — 2026-10-15 — Fase C (Documentos), ADMIN

**Arquivos fictícios:** PDFs de ~400 B gerados no teste (`qa43-*.pdf`), um `.zip` vazio e um PDF
esparso de 51 MB (nunca enviado). **Documentos criados:** `QA43 Doc cliente x2p6` (v1+v2, cliente PF),
`QA43 Doc processo msta`, `QA43 Doc parceiro msta` (caso de parceiro, compartilhado),
`QA43 Doc rede msta` / `QA43 Doc rede2 wb61` (teste de rede), `QA43 Doc excluir msta` (excluído),
pendências `QA43 Extrato …` (aprovada) e `QA43 Contrato …` (rejeitada). URLs assinadas não foram
registradas em lugar nenhum.

| ID | Status | Evidência / observação |
|---|---|---|
| C-01 | PASS | Arrastar-e-soltar (evento `drop` com `DataTransfer` real) abre o envio. As 4 etapas aparecem ("Registrar o documento → Autorizar o envio → Enviar o arquivo → Confirmar a nova versão") e o documento entra como "v1 · Não verificado". |
| C-02 | PASS | `.zip` → "Tipo de arquivo não aceito. Envie PDF, Word, Excel, texto, CSV ou imagem." PDF de 51 MB → "Arquivo maior que o limite de 50 MB." (`evidencias/fase-C/C-02-qa43_grande_pdf.png`). Nenhuma etapa iniciada e nada gravado. |
| C-03 | PASS | Falha de rede **simulada só no upload ao Storage** (interceptação Playwright, `abort internetdisconnected`) → "Parou em: enviar o arquivo." + "Tentar novamente" (`evidencias/fase-C/C-03-falha-envio.png`). Liberada a rede, "Tentar novamente" conclui: o documento aparece na lista sem recarregar, com 1 versão (banco). |
| C-04 | PASS | "Baixar" → o servidor gera URL assinada e o arquivo abre (HTTP 200). Cada clique gera **outro** link. O 1º link, pedido de novo após 65 s → **HTTP 400** (expirado). Ver OBS-05 (abre na mesma aba). |
| C-05 | PASS | "Enviar nova versão" → linha "v2 · Não verificado". O histórico mostra v2 "Atual" e v1 "Substituída", cada uma com verificação própria (a v2 não herdou nada) e botão "Baixar"; o download da v1 traz o objeto da v1 (HTTP 200). Banco: 2 versões e 2× `DOCUMENT_UPLOADED`. |
| C-06 | PASS | "Marcar arquivo como verificado" → "Verificado"; "Registrar divergência" com nota → "Divergência encontrada", persistido após recarregar. |
| C-07 | PASS | Arquivar → some de Ativos e aparece em Arquivados (banco `ARCHIVED`); Reativar → volta a Ativos. |
| C-08 | PASS | ADMIN "Excluir documento" → some da lista após recarregar; banco `deleted_at` preenchido (versões mantidas). |
| C-09 | PASS (parte ADMIN) | "Nova pendência" com "Já solicitar" → "Solicitado". "Registrar recebimento" escolhendo o arquivo do caso → "Arquivo recebido"; Aprovar → "Aprovado". Outra pendência → Rejeitar → "Rejeitado" com "Solicitar de novo". Persistido após recarregar (`evidencias/fase-C/C-09-pendencias.png`). Aprovação por LAWYER e ASSISTANT sem Aprovar/Rejeitar: itens de papel (pendentes). |
| C-10 | PASS | Caso interno: o menu **não** oferece "Compartilhar com o parceiro". Caso de parceiro (`QA43 Caso Parceiro A`): "Compartilhar" → coluna Visibilidade "Compartilhado com o parceiro"; banco `PARTNER_VISIBLE`. |
| C-10b | NOT_RUN | "Minuta de agente não aprovada é recusada" exige minuta gerada por agente; nenhuma IA pode executar nesta etapa. |
| C-11 | PASS | Processo → Documentos: enviado; aparece também na aba Documentos do caso. |

### Resumo do lote 3

| PASS | FAIL | BLOCKED | NOT_RUN |
|---|---|---|---|
| 11 | 0 | 0 | 1 (C-10b) |

## Lote 4 — 2026-10-15 — Fase D (Parceiros e Solicitações), ADMIN

**Dados:** parceiro `QA43 Parceiro 8diz` (f542e8fc-…, situação PENDING até o 1º acesso, divisão
30/70). Solicitações no caso `QA43 Caso Parceiro A`: `… resolver bmvh` (RESOLVED), `… cancelar bmvh`
(CANCELLED) e duas `… 8diz` **OPEN**, mantidas como fixture para o portal (D-13). O parceiro
residual "Parceiro A imv6qovz8" (rodadas automáticas) foi suspenso e devolvido para ACTIVE.

| ID | Status | Evidência / observação |
|---|---|---|
| D-01 | PASS | 91 parceiros. "Próxima" → "26–50 de 91" (`?pagina=2`). Busca "Parceiro QA" → 2. Situação "Suspensos" → 0, mantido ao recarregar. Contadores da linha do QA A (2 clientes, 1 caso ativo, 0 pendências, "1 caso novo") batem com a ficha (Clientes relacionados 2 = aba Clientes 2; Casos ativos 1; Casos novos 1). |
| D-02 | PASS | Cadastro com clique duplo → ficha e **1** organização no banco. Editar telefone persiste. "Alterar" divisão → 30%/70% com o aviso "Vale apenas para novos casos". Situação: no parceiro recém-criado o seletor fica **oculto até o 1º acesso** ("Aguardando o primeiro acesso", por design). Num parceiro ativo: Ativo/Suspenso/Inativo; Suspenso persiste e aparece no filtro "Suspensos"; devolvido para Ativo. Captura: `evidencias/fase-D/D-02-parceiro-qa43.png`. |
| D-03 | PASS | Ficha do Parceiro QA A: Usuários = só os 2 usuários QA do parceiro A; Clientes e Casos só com vínculo/origem/acesso do A (caso `QA43 Caso Parceiro A` presente; casos internos QA43 ausentes); Processos sem itens. Também aparecem um caso "Pencionário" e um cliente "RIcard", que **não foram criados pelo QA** (provavelmente teste manual anterior). |
| D-04 | PASS | "Nova solicitação" com clique duplo → 1 solicitação "Aberta". "Abrir conversa" → mensagem enviada aparece na conversa. "Marcar resolvida" → "Resolvida"; outra → "Cancelar solicitação" → "Cancelada". Persistido após recarregar; resolvida sem campo de mensagem. "Pedir nova resposta" só aparece com resposta do parceiro: fica para a rodada com PARTNER_ADMIN. |

### Resumo do lote 4

| PASS | FAIL | BLOCKED | NOT_RUN |
|---|---|---|---|
| 4 | 0 | 0 | 0 |

## Lote 5 — 2026-10-15 — Fase E (Análises e Revisões), ADMIN

**Preparação PR-01:** bloco §6.2 do guia executado no DEV. Ele criou agente e modelo, mas
deixou o agente **sem versão atual** (ver **BUG-03**); fixture corrigida com um `update` pontual.
Conferência final: agente `qa-analise-43` ACTIVE com versão, modelo "QA 4.3 — com agente" ativo.
Worker de agentes parado o tempo todo. **Nenhuma proposta de agente foi aprovada** (aprovar
aplica a proposta pelo worker).

**Dados:** análise "Análise Bancária" PENDING no `QA43 Caso Processos`; análise "QA 4.3 — com
agente" QUEUED + 1 execução QUEUED no `QA43 Caso Parceiro A`. Decisões em revisões fictícias das
rodadas automáticas ("Caso revisão"): 2 aprovadas (uma depois reaberta), 1 com alterações
solicitadas (o que enfileira um pedido ao agente, a cancelar na Fase G) e 1 rejeitada; 1 proposta
de agente rejeitada (não aplica nada).

| ID | Status | Evidência / observação |
|---|---|---|
| E-01 | PASS | Caso sem análises → "Nenhuma análise jurídica neste caso." + "Nova análise". |
| E-02 | PASS | Modelo "Análise Bancária" (sem agente): na Documentação lista os obrigatórios faltando e oferece "Continuar mesmo assim"; na Confirmação, "Enviar ao agente agora" fica **desabilitado** ("Este modelo não tem agente configurado…"). "Criar análise" → aba Análise "Pendente / Não iniciada", com os documentos que faltam (`evidencias/fase-E/E-02-analise-pendente.png`). |
| E-03 | PASS | Modelo "QA 4.3 — com agente": "Enviar ao agente agora" habilitado e marcado; **clique duplo** em "Iniciar e enviar ao agente" → banco com **1** análise QUEUED ligada a **1** execução QUEUED (`qa-analise-43`). A tabela mostra "Na fila do agente"; ver OBS-06 sobre o rótulo do cartão. |
| E-04 | NOT_RUN | Nenhum modelo do DEV tem agente **e** documentos obrigatórios ao mesmo tempo (o com agente não exige documentos; o bancário exige, mas não tem agente). Exige fixture adicional. |
| E-05 | PASS | Com a análise na fila, "Nova análise" → "Este caso já possui uma análise em andamento." |
| E-06 | NOT_RUN | Nenhum modelo ativo pede "Dados específicos" ("Este modelo não pede dados adicionais."). Cobertura parcial: testes unitários `phase-e-ui.test.ts` ("obrigatório, moeda, opção e sim/não"; "payload: só campos do template"). |
| E-07 | PASS | Aguardando decisão 50 · Atribuídas a mim 0 · Todas 82 · +Tipo Documento 9 · +Situação Aprovada 9 (`?visao=todas&tipo=DOCUMENT_VERSION&situacao=APPROVED`), mantido ao recarregar. "Sem responsável" 43 e página 2 "26–43 de 43" (`?sem_responsavel=1&pagina=2`). |
| E-08 | PASS | Revisão de análise: "Resultado da análise… A análise ainda não tem resultado." Revisão de documento: "Versão 1 · Outro" e "Baixar esta versão" → link assinado HTTP 200. Proposta de agente: conteúdo da proposta (dados e resumo) com o aviso "Aprovar aplica a proposta pelo worker" (`evidencias/fase-E/E-08-proposta.png`). |
| E-09 | PASS | "Alterar" na lateral → responsável "QA Advogado", prioridade "Alta", prazo 20/10/2026 → após recarregar a lateral mostra os três. Só advogados e ADMIN com OAB são oferecidos como responsáveis. |
| E-10 | PASS | Aprovar sem comentário → "Aprovada", histórico "Aprovada · adm" (~3 s, sem recarregar). "Solicitar alterações" e "Rejeitar" **recusam texto vazio** (o diálogo não fecha); com justificativa, ficam no histórico. Banco: `APPROVE`, `REQUEST_CHANGES` e `REJECT` nas revisões certas. |
| E-11 | PASS | Revisão aprovada → "Reabrir" → "Confirmar reabertura" com motivo → "Reaberta", com Aprovar/Rejeitar de novo. Proposta de agente rejeitada **não** oferece "Reabrir". |
| E-12 | NOT_RUN | Não há proposta estrutural (alteração de agente/skill) no DEV; as propostas existentes são providências fictícias. A parte do LAWYER também exige outro papel. |
| E-13 | PASS | Caso "Caso A (op. A, origem A)" → aba "Revisões 1" lista só a revisão daquele caso. |

### Resumo do lote 5

| PASS | FAIL | BLOCKED | NOT_RUN |
|---|---|---|---|
| 10 | 0 | 0 | 3 (E-04, E-06, E-12) |

## Lote 6 — 2026-10-15 — Fase F (Financeiro), ADMIN

**Contexto:** o **BUG-04** (pageSize 100 > máximo 50) impede criar contrato, gerir modelos **e
carregar as obrigações e os lançamentos** na gaveta de qualquer contrato. Os testes possíveis usaram
contratos fictícios das rodadas automáticas: "Caso A (op. A, origem A)" (ativo, origem "Parceiro A
rmv9r5unb") e um "Caso visão do parceiro" quitado (1d918f15-…, agora COMPLETED).
**Dados criados:** obrigação `QA43 obrigação zq7v` (R$ 300, no "Caso A"); repasses `QA43 zq7v` ao
"Parceiro A rmv9r5unb": R$ 1,00 PAID e R$ 125,00 CANCELLED (com motivo).

| ID | Status | Evidência / observação |
|---|---|---|
| F-01 | PASS | Totais, gráfico de 12 meses (nov/25–out/26) e contratos paginados. Filtro "Concluído" → `?situacao=COMPLETED`, mantido ao recarregar. **Totais conferidos com o banco** (regra `balanceTotals` sobre `payment_balances`): em aberto 11.830,00 / 64 obrigações; recebido 27.910,00; contratado 39.740,00; em atraso 2.190,00; 50 ativos, 14 rascunhos, 4 concluídos, todos iguais ao painel. |
| F-02 | **FAIL** | `/financeiro/contratos/novo` (4 variantes, inclusive pelo link do caso) → "Não foi possível abrir o cadastro de contrato. Confira os dados informados." **BUG-04.** Sub-itens (com/sem modelo, ativar, clique duplo, 2º ativo recusado) não executáveis pela UI. |
| F-03 | **FAIL** | "Nova obrigação" funciona: o clique duplo gerou **1** obrigação no banco. Mas a lista de obrigações da gaveta falha ("Não foi possível carregar as obrigações." ref. F17D9A34), e sem ela não há como registrar recebimento parcial, quitar, estornar nem ajustar. **BUG-04.** Captura: `evidencias/fase-F/F-03-gaveta-caso-A.png`. |
| F-04 | PASS (parcial) | Concluir com obrigação em aberto → **recusado**: "Há obrigações em aberto neste acordo: registre o recebimento ou cancele-as antes." (o acordo continua ACTIVE). Acordo quitado → "Acordo concluído" (banco COMPLETED); o concluído não oferece "Nova obrigação", "Concluir" nem "Cancelar acordo". Sub-item "estorno continua disponível" **BLOCKED** pelo BUG-04 (a lista onde fica o estorno não carrega). |
| F-05 | **FAIL** | "Cancelar obrigação" fica no menu da linha da obrigação, que não carrega. **BUG-04.** |
| F-06 | PASS | "Caso A" → Financeiro: "1 contrato" listado e a parceria. `QA43 Caso Parceiro A` → "Parceria do caso: Parceiro QA A 40%", com o texto "Mudar a divisão padrão do parceiro não altera este registro" (snapshot do aceite). |
| F-07 | PASS | Parceiro → Financeiro: participação acumulada R$ 250,00; repasse acima do saldo → recusado: "O saldo disponível do parceiro é menor que o valor do repasse." Repasses de R$ 125,00 e R$ 1,00 registrados; "Marcar como pago" (1,00 → PAID, "Repassado R$ 1,00"); "Cancelar repasse" com motivo (125,00 → CANCELLED, motivo gravado); disponível final R$ 249,00. Captura: `evidencias/fase-F/F-07-repasse-acima.png`. |
| F-08 | **FAIL** | Configurações → Modelos de honorários → "Não foi possível carregar os modelos." (`evidencias/fase-F/F-08-modelos-honorarios.png`). **BUG-04.** Criar, editar e inativar não verificáveis. |

### Resumo do lote 6

| PASS | FAIL | BLOCKED | NOT_RUN |
|---|---|---|---|
| 4 | 4 | 0 (+1 sub-item) | 0 |

## Lote 7 — 2026-10-15 — Fase G (Execuções), ADMIN

| ID | Status | Evidência / observação |
|---|---|---|
| G-01 | PASS | DG Brasil → Execuções: 93 execuções; situações Na fila/Executando/Aguardando decisão humana/Concluída/Falhou/Cancelada; "Na fila" → 11 (`?situacao=QUEUED`), mantido ao recarregar; página 2 "26–50 de 93" (`?pagina=2`). A execução da análise enviada no E-03 aparece "Agente QA 4.3 · Na fila · Cancelar". |
| G-02 | PASS | "Cancelar" (sem diálogo de confirmação) → "Cancelada" após a resposta, sem botão, e mantido ao recarregar. Filtro "Cancelada": 25 linhas, nenhuma com "Cancelar". Sub-item "concluída não oferece cancelar" sem fixture (0 execuções concluídas no DEV). Captura: `evidencias/fase-G/G-02-cancelada.png`. Só a execução do QA (`qa-analise-43`) foi cancelada; as 9 do `validar:real` (OBS-01) não foram tocadas. |
| G-03 | PASS | `QA43 Caso Parceiro A` → Análise → "Execuções de agente neste caso": 1 execução (Agente QA 4.3), nenhuma de outro caso. |

### Resumo do lote 7

| PASS | FAIL | BLOCKED | NOT_RUN |
|---|---|---|---|
| 3 | 0 | 0 | 0 |

## Lote 8 — 2026-10-15 — Fase H (Painéis e configurações) e transversais, ADMIN

**Preparação PR-02:** SQL §6.3 executado **duas vezes** ("Aviso de QA 4.3" e "Aviso de QA 4.3 (2)"),
para testar "marcar como lida" e "marcar todas" separadamente. Configurações → Geral foi alterada e
**restaurada** (OAB e site voltaram a NULL; conferido no banco).

| ID | Status | Evidência / observação |
|---|---|---|
| H-01 | PASS | Início × banco (mesma regra do `features/home/load.ts`): casos ativos 127 = 127; aguardando a equipe 234 = 234 SUBMITTED + 0 WAITING_DOCUMENTS; processos ativos 113 = 113; revisões pendentes 46 / 7 urgentes = 46 / 7; prazos 10 vencidos / 0 em até 5 dias = prazos OPEN de processos/casos vivos (6+1 de processos excluídos ficam OPEN no banco e são corretamente ignorados); Financeiro igual ao painel de `/financeiro` (11.830,00 / 64 / 2.190,00 / recebido no mês 27.910,00). |
| H-02 | PASS | Menu da casa: clientes 602, casos 234, processos 113, revisões 46, parceiros 42 ativos; iguais à Início e ao banco; mesmos números após recarregar. |
| H-03 | PASS | Atividade: cliente "1–15 de 15 eventos" (frases, campos alterados **sem valores**, autor); caso "1–15 de 15" ("Pendência documental atualizada · de recebido para não aceito · adm"); parceiro "1–2 de 2" ("Divisão do parceiro registrada · Sistema"). Nenhum IP ou user agent. |
| H-04 | PASS | Segurança: postura real (MFA obrigatório, RLS por papel, credenciais só no servidor). Auditoria 6.459 eventos → Ação "Repasse cancelado" 8 → +responsável 8 → +período (hoje) 4; página 2 "26–50 de 6459" (`evidencias/fase-H/H-04-auditoria.png`). |
| H-05 | **FAIL** | Salvar e recarregar funcionam (alterações auditadas, só nomes de campos), mas **OAB "OAB/SP 123.456" vira "OAB/SP 12345"**: a máscara tira o ponto e corta em 12 caracteres, perdendo o último dígito sem aviso (digitação real, letra a letra). Ver **BUG-05**. Captura: `evidencias/fase-H/H-05-oab.png`. Valores restaurados. |
| H-06 | PASS | Faixa: "113 ativos · 4 com prazo em até 5 dias (inclui vencidos) · 0 DG Brasil · 0 importados". Clicar → `?prazo=5dias` com 4 processos (= faixa). `?prazo=vencidos` → seletor "Vencidos", 4 processos, todos com prazo vencido. |
| H-07 | PASS | Processo → Revisões: "Nenhuma revisão neste processo."; → Financeiro: "Contratos de honorários do caso… abrangem todos os processos dele"; processo do "Caso A" → Financeiro lista "1 contrato". Nenhum erro. |
| H-08 | PASS | Sino "2 não lidas" → painel com os avisos ("Marcar como lida", "Marcar todas como lidas", abas Não lidas/Todas) → marcar uma → "1 não lidas" → marcar todas → "Notificações" (0), "Tudo em dia"; mantido após recarregar; as duas continuam em "Todas" (`evidencias/fase-H/H-08-sino.png`). |

### Transversais (ADMIN)

| ID | Status | Evidência / observação |
|---|---|---|
| T-01 | PASS | Nova aba + recarregar: cliente, caso, processo, revisão e parceiro abrem igual. |
| T-04 | PASS | uuid inventado e `abc` em `/clientes`, `/casos`, `/processos`, `/revisoes` e `/parceiros` → "não encontrado", sem texto de permissão. |
| T-05 | PASS (parcial) | Clique duplo → 1 registro: cliente PF/PJ, caso (rascunho e envio), processo, solicitação ao parceiro, análise + execução, obrigação, parceiro. **Não verificáveis:** contrato e recebimento (BUG-04), envio de caso do parceiro (papel). Repasse não foi testado com clique duplo. |
| T-06 | PASS | Rede desligada em Clientes (lista) e no envio de documento (C-03): erro recuperável com "Tentar novamente". |
| T-07 | PASS | CPF (Clientes) e CNJ (Processos) fora da URL; busca com dígito nunca vai para a URL. |
| T-08 | PASS | Clientes, casos, processos, documentos, solicitações, revisões, análises, financeiro, execuções, notificações, auditoria e Início mostram só dados do DEV. Ver OBS-03 sobre o selo e o menu "Demonstração". |
| T-09 | OK (fora do escopo) | DG Brasil (agentes, skills, teses), IA e Integrações continuam de demonstração, como previsto (VAL:212). |

### Resumo do lote 8

| PASS | FAIL | BLOCKED | NOT_RUN |
|---|---|---|---|
| 13 (+T-09 OOS) | 1 | 0 | 0 |

## Consolidado — ADMIN (lotes 1–8)

| Fase | PASS | FAIL | NOT_RUN |
|---|---|---|---|
| A — Clientes | 14 | 1 (A-08) | 0 |
| B — Casos e Processos | 11 | 1 (B-06) | 0 |
| C — Documentos | 11 | 0 | 1 (C-10b) |
| D — Parceiros | 4 | 0 | 0 |
| E — Análises e Revisões | 10 | 0 | 3 (E-04, E-06, E-12) |
| F — Financeiro | 4 | 4 (F-02, F-03, F-05, F-08) | 0 |
| G — Execuções | 3 | 0 | 0 |
| H — Painéis | 7 | 1 (H-05) | 0 |
| Transversais | 6 | 0 | 0 |
| **Total ADMIN** | **70** | **7** | **4** |

Pré-requisitos automatizados (lote 0): 6 PASS, 3 preparações feitas depois (P-06 parcial: contas QA existem, falta o 1º login delas).
Itens que exigem outros papéis: **40, não executados** (ver pendências).

## Lote 10 — 2026-10-15 — papel LAWYER (`qa.advogado@dgbrasil.test`)

Sessão conferida no menu do usuário: "QA Advogado · Advogado · Bárbara Cardoso Advocacia". Login e MFA feitos por você.

| ID | Status | Evidência / observação |
|---|---|---|
| A-09-L | PASS | Trocar o CPF e salvar → no campo e no aviso: "Só o administrador pode corrigir o CPF/CNPJ."; após reabrir, o CPF continua o mesmo. Captura: `evidencias/fase-A/A-09-L-cpf-lawyer.png`. |
| A-12-L | PASS | Edição do cliente sem "Ações perigosas" e sem "Excluir cliente". |
| B-04-L | PASS | Caso aceito, menu Editar: só "Editar dados do caso" e "Definir advogado responsável" (sem "Alterar origem"). |
| B-11-L | PASS | "Mais ações do processo": só "Editar dados do processo" (sem Excluir). |
| C-08-L | PASS | Menu do documento sem "Excluir documento". |
| C-09 (LAWYER) | PASS | O LAWYER cria a pendência, registra o recebimento e **aprova** → "Aprovado". |
| D-01-L / D-02-L | PASS | Lista de parceiros sem coluna de divisão; ficha sem divisão, sem "Adicionar parceiro", "Editar dados", situação ou "Alterar". |
| F-09-L | PASS | Sem item Financeiro no menu; `/financeiro` → acesso negado; caso sem aba Financeiro (`evidencias/fase-F/F-09-L-financeiro-negado.png`). |
| G-04-L | PASS | Aba Análise mostra a execução do caso, sem "Cancelar"; `/dg-brasil/execucoes` → acesso negado. |
| H-09-L | PASS | Início com revisões; sem financeiro, execuções ou atividade; cliente e caso sem aba Atividade. |
| E-12-L | NOT_RUN | Sem proposta estrutural no DEV. |

### Resumo do lote 10: PASS 10 · FAIL 0 · NOT_RUN 1

## Lote 11 — 2026-10-15 — papel ASSISTANT (`qa.assistente@dgbrasil.test`)

Sessão: "QA Assistente · Assistente · Bárbara Cardoso Advocacia". O 1º acesso mostra o diálogo
"Deseja conhecer o DG Brasil?"; foi escolhido "Pular introdução". O 1º login perdeu a sessão ao fechar
o navegador (o script fechava 1,5 s após entrar); o script foi ajustado para confirmar com um
recarregamento antes de fechar, e você refez o login.

| ID | Status | Evidência / observação |
|---|---|---|
| T-02 (ASSISTANT) | PASS | `/revisoes`, `/financeiro`, `/dg-brasil/execucoes`, `/casos/<id>/analise/nova` → acesso negado (`evidencias/transversal/T-02-assistant.png`). |
| A-09-S | PASS | Trocar o CPF → "Só o administrador pode corrigir o CPF/CNPJ."; CPF inalterado. |
| A-12-S | PASS | Sem "Ações perigosas". |
| A-13 | PASS | "Origem do cliente" no cadastro só oferece "Bárbara Cardoso Advocacia"; a lista não tem filtro de origem. |
| B-13-S | PASS | Vê 503 casos e 113 processos; criou e enviou `QA43 Caso ASSISTANT ysie` (origem só o escritório); sem Aceitar/Rejeitar/Encerrar/Arquivar/Andamento; sem "Cadastrar processo" e "Adicionar prazo"; `/processos/novo` → acesso negado. |
| C-08-S | PASS | Menu do documento sem "Excluir documento" (tem nova versão, histórico, verificar, arquivar). |
| C-09-S | PASS | O ASSISTANT cria a pendência e registra o recebimento ("Arquivo recebido"), mas **não** vê Aprovar/Rejeitar. |
| D-01-S | PASS | `/parceiros` → acesso negado (ASSISTANT não tem `partners.view`, então também não vê divisão). |
| E-14-S | PASS | Abas do caso: Visão geral / Documentos / Processos (sem Análise e Revisões). |
| F-09-S, G-05-S, H-09-S | PASS | Início sem financeiro, revisões e execuções; menu sem Revisões, Financeiro e DG Brasil; sem aba Financeiro no caso; cliente sem aba Atividade. |

### Resumo do lote 11: PASS 12 · FAIL 0

## Lotes 12–13 — 2026-10-15 — PARTNER_ADMIN do parceiro A (`qa.parceiro-a.admin@dgbrasil.test`)

Sessão: "QA Admin Parceiro A · Administrador do parceiro · Parceiro QA A". Fixtures internas feitas pelo
ADMIN pela UI: andamento MANUAL `QA43 nota interna qw83` no processo do parceiro, documento interno
`QA43 Doc interno qw83` (não compartilhado) no caso do parceiro, caso do portal `QA43 Caso Portal 9sjq`
rejeitado com motivo público e nota interna.
**Dados criados pelo parceiro:** casos `QA43 Caso Portal 9sjq` (depois rejeitado), `QA43 Caso Portal bama`
(com o documento `QA43 doc do portal`, enviado depois do caso) e `QA43 Caso Portal outro …` (cliente de
outro escritório); processos `QA43 Proc Portal diag` e `QA43 Proc Portal dbl oymo`; documento
`QA43 Doc do parceiro d5cw` (v1+v2); resposta na solicitação `… resolver 8diz`.

| ID | Status | Evidência / observação |
|---|---|---|
| T-02 (parceiro) | PASS | `/parceiros`, `/revisoes`, `/dg-brasil/execucoes`, `/casos/<id>/analise/nova` e `/clientes/<id>/editar` → acesso negado. |
| T-03 / D-18 / A-17 / B-14 | PASS | Cliente, caso e processo do parceiro B, cliente interno, caso interno de origem A sem acesso e processo interno → "não encontrado". |
| A-18-P | PASS | `/clientes/<id>/editar` → acesso negado. |
| E-15-P, G-05-P | PASS | Rotas de revisão, análise e execuções negadas. |
| D-05 | PASS | Só clientes do próprio escritório; busca por nome e por prefixo do CPF; URL sem dígitos. |
| D-06 | PASS | Ficha sem campos internos; "Editar" contato: e-mail salvo e depois apagado, persistido após recarregar. |
| D-07 | PASS | CPF novo → Cadastro básico → Novo caso → Documentos ("Adicionar documento") → "Revisar envio" → **clique duplo** em "Confirmar e enviar para Bárbara Cardoso Advocacia" → **1** caso SUBMITTED, origem e acesso do Parceiro QA A (banco). O arquivo sobe **depois** do envio: `QA43 doc do portal`, PARTNER_VISIBLE, 1 versão (`evidencias/fase-D/D-07-enviado.png`). |
| D-08 | PASS | CPF de outro escritório → "Cliente já cadastrado no sistema. Este cliente já possui cadastro no DG Brasil. Você pode criar um novo caso para ele, sem duplicar o cadastro." (sem nome nem escritório; a revisão também não mostra o nome) → caso enviado → o cliente passou a aparecer na carteira. |
| D-09 | PASS | CPF da carteira → "Este cliente já está na sua carteira." com "Abrir cliente" e "Criar novo caso para este cliente". |
| D-10 | PASS | Consultas rápidas de CPF → bloqueada na 9ª: "Consulta temporariamente bloqueada. Muitas consultas em pouco tempo. Aguarde alguns instantes" (limite configurado: 10/min por usuário, 30/min por escritório). |
| D-11 | PASS (parcial) | Filtro com situações simplificadas (Rascunho … Arquivado; "Em análise" → `?situacao=Em+análise`, 0 casos: não há caso do parceiro em READY/ANALYZING/WAITING_REVIEW). Caso recusado mostra **só** o motivo público, sem a nota interna (`evidencias/fase-D/D-11-caso-recusado.png`). Ver OBS-07. |
| D-12 | PASS | Documento compartilhado visível e baixável (HTTP 200); documento **interno não compartilhado não aparece**; o parceiro envia arquivo e nova versão (v2); caso recusado sem área de envio; pendências documentais sem ações de gestão. |
| D-13 | PASS | Responder solicitação aberta → "Resposta enviada."; solicitação resolvida não tem campo de resposta. |
| D-14 | PASS | "Cadastrar processo" a partir do caso (caso já escolhido); **clique duplo** → 1 processo; `/processos` sem responsável e próximo prazo. |
| D-15 | PASS | Movimentações do processo sem a nota MANUAL registrada pela equipe. |
| D-16 | PASS | `/pendencias` lista as solicitações do escritório; filtro Todas/Aberta/Respondida/Resolvida/Cancelada. |
| D-17 | PASS | `/minha-conta`: dados da sessão; PARTNER_ADMIN vê "Divisão padrão" e "Usuários do escritório". |
| D-19 | PASS | Rede desligada + filtro → "Não foi possível carregar os casos." + "Tentar novamente"; religar → volta. |
| F-10-PA | PASS | `/financeiro`: só a participação do próprio escritório, sem receita do escritório nem outros parceiros; repasses sem ações. |
| H-10 | PASS | Início do portal com casos, solicitações e "Sua participação"; nada de outro escritório. |
| H-11 | PASS | `/notificacoes` só com a notificação do próprio usuário (criada às 13:02, antes deste QA); "Marcar como lida" gravou `read_at`. |
| T-05 (parceiro) | PASS | Envio de caso e cadastro de processo com clique duplo → 1 registro cada. |

**Desempenho (ver BUG-06):** a lista `/clientes` do portal levou 6,5–14 s para 4 clientes (ADMIN: ~3 s
para 602), e uma chamada falhou com `57014` (statement timeout) após 8,2 s.

### Resumo dos lotes 12–13: PASS 26 · FAIL 0 (+1 defeito de desempenho)

## Lote 14 — 2026-10-15 — PARTNER_ADMIN do parceiro B (`qa.parceiro-b.admin@dgbrasil.test`)

Esta sessão foi aberta na janela destinada ao PARTNER_USER A (troca de conta no login). Ela foi
aproveitada para o lado inverso do isolamento; os resultados do script do PARTNER_USER rodado com
essa sessão foram **descartados** (não valem como resultado de PARTNER_USER).

| ID | Status | Evidência / observação |
|---|---|---|
| T-03 / D-18 (inverso) | PASS | Parceiro B abrindo o cliente `QA43 PF`, o caso `QA43 Caso Parceiro A`, o caso enviado pelo A e o processo do A → "não encontrado"; lista de clientes e `/pendencias` de B sem nada do A (`evidencias/transversal/T-03-parceiro-B.png`). |

## Lote 15 — 2026-10-15 — PARTNER_USER do parceiro A (`qa.parceiro-a.usuario@dgbrasil.test`)

Sessão: "QA Usuário Parceiro A · Usuário do parceiro · Parceiro QA A" (perfil novo, limpo).

| ID | Status | Evidência / observação |
|---|---|---|
| T-02 / F-11-PU | PASS | `/parceiros`, `/revisoes`, `/dg-brasil/execucoes`, `/casos/<id>/analise/nova`, `/clientes/<id>/editar` **e `/financeiro`** → acesso negado. |
| T-03 / A-17-P | PASS | Ids do parceiro B, o caso interno de origem A sem acesso e o processo interno → "não encontrado". O "Cliente Teste Interno" **abre**, mas desde o D-08 ele está na carteira do A (caso `QA43 Caso Portal outro oymo`, criado pelo PARTNER_ADMIN A; banco). Na ficha, o usuário vê só esse caso, sem os casos internos "Caso SM" e "Caso interno com origem A, sem acesso", sem processos e sem documentos internos (`evidencias/fase-D/D-08-cliente-na-carteira-PU.png`). Comportamento esperado pelo D-08; não é vazamento. |
| D-05 | PASS | Só clientes da carteira do A (inclui o cliente do D-08, como esperado); busca por nome e CPF; URL sem dígitos. |
| D-06 | PASS | Editar contato; apagar e-mail persiste; sem campos internos. |
| D-07 | PASS | Envio completo com clique duplo → 1 caso `QA43 Caso Portal ftbr` (criado por `qa.parceiro-a.usuario`, banco) e o arquivo depois do envio. |
| D-11, D-12, D-13, D-16 | PASS | Filtro de situações; documento compartilhado visível e baixável (HTTP 200); respondeu a solicitação aberta `… cancelar 8diz` ("Resposta enviada."); `/pendencias` com filtro. |
| D-14 | PASS | Clique duplo → 1 processo `QA43 Proc Portal dbl fio4`. |
| D-17 | PASS | `/minha-conta` **sem** "Divisão padrão" e **sem** "Usuários do escritório". |
| H-10 / H-11 | PASS | Início do portal **sem** "Sua participação"; `/notificacoes` só com as próprias. |

### Resumo do lote 15: PASS 13 · FAIL 0

## Consolidado final — 2026-10-15

| Papel | PASS | FAIL | NOT_RUN |
|---|---|---|---|
| ADMIN (fases A–H + transversais) | 70 | 7 | 4 |
| LAWYER | 10 | 0 | 1 (E-12-L) |
| ASSISTANT | 12 | 0 | 0 |
| PARTNER_ADMIN A | 26 | 0 | 0 |
| PARTNER_ADMIN B (isolamento inverso) | 1 | 0 | 0 |
| PARTNER_USER A | 13 | 0 | 0 |
| **Total** | **132** | **7** | **5** |

Pré-requisitos automatizados: `verificar` 481/481, unitários 388/388, lint e typecheck limpos, integração
172/172, `validar:real` 124/124 (`build` não rodado com o dev server ativo).

**FAILs:** A-08 (BUG-01), B-06 (BUG-02), F-02/F-03/F-05/F-08 (BUG-04), H-05 (BUG-05).
**Defeito fora dos itens do checklist:** BUG-06 (lentidão/timeout da lista de clientes do portal).
**Defeito do guia:** BUG-03 (SQL §6.2).
**NOT_RUN:** C-10b, E-04, E-06, E-12 (ADMIN e LAWYER), por falta de fixture possível sem IA.

**Limpeza pós-QA (§6.2) executada:** agente `qa-analise-43` INACTIVE, modelo "QA 4.3 — com agente"
inativo, 0 execuções na fila desse agente (a do QA já fora cancelada no G-02).
