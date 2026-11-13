# Instalação no computador do escritório (modo assistido)

Este guia prepara um computador do escritório para processar os trabalhos do DG
Brasil com o Claude Code.

**Modo assistido:** uma pessoa abre o Claude Code e manda processar a fila. Nada
roda sozinho, e o uso fica dentro da assinatura do Claude que o escritório já tem.
Nenhuma chave de API é necessária.

Não mexe nos agendamentos atuais (Clara, Lucas, Luísa, Bruno), que continuam como
estão.

---

## Jeito rápido: um comando (Roadmap 2.0)

1. No DG Brasil (ADMIN): **DG Brasil → Computador do escritório → Autorizar
   computador** → dê um nome → **Gerar token**. O diálogo mostra o comando e o token.
2. No computador do escritório, abra o **PowerShell** (como a pessoa que usa o
   Claude Code) e cole:

   ```powershell
   irm https://app.dgbrasil.adv.br/executor/instalar.ps1 | iex
   ```

3. Quando pedir, cole o token (`dgx_...`).

O instalador (`apps/frontend/public/executor/instalar.ps1`) confere Node.js 22+ e o
Claude Code, baixa o conector já compilado (`/executor/dg-executor.mjs`, gerado
com `npm run bundle` em `apps/executor`), grava o token em
`%APPDATA%\DGBrasil\executor.json` (só a conta do Windows lê), cria
`C:\DGBrasil\sessao` com o `.mcp.json` e as permissões da seção 4 e roda o
diagnóstico. Ele também cria na área de trabalho os atalhos **"DG Brasil -
Sessão"** (modo assistido: digite `/mcp__dg-brasil__trabalhos`) e **"DG Brasil -
Vigia"** (seção 6). **Abra sempre pelos atalhos:** eles rodam
`claude --strict-mcp-config --mcp-config .mcp.json`, que carrega só o servidor do
DG Brasil, sem os conectores do claude.ai nem os servidores MCP do usuário
(QA da máquina principal, MP-05).
Rodar de novo atualiza o conector e **mescla** o `deny`: regras acrescentadas à
mão no computador não se perdem, e o arquivo anterior fica em
`settings.json.anterior`. O passo a passo manual continua abaixo.

**Rodar de novo com um token já guardado (desde 13/11/2026):** se este computador
já tem um token para o mesmo endereço, o instalador mostra o começo dele e
pergunta: **M** mantém, **T** troca por um novo (Enter = manter). Antes ele
reaproveitava em silêncio; como o site de teste e o de uso real ficam no mesmo
endereço, o token de teste era reaproveitado depois da virada e o computador
parava de conectar. Sem ninguém para responder: `$env:DG_BRASIL_MANTER_TOKEN = '1'`
mantém sem perguntar e `$env:DG_BRASIL_TOKEN = 'dgx_...'` troca sem perguntar.

**Versão mínima do conector:** o site recusa conector abaixo da **1.3.4**
(resposta 426, código `CLIENT_OUTDATED`), e a mensagem diz para rodar o
instalador de novo. O número fica num lugar só:
`MIN_EXECUTOR_VERSION`, em `apps/frontend/src/server/executor/contract.ts`.

> Ao mudar o código de `apps/executor`, rode `npm run bundle` e faça commit do
> `apps/frontend/public/executor/dg-executor.mjs` atualizado.

## 1. O que precisa

| Item | Como conferir |
|---|---|
| Windows 10/11 com o Claude Code instalado e logado | `claude --version` no terminal |
| Node.js 22 ou mais novo | `node --version` |
| Git (para baixar o repositório) | `git --version` |
| Acesso ADMIN ao DG Brasil (para gerar o token) | DG Brasil → Computador do escritório |
| BitLocker ligado no disco (recomendado) | Configurações do Windows → Criptografia de dispositivo |

## 2. Baixar e compilar o pacote

Use um caminho **sem acento** (ex.: `C:\DGBrasil`):

```powershell
mkdir C:\DGBrasil
cd C:\DGBrasil
git clone https://github.com/DG-Btasil/dg-brasil.git
cd dg-brasil\apps\executor
npm ci
npm run build
npm test          # 13 testes; não fala com o DG Brasil de verdade
```

