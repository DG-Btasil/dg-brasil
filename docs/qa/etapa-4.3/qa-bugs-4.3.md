# QA 4.3 — Defeitos

Formato por defeito: funcionalidade · esperado × observado · passos · evidência
(sem segredos) · causa provável · severidade/impacto · correção sugerida.
Nenhum código de produção é alterado nesta rodada.

Problemas de ambiente, fixture ausente ou sessão expirada **não** entram aqui
(vão para [qa-pendencias-4.3.md](qa-pendencias-4.3.md)).

## BUG-01 — Documento de identidade incompleto não mostra erro no campo (PF)

- **Funcionalidade:** cadastro e edição de cliente PF, bloco "Documento de identidade" (Fase A, item A-08, FI:563).
- **Esperado:** "Tipo de documento sem número (ou o contrário) é apontado no campo." O schema
  já tem as mensagens: "Informe o número do documento (ou limpe o tipo)." e
  "Selecione o tipo do documento (ou limpe o número)."
- **Observado:** ao salvar só com o tipo (ou só com o número), nada é exibido.
  Não há mensagem, `aria-invalid` nem aviso; a tela fica parada e o foco vai para o
  campo. O usuário não sabe por que "Salvar alterações" não funciona.
- **Passos:** `/clientes/<id PF>/editar` → "Documento de identidade" = RG, "Número do
  documento" vazio → "Salvar alterações". Repetir com número preenchido e tipo vazio.
- **Evidência:** `evidencias/fase-A/A-08-tipo-sem-numero.png` (foco no campo, sem
  mensagem); nenhum erro de console nem requisição com falha.
- **Causa provável:** em `apps/frontend/src/features/clients/components/form/individual-fields.tsx`
  (linhas 44–55), os `Field` "Documento de identidade", "Número do documento",
  "Órgão emissor" e "UF" não recebem `error={errors.idType?.message}` /
  `errors.idNumber?.message`, ao contrário de "Nome completo" e "CPF". A validação
  (`schemas.ts:57-62`) registra o erro em `idNumber`/`idType`, que nunca é renderizado.
- **Severidade:** média. Não corrompe dados (o banco tem a constraint
  `individual_client_details_identity_complete` e o envio é bloqueado), mas deixa o
  usuário sem explicação, no cadastro e na edição.
- **Correção sugerida:** passar `error` dos quatro campos (pelo menos `idType` e
  `idNumber`) para o `Field`, e um teste unitário que renderize a mensagem.

_Não corrigido nesta rodada (sem alteração de código de produção)._

## Observações (não são defeitos de produto)

### OBS-01 — `validar:real` deixa execuções na fila com agente fictício ATIVO

- **Onde:** `supabase/tests/real/validar-real.mjs` (linhas ~486–612), harness de validação, não o app.
- **Observado (2026-10-15, leitura no DEV):** 9 agentes `teste-rmv…` com status
  `ACTIVE`; 9 execuções `QUEUED` e 8 `WAITING_HUMAN` desses agentes, uma por rodada
  desde 2026-10-09 (inclusive a de hoje, `rmv9r5unb`). Os testes de integração
  (`apps/frontend`) cancelam as suas; o `validar:real` não.
- **Risco:** com o worker parado, nenhum. Se o worker de `apps/agentes` for ligado
  no DEV, ele encontrará essas execuções na fila e pode chamar a IA real com
  agentes fictícios (custo e ruído), contrariando "nada executa IA nesta etapa".
- **Severidade:** baixa (higiene de ambiente/teste).
- **Sugestão:** no fim do `validar:real`, cancelar as execuções `QUEUED` da
  rodada e inativar o agente `teste-<rodada>`; para a fila atual, um `update
  agent_runs set status='CANCELLED' where status='QUEUED' and agent_id in (agentes teste-rmv%)`
  — **não executado**, aguardando sua decisão. (Antes disso, essas execuções podem
  servir de fixture para G-01/G-02.)

### OBS-02 — Mensagem enganosa para CPF com dígitos repetidos

