# Validação: Etapa 7 — Importação de planilhas

**Para o agente validador na outra máquina.** Siga na ordem, sem pular parte, e
devolva o relatório no formato da seção final.

- **Escopo:** migration 042, leitura de CSV/XLSX no servidor, actions
  `imports.*`, telas em Configurações → Integrações → Importações.
- **Como funciona (leia antes):** [importacao.md](importacao.md).

**Regras:**
- Use **só o Supabase DEV** (`DG_ENV=development`) e **só dados fictícios** — os
  arquivos de [qa/etapa-7/exemplos/](qa/etapa-7/exemplos/). Nenhuma planilha real
  de cliente.
- Não mexa em dados que não foram criados por esta validação.

---

## Parte 0: Preparar

1. `git pull` e confira que o último commit é o da Etapa 7 ("spreadsheet import"
   ou posterior). Caminho do repositório **sem acento** (Turbopack).
2. Node 24, Supabase CLI logada no projeto DEV, `supabase/.env.real` e
   `apps/frontend/.env.local` como nas validações anteriores (nada novo de
   variável nesta etapa).

## Parte 1: Migration 042 no DEV

```bash
cd supabase
npx supabase db push --dry-run    # deve listar SÓ 20261031000042_spreadsheet_import.sql
npx supabase db push
```

- [ ] **Push sem erro.**
- [ ] **Agendamento novo.** No SQL Editor:

  ```sql
  select jobname, schedule, active from cron.job where jobname like 'dg-%' order by jobname;
  ```

  Esperado: `dg-importacoes` (`17 6 * * *`), `dg-lembretes-de-prazo`
  (`*/15 * * * *`) e `dg-manutencao` (`* * * * *`), os três ativos.
- [ ] **A rotina diária roda à mão:**

  ```sql
  select private.import_housekeeping();
  ```

  Esperado: algo como `{"cancelled": 0, "purged_rows": 0}`, sem erro.

## Parte 2: Banco

```bash
cd supabase
npm run verificar
npm run validar:real
```

- [ ] **`verificar`:** **712 verificações, todas passaram** (eram 673; 39 novas,
  seções com `[042]`: arquivo e mapeamento, simulação sem gravar, conflitos,
  prévia = resultado, gravação em lotes, falha por linha, processos sem CPF
  ligados pelo nome, retenção, catálogo).
- [ ] **`validar:real`:** todas ✓. A seção nova **41h** (importação pelo PostgREST:
  ADMIN cria e cancela, LAWYER/ASSISTANT/parceiro recusados; `pg_cron`; bucket
  `imports` fechado ao navegador; funções internas fechadas) aparece com ✓. O
  pré-flight confirma "todas as migrations aplicadas, e nenhuma a mais". A
  rodada anterior teve 145; agora são **148**.

## Parte 3: Site (front e servidor)

```bash
cd apps/frontend
npm ci
npm test
npm run lint
npx tsc --noEmit
npm run build
npm run test:integration
```

- [ ] **Unitários:** 43 arquivos, **504/504** (o novo
  `src/server/domain/imports/imports.test.ts` tem 25: CSV, XLSX, cabeçalho com
  título acima, conversões, validação por linha, relatório CSV, a lista de campos
  igual à do banco e o cabeçalho real do relatório de processos do ADVBOX).
- [ ] **`lint` e `tsc`:** sem erro.
- [ ] **`build`:** sem erro; na lista de rotas aparecem
  `/configuracoes/importacoes` e `/configuracoes/importacoes/[id]`.
- [ ] **Integração:** 31 arquivos, todos passaram. Em especial
  **`imports.int.test.ts`: 7/7** — contra o DEV real (Storage `imports`, JWT do
  ADMIN):
  1. CSV: colunas lidas do Storage e sugestão de mapeamento;
  2. simulação: linha com erro, nada gravado, prévia;
  3. confirmação e gravação: cliente, caso em andamento, processo `IMPORT`,
     prazo, movimentação de importação; arquivo apagado do Storage; relatório;
  4. XLSX com o mesmo cliente e o mesmo processo: conflitos de CPF e CNJ,
     decisão, resultado igual à prévia;
  5. processos sem CPF (formato ADVBOX) ligados ao cliente pelo nome;
  6. arquivo ilegível → falhou com motivo; cancelamento apaga o arquivo;
  7. advogado e assistente recusados no servidor e no banco.

