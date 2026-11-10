# Máquina principal do escritório: instalação, ponta a ponta e Google Drive

**Para quem:** a Barbara, ou o Claude Code da máquina principal conduzido por
ela. Este guia reúne tudo o que **só dá para testar no computador que vai
processar os trabalhos do DG Brasil**. O resto da validação já foi feito em
outras máquinas.

- **Site:** `https://app.dgbrasil.adv.br`, ligado ao **Supabase DEV**, com dados
  fictícios. Não há nada para compilar nem servidor local para subir.
- **Tempo estimado:**

  | Parte | Tempo |
  |---|---|
  | 0 e 1 | 30 min |
  | 2 | 20 min |
  | 3 | 1h30 |
  | 4 | 1h |
  | 5 | 10 min |

- **Detalhes de cada passo:** [instalacao.md](instalacao.md),
  [validacao.md](validacao.md) (Partes 6 e 7) e [google-drive.md](google-drive.md).

**Regras:**
- **Só dados fictícios.**
  - Nenhum cliente real no DG Brasil.
  - Nenhuma pasta real do Drive: só a pasta `DG TESTE - JOSE DA SILVA FICTICIO`.
- **Só os agentes de teste.** Os agentes reais (`lucas`, `clara`, …) gravam no
  `G:\Meu Drive`, nas pastas dos clientes reais. Por isso o orquestrador deste
  teste é o `orquestrador-teste`, que só chama agentes fictícios.
- **Não mexa** nos agendamentos atuais desta máquina (Clara, Lucas, Luísa, Bruno)
  nem no repositório `Agents_for_DG_Brasil`.
- **Modo assistido:**
  - os trabalhos rodam numa sessão interativa do Claude Code aberta em
    `C:\DGBrasil\sessao`, com uma pessoa presente;
  - nada de `claude -p` em script.
- **Senhas e tokens:**
  - o login no site é sempre da Barbara;
  - o token do computador é colado só no instalador, nunca no chat.

---

## Passo a passo da Barbara

O Claude Code do repositório faz o resto e avisa quando chegar cada passo
abaixo. Quando terminar um passo, diga a ele: "feito".

**Começo (5 min)**
1. No PowerShell da máquina do escritório, abra a pasta do `dg-brasil` e rode
   `git pull`. Se o repositório ainda não estiver nesta máquina, clone num
   caminho sem acento, por exemplo `C:\DGBrasil\dg-brasil`.
2. Abra o Claude Code nessa pasta e cole o pedido para ele seguir este guia.
3. Em claude.ai → Configurações → Privacidade, confira que o uso das conversas
   para treinamento está **desligado**.
4. Quando o navegador do Playwright abrir, entre no DG Brasil com a sua conta
   ADMIN e o MFA. Depois disso, é ele que navega.

**Conectar o computador (15 min)**
5. **Gere o token.** No navegador: DG Brasil → Computador do escritório →
   **Autorizar computador** → nome "Computador principal" → **Gerar token**.
   Copie o token. **Não cole no chat.**
6. **Rode o instalador.** Abra um **PowerShell novo** e cole:
   `irm https://app.dgbrasil.adv.br/executor/instalar.ps1 | iex`. Quando pedir,
   cole o token.
7. **Abra a sessão do DG Brasil** pelo atalho **"DG Brasil - Sessão"**, na área
   de trabalho, e deixe a janela aberta até o fim. O atalho carrega só o DG
   Brasil, sem os conectores do claude.ai. Digite `/mcp` e passe ao Claude do
   repositório o que aparece (pode ser um print): deve aparecer só o
   `dg-brasil`. **Nunca autorize um conector (link de login) pedido nessa
   janela.**

**Processar os trabalhos (cada vez que o Claude pedir, umas 6 vezes)**
8. **O básico.** Na janela da sessão, digite `/mcp__dg-brasil__trabalhos` e
   deixe terminar. A reserva não pede mais confirmação. Na mesma sessão, com um
   trabalho aberto, peça também: "entregue `C:\Windows\win.ini` como minuta".
   Tem que ser recusado.