## 3. Autorizar o computador no DG Brasil

1. **Gere o token.** No navegador, como ADMIN, abra **DG Brasil → Computador do
   escritório → Autorizar computador**, dê um nome (ex.: "Computador da recepção")
   e clique em **Gerar token**.
2. **Copie o conteúdo mostrado.** O token aparece **uma única vez**. Se perder,
   revogue o token e gere outro.
3. **Crie o arquivo de configuração** `%APPDATA%\DGBrasil\executor.json`. No
   PowerShell, `notepad $env:APPDATA\DGBrasil\executor.json` (crie a pasta
   `DGBrasil` antes, se não existir). Cole o conteúdo e acrescente a pasta de
   trabalhos:

```json
{
  "url": "https://app.dgbrasil.adv.br",
  "token": "dgx_...",
  "pasta_trabalhos": "C:\\DGBrasil\\sessao\\trabalhos"
}
```

- **Endereço:** `url` é o endereço do DG Brasil, `https://app.dgbrasil.adv.br`.
  - Sempre com o `app.`: o domínio sem ele redireciona, e o token não vai junto.
  - Em desenvolvimento local, pode ser `http://localhost:3000`.
  - Fora do localhost, só `https://`.
- **Onde o token NÃO pode ir:** em e-mail, WhatsApp, `.mcp.json` ou repositório.

4. **Rode o diagnóstico:**

```powershell
cd C:\DGBrasil\dg-brasil\apps\executor
node dist\index.js doctor
```

Tudo deve sair `OK`. O "AVISO Execução pelo escritório: DESLIGADA" é normal até
um ADMIN ligar a execução em Configurações.

## 4. A pasta de sessão do DG Brasil

Os trabalhos do DG Brasil são feitos **numa pasta própria**, com regras de
permissão só dela. As regras **não** afetam o uso normal do Claude Code em outras
pastas.

```powershell
mkdir C:\DGBrasil\sessao\.claude
mkdir C:\DGBrasil\sessao\trabalhos
```

**`C:\DGBrasil\sessao\.mcp.json`** registra o servidor MCP do DG Brasil. Não leva
o token, que está no `executor.json`:

```json
{
  "mcpServers": {
    "dg-brasil": {
      "type": "stdio",
      "command": "node",
      "args": ["C:\\DGBrasil\\dg-brasil\\apps\\executor\\dist\\index.js", "mcp"]
    }
  }
}
```

**`C:\DGBrasil\sessao\.claude\settings.json`** define as permissões:

```json
{
  "permissions": {
    "allow": [
      "mcp__dg-brasil__listar_trabalhos", "mcp__dg-brasil__ver_trabalho", "mcp__dg-brasil__ver_caso",
      "mcp__dg-brasil__ver_processo", "mcp__dg-brasil__listar_documentos", "mcp__dg-brasil__baixar_documentos",
      "mcp__dg-brasil__consultar_teses", "mcp__dg-brasil__listar_referencias", "mcp__dg-brasil__abrir_referencia",
      "mcp__dg-brasil__informar_progresso", "mcp__dg-brasil__entregar_analise", "mcp__dg-brasil__entregar_minuta",
      "mcp__dg-brasil__propor", "mcp__dg-brasil__concluir_trabalho", "mcp__dg-brasil__informar_falha",
      "mcp__dg-brasil__devolver_trabalho", "mcp__dg-brasil__reservar_trabalho", "mcp__dg-brasil__roteiro_vigia",
      "Read(./trabalhos/**)", "Write(./trabalhos/**)"
    ],
    "deny": [
      "Read(~/AppData/Roaming/DGBrasil/**)",
      "WebFetch", "WebSearch",
      "mcp__claude_ai_Gmail__*", "mcp__claude_ai_Chat_Juridico_MCP__*", "mcp__claude_ai_ADVBOX__*",
      "mcp__claude_ai_Google_Drive__*"
    ]
  }
}
```

O que cada regra faz:
- **`allow`:** libera as ferramentas do DG Brasil e a leitura e gravação só na
  pasta dos trabalhos. Desde a sessão vigia (2026-11-09), **reservar também está
  liberado**: antes ficava em `ask` e o Claude pedia confirmação a cada trabalho,
  o que travava a vigia. No modo assistido, quem escolhe o que processar continua
  sendo a pessoa (o roteiro pergunta), e nada do que é entregue vale sem a
  aprovação em Revisões.
