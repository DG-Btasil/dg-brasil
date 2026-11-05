# QA — Etapa 8 (integrações judiciais e prazos)

> **Pendente:** a conferência do dia seguinte da Parte 6 e a Parte 7, adiada pelo Miguel ([producao.md](../../deploy/producao.md), item 11).

Commit: `21c0d70`. Data: 2026-11-04. Supabase DEV (`hco…idb`, `Digital-Group-Brasil-Dev`). Máquina: Windows 11 Pro 10.0.26300, Node 24.19.0.
Guia: [`docs/etapa-8-validacao.md`](../../etapa-8-validacao.md).

## Resumo
| Parte | Status (PASS / FAIL / PASS com ressalva / não feito) | Evidência curta |
|---|---|---|
| 1 — Migration 043 e pg_cron | **PASS com ressalva** | `--dry-run` listou só `20261101000043_judicial_monitoring.sql`; push feito pelo Miguel (`migration list` mostra a 043 local e remota); `dg-importacoes`, `dg-judicial` (`*/5 * * * *`), `dg-lembretes-de-prazo` e `dg-manutencao` ativos; nenhum processo ativo com CNJ sem ref. A contagem do guia não fecha por causa dos processos excluídos (JUD-02) |
| 2 — verificar / validar:real | **PASS** | "765 verificações, todas passaram."; "152 verificações reais, todas passaram." (rodada `rmw2q8e9q`, 148 + 4 da 41i); `pg_net NÃO instalado · resultado: pg_net ou Vault indisponível` (esperado antes da Parte 6) |
| 3 — front (unit, lint, tsc, build, integração) | **PASS com ressalva** | unit 45 arquivos, 530/530; lint e tsc limpos; build OK com `/publicacoes` e `/api/cron/judicial-sync`; integração 32 arquivos: 1ª rodada 241/243 (JUD-01, falha do teste) → 243/243 depois da correção |
| 4 — deploy e crons | **PASS com ressalva** | status Vercel do `21c0d70`: "Deployment has completed"; `vercel.json` com as 2 rotas; `curl` sem senha → `401` nas duas. Painel conferido pelo Miguel; `drive-sync` não apareceu na 1ª olhada, depois resolvido (JUD-03) |
| 5.1–5.4 — telas e DJEN real | **PASS com ressalva** | N = 252 na OAB RJ (0 do DG Brasil) e 0 na SP; busca em 34 s, sem erro no DJEN, sem bloqueio de IP. DataJud esgotou o tempo (JUD-04); texto desatualizado no portal (JUD-05) |
| 6 — agendador do banco (lotes) | **PASS com ressalva** | `pg_net` 0.20.4 e os 2 segredos criados; chamada de teste com `200` e rodada `CRON` nova; `judicial_djen_due()` vazia. Rodadas do dia seguinte ainda não vistas; rodada presa por DataJud lento (JUD-06) |
| 7 — conferência com o APOGEU | não feito | adiada pelo Miguel; registrada em `docs/deploy/producao.md`, item 11 |

O build passou no caminho com "Programação". Ele mostra logs `action.crashed … Dynamic server usage` de `/dg-brasil/*` durante a coleta de páginas. É o aviso do Next para rotas que usam cookies, e o build termina sem erro (código 0).

## Rodada 2 (migration 044)

Commit `819bb9c`. Data: 2026-11-04, até 22:26 de Brasília. Push da 044 feito pelo Miguel (o do agente foi bloqueado pela permissão). Só falta o item 7.

| Item | Status | Evidência |
|---|---|---|
| 1 — migration 044 | **PASS** | `--dry-run` listou só `20261101000044_judicial_sync_fixes.sql`; 044 registrada no DEV e `judicial_ingest_datajud` com `p_transient` |
| 2 — verificar | **PASS** | "768 verificações, todas passaram." |
| 3 — front | **PASS** | unit 45 arquivos, 534/534; lint, tsc e build sem erro; deploy verde |
| 4 — rodadas no banco | **PASS com ressalva** | rodadas das 22:20 e 22:25 com 47 s e 45 s, abaixo de 55 s, nenhuma presa. "6 min" não observado |
| 5 — falhas em 1 h × 20 h | **PASS com ressalva** | `em_1h` = 6 ("tempo esgotado" às 22:20 e 22:25); "ainda não aparece" em `em_20h`. Nenhum 429 ocorreu depois da 044 |
| 6 — texto do portal | **PASS** | PARTNER_USER vê "De processo que não está no DG Brasil nada é guardado, nem o número." |
| 7 — pendência da Parte 6 | **pendente** | só depois das 05:00 de 2026-11-05 |

