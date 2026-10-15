# Etapa 4.3.1 — Relatório final (Feature Restoration & Product Closure)

## 1. Status

**`4.3.1 FEATURE RESTORATION READY FOR DEV VALIDATION`**

As nove funcionalidades estão implementadas com backend real, e as correções
do QA 4.3 também. Tudo está commitado e enviado (`master`, até o commit desta
documentação).

Nesta máquina passaram:
- **verificador (PGlite):** 579 verificações;
- **worker:** 34 testes;
- **front:** lint, typecheck, 422 testes unitários e build.

Falta o que só roda no Supabase DEV: `db push` das migrations **032–037**,
`validar:real`, `test:integration` (25 arquivos, 192 casos) e o QA manual.
O guia está em [`etapa-4.3.1-validacao.md`](etapa-4.3.1-validacao.md).

Antes da 4.3.1, foram corrigidos os defeitos do QA 4.3:
- **BUG-04:** página maior que o permitido no Financeiro;
- **BUG-06:** RLS do portal linha a linha (migration 032; 6 ms × 3.980 ms com 3.000 clientes de outro escritório);
- **BUG-01, 02, 03 e 05**, e as observações **OBS-01, 02, 03, 05, 06 e 07**.

Detalhes em [`qa/etapa-4.3/qa-bugs-4.3.md`](qa/etapa-4.3/qa-bugs-4.3.md).

## 2. Notifications

**Produtor.** `private.notify` (037) é o único ponto que grava notificação.

Regras:
- não avisa o autor da ação;
- só destinatário ativo (vínculo, organização e perfil);
- parceiro só recebe aviso de caso do próprio escritório (conferido dentro do produtor, além do cálculo de destinatários);
- respeita a preferência da categoria;
- `SECURITY` não se desliga;
- chave de evento única por usuário: nova tentativa, corrida ou gatilho repetido não duplicam.

Os gatilhos `AFTER` nas tabelas de domínio chamam o produtor na mesma
transação da operação. Operação recusada não deixa notificação, e isso é
testado com um aceite inválido.

**Eventos e destinatários** (calculados no banco, nunca vindos do navegador):

| Evento | Quem recebe |
|---|---|
| Caso enviado pelo parceiro | Advogado do caso; sem advogado, a triagem (ADMIN) |
| Caso atribuído | O advogado atribuído |
| Aceite e recusa | Escritório parceiro que opera o caso; na recusa, só o motivo público |
| Prazo novo ou atribuído | O responsável (ou o advogado do caso) |
| Prazo próximo (48 h) e vencido | O responsável, uma vez cada (`notify_deadline_reminders`: ciclo do worker e `pg_cron` se existir) |
| Documento solicitado | Escritório parceiro |
| Documento recebido | Advogado do caso |
| Revisão atribuída | O revisor |
| Revisão decidida | Quem pediu o material |
| Solicitação ao parceiro | Pelo escritório: o parceiro. Pelo parceiro: o advogado (ou a triagem) |
| Respostas na solicitação | O outro lado da conversa |
| Análise enviada | Advogado do caso, quando outra pessoa enviou |
| Análise aguardando revisão, concluída ou com falha | Quem pediu |
| Execução sem análise que exige atenção | Quem pediu |
| Repasse registrado ou pago | Só PARTNER_ADMIN |
| Segurança: MFA redefinido, troca de perfil | A própria pessoa |

**Categorias:** CASES, DEADLINES, DOCUMENTS, REVIEWS, PARTNER_REQUESTS,
ANALYSES, FINANCE e SECURITY (crítica).

**Preferências:** reaproveitam `user_notification_preferences`, com uma linha
por categoria. Constraints recusam categoria desconhecida e SECURITY sem
in-app. Telas: Configurações → Notificações (interno) e Minha conta (portal),
cada perfil vendo só as categorias que pode receber. E-mail e resumo ficam
guardados, com o aviso "Será usada quando notificações por e-mail forem
ativadas". Nenhum e-mail é enviado.

## 3. Review manual editing