- **Onde:** `apps/frontend/src/server/core/validation.ts:21` e `lib/validation/index.ts:30`.
- **Observado (A-11):** o CPF `111.111.111-11` (11 dígitos, todos iguais) recebe
  "CPF deve ter 11 dígitos.". A regra é `length === 11 && !allSame`, e a mensagem só
  descreve o tamanho. Pelo código, não há conferência dos dígitos verificadores
  (não testado na UI com um CPF de verificador errado).
- **Severidade:** baixa (texto). **Sugestão:** "CPF inválido." para os dois casos e
  decidir se o verificador deve ser conferido.

### OBS-03 — Selo "Demonstração" no cabeçalho com dados reais

- **Onde:** `components/layout/app-header.tsx:30` e `user-menu.tsx:19`.
  `DEMO_MODE = NEXT_PUBLIC_DEMO_MODE !== "false"`, ou seja, ligado quando a variável não existe.
- **Observado:** o cabeçalho mostra "DEMONSTRAÇÃO" sobre telas que já leem o banco real.
  O menu do usuário oferece ao ADMIN "Restaurar dados de demonstração". Pelo código
  (`store/slices/session-office.ts:48`), isso só recria o store local de demonstração e **não toca no banco**;
  mas o diálogo diz "Todos os clientes, processos, revisões e configurações criados nesta demonstração serão
  substituídos pelos dados originais", o que hoje é enganoso (esses dados são reais). Não foi clicado.
- **Severidade:** baixa/média (configuração + texto enganoso). **Sugestão:** documentar a variável no
  `.env.example`, definir o padrão para DEV e produção e restringir ou reescrever o texto de "Restaurar dados de demonstração".

### OBS-04 — Seletores poluídos por usuários e escritórios das rodadas automáticas

- **Observado:** "Responsável" lista dezenas de "Teste ADMIN"/"Teste LAWYER" repetidos e
  "rmv….convidado"; "Origem" lista dezenas de "Parceiro A/B/Auditoria/Int …". São dados
  das rodadas `validar:real` e `test:integration` no mesmo projeto DEV.
- **Impacto:** atrapalha o QA manual (nomes iguais, impossível distinguir). Não é defeito do app.
- **Sugestão:** limpeza periódica das rodadas antigas no DEV, ou nomes únicos por rodada para os usuários de teste.

## BUG-02 — Lista de processos omite o caso quando há "Tipo de ação"

- **Funcionalidade:** `/processos`, coluna "Tipo / ação" (Fase B, item B-06, FI:602).
- **Esperado:** "lista com cliente, caso e próximo prazo" (o servidor já devolve `caseTitle`).
- **Observado:** a 2ª linha da célula mostra `p.actionType ? p.title : p.caseTitle`.
  Com tipo de ação preenchido (o normal num processo distribuído), aparecem tipo e
  título do processo, e o **caso não aparece em nenhuma coluna**.
- **Passos:** cadastrar processo com "Tipo de ação" preenchido → `/processos` → a linha
  mostra "Ação revisional… / QA43 Proc CNJ fr5n", sem "QA43 Caso Processos 5uwo".
- **Causa provável:** `apps/frontend/src/features/processes/components/process-list-table.tsx:89-90`.
- **Severidade:** baixa (informação ausente na lista; a ficha mostra o caso).
- **Correção sugerida:** mostrar o caso sempre, por exemplo como 3ª linha ou em coluna
  própria, ou mostrar "título · caso" na 2ª linha.

### OBS-05 — "Baixar" abre o arquivo na mesma aba

- **Onde:** `apps/frontend/src/features/documents/use-document-actions.ts:63-66` (link `<a>` sem `target`/`download`).
- **Observado (C-04):** o PDF substitui a página do app na aba atual; para voltar, é preciso usar o "Voltar" do navegador.
- **Severidade:** baixa (UX). Atende ao checklist ("abre/baixa").
- **Sugestão:** `target="_blank"` ou o parâmetro `download` na URL assinada do Storage.