Observações:
- **Corte depois de 3 falhas:** as rodadas das 22:20 e 22:25 pararam com 3 falhas cada, como previsto no JUD-04.
- **Rodada presa antiga:** a de 21:40 virou `FAILED` depois de 901 s, com "Interrompida (sem conclusão em 15 min).". Isso confirma o encerramento automático, mas pela regra antiga. O texto "6 min" só aparece se outra rodada ficar presa, e nenhuma ficou.
- **`em_20h` inclui falhas antigas:** os 11 "tempo esgotado" e os 3 `429` das 21:55 são anteriores à 044, que os deixou na regra de 20 h. Não é defeito.
- **Rodada das 22:15:** 3 falhas sem registro, porque rodou antes do push da 044.
- **DataJud:** ainda instável. A rodada das 22:25 leu 1 processo; as demais não leram nenhum.
- **JUD-02:** a consulta nova do guia foi conferida no DEV: 217 refs × 217 processos.

## Detalhe das telas (Parte 5)

Sessão ADMIN: login feito na janela do Playwright pelo responsável humano (usuário "adm"). Portal: PARTNER_ADMIN e PARTNER_USER fictícios, em contextos isolados, em `portal.dgbrasil.adv.br`.

- **5.1:**
  - Painel acima do Google Drive; aviso de "Demonstração" só em "Outros serviços".
  - OABs: `225006/RJ` e `548089/SP` com "OAB cadastrada"; repetir a RJ deu "OAB reativada", sem duplicar.
  - Buscar agora, 1ª vez: 34 s, `COMPLETED`, "2/2 OAB(s) · 252 fora do DG Brasil · 150 para o próximo lote". O DataJud não rodou por falta de tempo na rodada.
  - Buscar agora, 2ª vez: 77 s, "Busca concluída com falhas … 2 falha(s)" (JUD-04). DJEN de novo sem erro, com 252.
  - Nenhum CNJ na tela. No banco, nenhuma publicação das OABs reais.
  - Cobertura RJ: 04/11 = 60 e 03/11 = 184 ("Conferido (pode chegar mais)"); 30/10 = 8 e 31/10 a 02/11 = 0 ("Conferido e assentado"). Soma 252.
  - Calendário: `2099-12-31`/`TJXX` adicionado e removido. Configuração: 4 dias salvo e recarregado; devolvida para 5 dias e agente "Nenhum".
- **5.2:**
  - Item no menu e 4 publicações fictícias em "Todas a tratar".
  - Detalhe com teor, processo, "Encontrada pela OAB AC 9135861" e "Certidão do DJEN".
  - Criar prazo: 15 dias → 26/11/2026, com "Publicada em 04/11/2026" e 20/11 não contado; 5 dias → 11/11/2026. Conferido à mão.
  - Prazo criado, publicação "Tratada", prazo em Processo → Prazos.
  - Não há prazo: botão desabilitado sem motivo; com motivo, "Tratada / Sem prazo". Reabrir (com confirmação) voltou para "A tratar".
- **5.3:** quadro "Ativo"; Pausar → "Pausado"; Retomar → "Ativo". Aba Publicações lista só as do processo. "Buscar andamentos agora": 36 s, "1 falha(s)", em vez do aviso esperado (JUD-04).
- **5.4:**
  - PARTNER_ADMIN: `9408215/AC` com "OAB cadastrada", sem nome de escritório.
  - PARTNER_USER: lista sem "Adicionar OAB" e sem "Pausar".
  - ADMIN: a OAB aparece com o escritório e "Parceiro"; ficou **pausada**.

## Problemas encontrados

### JUD-01 — Teste de integração lê tabela fechada com o `service_role`
- **Parte:** 3.
- **O que fez:** `npm run test:integration`.
- **Esperava:** 32 arquivos passando.
- **Aconteceu:** 2 falhas em `judicial.int.test.ts`. Em "DJEN: só entra publicação…": `TypeError: Cannot read properties of null (reading 'length')`, porque a leitura deu `42501 permission denied for table judicial_publications`. A falha de "triagem…" é consequência dela (`state.publication` vazio).
- **Causa:** o teste estava errado; o banco está certo. A 043 revoga o acesso do `service_role` de propósito (linha 293).
- **Correção:** o teste passou a conferir essas linhas como postgres, com `SUPABASE_DB_URL`, como o `validar:real`. Sem mudança em migration nem em código de produção. Depois disso, 243/243.
- **Gravidade:** atrapalha (só o teste).

