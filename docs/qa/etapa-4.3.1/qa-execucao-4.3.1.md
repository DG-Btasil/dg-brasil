# QA 4.3.1 — Execução

Guia: [`docs/etapa-4.3.1-validacao.md`](../../etapa-4.3.1-validacao.md). Supabase DEV, dados fictícios,
worker de agentes parado o tempo todo. Repositório em `d8a5977` (igual ao `origin/master`, sem
alterações locais). Execução de UI com scripts Playwright e um perfil de navegador por papel
(ADMIN, LAWYER, ASSISTANT, PARTNER_ADMIN A, PARTNER_USER A, PARTNER_ADMIN B); persistência e
notificações conferidas por consulta somente leitura ao banco do DEV. Datas: 2026-10-15/16.

## Resumo

| Bloco | Resultado |
|---|---|
| §2 Verificações locais | **PASS**: 579/579 · lint · typecheck · 422/422 testes · build · worker 34/34 |
| §3 Migrations 032–037 | **PASS**: `db push` aplicou as seis (autorizado por você); `migration list` mostra Local = Remote |
| §4 `validar:real` | **PASS**: 129/129; §42 carteira do parceiro em **49 ms** (DEV com 616 clientes) |
| §5 `test:integration` | 188/192; as **4 falhas são defeitos dos testes/harness, não do produto** (ver TEST-01..03) |
| §7 Retestes do QA 4.3 | BUG-01, 02, 04, 06: **PASS** · BUG-05: **PASS parcial** (formatação) · BUG-03 (guia): **PASS** |
| §7 QA manual 4.3.1 (A–I) | **PASS** em quase tudo; **1 defeito novo (BUG-07)**; observações de rótulo/UX; 1 item manual (MFA) |
| §8 Limpeza | **Feita** |

## §2 — Verificações locais

| Verificação | Esperado | Resultado |
|---|---|---|
| `supabase: npm run verificar` | 579 | **PASS**: "579 verificações, todas passaram." |
| `frontend: lint / typecheck` | limpos | **PASS** |
| `frontend: npm test` | 38 arquivos, 422 | **PASS**: 38/38, 422/422 |
| `frontend: npm run build` | sem erro | **PASS** |
| `agentes: npm test` | 34 | **PASS**: 34/34 |

## §3 — Migrations

`migration list` (antes): 001–031 em Local e Remote; 032–037 só em Local. O `db push --dry-run` listou as seis.
O `db push` aplicou 032 → 037 sem erro. `migration list` (depois): **032–037 em Local e Remote**.

## §4 — `validar:real`

**129 verificações reais, todas passaram** (rodada `rmvb4r96t`). Novos: §41b (LAWYER interrompe a
execução na fila: CANCELLED, mensagem sai da fila real, idempotente; ASSISTANT não interrompe), §41c
(produtor de notificações pelo PostgREST), **§42 (carteira do parceiro A: 1 cliente em 49 ms, com 616
clientes no banco)**, §43 (execuções QUEUED dos agentes de teste canceladas; agentes de teste inativos).
Isso resolve a OBS-01 do QA 4.3.

## §5 — `test:integration`: 188/192

| Teste que falhou | Causa | Classificação |
|---|---|---|
| `agents.int.test.ts` › "ADMIN cancela; repetir é estado inválido; LAWYER não cancela" | Espera `FORBIDDEN` para o LAWYER e `INVALID_STATE` ao repetir. Desde a 033 (commit `00723eb`) o LAWYER **pode** interromper execução de caso que acessa e repetir é **idempotente** (`service.ts` e §41b do `validar:real` confirmam). | **TEST-01**: teste desatualizado |
| `frontend-431-notifications.int.test.ts` › "solicitação aberta pelo escritório…" | `createPartnerRequestSchema.parse({ type: "DOCUMENT" … })`: o enum aceita `DOCUMENT_REQUEST`, `INFORMATION_REQUEST`, `CORRECTION_REQUEST` e `GENERAL_REQUEST` → ZodError antes de chamar o produto. O mesmo fluxo pela tela passou (A7). | **TEST-02**: erro no teste |
| `frontend-431-review-edit.int.test.ts` (2 casos) | `SUPABASE_SERVICE_ROLE_KEY ausente`: o código lê `process.env`, e o harness carrega `supabase/.env.real` só para os próprios objetos. **Com as variáveis exportadas, o arquivo passa 3/3.** | **TEST-03**: harness não exporta as variáveis de servidor |

