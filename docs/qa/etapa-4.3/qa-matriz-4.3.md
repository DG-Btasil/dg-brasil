# QA 4.3 — Matriz de validação

Matriz única dos cenários da etapa 4.3, sem duplicações, com rastreabilidade
até o item original. Resultados ficam em [qa-execucao-4.3.md](qa-execucao-4.3.md).

## Fontes encontradas

| Documento | Conteúdo usado |
|---|---|
| `docs/etapa-4.3-validacao.md` | §2 verificações locais, §3 migrations, §4 `validar:real`, §5 integração, §6 preparação (usuários QA, agente fictício, notificação), §7.1 verificações transversais |
| `docs/frontend-integration.md` | "QA manual — Fase A … H" (linhas 542–830); seção "Testes" (cobertura automatizada) |
| `docs/etapa-4.3-relatorio.md` | status da etapa e áreas fora do escopo |
| `docs/auth.md` | regras de MFA/sessão; "QA manual (DEV, contas fictícias)" é da etapa de Auth (fora desta matriz) |
| `supabase/README.md`, `supabase/scripts/usuarios-qa.mjs` | usuários QA fixos, trava `DG_ENV=development` |
| `apps/frontend/tests/integration/*.int.test.ts` (20 arquivos) | testes de integração (Supabase DEV) |
| `supabase/tests/verificar.mjs` | banco simulado (PGlite) |

Referência de linha: `FI:nnn` = `docs/frontend-integration.md`, `VAL:nnn` = `docs/etapa-4.3-validacao.md`.

## Legenda de classificação

- **ADM** — executável com ADMIN.
- **ROLE(x)** — exige outro papel (L = LAWYER, S = ASSISTANT, PA/PU = PARTNER_ADMIN/USER do parceiro A, PB = parceiro B).
- **AUTO** — coberto também por teste automatizado (o resultado do teste é conferido em P-xx; não substitui a parte de UI).
- **PREP** — exige preparação de dados/infra.
- **HUM** — exige intervenção humana (autenticação, rede física etc.).
- **OOS** — fora do escopo atual.

Um item multi-papel foi dividido: a parte ADMIN fica aqui; a parte dos outros papéis tem sufixo `-L`, `-S`, `-P`.

## Pré-requisitos e testes automatizados

| ID | Item | Fonte | Classe |
|---|---|---|---|
| P-01 | `npm run verificar` (PGlite) — 481 verificações | VAL:29 | AUTO |
| P-02 | Front: `npm test` (388), lint, typecheck, build | VAL:34-38 | AUTO |
| P-03 | Migrations 028–031 aplicadas no DEV (`migration list`) | VAL:44-61 | HUM (CLI vinculada) |
| P-04 | `npm run validar:real` | VAL:63-68 | AUTO |
| P-05 | `npm run test:integration` (≈172 casos, 20 arquivos) | VAL:70-88 | AUTO |
| P-06 | Usuários QA (`npm run usuarios:qa`) + termos/MFA no 1º login | VAL:92-117 | HUM |
| P-07 | Agente e modelo fictícios (SQL §6.2) | VAL:119-154 | PREP |
| P-08 | Notificação de teste para o ADMIN (SQL §6.3) | VAL:165-179 | PREP |
| P-09 | Worker de agentes parado | VAL:12-14 | — (pré-condição) |

## Transversais (§7.1)

| ID | Item | Fonte | Classe |
|---|---|---|---|
| T-01 | Rota direta / nova aba / recarregar em fichas (cliente, caso, processo, revisão, parceiro) | VAL:190; FI:577 | ADM |
| T-02 | Permissão por rota (ASSISTANT, PARTNER_USER, parceiro) | VAL:192 | ROLE(S,PU,PA) |
| T-03 | Parceiro A × B → "não encontrado" | VAL:196; FI:696 | ROLE(PA,PB) · AUTO |
| T-04 | IDOR: uuid inventado/de outro escritório → "não encontrado" | VAL:198; FI:575,611 | ADM · AUTO |
| T-05 | Idempotência por clique duplo em cada criar/enviar | VAL:200 | ADM (+ ROLE(PA) p/ envio de caso/processo do parceiro) · AUTO |
| T-06 | Rede desligada → "Tentar novamente"; vazio e esmaecido | VAL:203; FI:578,698 | HUM/PREP (emulação offline) |
| T-07 | CPF/CNPJ fora da URL | VAL:206; FI:550,602 | ADM · AUTO |
| T-08 | Sem dado de demonstração na área jurídica | VAL:208 | ADM |
| T-09 | Áreas que continuam de demonstração (esperado) | VAL:212-216 | OOS (só conferir que continuam isoladas) |