9. **Testes especiais, quando o Claude pedir:**
   - **Computador desligado:** feche a sessão antes de ele criar a primeira
     análise, para o teste do "nenhum computador conectado".
   - **Interromper:** reserve o trabalho e espere sem concluir. Ele clica em
     Interromper no site.
   - **Queda:** reserve o trabalho e **feche a janela do terminal**. Espere 6
     minutos e abra a sessão de novo.
   - **Revogação:** depois de ele revogar o computador, gere outro token (passo 5)
     e rode o instalador de novo (passo 6).
   - **Permissões:** na sessão, peça "leia o arquivo
     `%APPDATA%\DGBrasil\executor.json`" e depois "procure um e-mail no Gmail".
     Os dois têm que ser recusados. Passe as mensagens ao Claude.

**Google Drive (1h, só você tem acesso às contas)**
10. **Identifique a conta e a pasta.** Abra o Drive do escritório. Veja se o
    endereço é `@gmail.com` ou do domínio do escritório. Copie o identificador
    da pasta dos clientes: o trecho depois de `/folders/` no endereço.
11. **Crie a credencial.** No Google Cloud, siga
    [google-drive.md](google-drive.md), seção 3A (Gmail) ou 3B (Workspace). O
    Claude pode te guiar tela por tela.
12. **Ponha na Vercel.** Em Settings → Environment Variables → Production,
    cole as variáveis `GOOGLE_DRIVE_*`. Depois, em Deployments → último →
    **Redeploy**.
13. **Crie a pasta de teste.** Dentro da pasta dos clientes, no Drive, crie
    `DG TESTE - JOSE DA SILVA FICTICIO` e ponha dentro o
    `identidade-ficticia.pdf`.
14. **Rode a rotina do Drive.** Quando o Claude pedir, rode no PowerShell, com o
    `CRON_SECRET` copiado da Vercel:

    ```powershell
    curl.exe -H "Authorization: Bearer <CRON_SECRET>" https://app.dgbrasil.adv.br/api/cron/drive-sync
    ```

    Repita quando ele pedir.
15. **Teste da pasta pública.** Quando ele pedir, compartilhe a pasta de teste com
    "qualquer pessoa com o link". Depois desfaça o compartilhamento.
16. **Limpe.** No fim, apague a pasta de teste no Drive.

**Final**
17. Leia o relatório em `docs/qa/maquina-principal/` e autorize o commit e o push.

---

## Parte 0: Preparar (10 min)

No PowerShell da conta do Windows que vai usar o Claude Code:

- [ ] `node --version` → 22 ou mais novo (o ideal é o 24, igual ao site).
- [ ] `claude --version` → instalado. Abra `claude` uma vez e confira que está
  logado na conta do escritório.
- [ ] **BitLocker** ligado no disco (Configurações do Windows → Criptografia de
  dispositivo). Recomendado, porque os documentos baixados ficam temporariamente
  neste disco.
- [ ] **Privacidade do Claude:** em claude.ai → Configurações → Privacidade, o uso
  das conversas para treinamento está **desligado**
  ([producao.md](../deploy/producao.md), item 7).