## §7 — Retestes das correções do QA 4.3

| Item | Status | Evidência |
|---|---|---|
| F-08 (BUG-04) | PASS | Modelos de honorários carrega; criar, editar ("Editar <nome>") e inativar; o inativo não é oferecido em novo contrato. |
| F-02 (BUG-04) | PASS | Novo contrato abre; sem modelo + "Ativar agora" com clique duplo → 1 ativo; 2º ativo → "Este caso já tem um acordo financeiro ativo."; com modelo → termos copiados (fixo R$ 1.000,00 em 2x); rascunho sem modelo. |
| F-03 (BUG-04) | PASS | Obrigações carregam; nova obrigação (clique duplo) → 1; recebimento 100 (clique duplo) → recebido 100, "Parcialmente recebida"; quitar → "Recebida"; estorno parcial (100 de 400) → "Parcialmente recebida"; ajuste para menos só com justificativa. |
| F-04 (BUG-04) | PASS | Concluir com saldo → "Há obrigações em aberto neste acordo…"; quitado → concluído; concluído sem "Nova obrigação" e sem "Gerar cronograma"; **estorno continua** ("Ver lançamentos" → "Estornar" → registrado). |
| F-05 (BUG-04) | PASS (obs.) | Com recebimento, o menu **não oferece** "Cancelar obrigação" (o checklist fala em "pede estorno antes"); sem recebimento: sem motivo não grava, com motivo → "Cancelada" (motivo gravado). |
| T-05 | PASS | Clique duplo em "Criar contrato", "Registrar obrigação" e "Registrar recebimento" → 1 registro cada. |
| A-08 (BUG-01) | PASS | "Informe o número do documento (ou limpe o tipo)." / "Selecione o tipo do documento (ou limpe o número)." no campo. |
| B-06 (BUG-02) | PASS | Linha com tipo de ação **e** caso. |
| H-05 (BUG-05) | PASS parcial | Nenhum dígito se perde; após salvar e recarregar aparece "OAB/SP 123456" (sem o ponto). Restaurado ao original. |
| BUG-06 | PASS | Portal `/clientes`: 832, 526, 598, 594 ms (antes 6,5–14 s); banco 49 ms (§42). |
| BUG-03 (guia §6.2) | PASS | O SQL atual deixa o agente ACTIVE **com versão atual** (`tem_versao = true`). |

## §7 — QA manual 4.3.1

### A — Notificações (conferidas no banco, por usuário)

| Item | Status | Evidência |
|---|---|---|
| PARTNER_USER envia caso → ADMIN | PASS | 2 casos enviados pelo `qa.parceiro-a.usuario` → "Novo caso enviado pelo parceiro" para os 19 ADMIN ativos do DEV (inclui `adm`); o parceiro não recebe aviso do próprio envio. |
| Atribuir advogado (2×) | PASS | 1 aviso "Caso atribuído a você" para `qa.advogado` (não duplica). |
| LAWYER aceita | PASS | "Caso aceito" para `qa.parceiro-a.admin` e `qa.parceiro-a.usuario`; parceiro B nada. |
| Recusa | PASS | Parceiros recebem "Caso não aceito: <título>" com o motivo **público**; nota interna ausente. |
| Prazo novo com responsável | PASS | "Novo prazo: …" para `qa.advogado`; no sino, "Ver prazo" → `/processos/<id>?aba=prazos`. |
| Pendência "Solicitar" / recebimento | PASS | DOCUMENT_REQUESTED para PA e PU do A; recebimento → DOCUMENT_RECEIVED para `qa.advogado`. |
| Solicitação / resposta | PASS | PARTNER_REQUEST_CREATED para PA e PU; resposta do parceiro → PARTNER_REQUEST_REPLY para `qa.advogado` (e `adm`, autor da solicitação). |
| Revisão atribuída / decidida | PASS | "Revisão atribuída a você" para `qa.advogado`; aprovação → "Revisão aprovada" para quem pediu a análise. |
| Repasse registrado | PASS | "Repasse registrado" só para `qa.parceiro-a.admin`; PARTNER_USER não. |
| Segurança (troca de papel) mesmo com categorias desligadas | PASS | LAWYER desligou as 6 categorias; papel trocado e devolvido → 2× "Seu perfil de acesso mudou" (e nada mais); papel final LAWYER; preferências restauradas. |
| Segurança (MFA redefinido) | **NOT_RUN: manual** | Redefinir o MFA obriga o usuário a recadastrar o autenticador; só você pode fazer isso. |
| Sino | PASS | "8 não lidas" → "Ver prazo" leva ao destino → "7 não lidas" → "Marcar todas como lidas" → 0. |