### JUD-02 — Contagem da Parte 1 do guia inclui processos excluídos
- **Parte:** 1.
- **O que fez:** comparou `process_external_refs` (`provider = 'DATAJUD'`) com os processos não excluídos com CNJ.
- **Esperava:** números iguais.
- **Aconteceu:** 232 refs × 202 processos na primeira medição. Na segunda, separando: 217 refs de processos ativos com CNJ (217 processos) e 32 de processos excluídos.
- **Causa:** o processo excluído mantém a ref. Todo processo ativo com CNJ tem a sua, e `judicial_datajud_queue` ignora excluídos, então essas refs não geram consulta.
- **Gravidade:** cosmético (texto do guia).

### JUD-03 — `drive-sync` não aparece em Settings → Cron Jobs
- **Parte:** 4.
- **O que fez:** Miguel conferiu o painel da Vercel.
- **Esperava:** as duas rotas.
- **Aconteceu:** na primeira olhada, aparecia `judicial-sync`, não `drive-sync`. Depois, Miguel informou que o item funcionou.
- **Conferido:** `apps/frontend/vercel.json` lista as duas; a rota existe e responde `401` em produção. O painel não foi visto pelo agente, e a causa da primeira leitura não foi apurada.
- **Gravidade:** resolvido.

### JUD-04 — DataJud esgota o tempo
- **Parte:** 5.1 e 5.3.
- **O que fez:** "Buscar agora" (2ª vez) e "Buscar andamentos agora".
- **Esperava:** "Busca concluída" e o aviso "Processo ainda não aparece no DataJud…".
- **Aconteceu:** `DataJud não respondeu (tempo esgotado)`, com a rodada em 77 s (guia: ~60 s).
- **Conferido:** fora da Vercel, o índice TJSP também não respondeu em 40 s, e o TJRJ devolveu `429`. Aponta para instabilidade ou limite do CNJ, não bloqueio do nosso servidor. O comportamento do sistema foi correto: falha registrada, rodada "com falhas", DJEN preservado.
- **Falta:** ver o aviso de processo não encontrado com o DataJud respondendo.
- **Gravidade:** atrapalha. Cada chamada travada consome 35 s da rodada.

### JUD-05 — Texto do portal contradiz a regra da etapa
- **Parte:** 5.4.
- **Aconteceu:** `partner-oabs-panel.tsx` diz "Publicação de processo que não está no DG Brasil não é importada: aparece só o número." A regra é outra: de processo não cadastrado, só a contagem, nem o número. Nenhum número apareceu na tela.
- **Gravidade:** cosmético.

### JUD-06 — Rodada do DataJud passa de 60 s e fica presa como `RUNNING`
- **Parte:** 6.
- **O que fez:** conferiu `net._http_response` e `judicial_sync_runs` depois de ligar o agendador.
- **Esperava:** rodadas terminando dentro dos 60 s da rota, com `200`.
- **Aconteceu:** a rodada `CRON`/`DATAJUD` de 00:38:54 UTC levou 57 s e terminou `PARTIAL`. A de 00:40:00 deu `Timeout of 60000 ms reached` no `pg_net` e seguia `RUNNING` depois de 2 minutos.
- **Causa provável:** com o DataJud lento (JUD-04), a rodada passa do limite de 60 s da Vercel e é encerrada antes de gravar o fim. O prazo interno de 50 s nem sempre segurou, e a causa exata não foi apurada.
- **Efeito, pelo código de `judicial_sync_begin`:** a rodada presa barra só novos lotes do DataJud; as buscas do DJEN seguem. Depois de 15 min ela vira `FAILED`. Isso não foi observado em execução.
- **Gravidade:** atrapalha, enquanto o DataJud estiver lento.

## Dados criados
- OABs reais `225006/RJ` e `548089/SP`, **ativas** (a Parte 6 precisa delas).
- OAB fictícia `9408215/AC`, pausada, no "Parceiro QA Etapa 8 qa8mw2sj320".
- 3 usuários fictícios `qa8mw2sj320.*@dgbrasil.test` (o ADMIN acabou sem uso) e esse parceiro.
- 1 prazo fictício (11/11/2026) no processo `2858688-81.2026.8.26.6627`.
- `pg_net` e os segredos `dg_app_url` e `dg_cron_secret` no Supabase DEV (criados pelo Miguel). O agendador segue ligado.