**Versionamento.** `prepare_manual_revision` confere:
- quem edita (ADMIN ou LAWYER);
- revisão de documento aberta (pendente, reaberta ou com alterações pedidas);
- base = versão mais recente do documento;
- formato de texto.

Devolve o caminho exato da versão N+1, ou o resultado anterior da mesma
chave, e nesse caso nada é reenviado. O servidor grava o texto nesse caminho
(write-once). Em seguida, `commit_manual_revision_once` grava numa transação:
- a versão N+1 `MANUAL_EDIT`;
- a decisão `REQUEST_CHANGES` na revisão N (append-only, pelo `decide_review`);
- a revisão nova `PENDING`, com o mesmo responsável, prioridade e prazo;
- a auditoria `DOCUMENT_MANUALLY_REVISED`.

**Garantias:**
- a versão N fica intacta (linha e arquivo);
- aprovação nunca é herdada: a view por versão marca N como "substituída" e N+1 como "pendente";
- edições concorrentes da mesma base são serializadas, e a segunda é recusada.

**Tela:** mantém a UX do Front V1: "Editando manualmente · Versão N → Versão
N+1" e "Salvar nova versão", que abre a revisão nova.
- PDF e DOCX: "envie uma nova versão do arquivo".
- Revisão decidida: só leitura.
- "Solicitar alteração à IA" aparece desativado. O contrato futuro já existe: `worker_deliver_document` sempre cria versão e revisão novas.

## 4. Analysis / AgentRun cancellation

**Estados:** a máquina de estados não mudou e não há enum novo.

| Estado | O que "Interromper" faz |
|---|---|
| QUEUED | CANCELLED na hora; a mensagem do `pgmq` é arquivada |
| RUNNING | Grava `cancel_requested_at/by`; o worker confirma `CANCELLED` |
| Reserva vencida (worker morto) com pedido | Vira CANCELLED em vez de ser retomada; nova tentativa com pedido também encerra |
| WAITING_HUMAN | Só ADMIN; o LAWYER decide em Revisões |
| Encerrada | Recusado |

- Repetir o pedido é idempotente: `ALREADY_CANCELLED` ou `ALREADY_REQUESTED`.
- Quem pode: ADMIN, ou LAWYER do caso. ASSISTANT e parceiros, não.
- O `UPDATE` direto de RUNNING deixou de valer: a política foi restringida, nunca relaxada.

**Contrato do worker** (implementado em `apps/agentes`):
- `private.worker_cancel_requested` é conferido antes de começar, a cada batimento (aborta o agente pelo `AbortController` do SDK) e antes de encerrar;
- `worker_finish_run` aceita `CANCELLED` só com pedido registrado;
- com pedido, recusa concluir ou mandar para revisão;
- o que já tinha sido entregue antes do pedido fica em Revisões para decisão humana.

**Análise ← execução:** um gatilho novo mantém `legal_analyses` coerente
(fila, rodando, aguardando revisão, concluída, falhou, interrompida). Antes,
a análise ficava presa em "na fila".

**Auditoria:** `AGENT_RUN_CANCEL_REQUESTED` e `AGENT_RUN_CANCELLED`, com o autor e sem conteúdo.

**Tela:** "Interromper análise" (aba Análise) e "Interromper" (Execuções),
com confirmação e o servidor primeiro, mostrando "Interrupção solicitada"
enquanto o worker não confirma.

## 5. Payment schedule

- **Algoritmo:** total em centavos inteiros; parcela = total ÷ N (inteiro); o resto vai para as primeiras parcelas, um centavo em cada. R$ 100,00 em 3 = 33,34 + 33,33 + 33,33, e a soma é sempre exata. Sem float: o banco usa `numeric`, e a prévia do navegador usa a mesma regra, testada com os mesmos exemplos.
- **Vencimentos:** mensal a partir do 1º vencimento, preservando o dia quando o mês permite (31/01 → 28/02 → 31/03); quinzenal +14 dias; semanal +7.
- **Atomicidade:** uma transação, todas ou nenhuma. Provado com uma falha forçada na 3ª de 5 parcelas: nenhuma fica gravada, e a mesma chave funciona depois.
- **Idempotência:** chave por intenção (027). Clique duplo e nova tentativa devolvem o mesmo cronograma; mesma chave com outros dados é recusada.
- **Regras:** só ADMIN; só acordo DRAFT/ACTIVE; até 120 parcelas; auditoria `PAYMENT_SCHEDULE_CREATED`, sem valores.
- **Ledger:** cria só obrigações. Recebimento, divisão e repasse continuam nascendo só quando o dinheiro entra.

