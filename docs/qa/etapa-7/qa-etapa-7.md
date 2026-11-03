# QA — Etapa 7 (importação de planilhas)

Commit: `22e839c` (mais a correção de teste do IMP-01, neste commit). Data: 2026-11-03.
Supabase DEV (`hco…idb`, `DG_ENV=development`). Máquina: Windows 11 Pro 10.0.26300, Node 24.19.0,
Supabase CLI 3.0.0. Guia: [`docs/etapa-7-validacao.md`](../../etapa-7-validacao.md).

## Resumo

| Parte | Status (PASS / FAIL / PASS com ressalva) | Evidência curta |
|---|---|---|
| 1 — Migration 042 e pg_cron | **PASS com ressalva** | `--dry-run` listou só `20261031000042_spreadsheet_import.sql`; push sem erro; `dg-importacoes` (`17 6 * * *`), `dg-lembretes-de-prazo` (`*/15 * * * *`) e `dg-manutencao` (`* * * * *`) ativos; `import_housekeeping()` → `{"cancelled": 13, "purged_rows": 0}`, sem erro (ver G-01 e G-02) |
| 2 — verificar / validar:real | **PASS** | "712 verificações, todas passaram."; "148 verificações reais, todas passaram." (rodada `rmw0xhfdq`), 41h com 3 ✓, pré-flight "todas as migrations do repositório aplicadas, e nenhuma a mais" (42) |
| 3 — front (unit, lint, tsc, build, integração) | **PASS com ressalva** | unit 43 arquivos, 504/504; lint e tsc limpos; build OK com `/configuracoes/importacoes` e `/configuracoes/importacoes/[id]`; integração 31 arquivos, 235/236 na 1ª rodada (IMP-01, falha do teste) → `imports.int.test.ts` 7/7 depois da correção |
| 4.1–4.5 — telas | **PASS com ressalva** | todos os números e comportamentos do guia conferem (detalhe abaixo); 3 problemas de tela: IMP-02, IMP-03 e IMP-04 |

O build passou no caminho com "Programação": o ENV-02 da Etapa 5 não se repetiu.

## Detalhe das telas (Parte 4)

Entrada com um ADMIN e um LAWYER fictícios criados para esta rodada (G-04).

- **4.1:** a seção "Importação de planilhas" fica acima do aviso de demonstração, com "Importar planilha" e "Ver importações"; a lista abre com as importações dos testes de integração.
- **4.2 (arquivo 1):**
  - **Mapeamento:** 10 linhas, 15 colunas, cabeçalho na linha 1; as 15 sugestões conferem com o guia; painel "Casos e processos novos" com Direito Bancário.
  - **Bloqueios:** sem campo no nome → "Escolha a coluna do nome do cliente (obrigatória)."; nome em duas colunas → "… está em mais de uma coluna".
  - **Simulação:** Prontas 0 · Com aviso 6 · Com erro 4. Erros nas linhas 7, 8, 9 e 11, com as mensagens do guia; os 3 avisos na linha 4. Prévia 5 / 0 / 5 / 1 / 4, sem conflito, nada gravado.
  - **Refazer o mapeamento:** mantém as escolhas; "Voltar à simulação" funciona.
  - **Gravação:** "Gravar 6 linhas". Relatório: 6 importadas, 5 clientes, 5 casos e processos, 1 prazo, 4 não importadas. Filtros "Com erro" (4) e "Importadas" (com os links "abrir") certos.
  - **No sistema:**
    - Maria: 2 casos `IN_PROGRESS`; o `7000001-60…` tem "Cadastro por importação" e o prazo "Prazo importado da planilha" em 13/12/2026 ("Vence em 40 dias");
    - Comércio é `COMPANY`; Ana não tem caso; o caso da Eva está `CLOSED`;
    - job `COMPLETED`, com o arquivo apagado (`true`).
- **4.3 (arquivo 2, ADVBOX):**
  - **Mapeamento:** aviso "Sem a coluna de CPF/CNPJ"; "Expectiva/Valor da causa (R$)" sugerido como Valor da causa.
  - **Simulação:** linha 2 com aviso "encontrado pelo nome", linha 3 com erro "não encontrado pelo nome", conflito já em "Manter". Prévia 0 / 1 mantido / 1 processo.
  - **Gravação:** Maria passa a ter 3 processos (o novo é `7000011-07…`), sem cliente novo.