- **`deny`:**
  - impede ler o arquivo do token;
  - impede acessar a internet;
  - impede usar os conectores de WhatsApp/ChatJurídico, Gmail, ADVBOX e Drive
    durante estes trabalhos.

  Um PDF com instruções maliciosas não consegue mandar mensagem nem buscar outro
  cliente.

> **Isolamento (2026-11-10, MP-05).** Uma lista de conectores proibidos não
> basta: na validação, a sessão de trabalhos conseguiu ler o Notion, que não
> estava na lista, e ainda ofereceu um link para "conectar" outro conector. O
> instalador agora usa três camadas:
> 1. `"disableClaudeAiConnectors": true` no `settings.json`: nenhum conector do
>    claude.ai carrega nesta pasta;
> 2. os atalhos abrem com `--strict-mcp-config`: só o servidor `dg-brasil`;
> 3. o `deny` acima, ampliado com `mcp__claude_ai_*`, os conectores conhecidos e
>    `mcp__djen`, fica como reserva.
>
> **Confira:** abra pelo atalho e digite `/mcp`. Só o `dg-brasil` deve aparecer.
> **Nunca autorize um conector (link de login) pedido pela sessão de trabalhos.**

## 5. Os agentes locais

Para cada agente cadastrado no DG Brasil, o arquivo `.md` com o mesmo `name:`
precisa existir em `%USERPROFILE%\.claude\agents\`. Para testar, copie os agentes
fictícios:

```powershell
copy C:\DGBrasil\dg-brasil\docs\mcp\pilotos\agentes\*.md $env:USERPROFILE\.claude\agents\
```

Os agentes do escritório (Clara, Lucas, redatores) **não são alterados**. Desde
11/11/2026, o DG Brasil usa **clones** deles, com o sufixo `-dg`
([docs/agentes/clonagem](../agentes/clonagem/README.md)), que também entram pela
**ponte** ([docs/ponte.md](../ponte.md)).

### 5.0 Os agentes do kit (clones do DG Brasil)

**Os arquivos dos clones não estão no repositório do GitHub**, que é público:
eles trazem o método do escritório (teses, modelos, regras de redação). Por
enquanto existem só no computador do escritório, na pasta `agentes/` da cópia
local do projeto (o `.gitignore` impede o envio por engano). Levar os agentes
para dentro do DG Brasil, com um botão "Setup" na tela de autorizar o
computador, é o primeiro item do pós-MVP: [deploy/pos-mvp.md](../deploy/pos-mvp.md),
item 6.

No computador do escritório, com a pasta `agentes/` na cópia local do projeto:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Projetos\dg-brasil\apps\executor\scripts\instalar-agentes-bancario.ps1
```