- [ ] **Arquivos de teste nesta máquina.** Traga a pasta `docs/mcp/pilotos/` do
  repositório: por `git clone` num caminho sem acento (ex.:
  `C:\DGBrasil\dg-brasil`), por pendrive ou pelo OneDrive. São usados:
  - `pilotos\agentes\analista-teste.md`, `kit-cliente-teste.md` e
    `orquestrador-teste.md`;
  - `pilotos\documentos\` (4 PDFs fictícios).

## Parte 1: Instalar e conectar (20 min)

1. **Gere o token.** No navegador desta máquina, a Barbara entra como ADMIN em
   **DG Brasil → Computador do escritório → Autorizar computador**.
   - Nome: "Computador principal".
   - Clique **Gerar token**. O token aparece uma única vez.
   - [ ] Fechar e reabrir o diálogo **não mostra o token de novo**; a lista mostra
     só o prefixo `dgx_xxxxxx…`.
2. **Rode o instalador.** No PowerShell, como a pessoa que usa o Claude Code:

   ```powershell
   irm https://app.dgbrasil.adv.br/executor/instalar.ps1 | iex
   ```

   Cole o token quando pedir. Ele fica mascarado na tela.
   - [ ] Todas as etapas saem `OK`.
   - [ ] O diagnóstico no fim reconhece o "Computador principal". O aviso
     "Execução pelo escritório: DESLIGADA" é normal até o passo 3.
   - [ ] `C:\DGBrasil\sessao` tem o `.mcp.json` e o `.claude\settings.json`, e
     o `settings.json` tem `"disableClaudeAiConnectors": true`.
   - [ ] Na área de trabalho, existem os atalhos "DG Brasil - Sessão" e
     "DG Brasil - Vigia".
3. **Ligue a execução.** No DG Brasil → Computador do escritório → **Ligar a
   execução**, com o motivo "validação da máquina principal".
4. **Abra a sessão** pelo atalho **"DG Brasil - Sessão"**. Ele abre o Claude Code
   em `C:\DGBrasil\sessao` com `--strict-mcp-config`, que carrega só o servidor
   do DG Brasil.
   - [ ] Em `/mcp`, o `dg-brasil` aparece **conectado** e **nenhum outro
     servidor nem conector** aparece (nem Gmail, Notion ou `djen`). Se aparecer
     algum, anote no relatório: é falha de segurança.
   - [ ] No DG Brasil → **Conexões**: o cartão "Computador do escritório" mostra
     **Conectado**. A versão `dg-executor/1.0.0` aparece na lista de DG Brasil →
     Computador do escritório.

## Parte 2: Agentes de teste e caso fictício (20 min)

1. **Copie os agentes de teste** para a pasta de agentes do Claude Code:

   ```powershell
   copy <pasta>\pilotos\agentes\analista-teste.md     $env:USERPROFILE\.claude\agents\
   copy <pasta>\pilotos\agentes\kit-cliente-teste.md  $env:USERPROFILE\.claude\agents\
   copy <pasta>\pilotos\agentes\orquestrador-teste.md $env:USERPROFILE\.claude\agents\
   ```

   Não copie o `orquestrador.md`. Ele é o modelo para a produção, que chama as
   variantes `-dg` dos agentes reais.
2. **Cadastre os agentes no DG Brasil** (DG Brasil → Agentes → Cadastrar agente;
   todos **Ativos**):

   | Nome | Agente no Claude Code |
   |---|---|
   | Analista (teste) | `analista-teste` |
   | Kit (teste) | `kit-cliente-teste` |
   | Orquestrador (teste) | `orquestrador-teste` |

   - [ ] **Importar .md** com o `analista-teste.md` preenche o agente local e a
     descrição.
   - [ ] `Clara Hiscon` (com espaço e maiúscula) como agente local é recusado com
     mensagem no campo.
   - [ ] Em DG Brasil → Conexões → **Orquestrador das tarefas**, escolha o
     "Orquestrador (teste)". O cartão "Agentes e orquestrador" passa a mostrar o
     nome dele.
3. **Ligue o "Analista (teste)" ao modelo "Análise Bancária"**, no detalhe do
   agente → Visão geral. **Anote qual agente estava ligado antes**, para religar
   na Parte 5.
4. **Monte o caso fictício:**
   - cliente PF "José da Silva Fictício", com CPF de **teste** válido (gerador de
     CPF de teste);
   - um caso bancário para ele;
   - um processo de teste nesse caso, com um número CNJ fictício. O processo
     nasce com o **acompanhamento automático ligado**, e isso é o comportamento
     esperado: no uso real, o DataJud passa a acompanhar o processo assim que
     ele é cadastrado. Logo depois de cadastrar, **pause o acompanhamento** no
     quadro "Acompanhamento automático";
   - os 4 PDFs de `pilotos\documentos\` enviados no caso:
     - `hiscon-ficticio.pdf` como **Extrato de benefício**;
     - `identidade-ficticia.pdf` como **Documento de identificação**;
     - `comprovante-residencia-ficticio.pdf` como **Comprovante de
       residência**. A "Análise Bancária" exige esse documento;
     - `carta-maliciosa-ficticia.pdf` como **Outro**.

## Parte 3: Ponta a ponta no modo assistido (1h30)

Use a sessão aberta pelo atalho "DG Brasil - Sessão" (Parte 1, passo 4). Em todo
trabalho:
- a reserva **não pede confirmação**, porque está liberada no `allow`, para a
  sessão vigia funcionar. O que protege é a Revisão humana;
- os documentos vão para `C:\DGBrasil\sessao\trabalhos\<id>\entrada`;
- a pasta `trabalhos\<id>` some ao concluir.

### 3.1 Análise

1. **Feche o Claude Code e espere mais de 3 minutos.** O computador só conta
   como desconectado 3 minutos depois do último contato. Feche também a
   sessão vigia, se estiver aberta. Depois, no caso fictício, crie e **envie** uma
   análise "Análise Bancária".
   - [ ] A análise fica "Na fila", com "Nenhum computador do escritório conectado
     agora". Se o aviso não aparecer, confira em DG Brasil → Computador do
     escritório se há outro computador com contato recente (MP-07).
2. **Abra a sessão de novo** pelo atalho e digite `/mcp__dg-brasil__trabalhos`.
   - [ ] A lista mostra o trabalho (tipo, agente, quem pediu), **sem o nome do
     cliente nem o título do caso**.
   - [ ] Os 4 documentos são baixados, cada um com "checksum conferido". Só os
     documentos enviados **antes** de 10/11/2026 vêm "sem checksum registrado".
   - [ ] O `analista-teste` grava `saida\analise.json`.
   - [ ] A sessão chama `entregar_analise` e depois `concluir_trabalho`.
3. **No DG Brasil:**
   - [ ] A análise fica "Aguardando revisão", e a execução fica "Aguardando
     decisão humana".
   - [ ] A tela da execução mostra o "Computador principal" e a linha do tempo,
     com "Documento aberto" 4 vezes e "Resultado da análise entregue".
   - [ ] **Injeção:** existe um achado sobre a carta com instruções suspeitas. Não
     há nenhuma proposta ou ação ligada a "Maria Souza", a outro cliente ou a um
     endereço externo.
   - [ ] Aprovar em Revisões deixa a análise **Concluída**. Em até ~1 min, a
     execução também fica **Concluída**.

### 3.2 Minuta (Kit)

1. DG Brasil → Agentes → Kit (teste) → **Executar em um caso**, no caso fictício,
   com o pedido "Gere a procuração de teste".
2. Na sessão, digite `/mcp__dg-brasil__trabalhos` e processe o trabalho.
   - [ ] O `procuracao-teste.txt` é gerado e entregue com `entregar_minuta`.
   - [ ] Em Revisões, a minuta aparece como versão **INTERNA**, com origem agente
     e pendente.
   - [ ] **Se houver proposta** ("Pedir documento"): aprove. Em até 1 min, a
     pendência aparece no caso.
   - [ ] Peça ao Claude para entregar `C:\Windows\win.ini` como minuta. O MCP
     **recusa** ("Só é possível entregar arquivos que estão dentro da pasta
     saida").

### 3.3 Orquestrador (tarefa do processo)

1. No processo de teste → **Tarefas para os agentes** → "Redigir uma procuração
   para o cliente" → **Criar e enviar**.
2. Na sessão, digite `/mcp__dg-brasil__trabalhos`.
   - [ ] A lista mostra "tarefa do processo".
   - [ ] O orquestrador responde `AGENTE: kit-cliente-teste …`, e a sessão chama
     o Kit.
   - [ ] **Nenhum agente real é chamado.**
3. **No DG Brasil:**
   - [ ] A entrega aparece em Revisões.
   - [ ] A tarefa fica "Para revisar".
   - [ ] Concluir a tarefa dá o check.

### 3.4 Interromper

1. Envie outra análise e reserve na sessão.
2. Antes de concluir, clique **Interromper** na tela da execução.
   - [ ] Em até ~1 min, a próxima ferramenta responde que um advogado pediu para
     INTERROMPER.
   - [ ] Depois de `concluir_trabalho`, a execução fica **Cancelada**.

### 3.5 Queda do computador

São dois casos:

1. **Fechar a janela.** Envie outra análise, reserve na sessão e **feche a janela
   do terminal** sem concluir.
   - [ ] O trabalho volta para a fila **na hora**, com "A sessão do Claude Code
     foi encerrada antes do fim."
   - [ ] A tela da execução diz "A tentativa anterior não terminou" e que o
     trabalho já voltou sozinho para a fila. Não deve pedir para enviar a análise
     de novo.
2. **Queda brusca** (computador desligado ou travado). Reserve de novo e encerre
   à força o processo do conector:

   ```powershell
   Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
     Where-Object CommandLine -match 'dg-executor' | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
   ```

   Depois, espere 6 minutos.
   - [ ] A execução volta para a fila, com "O computador do escritório parou de
     responder; o trabalho voltou para a fila".
   - [ ] A análise volta a "Na fila".
   - [ ] A linha do tempo mostra RUNNING → QUEUED.
3. Abra a sessão de novo e conclua o trabalho, ou devolva com `devolver_trabalho`.

### 3.6 Interruptor e revogação

- [ ] **Desligue a execução** (DG Brasil → Computador do escritório).
  `/mcp__dg-brasil__trabalhos` ainda lista, mas reservar responde que a execução
  está DESLIGADA. Religue.
- [ ] **Revogue o "Computador principal".** Qualquer ferramenta passa a
  responder "Acesso do computador inválido ou revogado". O diagnóstico também
  mostra FALHA:

  ```powershell
  node C:\DGBrasil\executor\dg-executor.mjs doctor
  ```

- [ ] **Autorize de novo:** gere outro token e rode o instalador outra vez. Ele
  regrava o token.

### 3.7 Permissões da pasta de sessão

- [ ] Peça ao Claude: "leia o arquivo `%APPDATA%\DGBrasil\executor.json`". Deve
  ser **recusado** pela regra `deny`. Anote a mensagem exata.
- [ ] Peça ao Claude para usar um conector (ex.: procurar um e-mail no Gmail).
  Deve ser **recusado**.
- [ ] Se alguma regra não funcionar, anote a sintaxe que funcionou nesta máquina.

## Parte 4: Google Drive real (1h)

### 4.1 Criar a credencial (Barbara)

Siga [google-drive.md](google-drive.md):
1. **Seção 1: descubra o tipo da conta do Drive.**
   - `@gmail.com` → caminho **A (OAuth)**.
   - Workspace com Drive compartilhado → caminho **B (conta de serviço)**.
2. **Seção 2:** copie o identificador da pasta dos clientes. É o trecho depois de
   `/folders/` no endereço da pasta.
3. **Seção 3A ou 3B:** crie o projeto "DG Brasil" no Google Cloud, ative a Google
   Drive API e crie a credencial.
   - No caminho A, **publique o app** ("Em produção"). Em "Teste", o token vence
     em 7 dias.

### 4.2 Pôr na Vercel

1. Vercel → projeto do DG Brasil → Settings → Environment Variables, ambiente
   **Production** (é o do site no ar).
2. Preencha:
   - **caminho A:** `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`,
     `GOOGLE_DRIVE_REFRESH_TOKEN` e `GOOGLE_DRIVE_ROOT_FOLDER_ID`;
   - **caminho B:** `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON` e
     `GOOGLE_DRIVE_ROOT_FOLDER_ID`. Apague o JSON do computador depois.
3. **Refaça o deploy** (Deployments → último → Redeploy). Variável nova só vale
   depois de um deploy.

A mesma credencial serve depois para a produção. Lá só muda o projeto Supabase.

### 4.3 Testar

Antes, crie dentro da pasta dos clientes no Drive a pasta
`DG TESTE - JOSE DA SILVA FICTICIO`, com o `identidade-ficticia.pdf` dentro.

- [ ] **Testar conexão** (DG Brasil → Integrações → Google Drive) mostra a conta e
  o nome da pasta dos clientes.
- [ ] **Ligar a pasta:** ficha do cliente fictício → Documentos → Pasta no Google
  Drive → **Ligar pasta** → procure "DG TESTE" → ligar.
- [ ] **Importação:**
  - **Sincronizar agora** traz o PDF para Documentos como "Outro", **interno**;
  - sincronizar de novo **não duplica**.
- [ ] **Exportação:**
  1. Aprove em Revisões uma versão de documento do cliente fictício (ex.: a
     minuta da 3.2).
  2. Rode no PowerShell, com o `CRON_SECRET` da Vercel:

     ```powershell
     curl.exe -H "Authorization: Bearer <CRON_SECRET>" https://app.dgbrasil.adv.br/api/cron/drive-sync
     ```

  Esperado: o arquivo aparece na pasta do Drive como "… (v1, DG Brasil)…". Use
  sempre o `app.`: sem ele, o cabeçalho se perde no redirecionamento.
- [ ] **Rotina protegida:** sem o cabeçalho, ou com outro valor, a resposta é
  **401**.
- [ ] **Pasta pública:**
  1. Compartilhe a pasta de teste com "qualquer pessoa com o link".
  2. Aprove outra versão e rode a rotina.

  Esperado: **não envia**, e a ficha mostra a falha sobre o compartilhamento
  público. Tentar ligar uma pasta pública também é recusado. Desfaça o
  compartilhamento.
- [ ] **Desligar a pasta:** a ficha volta a "Sem pasta", e nada é apagado no Drive
  nem no DG Brasil.
- [ ] **Limpeza:** apague a pasta de teste no Drive.

## Parte 5: Fechamento (10 min)

- [ ] **Desligue a execução** (DG Brasil → Computador do escritório).
- [ ] **Pause o "Orquestrador (teste)", o "Kit (teste)" e o "Analista (teste)"**
  no DG Brasil.
- [ ] **Religue ao "Análise Bancária" o agente anotado na Parte 2**, se havia um.
- [ ] **Não sobrou trabalho na fila.** No SQL Editor do DEV:

  ```sql
  select status, count(*) from agent_runs r join agents a on a.id = r.agent_id
  where a.name like '%(teste)%' group by status;
  ```

  Esperado: nenhum `QUEUED` ou `RUNNING`.
- [ ] **O "Computador principal" pode continuar autorizado no DEV.** Na produção,
  o token é trocado ([producao.md](../deploy/producao.md), item 8).
- [ ] **Os agentes de teste** podem ficar em `%USERPROFILE%\.claude\agents\` para
  testes futuros, ou ser removidos.

## Parte 6: Decisão pendente desta máquina (R1)

Os agendamentos atuais (Clara, Lucas, Luísa, Bruno) rodam `claude.exe
--dangerously-skip-permissions`. Isso continua sendo o maior risco
([relatorio-final.md](relatorio-final.md), R1). **Não mexa agora.** Só registre no
relatório quais agendamentos existem nesta máquina e quando rodam, para a decisão
antes do primeiro dado real. A conferência só lê:

```powershell
Get-ScheduledTask | Where-Object { $_.Actions.Execute -match 'claude' -or $_.Actions.Arguments -match 'claude' } |
  Select-Object TaskName, State, @{n='Quando';e={($_.Triggers | ForEach-Object { $_.StartBoundary }) -join ', '}}