## BUG-03 — SQL de preparação do guia (§6.2) cria o agente sem versão atual

- **Onde:** `docs/etapa-4.3-validacao.md`, §6.2 (bloco "ANTES do QA"). Afeta só a preparação do QA, não o app.
- **Esperado:** agente fictício `qa-analise-43` ATIVO **com versão atual** (FI:702).
- **Observado (2026-10-15):** com o agente ainda inexistente, o bloco criou agente e versão,
  mas `current_version_id` ficou NULL. A conferência do próprio guia não mostra isso,
  porque olha só `status` e `active`.
- **Causa:** as CTEs `a` (insert do agente) e `v` (insert da versão) rodam no mesmo comando
  que `update public.agents … from v`. No PostgreSQL, o UPDATE principal não enxerga
  linhas inseridas pelas CTEs do mesmo comando, então atualiza 0 linhas.
- **Severidade:** média para o QA (E-03, E-04, G-01 e G-02 dependem do envio ao agente); nenhuma para produção.
- **Correção sugerida:** separar em dois comandos, ou usar `insert into agents (…, current_version_id)`
  depois da versão; incluir `current_version_id is not null` na consulta de conferência.
- **Contorno aplicado (fixture fictícia, DEV):** `update agents set current_version_id = <versão criada pelo bloco>
  where slug = 'qa-analise-43' and current_version_id is null` → 1 linha; conferência: agente ACTIVE, com versão, modelo ativo.

### OBS-06 — Análise na fila aparece como "Em análise" no cartão e "Na fila do agente" na tabela

- **Onde:** aba Análise do caso (E-03). Análise com status QUEUED.
- **Observado:** o cartão da análise atual mostra "Em análise · Com o agente."; a tabela "Análises do caso"
  mostra "Na fila do agente" para o mesmo registro. O checklist (FI:713) espera "Na fila do agente".
- **Severidade:** baixa (rótulo). **Sugestão:** usar o mesmo rótulo de situação nos dois lugares.

## BUG-04 — Financeiro: novo contrato, modelos e obrigações/lançamentos não carregam (pageSize 100 > máximo 50) — ALTA

- **Funcionalidade:** Fase F — gaveta de **todo** contrato (lista de obrigações e de lançamentos), `/financeiro/contratos/novo` (com ou sem `?caso=`, inclusive pelo link
  "Novo contrato de honorários" da aba Financeiro do caso) e Configurações → Modelos de honorários.
- **Esperado:** F-02 (criar contrato com/sem modelo, ativar agora, clique duplo, 2º ativo recusado) e
  F-08 (listar, criar, editar, inativar modelos).
- **Observado:** as duas telas mostram só o erro "Não foi possível abrir o cadastro de contrato." /
  "Não foi possível carregar os modelos." com "Confira os dados informados." e código de referência
  (ex.: `FC604DDD`, `E7B833C4`, `5A7014F1`). Reproduz 100%, em 4 variantes de URL.
- **Passos:** ADMIN → `/financeiro` → "Novo contrato de honorários"; ou `/configuracoes?secao=honorarios`.
- **Evidência:** `evidencias/fase-F/F-novo-contrato-erro.png`, `evidencias/fase-F/F-08-modelos-honorarios.png`.
- **Causa provável (código):** `app/(app)/financeiro/contratos/novo/page.tsx:11` chama
  `listFeeModelsAction({ active: true, pageSize: 100 })`, e
  `features/settings/components/sections/fees-section.tsx:41` chama `listFeeModelsAction({ pageSize: 100 })`;
  `features/finance/components/agreement-drawer.tsx:54` chama `listPaymentsAction({ …, pageSize: 100 })` e
  `:63` chama `listReceiptsAction({ …, pageSize: 100 })` (gaveta: "Não foi possível carregar as obrigações.").
  `listFeeModelsSchema` estende `pageInputSchema`, com `pageSize … .max(MAX_PAGE_SIZE)`, e
  `MAX_PAGE_SIZE = 50` (`server/core/pagination.ts:10`). O Zod recusa a entrada → `VALIDATION`.
  Os testes não pegaram porque os unitários não renderizam a página e a integração chama o service direto.
