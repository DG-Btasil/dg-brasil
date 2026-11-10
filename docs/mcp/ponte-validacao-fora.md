# Ponte · Frente A: validações fora da máquina principal

**Para quem:** o agente validador (Claude Code) em qualquer computador com o
repositório. O `db push` é feito na máquina que tem o Supabase CLI ligado ao DEV.
O Drive real é testado pelo site, com a Barbara logada.

**Relatório:** `docs/qa/ponte/qa-ponte-fora.md`. Para cada item `PA-xx`: OK /
FALHOU / NÃO TESTADO e o que viu.

**Regras:** só dados fictícios; nenhum `.env` nem token no chat; login no site
sempre da Barbara (o validador navega, ela digita a senha).

## A1 · Banco (qualquer máquina)

`cd supabase && npm install && npm run verificar`
- [ ] **PA-01** todas as verificações passam, inclusive a seção `[051]` (dados da
  ponte só do cliente do trabalho, bloqueio do Porteiro, Drive sem duplicata,
  permissões das funções novas).

## A2 · Código (qualquer máquina)

- [ ] **PA-02** `cd apps/executor && npm install && npx tsc --noEmit && npm test`: tudo passa.
- [ ] **PA-03** `cd apps/frontend && npx tsc --noEmit && npx vitest run`: tudo passa.
- [ ] **PA-04** `cd apps/executor && npm run bundle` e `git status`: o
  `apps/frontend/public/executor/dg-executor.mjs` e os três `agentes/*.md`
  **não mudam** (o pacote publicado é o do código).

## A3 · Instalador sem instalar (qualquer máquina Windows)

O instalador grava em `C:\DGBrasil` e no `%APPDATA%`. Aqui só se confere o que ele
produziria, numa pasta temporária.

1. **Sintaxe nas duas codificações** em que o `irm | iex` pode entregar o texto:
   ```powershell
   foreach ($enc in 'utf-8', 'iso-8859-1') {
     $s = [IO.File]::ReadAllText("$PWD\apps\frontend\public\executor\instalar.ps1", [Text.Encoding]::GetEncoding($enc))
     $t = $null; $e = $null
     $null = [Management.Automation.Language.Parser]::ParseInput($s, [ref]$t, [ref]$e)
     "$enc : $(if ($e) { $e.Message } else { 'ok' })"
   }
   ```
   - [ ] **PA-05** `ok` nas duas.
2. **Simulação da parte das permissões e da ponte:** rode só o trecho entre
   `$Settings = ...` e `Passo 'Atalhos na área de trabalho'`, com
   `$Sessao`, `$CfgDir` e `$env:USERPROFILE` apontando para uma pasta temporária
   e um `settings.json` antigo que tenha `WebFetch` e uma regra extra no `deny`.
   - [ ] **PA-06** `ponte.json`: caminhos com acento corretos (`3. PROCURAÇÃO
     ASSINADA`, `01. ADVOCACIA — CLIENTES`, `CLIENTE - ESCRITÓRIO`), Clara, Lucas
     e os 11 redatores, `pasta_pelo_nome: false`.
   - [ ] **PA-07** `settings.json`: as quatro ferramentas da ponte, as pastas do
     `G:`, `~/agentes-juridicos/**`, `python`; `WebFetch` e `WebSearch` no
     `allow` e **fora** do `deny`, mesmo com o `settings.json` antigo; a regra
     extra do `deny` antigo mantida; `mcp__claude_ai_*` e o arquivo do token
     continuam no `deny`.
   - [ ] **PA-08** com `$env:DG_BRASIL_PONTE = '0'`: sem `ponte.json`, sem as
     regras da ponte, e `WebFetch`/`WebSearch` continuam no `deny`.
   - [ ] **PA-09** rodar de novo **não** sobrescreve um `ponte.json` existente.

## A4 · Porteiro e diagnóstico (qualquer máquina)

1. Rode `checarArquivo` (de `apps/executor/dist/ponte.js`, depois de `npm run
   build`) sobre os PDFs de `docs/mcp/pilotos/documentos/`:
   - [ ] **PA-10** `hiscon`, `identidade`, `comprovante` e `carta-maliciosa`:
     `liberado` pelo script (a carta só é pega na leitura do Porteiro, na Frente B);
     `pdf-com-javascript-ficticio.pdf`: `suspeito`, com JavaScript.
2. **Falso positivo:** o mesmo em até 40 PDFs reais da máquina (pasta Downloads),
   anotando **só a contagem** por resultado, sem nome de arquivo.
   - [ ] **PA-11** nenhum `suspeito` por JavaScript ou ação automática sem motivo
     real (até 5% é aceitável; acima disso, anote os motivos).
3. **Diagnóstico com uma ponte de teste:** `ponte.json` temporário (variável
   `DG_EXECUTOR_PONTE`) com uma raiz e um agente numa pasta temporária;
   `node apps/executor/dist/index.js doctor`.
   - [ ] **PA-12** aparecem as linhas `Ponte:` (raiz, agente, agentes da ponte,
     antivírus, Edge); raiz inexistente vira `FALHA`.
4. **Edge e antivírus de verdade** (máquina Windows com Edge e Defender):
   - [ ] **PA-19** `edgeHtmlParaPdf` converte um HTML fictício que tem
     `<script>` em PDF (começa com `%PDF-`), e o mesmo HTML protegido
     (`htmlSemScript`) aberto com `msedge --headless --dump-dom` mostra o
     conteúdo original: o script **não** rodou.
   - [ ] **PA-20** `defender` responde `limpo` para o `hiscon-ficticio.pdf` em
     poucos segundos.

## A5 · Site e banco DEV

1. `git log origin/master -1` mostra o commit da ponte; o deploy do Vercel desse
   commit está **Ready**.
   - [ ] **PA-13** a rota nova existe:
     `curl.exe -s -o NUL -w "%{http_code}" https://app.dgbrasil.adv.br/api/executor/v1/jobs/11111111-2222-4333-8444-555555555555/bridge`
     responde `401` (sem token), e não `404`.
2. **Na máquina do Supabase DEV:** `git pull`, `cd supabase`,
   `supabase db push` (a única pendente é `20261110000051_ponte_agentes.sql`) e
   `supabase db push --dry-run`.
   - [ ] **PA-14** "Remote database is up to date".
   - [ ] **PA-15** `npm run validar:real` continua passando.

## A6 · Google Drive real (pelo site, depois da credencial)

Quando a credencial do Drive estiver no Vercel ([google-drive.md](google-drive.md)):

1. No Drive, crie `000. PASTA CLIENTES NOVOS\7. KIT DO CLIENTE\DG TESTE - JOSE DA SILVA FICTICIO`.
2. No site, no cliente fictício "DG Teste - José da Silva Fictício": **Documentos
   → Pasta no Google Drive** → ligue essa pasta.
   - [ ] **PA-16** a pasta aparece ligada.
3. Envie ao caso o `hiscon-ficticio.pdf` pelo site e ponha o **mesmo arquivo** na
   pasta do Drive. Ponha também um `DADOS DO CADASTRO.txt` qualquer (fictício) e
   um PDF fictício novo. **Sincronizar agora.**
   - [ ] **PA-17** o PDF novo é importado; o HISCON (mesmo conteúdo) **não** vira
     documento "Outro" duplicado; o `DADOS DO CADASTRO.txt` não é importado.
   - [ ] **PA-18** rodar "Sincronizar agora" de novo não importa nada.

A Frente B usa esta mesma pasta e este cliente.

## Fechamento

Commit do relatório numa branch `qa/ponte` e push. Itens que falharem: descrever
o que viu e o comando exato.