## Fase A — Clientes (FI:542-585)

| ID | Item | Fonte | Classe |
|---|---|---|---|
| A-01 | `/clientes` sem flash de demo; vazio → "Nenhum cliente cadastrado." | FI:548 | ADM (vazio: PREP — usar filtro sem resultado) |
| A-02 | Busca por nome (debounce), por parte do CPF; URL sem dígitos | FI:550 | ADM · AUTO |
| A-03 | Filtros (tipo, situação, responsável, origem) e ordem; recarregar mantém | FI:552 | ADM · AUTO |
| A-04 | Paginação > 25 clientes | FI:554 | ADM (PREP se < 26) |
| A-05 | Cadastrar PF e PJ; loading; duplo clique → um; abre a ficha | FI:555 | ADM |
| A-06 | CPF duplicado → mensagem no campo | FI:557 | ADM |
| A-07 | Editar; apagar nome social apaga | FI:559 | ADM · AUTO |
| A-08 | PF: apagar nascimento, gênero, estado civil, identidade; tipo sem número → erro no campo | FI:561 | ADM · AUTO |
| A-09 | ADMIN corrige CPF | FI:564 | ADM · AUTO |
| A-09-L/S | LAWYER/ASSISTANT alterando CPF → aviso, nada salvo | FI:564 | ROLE(L,S) · AUTO |
| A-10 | Inativar/reativar; lista "Inativos" | FI:566 | ADM |
| A-11 | PJ — representantes e sócios (adicionar, editar, remover, principal, erro, descartar) | FI:568 | ADM · AUTO |
| A-12 | ADMIN exclui → volta à lista | FI:572 | ADM |
| A-12-L/S | LAWYER/ASSISTANT sem "Ações perigosas" | FI:573 | ROLE(L,S) |
| A-13 | ASSISTANT: "Origem" só escritório proprietário | FI:574 | ROLE(S) · AUTO |
| A-14 | `/clientes/<uuid inexistente>` e `/clientes/abc` → "Cliente não encontrado." | FI:575 | ADM |
| A-15 | Ficha em nova aba / recarregar | FI:577 | ADM (= T-01) |
| A-16 | Rede off + filtro → "Tentar novamente" | FI:578 | HUM/PREP (= T-06) |
| A-17-P | Parceiro em `/clientes/<id interno>` sem dados internos | FI:583 | ROLE(PA,PU) |
| A-18-P | Parceiro em `/clientes/<id>/editar` → acesso negado | FI:585 | ROLE(PA,PU) |

## Fase B — Casos e Processos (FI:587-622)