- **4.4 (arquivo 3, XLSX):**
  - **Mapeamento:** "cabeçalho na linha 3", 2 linhas, mapeamento todo sugerido.
  - **Conflitos:** CPF (Maria) e CNJ (`7000001-60…`) pendentes; passo com "!" e "Confirmar e gravar" desabilitado.
  - **Decisão:** CPF → Manter, CNJ → Atualizar. Situação "Simulação pronta"; prévia 1 novo, 1 mantido, 1 processo novo, 1 atualizado.
  - **Depois de gravar:**
    - o nome da Maria não mudou;
    - o `7000001-60…` está com "5ª Vara Cível (atualizada)", `SUSPENDED` e distribuição 2025-03-10, com "Dados atualizados por importação", e continua na Maria;
    - "Nova Cliente XLSX Etapa Sete" foi criada com o `7000013-74…`.
- **4.5:**
  - **Cancelamento:** o reenvio do arquivo 1 mostra "Este mesmo arquivo já foi enviado antes"; o cancelamento dá "Importação cancelada", arquivo apagado e contagens iguais às de antes.
  - **`.txt` renomeado para `.xlsx`:** "Não foi possível ler o arquivo", com o motivo; `FAILED` no banco; o arquivo some do Storage na limpeza seguinte (IMP-04).
  - **`.xls` e `.pdf`:** recusados antes do envio, com mensagem, e nenhum job criado.
  - **LAWYER:** a seção diz "Só o administrador importa planilhas", sem botões; `/configuracoes/importacoes` mostra "Acesso restrito".

## Problemas encontrados

### IMP-01 — `imports.int.test.ts` falhava ao conferir que o arquivo foi apagado (teste)

- **Parte:** 3, integração.
- **O que fiz:** `npm run test:integration`, e depois o arquivo sozinho mais 3 vezes.
- **O que esperava:** 7/7.
- **O que aconteceu:** 6/7, sempre no teste 3.

  ```
  AssertionError: expected null not to be null
   ❯ tests/integration/imports.int.test.ts:121:26   expect(dl.error).not.toBeNull();
  ```

- **Causa (confirmada):** o arquivo foi apagado. No banco, `source_file_deleted_at` está preenchido e `storage.objects` não tem mais o objeto. Mas `download()` continua entregando o arquivo pelo cache do Storage por até ~60 s depois do `remove()`. Reproduzi com um objeto descartável: o download funciona em +0, +5 e +20 s e dá "Object not found" em +60 s. O bucket é privado; só a service role alcança essa cópia.
- **Correção (neste commit):** o teste agora confere com `list()` da pasta do job, que lê o catálogo e não passa pelo cache. Resultado: 7/7.
- **Gravidade:** atrapalha (quebrava a suíte). O produto está certo.

### IMP-02 — Linhas com erro mostram o valor de outra coluna como "Cliente"

- **Parte:** 4.2 e 4.3, tabela de linhas (simulação e relatório).
- **O que fiz:** simulei o arquivo 1 e o arquivo 2.
- **O que esperava:** na coluna CLIENTE das linhas com erro, o nome da planilha ("Paulo CPF Curto Etapa Sete", "Lúcia CNJ Errado…", "Rui CNJ Repetido…"; na linha 11 o nome está vazio).
- **O que aconteceu:**
  - linhas 7, 8, 9 e 11 do arquivo 1 aparecem como **"Revisional"** (o tipo de ação);
  - a linha 3 do arquivo 2 aparece como **"Osasco"** (a comarca);
  - a coluna PROCESSO mostra "—" mesmo quando a linha tem CNJ.