### B — Preferências

| Item | Status | Evidência |
|---|---|---|
| Categorias por perfil | **FAIL (BUG-07)** para ASSISTANT; PASS para os demais | ADMIN e LAWYER: Casos, Prazos, Documentos, Revisões, Solicitações, Análises, Segurança. PARTNER_ADMIN: + Financeiro. PARTNER_USER: **sem Financeiro**. ASSISTANT: `/configuracoes?secao=notificacoes` → **"Acesso restrito"** (sem acesso às próprias preferências). |
| Desligar "Prazos" / religar | PASS | Desligado (persistido após recarregar) → prazo novo sem aviso; religado → "Novo prazo: …". |
| Segurança fixa, e-mail, recarregar, restaurar | PASS | "Segurança da conta" sem controle ("Sempre ativo"); "Será usada quando notificações por e-mail forem ativadas."; "Casos por e-mail" mantido após recarregar; "Restaurar padrão" volta ao padrão. |

### C — Revisão: edição manual (`minuta.txt` fictícia)

| Item | Status | Evidência |
|---|---|---|
| Conteúdo, editor, salvar → revisão nova | PASS | Texto exibido; "Versão 1 → Versão 2"; "Salvar nova versão" → abre a revisão nova "Pendente", mesmo responsável (QA Advogado). |
| Revisão antiga, versão N, histórico | PASS | Antiga "Alterações solicitadas" com a nota "Conteúdo editado manualmente: a versão 2 seguiu para revisão."; histórico "v2 · edição manual"; v1 baixável (HTTP 200). |
| Clique duplo | PASS | Banco: v1 UPLOAD + **uma** v2 MANUAL_EDIT. |
| PDF / decidida | PASS | PDF: "Este formato (PDF, DOCX ou imagem) não é editável aqui. Para corrigir, envie uma nova versão…"; aprovada: "Esta revisão já foi decidida. Para editar, reabra a revisão." (sem botão). Ver OBS-08. |
| "Solicitar alteração à IA" | PASS | Desabilitado; explicação em tooltip ("Disponível quando a execução real dos agentes for ativada…"). |
| ASSISTANT e parceiro | PASS | "Acesso restrito". |

### D — Interromper análise

| Item | Status | Evidência |
|---|---|---|
| Na fila → interromper | PASS (obs.) | Confirmação → execução e análise CANCELLED (banco); Execuções "Cancelada"; a aba mostra **"Cancelada"** + "Execução interrompida a pedido" (o checklist diz "Interrompida"). Ver OBS-09. |
| "Rodando" (simulado) | PASS | "Interromper" → **"Interrupção solicitada"**; banco: RUNNING com pedido registrado (segue até o worker confirmar). |
| LAWYER / ASSISTANT | PASS | LAWYER interrompeu análise do caso dele; ASSISTANT sem aba Análise, sem botão, Execuções negado. |

### E, F, G — Financeiro

