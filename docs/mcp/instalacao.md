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

Os agentes reais (Clara, Lucas, redatores) **não** são copiados nem
reescritos: entram pela **ponte** ([docs/ponte.md](../ponte.md)).

### 5.1 A ponte (agentes reais)

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
| `agentes.<nome>.pasta` | A etapa (ou etapas, em ordem) onde ficam as pastas dos clientes desse agente. |
| `agentes.<nome>.trazer` | Os nomes dos arquivos que o Mensageiro traz (`*` vale qualquer coisa; maiúsculas e acentos não importam). |
| `agentes.<nome>.dados_do_cadastro` | Gravar o `DADOS DO CADASTRO.txt` quando faltar (padrão `true`; os redatores não usam). |
| `agentes.<nome>.criar_pasta` | Criar a pasta do cliente quando ela não existe em nenhuma etapa (padrão `true`; para os redatores, `false`). |
| `agentes.<nome>.profundidade` | Até quantas subpastas o Mensageiro procura (padrão 3: subpasta do banco, `PEÇAS GERADAS`). |

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
Claude Code em `C:\DGBrasil\sessao` já rodando:

```powershell
claude --strict-mcp-config --mcp-config .mcp.json "/loop 15m Use a ferramenta roteiro_vigia do servidor dg-brasil e siga exatamente o roteiro que ela devolver."
```

- Não use `/loop 15m /mcp__dg-brasil__vigiar`: o `/loop` não abre comandos de
  servidor MCP ("Unknown skill"). Por isso o roteiro sai pela ferramenta
  `roteiro_vigia`. Digitado sozinho, sem loop, o `/mcp__dg-brasil__vigiar` funciona.
- A cada 15 minutos, o Claude confere a fila e processa **todos** os trabalhos,
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
- Intervalo diferente: troque `15m` no atalho (ex.: `10m`, `30m`).
- Assinatura: a vigia usa a assinatura do Claude de quem abriu a sessão. Continua
  sendo uma sessão interativa aberta por uma pessoa, mas roda sem ninguém olhando
  (decisão de 2026-11-09, em [relatorio-final.md](relatorio-final.md)).

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