| ID | Item | Fonte | Classe |
|---|---|---|---|
| B-01 | `/casos`: filtros (situação, área, responsável, cliente, origem, período), ordem, páginas, recarregar | FI:591 | ADM · AUTO |
| B-02 | Novo caso: buscar cliente; rascunho e enviar → ficha; clique duplo → um | FI:593 | ADM · AUTO |
| B-03 | Ficha: editar área/tipo, advogado, aceitar (sem advogado → aviso), rejeitar (motivo), em andamento, encerrar, arquivar | FI:595 | ADM |
| B-04 | ADMIN altera origem de caso aceito (motivo + confirmação) | FI:598 | ADM |
| B-04-L | LAWYER não vê "Alterar origem" | FI:599 | ROLE(L) |
| B-05 | Aba Processos do caso; "Cadastrar processo" com caso escolhido | FI:600 | ADM |
| B-06 | `/processos`: cliente, caso, próximo prazo; filtros; CNJ fora da URL | FI:602 | ADM · AUTO |
| B-07 | Cadastrar processo (CNJ válido e sem CNJ); prazo inicial; CNJ errado → erro no campo | FI:604 | ADM · AUTO |
| B-08 | Editar processo: apagar vara e valor da causa | FI:606 | ADM · AUTO |
| B-09 | Registrar andamento (origem "Equipe") | FI:607 | ADM · AUTO |
| B-10 | Prazos: adicionar, editar, cumprir, cancelar; vencido → "Vencido" | FI:608 | ADM · AUTO |
| B-11 | ADMIN exclui processo → volta ao caso | FI:610 | ADM |
| B-11-L | LAWYER não vê "Excluir" | FI:610 | ROLE(L) |
| B-12 | `/casos/<…>` e `/processos/<…>` inexistente/outro escritório → "não encontrado" | FI:611 | ADM (= T-04) · AUTO |
| B-13-S | ASSISTANT: vê, cria caso, sem decisões, sem processo/prazo | FI:616 | ROLE(S) · AUTO |
| B-14-P | Parceiro: rotas de outro escritório → "não encontrado" | FI:621 | ROLE(PA,PU) (= T-03) |

## Fase C — Documentos (FI:624-646)

| ID | Item | Fonte | Classe |
|---|---|---|---|
| C-01 | Cliente → Documentos: enviar PDF; etapas; "Não verificado" | FI:628 | ADM · AUTO |
| C-02 | .zip ou > 50 MB → aviso antes de enviar | FI:630 | ADM |
| C-03 | Rede off durante envio → etapa + "Tentar novamente" | FI:631 | HUM/PREP |
| C-04 | Baixar (URL de 60 s) | FI:633 | ADM · AUTO |
| C-05 | Nova versão → v2 "Não verificado"; histórico com download por versão | FI:635 | ADM |
| C-06 | Verificado / divergência (com nota) | FI:637 | ADM · AUTO |
| C-07 | Arquivar / reativar | FI:638 | ADM |
| C-08 | ADMIN exclui documento | FI:639 | ADM |
| C-08-L/S | LAWYER/ASSISTANT sem "Excluir documento" | FI:639 | ROLE(L,S) |
| C-09 | Caso → pendência: nova (solicitada), enviar, registrar recebimento, aprovar, rejeitar → "Solicitar de novo" | FI:640 | ADM (aprovação por LAWYER: ROLE(L)) · AUTO |
| C-09-S | ASSISTANT não vê Aprovar/Rejeitar | FI:641 | ROLE(S) · AUTO |
| C-10 | Caso de parceiro: "Compartilhar"; caso interno sem opção | FI:643 | ADM (PREP: caso com parceiro vinculado) · AUTO |
| C-10b | Minuta de agente não aprovada recusada pelo servidor | FI:644 | PREP (exige minuta gerada por agente — não há sem IA) |
| C-11 | Processo → Documentos: enviar; aparece no caso | FI:646 | ADM |

## Fase D — Parceiros e Portal (FI:648-698)