| Item | Status | Evidência |
|---|---|---|
| Cronograma (prévia) | PASS | R$ 100,00 em 3 a partir de 31/01/2027 → 33,34 · 33,33 · 33,33; 31/01 → 28/02 → 31/03; "Total R$ 100,00". |
| Confirmar / clique duplo / recusa | PASS | Clique duplo → **3** obrigações (soma 100,00); acordo concluído e cancelado sem "Gerar cronograma" (recusa no servidor coberta por `frontend-431-finance`, que passou). |
| Valores da parceria | PASS | Financeiro do parceiro, portal do PARTNER_ADMIN e aba do caso: receita elegível 300,00 · participação 120,00 · repassado 0,00 · em repasse 10,00 · saldo 110,00 · histórico; nenhum campo editável; o portal não mostra a parte do escritório. |
| Contratado por modelo | PASS | "Sem modelo (valores próprios): R$ 45.000,00 em 79 contratos; QA43 Modelo A in3h editado: R$ 400,00 em 1 contrato". |

### H, I — Portal

| Item | Status | Evidência |
|---|---|---|
| Aba "Histórico" | PASS parcial | Cadastro, envio, aceite e não-aceite (motivo público), documentos solicitados e recebidos, solicitações e respostas, processos, versões de documento compartilhado. Sem fixture: "Carregar mais" (máx. 17 itens) e "Em análise sem repetir" (nenhum caso do parceiro passou por análise). |
| Nada interno no histórico | PASS | Sem nota interna, motivo interno, revisão, análise, execução ou documento interno. |
| Contagens em Clientes | PASS | "QA43 PF ru918": 3 casos (só os do parceiro; os internos não contam); "Cliente Teste Interno": 1 de 3. |
| Parceiro B | PASS | Casos do A → "não encontrado"; nada do A em Clientes. |

## Dados fictícios criados nesta rodada

Casos `QA431 Notif aceite w9k1` (aceito) e `QA431 Notif recusa w9k1` (recusado); prazos `QA431 prazo …`;
pendência `QA431 Documento w9k1`; solicitação `QA431 Solicitação w9k1`; repasse R$ 10,00 (`QA431 w9k1`);
modelos `QA43 Modelo A in3h editado` e `QA43 Modelo inativar in3h`; contratos no `QA43 Caso Processos`
(concluído) e no `QA43 Caso Parceiro A` (1 ativo com modelo, 1 cancelado, 1 rascunho); obrigações
`QA43 obrigação …431` e `QA431 Cron 32m6 1/3–3/3`; documento `QA431 Minuta de texto` (v1, v2 edição
manual) com 2 revisões; revisão do PDF `QA43 Doc processo msta`; 3 análises interrompidas no
`QA431 Notif aceite`. Configurações → Geral restaurada.

## §8 — Limpeza

Execução simulada "rodando" → CANCELLED; bloco do §8 executado (agente `qa-analise-43` INACTIVE, modelo
inativo; 0 execuções QUEUED/RUNNING de agentes QA ou de teste).

## Reteste após as correções (commit `d4a6091`, 2026-10-16)

| Item | Status | Evidência |
|---|---|---|
| `test:integration` | **PASS**: 25/25 arquivos, **192/192** testes (138 s) | TEST-01, TEST-02 e TEST-03 resolvidos, sem exportar variáveis à mão. |
| BUG-07 | **PASS** | ASSISTANT → menu do usuário → "Preferências de notificação" → `/configuracoes?secao=notificacoes`, só a seção "Notificações"; categorias Casos, Prazos, Documentos, Solicitações e Segurança da conta (**sem Revisões/Análises**); desligar "Documentos" persiste após recarregar; "Restaurar padrão" volta ao padrão; `?secao=geral\|equipe\|honorarios\|seguranca` cai em Notificações (nada é exposto). Captura: `../etapa-4.3/evidencias/fase-H/BUG-07-assistant-preferencias.png`. |

As demais correções do commit (OBS-05, 08, 09 e 10) não foram retestadas pela tela nesta rodada.