- **Causa:** em [`rows-table.tsx:122`](../../../apps/frontend/src/features/data-import/components/rows-table.tsx#L122), a linha com erro não tem `payload`, e a tela cai em `Object.values(r.raw)[0]`. O `raw_data` é `jsonb`, e o Postgres reordena as chaves (as mais curtas primeiro), então o "primeiro valor" é de uma coluna qualquer.
- **Sugestão:** usar a coluna mapeada para `client.name` e `process.cnj` (o job tem o mapeamento) para ler o `raw`, ou o servidor já devolver esses dois campos crus para a linha com erro.
- **Gravidade:** atrapalha. O número da linha e o CSV estão certos, mas a tela engana quem procura qual cliente corrigir.

### IMP-03 — CSV baixado sai sem BOM (acentos quebram no Excel)

- **Parte:** 4.2, "Baixar linhas com problema (CSV)".
- **O que fiz:** baixei `relatorio-1-clientes-e-processos-problemas.csv` e li os bytes.
- **O que esperava:** UTF-8 com BOM (`EF BB BF`) e `;`, como diz o comentário de `mappers.ts` e como garante o teste unitário de `buildReportCsv`.
- **O que aconteceu:** os primeiros bytes são `4C 69 6E` ("Lin"), sem BOM. Separador `;` e colunas certos, mas o Excel em português abre sem BOM como ANSI e mostra "SituaÃ§Ã£o".
- **Causa provável:** o `﻿` gerado no servidor se perde na resposta da Server Action, porque o decodificador de texto descarta o BOM no início do bloco. O `downloadText` ([`client.ts:47`](../../../apps/frontend/src/features/data-import/client.ts#L47)) não o recoloca.
- **Sugestão:** em `downloadText`, montar `new Blob(["﻿", content.replace(/^﻿/, "")], …)`, e um teste do lado do cliente.
- **Gravidade:** atrapalha. Esse é o arquivo que o admin abre para corrigir a planilha.

### IMP-04 — Depois de "Não foi possível ler o arquivo", o cabeçalho continua "Arquivo enviado"

- **Parte:** 4.5, arquivo inválido.
- **O que fiz:** enviei um `.txt` renomeado para `.xlsx`.
- **O que esperava:** situação "Falhou".
- **O que aconteceu:**
  - a mensagem e o motivo aparecem ("O arquivo não é uma planilha .xlsx válida…", código `D10A00D7");
  - mas o cabeçalho segue "Arquivo enviado", o passo 1 "em andamento" e continuam os botões "Tentar novamente" e "Cancelar importação";
  - no banco o job já está `FAILED`, e depois de recarregar a tela mostra "Falhou".
- **Observação:** no `FAILED`, o arquivo não é apagado na hora. Ele sai na limpeza preguiçosa da lista de importações (confirmado: `apagado = true` e 0 objetos depois de abrir a lista).
- **Gravidade:** cosmético.

## Ressalvas do guia (não são defeitos)

- **G-01:** a Supabase CLI 3.0 manda o `db push` para o banco local por padrão. Sem Docker dá `ECONNREFUSED 127.0.0.1:54322`. Os comandos certos são `npx supabase db push --remote --dry-run` e `npx supabase db push --remote`.
- **G-02:** o `import_housekeeping()` cancelou 13 jobs, não 0.
  - A tabela `import_jobs` existe desde a migration 013, e eram jobs `x.csv` do `validar:real` de rodadas anteriores (09/10 a 20/10), parados havia mais de 7 dias.
  - Todos receberam "Cancelada automaticamente: parada por mais de 7 dias antes da confirmação.", que é o comportamento certo.
  - Vale atualizar o "esperado" do guia.
- **G-03:** a barra de progresso não chegou a aparecer, porque a gravação de 6 linhas terminou em menos de 2 s.
- **G-04:** login.
  - Para não depender do autenticador da equipe, criei um ADMIN e um LAWYER fictícios no escritório proprietário (`qa7mw0xyewm.admin@…` e `qa7mw0xyewm.lawyer@dgbrasil.test`), do mesmo jeito que o `global-setup` da integração faz.
  - Os termos foram aceitos e o TOTP foi gerado por script. Senha e segredo ficaram só no scratchpad da sessão.
  - Os dois usuários ficam no DEV, como os da integração.
- **G-05 (cosmético, DEV):** a lista "Advogado responsável padrão" tem ~100 entradas "Teste ADMIN" / "Teste LAWYER" das rodadas de integração. É poluição do DEV, não defeito da Etapa 7.

## Dados criados

Só fictícios, que ficam no DEV como nas rodadas anteriores:

- 6 clientes `9997…`, com "Etapa Sete" no nome;
- 7 processos `70000…-…2026.8.26.0742`;
- jobs de importação desta rodada e das rodadas de integração `imp-<rodada>`;
- os 2 usuários do G-04.

Nada foi apagado à mão.