- **Severidade:** **alta**. Não há como criar contrato, gerir modelos, nem registrar recebimento,
  estorno, ajuste ou cancelamento de obrigação pela UI: o núcleo da Fase F. Os dados existentes
  não são afetados, e totais, conclusão e repasses funcionam.
- **Correção sugerida:** `pageSize: 50` (ou paginar/buscar os modelos), ou uma action dedicada
  "todos os modelos ativos" com teto próprio; teste que renderize as duas páginas ou valide as
  entradas fixas das actions contra o schema.

## BUG-05 — OAB do escritório perde o último dígito (máscara corta em 12 caracteres)

- **Funcionalidade:** Configurações → Geral → "OAB da sociedade ou do titular" (H-05, FI:813).
- **Esperado:** gravar e exibir "OAB/SP 123.456" (exemplo do checklist; o placeholder é "OAB/UF 000.000").
- **Observado:** digitando "OAB/SP 123.456" letra a letra, o campo fica "OAB/SP 12345" e é gravado
  assim, **sem aviso**. Com 6 dígitos sem prefixo ("123456") o campo aceita.
- **Causa provável:** `apps/frontend/src/lib/formatting/masks.ts:89`:
  `oab: (v) => v.toUpperCase().replace(/[^0-9A-Z/ ]/g, "").slice(0, 12)`. Remove o ponto do próprio
  placeholder e corta "OAB/SP 123456" (13 caracteres) em 12.
- **Severidade:** média (perda silenciosa de dado que aparece em documentos do escritório).
- **Correção sugerida:** máscara que aceite o formato do placeholder (`OAB/UF 000.000`, com ponto)
  ou um limite que comporte "OAB/UF" + 6 dígitos, e validação no servidor do formato completo.

## BUG-06 — Lista de clientes do Portal do Parceiro lenta, com timeout intermitente

- **Funcionalidade:** Portal do Parceiro → `/clientes` (`clients.list` com sessão de parceiro).
- **Esperado:** carregar a carteira do parceiro (4 clientes no QA A) em tempo comparável às demais listas.
- **Observado (DEV, mesmo servidor e mesmo momento):** parceiro `/clientes` 6,5 s, 6,5 s, 7,0 s, 8,0 s e
  14,3 s (1ª carga); ADMIN `/clientes` (602 clientes) ~3 s; demais listas do portal ~4,7 s. Durante o D-08
  o log do app registrou `{"action":"clients.list","code":"INTERNAL","technicalCode":"57014","durationMs":8205}`
  (e outra a 8216 ms): **cancelamento por statement timeout no PostgreSQL**. A tela mostrou erro e a
  carteira apareceu vazia.
- **Causa provável (não confirmada):** consulta de clientes sob RLS do parceiro (vínculo cliente ×
  escritório e visibilidade) cara: talvez subconsulta por linha, ou índice ausente na tabela de vínculo.
  Recomendo `EXPLAIN (ANALYZE)` com o JWT do parceiro.
- **Severidade:** média/alta. Falha intermitente para o parceiro e tende a piorar com o volume.
- **Correção sugerida:** analisar o plano sob RLS do parceiro; índices nas colunas da política; ou um read
  model/RPC `security definer` limitado ao escritório da sessão.

### OBS-07 — "Em análise" significa coisas diferentes no portal

- **Observado:** o Início do portal mostra "Casos em análise 1" (inclui Enviado e Aguardando documentos,
  `PARTNER_IN_ANALYSIS` em `features/home/load.ts:113`), mas o filtro "Em análise" de `/casos` traz 0
  (o caso enviado aparece como "Enviado").
- **Severidade:** baixa (rótulo). **Sugestão:** rotular o card como "Enviados e em análise" ou alinhar os grupos.