## Parte 4: Telas (ADMIN)

`npm run dev` em `apps/frontend` → `http://localhost:3000`, entre como **ADMIN**.
Os arquivos estão em `docs/qa/etapa-7/exemplos/`.

> Se uma validação anterior já importou estes exemplos no DEV, os clientes e
> processos vão aparecer como **já cadastrados** (conflitos). Nesse caso anote e
> confira que os conflitos aparecem — é o comportamento certo — e siga.

### 4.1 Entrada

- [ ] **Configurações → Integrações:** a seção "Importação de planilhas" aparece
  **acima** do aviso de demonstração, com "Importar planilha" e "Ver importações".
- [ ] **"Ver importações"** abre `/configuracoes/importacoes` (lista vazia ou com
  as importações dos testes de integração).

### 4.2 Arquivo 1 — `1-clientes-e-processos.csv`

- [ ] **Envio:** "Importar planilha" → escolher o arquivo → abre a tela da
  importação; "Lendo o arquivo…" e depois o mapeamento.
- [ ] **Mapeamento:** 10 linhas, 15 colunas, cabeçalho na linha 1. Sugestões
  esperadas: Nome Completo → Nome, CPF/CNPJ → CPF/CNPJ, Telefone, E-mail, Cidade,
  UF, Nº Processo → Número CNJ, Ação → Tipo de ação, Tribunal, Vara, Parte
  contrária, Responsável, Status, Vencimento, Valor da causa. Aparece o painel
  "Casos e processos novos": escolha **Direito Bancário** e um advogado.
- [ ] **Bloqueios do mapeamento:** tire o campo da coluna "Nome Completo" → o
  botão "Validar e simular" desabilita com a mensagem; ponha "Telefone" também
  como Nome → "Este campo está em mais de uma coluna". Desfaça.
- [ ] **Simulação:** "Validar e simular". Esperado:
  - **Prontas 0 · Com aviso 6 · Com erro 4** (os CPFs fictícios `999…` geram o
    aviso "Dígito verificador do CPF não confere" — esperado);
  - erros: linha 7 (CPF com 9 dígitos), 8 (CNJ com dígito verificador errado),
    9 (CNJ repetido: "mesmo CNJ está na linha 2"), 11 (nome vazio);
  - avisos da linha 4: e-mail inválido, responsável "Fulano Inexistente" não
    encontrado, vencimento 01/01/2020 já passou;
  - **prévia:** 5 clientes novos, 0 atualizados, **5 casos e processos novos**,
    1 prazo, 4 linhas com erro;
  - nenhum conflito (se houver, ver a nota acima).
- [ ] **Nada gravado ainda:** em Clientes, buscar "Etapa Sete" → nada (ou só o
  que validações anteriores criaram).
- [ ] **CSV da simulação:** "Baixar linhas com problema (CSV)" abre no Excel com
  colunas certas e acentos corretos.
- [ ] **Refazer o mapeamento** → volta ao mapeamento com as escolhas mantidas;
  "Voltar à simulação sem mudar nada" volta.
- [ ] **Confirmar e gravar** → diálogo com a prévia → "Gravar 6 linhas". Barra de
  progresso e, ao fim, **Relatório**: 6 importadas, 5 clientes criados, 5 casos e
  processos, 1 prazo, 4 não importadas.
- [ ] **Relatório por linha:** filtro "Com erro" mostra as 4 linhas com motivo;
  "Importadas" mostra os links "abrir" do cliente e do processo.
- [ ] **No sistema:**
  - Cliente "Maria Validação Etapa Sete": **dois** processos (dois casos), ambos
    "em andamento"; na ficha do processo, a linha do tempo tem "Cadastro por
    importação"; o processo `7000001-60.2026.8.26.0742` tem um prazo "Prazo
    importado da planilha" daqui a 40 dias;
  - "Comércio Validação Etapa Sete Ltda." é **pessoa jurídica**;
  - "Ana Só Cliente Etapa Sete" é cliente **sem** caso/processo;
  - o caso de "Eva Arquivada Etapa Sete" está **encerrado**.