| ID | Item | Fonte | Classe |
|---|---|---|---|
| D-01 | `/parceiros`: busca, situação, páginas; contadores batem | FI:655 | ADM |
| D-01-L/S | LAWYER/ASSISTANT não veem divisão | FI:657 | ROLE(L,S) |
| D-02 | ADMIN cadastra, edita, divisão, situação | FI:658 | ADM |
| D-02-L | LAWYER sem esses botões | FI:659 | ROLE(L) |
| D-03 | Ficha do parceiro: equipe, clientes, casos, processos, solicitações só dele | FI:660 | ADM |
| D-04 | Caso de parceiro → Solicitações: nova, responder, resolver, cancelar | FI:662 | ADM · AUTO |
| D-05-P | Portal `/clientes`: só os próprios; busca; CPF fora da URL | FI:668 | ROLE(PA,PU) |
| D-06-P | Ficha: editar contato/endereço; apagar e-mail | FI:670 | ROLE(PA,PU) |
| D-07-P | `/clientes/novo` fluxo completo; clique duplo → um caso; arquivos depois | FI:672 | ROLE(PA,PU) |
| D-08-P | CPF de OUTRO escritório → mensagem sem nome; caso no cadastro existente | FI:675 | ROLE(PA) |
| D-09-P | CPF já na carteira → "Abrir cliente"/"Criar novo caso" | FI:678 | ROLE(PA) |
| D-10-P | Rate limit de consultas | FI:679 | ROLE(PA) |
| D-11-P | `/casos`: filtro "Em análise"; recusado só motivo público | FI:681 | ROLE(PA) |
| D-12-P | Caso → Documentos (enviar, nova versão, baixar; interno não aparece; recusado sem envio; pendências leitura) | FI:683 | ROLE(PA) |
| D-13-P | Caso → Pendências: responder; resolvida não aceita | FI:686 | ROLE(PA) |
| D-14-P | Cadastrar processo pelo caso; clique duplo; `/processos` sem campos internos | FI:688 | ROLE(PA) |
| D-15-P | Movimentações: sem nota manual | FI:690 | ROLE(PA) · AUTO |
| D-16-P | `/pendencias` + filtro | FI:692 | ROLE(PA) |
| D-17-P | `/minha-conta`: PA vê divisão e usuários; PU não | FI:694 | ROLE(PA,PU) |
| D-18-P | A abrindo ids de B → "não encontrado" | FI:696 | ROLE(PA) (= T-03) |
| D-19-P | Rede off no portal | FI:698 | HUM/PREP |

## Fase E — Análises e Revisões (FI:700-739)

| ID | Item | Fonte | Classe |
|---|---|---|---|
| E-01 | Caso sem análises → vazio com "Nova análise" | FI:707 | ADM |
| E-02 | Modelo SEM agente: envio desabilitado; criar → "Pendente" + documentos faltando | FI:708 | ADM |
| E-03 | Modelo COM agente + documentos: clique duplo em "Iniciar e enviar" → 1 análise, 1 execução | FI:711 | ADM · PREP(P-07) · AUTO |
| E-04 | Faltando documento: envio não oferecido; após enviar documento, aparece e funciona | FI:714 | ADM · PREP(P-07) |
| E-05 | Análise na fila → "já possui uma análise em andamento" | FI:716 | ADM · PREP(P-07) |
| E-06 | Campo obrigatório vazio → erro; servidor recusa campo fora do modelo | FI:718 | ADM (2ª parte: AUTO) |
| E-07 | `/revisoes`: visões, filtros, páginas, recarregar | FI:723 | ADM |
| E-08 | Abrir revisão de análise/documento/proposta; baixar versão | FI:724 | ADM · PREP (revisões existentes; proposta de agente exige execução de IA → NOT_RUN) |
| E-09 | Atribuir responsável, prioridade, prazo | FI:726 | ADM · PREP |
| E-10 | Aprovar / pedir alterações / rejeitar; histórico | FI:728 | ADM · PREP · AUTO |
| E-11 | Reabrir decidida (não para proposta) | FI:730 | ADM · PREP |
| E-12 | Proposta estrutural: LAWYER só aviso; ADMIN decide | FI:731 | PREP (proposta de agente) + ROLE(L) |
| E-13 | Caso → Revisões lista as do caso | FI:733 | ADM |
| E-14-S | ASSISTANT sem abas e rotas de análise/revisão | FI:737 | ROLE(S) · AUTO |
| E-15-P | Parceiro sem rotas de revisão/análise | FI:739 | ROLE(PA,PU) |

## Fase F — Financeiro (FI:741-779)