Para ver o que ele faria sem gravar nada, acrescente `-Simular`. Ele:
- copia os 13 clones (`agentes/bancario/*-dg.md`) e os agentes da ponte para
  `%USERPROFILE%\.claude\agents\`. Não toca em nenhum outro arquivo dessa pasta;
- copia os scripts dos clones (`agentes/scripts/`) para `C:\DGBrasil\agentes\scripts\`
  e cria a pasta de trabalho `C:\DGBrasil\agentes\trabalho\`;
- cria, no Drive, `DG BRASIL` e `DG BRASIL\BASE DE CONHECIMENTO`. A pasta dos
  clientes é `DG BRASIL\<ORIGEM>\CLIENTE BANCÁRIO\<NOME DO CLIENTE>` (desde
  13/11/2026): `<ORIGEM>` é o escritório de origem do cliente, o próprio
  escritório ou o parceiro. Quem cria a pasta de cada origem é o conector, no
  primeiro cliente dela; o instalador não cria nem move pasta de cliente;
- cria `C:\DGBrasil\agentes\escritorio.json` (quem assina) a partir de um
  exemplo fictício, se ainda não existir. **Preencha com os dados reais**;
- acrescenta os clones ao `ponte.json` (com a pasta
  `G:\Meu Drive\DG BRASIL\{origem}\CLIENTE BANCÁRIO`) e libera as pastas deles
  na sessão do DG Brasil, guardando o arquivo anterior com o final `.anterior`.

A pasta com a origem exige o **conector 1.3.4 ou mais novo** e a **migration
060** no banco (é ela que entrega a origem do cliente). Faltando a migration, o
trabalho para com o aviso "o DG Brasil não informou o escritório de origem do
cliente", sem criar pasta. Atualize o conector **antes** de rodar este
instalador: o conector antigo não entende `{origem}`.

No site, os clones já aparecem em **DG Brasil → Agentes** (migration 054, o
"kit básico"). Depois de instalar, feche e abra de novo a janela "DG Brasil -
Vigia".

### 5.1 A ponte

O instalador cuida de tudo (para pular: `$env:DG_BRASIL_PONTE = '0'` antes de
rodar):

- grava `%APPDATA%\DGBrasil\ponte.json`, **só se ainda não existir**, com a Clara,
  o Lucas e os redatores, as pastas de cada um e os nomes dos arquivos que eles
  geram. É esse arquivo que diz quem passa pela ponte; agente fora dele segue o
  fluxo `entrada`/`saida`;
- baixa os três agentes da ponte (`porteiro-dg`, `arquivista-dg`,
  `mensageiro-dg`) para `%USERPROFILE%\.claude\agents\`;
- acrescenta ao `allow` da sessão: as quatro ferramentas da ponte, as pastas dos
  clientes (`000. PASTA CLIENTES NOVOS` e `01. ADVOCACIA — CLIENTES`), as pastas
  de modelos (só leitura), `~/agentes-juridicos/**` (pasta de trabalho e
  `registro_pecas.csv`), `~/.claude/scripts`, `docs` e `skills` (leitura),
  `python` e `powershell -File`.

A **internet** fica liberada (`WebFetch` e `WebSearch` saem do `deny` e entram
no `allow`; decisão de Barbara, 10/11/2026): os redatores conferem a
jurisprudência no portal oficial e os cálculos buscam o BACEN. A regra 7 do
roteiro proíbe pôr dado do cliente numa busca. O resto do `deny` **não muda**:
ChatJurídico, Gmail, ADVBOX, Drive (conector) e o arquivo do token continuam
bloqueados. Sem a ponte (`DG_BRASIL_PONTE=0`), a internet continua bloqueada.

Campos do `ponte.json`:

| Campo | O que é |
|---|---|
| `raizes_permitidas` | As árvores do Drive onde a ponte pode ler e gravar. Fora delas, as ferramentas recusam. |
| `pasta_pelo_nome` | `false` (padrão): sem pasta do Drive ligada ao cliente no DG Brasil, a ponte para com `SEM_PASTA_NO_DRIVE`. `true`: usa o nome do cliente em MAIÚSCULAS, sem acento. |
| `antivirus` | `true` (padrão): o Porteiro passa o antivírus do Windows em cada arquivo. |
| `agentes.<nome>.pasta` | A etapa (ou etapas, em ordem) onde ficam as pastas dos clientes desse agente. Pode levar o marcador `{origem}` como uma pasta inteira do caminho (`G:\Meu Drive\DG BRASIL\{origem}\CLIENTE BANCÁRIO`): o conector troca pelo nome do escritório de origem do cliente, em MAIÚSCULAS e sem acento, e cria a pasta da origem quando ela não existe. Sem o marcador, nada muda. |
| `agentes.<nome>.trazer` | Os nomes dos arquivos que o Mensageiro traz (`*` vale qualquer coisa; maiúsculas e acentos não importam). |
| `agentes.<nome>.dados_do_cadastro` | Gravar o `DADOS DO CADASTRO.txt` quando faltar (padrão `true`; os redatores não usam). |
| `agentes.<nome>.criar_pasta` | Criar a pasta do cliente quando ela não existe em nenhuma etapa (padrão `true`; para os redatores, `false`). |
| `agentes.<nome>.profundidade` | Até quantas subpastas o Mensageiro procura (padrão 3: subpasta do banco, `PEÇAS GERADAS`; nos clones, 1). |
| `agentes.<nome>.nome_da_pasta` | `drive` (padrão): a pasta do Drive ligada ao cliente no DG Brasil. `cliente`: sempre o nome do cliente no cadastro (os clones, em `DG BRASIL\<ORIGEM>\CLIENTE BANCÁRIO`). |

Ao lado do `ponte.json` o conector mantém o `pdfs-do-word.json`: a lista dos
PDFs que ele mesmo gerou a partir das minutas em Word (um PDF por `.docx`
trazido, gravado só na pasta do cliente). É por essa lista que o Mensageiro não
traz esses PDFs como se fossem arquivo novo do agente. Não precisa mexer nele.

Depois de mexer no arquivo, rode `node C:\DGBrasil\executor\dg-executor.mjs doctor`:
ele lista cada agente da ponte e avisa o que falta.

## 6. Usar

Abra o atalho **"DG Brasil - Sessão"** da área de trabalho. Sem o atalho, o
equivalente é:

```powershell
cd C:\DGBrasil\sessao
claude --strict-mcp-config --mcp-config .mcp.json
```

1. **Confira o isolamento.** Em `/mcp`, só o `dg-brasil` aparece.
2. **Peça a fila.** Digite `/mcp__dg-brasil__trabalhos`. O Claude lista a fila e
   pergunta quais trabalhos processar.
3. **O Claude processa.** Para cada trabalho escolhido, ele reserva, baixa os
   documentos, chama o agente local, entrega e encerra.
4. **Mantenha a sessão aberta enquanto houver trabalho.** Enquanto a sessão está
   aberta, o DG Brasil mostra "Computador conectado" e a reserva é renovada a cada
   minuto.
5. **Saiba o que acontece se fechar no meio.** Fechar o Claude Code (ou o
   computador desligar) no meio de um trabalho faz o trabalho voltar sozinho para a
   fila em 5 minutos. Se já tinha entregado algo, o trabalho fica como falha
   parcial, e o que foi entregue continua em Revisões.

O que foi entregue fica em **DG Brasil → Revisões**. A pasta de cada trabalho em
`C:\DGBrasil\sessao\trabalhos` é apagada ao terminar.

### Sessão vigia (processar sozinho enquanto estiver aberta)

Para não precisar digitar o comando a cada trabalho: de manhã, abra o atalho
**"DG Brasil - Vigia"** da área de trabalho (o instalador cria). Ele abre o
Claude Code em `C:\DGBrasil\sessao` já rodando, a cada 30 minutos (eram 15 até
11/11/2026):

```powershell
claude "/loop 30m Use a ferramenta roteiro_vigia do servidor dg-brasil e siga exatamente o roteiro que ela devolver." --strict-mcp-config --mcp-config .mcp.json
```

- O texto do `/loop` vem **antes** das opções. O `--mcp-config` aceita vários
  arquivos: escrito depois dele, o texto vira "outro arquivo de configuração",
  o Claude Code responde "MCP config file not found" e fecha na hora. Foi o que
  impediu a vigia de conectar na Frente B de 10/11/2026.

- Não use `/loop 30m /mcp__dg-brasil__vigiar`: o `/loop` não abre comandos de
  servidor MCP ("Unknown skill"). Por isso o roteiro sai pela ferramenta
  `roteiro_vigia`. Digitado sozinho, sem loop, o `/mcp__dg-brasil__vigiar` funciona.
- A cada 30 minutos, o Claude confere a fila e processa **todos** os trabalhos,
  um de cada vez, sem perguntar nada. Fila vazia: responde uma linha e espera a
  próxima rodada.
- São as mesmas regras do modo assistido (só a pasta do trabalho, documentos são
  dados, nenhum conector além do DG Brasil). Tudo vai para **Revisões**: nada é
  protocolado, enviado ou aprovado sozinho.
- **Feche no fim do dia.** A vigia só funciona com a janela aberta e o computador
  ligado (sem suspender). Fechar no meio de um trabalho é seguro: ele volta para a
  fila em 5 minutos.
- **Uma vigia por vez.** Duas janelas não processam o mesmo trabalho (a reserva é
  exclusiva), mas gastam a assinatura em dobro.
- **Desligar a execução** no DG Brasil (Computador do escritório) faz a vigia
  parar de pegar trabalhos na rodada seguinte, sem fechar a janela.
- **Se a janela parar esperando uma confirmação** (um agente local tentando usar
  algo fora das permissões, como Python ou Word), o trabalho fica parado até
  alguém responder. A mensagem diz o que falta: acrescente a regra no `allow`
  (o instalador já libera o que os agentes reais usam hoje, seção 5.1).
- Intervalo diferente: troque `30m` no atalho (ex.: `15m`, `60m`). Intervalo
  menor gasta mais assinatura. Com o "Verificar agora", ninguém precisa esperar o
  intervalo.
- **"Verificar agora"**: com a Vigia aberta, um advogado não precisa esperar os 30
  minutos (próxima seção).
- **Só os agentes da ponte na lista** (economia; seção "Economia de assinatura",
  abaixo).
- Assinatura: a vigia usa a assinatura do Claude de quem abriu a sessão. Continua
  sendo uma sessão interativa aberta por uma pessoa, mas roda sem ninguém olhando
  (decisão de 2026-11-09, em [relatorio-final.md](relatorio-final.md)).

#### "Verificar agora" (a Vigia roda na hora)

Em **DG Brasil → Computador do escritório** (e na análise que está na fila,
dentro do caso), o botão **Verificar agora** faz a Vigia rodar o roteiro em
segundos. Só ADMIN e advogado (LAWYER) veem o botão; o banco também confere.

**Como funciona.**
1. No fim de **toda** rodada (passo 4 do `roteiro_vigia`, "ESPERA"), a Vigia roda
   `node C:/DGBrasil/executor/dg-executor.mjs esperar --situacao`. O comando
   responde na hora e diz se já há uma espera rodando.
2. Se não houver, ela deixa `node C:/DGBrasil/executor/dg-executor.mjs esperar`
   **em segundo plano** e encerra a rodada. Esse comando não usa o Claude: só
   pergunta ao DG Brasil, a cada 15 a 30 s, se alguém pediu a verificação.
3. O clique grava um pedido (um por escritório; clicar de novo não cria outro). A
   primeira Vigia que perguntar fica com ele: o banco marca "atendido" de forma
   atômica, e duas Vigias nunca pegam o mesmo pedido.
4. O `esperar` imprime `VERIFICAR_AGORA` e termina. O Claude Code acorda a
   sessão, que roda o roteiro inteiro e, no fim, deixa uma espera nova.
5. O `/loop 30m` continua: é o padrão e a rede de segurança. O botão só "fura a fila" do loop.

**O que a tela mostra.** "Pedido enviado às HH:MM", depois "Atendido às HH:MM"
(o ADMIN vê também qual computador atendeu). Sem resposta em 2 minutos:
"**A Vigia não respondeu (janela fechada?)**". O pedido vale por 10 minutos: se a
Vigia abrir nesse tempo, ela atende. Depois disso ele vence e não acorda mais
ninguém.

**Se a Vigia não responder:**
1. Confira se a janela "DG Brasil - Vigia" está aberta e o computador ligado (sem
   suspender). Fechada, abra o atalho: a primeira rodada já processa a fila.
2. A janela está aberta, mas parada pedindo confirmação? Responda. Se o pedido for
   para rodar o `esperar`, rode o instalador de novo: ele grava a permissão.
3. Na janela, a última linha da Vigia diz `ESPERA_PARADA`? A espera parou por um
   erro que não passa sozinho, e a linha diz o motivo (por exemplo, o token do
   computador foi revogado). Resolva o motivo: a rodada seguinte tenta de novo
   sozinha (acesso: na hora; outros erros: depois de 1 hora). Enquanto isso, a Vigia
   segue no horário normal do loop.
4. A execução está **desligada** no DG Brasil? O botão fica desabilitado. Ligue
   o interruptor primeiro.

**Regras que evitam rodadas a mais** (cada término do `esperar` acorda o Claude e
gasta assinatura):
- **Uma espera por vez.** A trava `C:\DGBrasil\sessao\esperar.lock` guarda o PID e
  é renovada a cada 20 s. A rodada pergunta antes (`--situacao`, em primeiro plano)
  e só inicia uma espera se não houver outra. Trava de processo morto ou sem
  renovar há 2 minutos não conta.
- **Queda de rede, erro 5xx ou 429:** o `esperar` não termina. Tenta de novo em
  30 s, 60 s, 120 s, até 5 minutos, em silêncio.
- **Execução desligada:** continua esperando em silêncio (uma pergunta por minuto)
  até religar.
- **Erro definitivo** (token revogado ou inválido, DG Brasil sem a rota): imprime
  `ESPERA_PARADA: <motivo>` **uma vez** e termina. A marca
  `C:\DGBrasil\sessao\esperar.parado` impede que a rodada seguinte inicie outra
  espera que pararia igual.
- **Janela fechada:** o `esperar` percebe que o Claude Code sumiu e termina em
  silêncio. Não fica processo sobrando.
- **Pedido durante uma rodada:** o `listar_trabalhos` do início da rodada já dá o
  pedido pendente como atendido. Pedido que chega depois disso fica no DG Brasil,
  e a espera nova pega na primeira pergunta: uma rodada a mais, nunca duas.

**Permissão.** O instalador acrescenta ao `allow` só estas duas linhas exatas
(Bash e PowerShell), nada de `Bash(node *)`:

```
Bash(node C:/DGBrasil/executor/dg-executor.mjs esperar --situacao)
Bash(node C:/DGBrasil/executor/dg-executor.mjs esperar)
```

O Claude Code compara o comando inteiro. Por isso o roteiro manda escrever com
barras normais, sem aspas e sem nada antes ou depois.

**Opcional: acordar também com trabalho novo.** Com
`$env:DG_BRASIL_ESPERAR_FILA = '1'` antes do instalador (ou `"esperar_fila": true`
no `%APPDATA%\DGBrasil\executor.json`), o `esperar` também termina com
`TRABALHO_NOVO` quando entra trabalho na fila. Ele espera 1 minuto para juntar
os pedidos que chegam juntos. Trabalho que volta para nova tentativa não conta.
Com isso, os 30 minutos viram só a garantia.
- **Custo:** uma rodada por leva de trabalhos novos. Os trabalhos teriam rodado
  de qualquer jeito na rodada seguinte, então o gasto a mais é pequeno.
- **Cuidado:** vários pedidos espaçados no mesmo quarto de hora viram várias
  rodadas, em vez de uma.
- **Padrão:** desligado.

**Custo, medido em 11/11/2026** neste computador. Cada pedido ao modelo relê
todo o contexto da sessão, quase todo do cache. Esse contexto era de 95 mil tokens
e passou a 48 mil com a economia da seção seguinte.

| Situação | Pedidos ao modelo |
|---|---|
| `esperar` parado esperando | Nenhum (só HTTP para o DG Brasil, cerca de 3 por minuto) |
| Rodada do loop (30 min) com uma espera já rodando | 1 a mais (o `--situacao`) |
| Rodada logo depois de um "Verificar agora" | 2 a mais (`--situacao` e a espera nova) |
| Cada clique em "Verificar agora" | Uma rodada (fila vazia: cerca de 5 pedidos) |
| Alternativa descartada: `/loop 1m` | 60 rodadas por hora, mesmo sem ninguém pedir |

A FASE 0 provou o ponto que sustenta o desenho. A sessão parada, igual à Vigia,
acorda sozinha quando o comando em segundo plano termina: 3,4 s sem `/loop` e
3,6 s com o `/loop 15m` ativo. O teste foi feito antes da troca para 30 min, e o
intervalo não muda o despertar.

**Teste de ponta a ponta (11/11/2026, computador principal, site
`app.dgbrasil.adv.br` com a 052 no DEV).** O instalador foi rodado de novo, e a
Vigia foi aberta pelo atalho. O clique em "Verificar agora" foi feito pelo
Playwright, como Administrador.

| Momento | Hora | Depois do clique |
|---|---|---|
| Clique | 23:04:33,7 | — |
| `esperar` pega o pedido e termina (tela: "Atendido às 23:04 pelo Computador principal") | 23:04:55,4 | 21,7 s |
| A Vigia é acordada e lê `VERIFICAR_AGORA` | 23:05:03,6 | 29,9 s |
| Fila conferida (`listar_trabalhos`) | 23:05:16,9 | 43 s |
| Espera nova em segundo plano; rodada encerrada | 23:05:23 | 50 s |

A maior parte da espera é o intervalo entre consultas do `esperar` (15 a 30 s).
Do término dele ao Claude agir, foram 8 s.

Também se viu:
- **Volta do loop:** a das 23:10 encontrou `ESPERA_ATIVA` e não abriu outra.
- **Execução desligada:** um script de validação desligou a execução às 23:00.
  O botão ficou bloqueado, com o aviso, e o `esperar` continuou vivo, sem acordar
  a Vigia.
- **Permissões:** nenhuma janela de confirmação durante o teste.

Nesta Vigia, cada pedido ao modelo levou de 69 a 90 mil tokens de contexto. A
lista tinha 20 agentes, em vez de 73. Na sessão aberta, o contexto é maior que no
`claude -p` da medição, porque entram as instruções do `/loop` e o texto do
roteiro, que volta a cada rodada.

| Rodada (fila vazia) | Pedidos ao modelo |
|---|---|
| Rodada do clique | 6 |
| Volta do loop com a espera ativa | 4 |

#### Economia de assinatura: só os agentes da ponte na lista

A sessão manda ao modelo, em **todo** pedido, a descrição de todos os agentes de
`%USERPROFILE%\.claude\agents`. Neste computador, são 67 arquivos, e só essa lista
passa de 40 mil tokens. A Vigia chama poucos deles. O instalador põe no `deny` da
pasta da sessão (`Agent(<nome>)`) todos os outros, e o Claude Code os tira da lista.
Eles continuam funcionando normalmente em qualquer outra pasta.

| Contexto de cada pedido (medido com `claude -p` na cópia da pasta da sessão) | Tokens |
|---|---|
| Antes | 95.252 |
| Com os 47 agentes que a Vigia não usa no `deny` | 48.959 |
| E também os agentes internos `general-purpose`, `Explore`, `Plan`, `claude`, `statusline-setup` e `claude-code-guide` | **48.447** (−49%) |

- **Ficam na lista:**
  - os agentes do `ponte.json` (Clara, Lucas e os redatores);
  - `porteiro-dg`, `arquivista-dg` e `mensageiro-dg`;
  - os três de teste.
- **Agente novo para o DG Brasil chamar:** ponha no `ponte.json` ou em
  `$env:DG_BRASIL_AGENTES_EXTRA = 'nome1,nome2'` e rode o instalador de novo. Se
  um trabalho apontar para um agente fora da lista, a Vigia registra
  `AGENT_NOT_FOUND` com o nome dele. Ela nunca troca por outro agente.
- **As regras `Agent(...)` são refeitas a cada instalação.** As outras regras de
  bloqueio que alguém acrescentou à mão continuam.
- **Testado e descartado:**
  - **Esconder skills:** com `skillOverrides: "off"`, o contexto **subiu** para
    55 mil tokens; com `Skill(...)` no `deny`, não mudou nada.
  - **Desligar as skills sincronizadas do claude.ai:** a Clara usa uma delas, a
    `roteiro-peticao-consignado`.

## 7. Segurança, em resumo

- **O token do computador:**
  - só permite pegar trabalhos da fila e, depois de reservar, ver o caso daquele
    trabalho;
  - não dá acesso ao banco, à chave do Supabase nem a outros clientes;
  - vazou ou o computador saiu do escritório: **revogue** em Configurações →
    Computador do escritório. Vale na hora, e o que estava reservado volta para a
    fila.
- **Cada trabalho tem um token de reserva próprio**, que fica só na memória do
  servidor MCP. O Claude passa o número do trabalho, nunca vê o token.
- **Desligar tudo:** Configurações → Computador do escritório → **Desligar a
  execução**. Nenhum trabalho novo é reservado, mesmo com o Claude Code aberto.
- **Nada do que o agente entrega vale sem aprovação humana em Revisões.**

## 8. Atualizar

```powershell
cd C:\DGBrasil\dg-brasil
git pull
cd apps\executor
npm ci
npm run build
node dist\index.js doctor
```

Feche e abra o Claude Code depois de atualizar.