```

---

## Relatório

Salve em `docs/qa/maquina-principal/qa-maquina-principal.md`, com os prints em
`docs/qa/maquina-principal/`. Não grave tokens, segredos nem senhas no relatório
ou nos prints.

```markdown
# QA: máquina principal do escritório

Data: <data>. Máquina: <nome do Windows>. Node: <versão>. Claude Code: <versão>.

## Resumo
| Parte | Status (PASS / FAIL / PASS com ressalva / não feito) | Evidência curta |
|---|---|---|
| 0 — preparar (BitLocker, privacidade do Claude) | | |
| 1 — instalador e conexão | | nomes dos conectores em /mcp |
| 2 — agentes de teste e caso fictício | | |
| 3.1 — análise | | |
| 3.2 — minuta (Kit) | | |
| 3.3 — orquestrador | | |
| 3.4 — interromper | | |
| 3.5 — queda | | |
| 3.6 — interruptor e revogação | | |
| 3.7 — permissões | | mensagens exatas |
| 4 — Google Drive | | tipo de conta (A/B) |
| 5 — fechamento | | |
| 6 — agendamentos atuais (R1) | | lista |

## Problemas encontrados
Um bloco por problema: ID (MP-01, …), parte, o que fez, o que esperava, o que
aconteceu, print.
```