| ID | Item | Fonte | Classe |
|---|---|---|---|
| F-01 | `/financeiro`: totais, gráfico; contratos paginados; filtro na URL | FI:745 | ADM · AUTO |
| F-02 | Novo contrato (com/sem modelo; ativar sim/não); clique duplo; 2º ativo recusado | FI:747 | ADM · AUTO |
| F-03 | Gaveta: obrigação, recebimento parcial, quitar, estorno parcial, ajuste; situações | FI:751 | ADM · AUTO |
| F-04 | Concluir com aberto → recusa; quitada → conclui; concluído sem novas ações; estorno disponível | FI:755 | ADM · AUTO |
| F-05 | Cancelar obrigação (motivo); com recebimento → pede estorno | FI:758 | ADM |
| F-06 | Caso → Financeiro: contratos e parceria (percentual congelado) | FI:760 | ADM · PREP (caso de origem parceira aceito) |
| F-07 | Parceiro → Financeiro: participação, repasses; repasse maior → recusa; pago; cancelar | FI:762 | ADM · PREP (recebimento em caso de parceiro) |
| F-08 | Configurações → Modelos de honorários: criar, editar, inativar | FI:765 | ADM |
| F-09-L/S | Sem Financeiro; `/financeiro` negado; sem aba | FI:769 | ROLE(L,S) · AUTO |
| F-10-PA | Portal: só participação própria; repasses só leitura | FI:774 | ROLE(PA) |
| F-11-PU | `/financeiro` negado | FI:779 | ROLE(PU) |

## Fase G — Execuções (FI:781-798)

| ID | Item | Fonte | Classe |
|---|---|---|---|
| G-01 | DG Brasil → Execuções: páginas; filtro na URL; execução da E-03 "Na fila" | FI:785 | ADM · PREP(E-03) · AUTO |
| G-02 | Cancelar execução na fila → "Cancelada"; concluída/cancelada sem botão | FI:787 | ADM · PREP(E-03) |
| G-03 | Caso → Análise: execuções só do caso | FI:789 | ADM · AUTO |
| G-04-L | LAWYER vê execuções do caso, sem Cancelar, sem DG Brasil | FI:793 | ROLE(L) · AUTO |
| G-05-S/P | ASSISTANT/parceiros sem execuções; rota negada | FI:798 | ROLE(S,PA,PU) · AUTO |

## Fase H — Painéis e configurações (FI:800-829)

| ID | Item | Fonte | Classe |
|---|---|---|---|
| H-01 | Início: contadores batem com as listas | FI:804 | ADM |
| H-02 | Menu da casa: contadores coerentes; recarregar | FI:807 | ADM |
| H-03 | Cliente/caso/parceiro → Atividade | FI:808 | ADM · AUTO |
| H-04 | Configurações → Segurança: postura; auditoria com filtros e páginas | FI:810 | ADM |
| H-05 | Configurações → Geral: salvar; recarregar; OAB "OAB/SP 123.456" | FI:812 | ADM (alteração reversível — restaurar valor original) |
| H-06 | Processos: faixa de contadores; "em até 5 dias"; `?prazo=vencidos` | FI:814 | ADM · AUTO |
| H-07 | Processo → Revisões e → Financeiro | FI:816 | ADM |
| H-08 | Sino: notificação de teste; marcar lida e todas | FI:817 | ADM · PREP(P-08) |
| H-09-L/S | Início sem financeiro/atividade/execuções; revisões só LAWYER; sem Atividade | FI:822 | ROLE(L,S) · AUTO |
| H-10-P | Início do portal só do próprio escritório; participação só PA | FI:827 | ROLE(PA,PU) |
| H-11-P | `/notificacoes`: só as próprias; marcar lida | FI:829 | ROLE(PA,PU) · PREP |

## Contagem

Contada por script sobre as linhas desta matriz (131 itens):

| Classe principal | Itens |
|---|---|
| ADM (inclui ADM+PREP/AUTO; 71 de fase + 5 transversais) | 76 |
| ROLE (37 com sufixo + A-13 + T-02 + T-03) | 40 |
| HUM/PREP sem parte ADMIN (A-16, C-03, C-10b, E-12, T-06) | 5 |
| OOS (T-09) | 1 |
| Pré-requisitos/automatizados (P) | 9 |