- [ ] **Arquivo apagado do Storage** (SQL Editor):

  ```sql
  select status, source_file_deleted_at is not null apagado from import_jobs order by created_at desc limit 1;
  ```

  Esperado: `COMPLETED`, `true`.

### 4.3 Arquivo 2 — `2-processos-sem-cpf-formato-advbox.csv`

Simula o relatório de processos do ADVBOX (sem coluna de CPF).

- [ ] **Mapeamento:** aparece o aviso amarelo "Sem a coluna de CPF/CNPJ".
  "Expectiva/Valor da causa (R$)" é sugerido como Valor da causa.
- [ ] **Simulação:** linha 2 (MARIA VALIDACAO ETAPA SETE, em maiúsculas e sem
  acento) **com aviso** "encontrado pelo nome"; linha 3 **com erro** "não
  encontrado pelo nome". Conflito de CPF já decidido como "Manter o cadastro".
  Prévia: 0 clientes novos, 1 mantido, 1 processo novo.
- [ ] **Gravar** → o processo `7000011-07.2026.8.26.0742` aparece na ficha da
  **Maria** (agora com 3 processos). Nenhum cliente novo.

### 4.4 Arquivo 3 — `3-reimportacao-com-conflitos.xlsx`

XLSX com título na linha 1, cabeçalho na linha 3 e datas do Excel.

- [ ] **Mapeamento:** "cabeçalho na linha 3", 2 linhas; mapeie Nome, CPF,
  Processo → Número CNJ, Vara, Status e Distribuição → Data de distribuição.
- [ ] **Simulação → conflitos pendentes:** "CPF/CNPJ já cadastrado" (Maria) e
  "Processo (CNJ) já cadastrado" (`7000001-60…`); o botão "Confirmar e gravar"
  fica desabilitado; o passo aparece com "!".
- [ ] **Decida:** CPF → "Manter o cadastro como está"; CNJ → "Atualizar o
  processo". Status vira "Simulação pronta". Prévia: 1 cliente novo, 1 mantido,
  1 processo novo, 1 atualizado.
- [ ] **Gravar** e conferir:
  - o nome da Maria **não** mudou;
  - o processo `7000001-60…` está com vara "5ª Vara Cível (atualizada)", status
    suspenso e distribuição 10/03/2025; a linha do tempo tem "Dados atualizados
    por importação"; continua no cliente Maria;
  - "Nova Cliente XLSX Etapa Sete" foi criada com o processo `7000013-…`.

### 4.5 Cancelamento, arquivo inválido e permissões

- [ ] **Cancelar:** envie o arquivo 1 de novo, pare no mapeamento (deve aparecer o
  aviso amarelo "Este mesmo arquivo já foi enviado antes") e use "Cancelar
  importação" → "Importação cancelada"; nada foi gravado.
- [ ] **Arquivo inválido:** renomeie qualquer `.txt` para `.xlsx` e envie →
  "Não foi possível ler o arquivo" com o motivo; situação "Falhou".
- [ ] **`.xls` ou `.pdf`:** recusado antes do envio, com mensagem.
- [ ] **LAWYER** (entre como advogado): em Configurações → Integrações a seção diz
  "Só o administrador importa planilhas", sem botões; abrir
  `/configuracoes/importacoes` direto mostra "acesso negado".

## Parte 5: Limpeza

Os registros criados são fictícios e ficam no DEV como as rodadas anteriores
(prefixo `999…`, nomes com "Etapa Sete" e `imp-<rodada>`). Não apague nada à mão.

---

## Relatório (formato de entrega)

Salve em `docs/qa/etapa-7/qa-etapa-7.md` e faça o commit:

```markdown
# QA — Etapa 7 (importação de planilhas)

Commit: <hash>. Data: <data>. Supabase DEV (<ref mascarado>). Máquina: <Windows/versão>.

## Resumo
| Parte | Status (PASS / FAIL / PASS com ressalva) | Evidência curta |
|---|---|---|
| 1 — Migration 042 e pg_cron | | |
| 2 — verificar / validar:real | | totais |
| 3 — front (unit, lint, tsc, build, integração) | | totais |
| 4.1–4.5 — telas | | |

## Problemas encontrados
Um bloco por problema: ID (IMP-01, …), parte, o que fez, o que esperava, o que
aconteceu (mensagem exata), gravidade (bloqueia / atrapalha / cosmético).
```