## 6. Partnership values

**O que voltou:** o diálogo "Valores" na participação por caso (financeiro do
parceiro, portal do PARTNER_ADMIN e aba Financeiro do caso), mostrando:
- percentual congelado no aceite e a data;
- receita elegível;
- participação calculada;
- parte do escritório (só interno);
- repassado e em repasse;
- saldo a repassar;
- recebido no caso inteiro (só interno);
- histórico de repasses do caso.

**Derivado e só leitura:** tudo vem da view `partner_agreement_share_totals`,
das divisões que o banco gera e dos repasses. Não existe formulário nem
escrita (a view não aceita `UPDATE`, testado). A divisão padrão do parceiro
continua na configuração administrativa e nunca retroage.

## 7. Contracted by model

- **Fonte:** view `financial_contracted_by_fee_model`.
- **Definição:** "contratado" é a soma das obrigações não canceladas dos acordos não cancelados, agrupada por modelo de honorários (sem modelo = "valores próprios"), com a quantidade de acordos. É o mesmo "Contratado" da lista e da visão geral.
- **Agregação:** somada no banco; o servidor só ordena e junta acima de 5 modelos (4 maiores + "Outros", como no Front V1). O navegador não baixa contratos.
- **Visibilidade:** só ADMIN, pela RLS.

## 8. Partner Case Timeline

**Fontes** (`get_partner_case_timeline`):
- caso cadastrado e enviado;
- mudanças de situação, lidas da trilha só dentro da função e devolvidas com o rótulo do parceiro: "Em análise" junta os passos internos, e mudança que não muda o rótulo não aparece;
- processos e movimentações oficiais ou do sistema;
- versões de documentos compartilhados;
- documentos pedidos e recebidos;
- solicitações e respostas.

**Sanitização:** DTO fixo (tipo, título, descrição segura, quando, rótulo de
autor e relação permitida).
- Autor: nome, se for do próprio escritório; nome do escritório responsável, se for da equipe interna.
- Nunca vêm: nota ou motivo interno, revisão, análise, execução, metadata de auditoria, IP ou user agent. Testado procurando esses textos na resposta.
- Parceiro B e equipe interna: "não encontrado" ou acesso negado.

**Paginação:** deslocamento e limite (1..100), total em cada linha. A tela
mostra 25 por vez, com "Carregar mais".

## 9. Partner Client Counts

**Métricas** (`get_partner_client_counts`): casos, processos, solicitações em
aberto e documentos pedidos. A tela mostra as colunas Casos, Processos e
Pendências, como no Front V1.

**Isolamento:**
- só clientes da carteira do escritório;
- só casos operados por ele;
- cliente com casos internos ou de outro escritório nunca "mostra" esses casos.

Testado com o mesmo cliente nos dois escritórios e com casos internos. É
uma consulta por página, sem N+1.

## 10. Migrations novas

Nenhuma migration anterior foi alterada. A próxima livre é a **038**.

| # | Conteúdo |
|---|---|
| 032 | RLS dos caminhos quentes do portal (QA BUG-06) |
| 033 | Interromper execução |
| 034 | Edição manual na revisão |
| 035 | Cronograma de parcelas, valores da parceria, contratado por modelo |
| 036 | Histórico e contagens do portal |
| 037 | Produtor de notificações e preferências |

## 11. Service role

**Zero usos novos.** A edição manual grava o texto pelo módulo que já era o
único uso da service role em Documentos (`documents/signed-storage.ts`), que
ganhou duas operações:
- ler os bytes de um caminho autorizado por `authorize_document_download`, que registra o acesso (LGPD) e a auditoria com o usuário como ator;
- gravar a versão nova no caminho que `prepare_manual_revision` devolveu.

O módulo continua sem decidir acesso. Nenhum outro arquivo usa service role.

## 12. Security

- **RLS:** não foi relaxada.
  - A 032 reescreve políticas com a mesma semântica, provada tabela a tabela contra o critério antigo, para três usuários parceiros.
  - A 033 restringe: RUNNING não se cancela mais por `UPDATE` direto.
- **SECURITY DEFINER:** toda função nova tem `search_path` vazio, e nenhuma tem EXECUTE para `anon`. Os blocos internos (produtor, conferências, rótulos, gatilhos) não são executáveis por `authenticated`. Isso é conferido no catálogo pelo verificador.
- **Entrada:** escopo sempre da sessão. Nenhuma função aceita organização, papel ou destinatário vindos do navegador.
- **Respostas:** "não encontrado" sem enumeração (`P0002`, agora mapeado para NOT_FOUND).
- **IDOR:** testado em todas as RPCs novas (outro escritório, id inventado, aal1, anon).
- **Notificações:** ninguém grava pela API (nem ADMIN).

## 13. Testes

| Suíte | Resultado |
|---|---|
| Banco (PGlite) | **579 verificações**, novas seções `[032]`–`[037]` e catálogo |
| Worker | **34** (interrupção durante a execução, erro com pedido, lembretes) |
| Unitários | **422** em 38 arquivos |
| Integração (DEV) | **192** casos em 25 arquivos. Novos: interrupt, review-edit (Storage real), finance, portal, notifications. **Ainda não rodados no DEV** |
| `validar:real` | Novas seções 41b, 41c, 42 e 43. **Ainda não rodado** |
| lint / typecheck / build | Limpos |
| E2E | Não criado: não há Playwright no projeto e não era obrigatório |
| QA manual | Checklist atualizado (91 itens já aprovados marcados, 8 retestes, 5 pendentes de fixture, 4.3.1 novo). **Pendente** |

## 14. Regressões

- As 481 verificações anteriores, os 31 testes anteriores do worker e os 388 unitários anteriores continuam passando com os gatilhos novos ativos.
- O teste de sanitização do DTO do parceiro foi atualizado de propósito: a receita elegível entrou no DTO, e é dado que o parceiro já lia pela RLS.
- O fluxo antigo "Cancelar" das Execuções foi substituído pelo "Interromper", que chama a mesma RPC.

## 15. Limitações restantes

- Os lembretes de prazo dependem do ciclo do worker, ou do `pg_cron` se o projeto tiver. Com o worker parado e sem `pg_cron`, "prazo próximo/vencido" não dispara; "prazo novo" sempre dispara.
- A edição manual vale só para minuta de texto (`.md`/`.txt`). DOCX e PDF continuam por nova versão do arquivo.
- E-mail e resumo de notificações ficam guardados, sem envio. SMTP é etapa futura.
- Algumas notificações dependem de eventos que só existirão com o worker real (análise concluída ou com falha, execução que exige atenção). Já estão testadas com o worker simulado.
- O volume das contagens e do histórico do portal está bem para o tamanho atual. Candidatos a read model se crescer muito: totais do financeiro e Início.
- Continuam de demonstração: configuração DG Brasil (agentes e afins), Integrações, Importação e Configurações → IA. Cada uma mostra o próprio aviso.

## 16. Comandos exatos para validação na outra máquina

Ver [`etapa-4.3.1-validacao.md`](etapa-4.3.1-validacao.md):

```bash
git pull origin master
cd supabase && npm install && npm run verificar        # 579
cd ../apps/frontend && npm install && npm run lint && npm run typecheck && npm test && npm run build   # 422
cd ../agentes && npm install && npm test                # 34
cd ../../supabase && npx supabase migration list && npx supabase db push && npx supabase migration list   # 032–037
npm run validar:real
cd ../apps/frontend && npm run test:integration         # 192
```

Depois, o QA manual: `docs/frontend-integration.md`, "QA manual — 4.3.1" e os itens "Retestar".

## 17. Próximo passo

**Auth / Security Production Hardening:** sessões e dispositivos ativos.
**Não iniciado.** Antes dele, rodar o guia de validação e corrigir o que
aparecer.
