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
diagnóstico. Depois: `cd C:\DGBrasil\sessao`, `claude`, `/mcp__dg-brasil__trabalhos`.
Rodar de novo atualiza o conector. O passo a passo manual continua abaixo.

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
      "mcp__dg-brasil__devolver_trabalho", "mcp__dg-brasil__reservar_trabalho",
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

> **A confirmar na primeira vez:** os nomes dos conectores do claude.ai podem ser
> um pouco diferentes neste computador. Abra o Claude Code na pasta de sessão e
> digite `/mcp`: a lista mostra os nomes exatos. Ajuste o `deny` se precisar.

## 5. Os agentes locais

Para cada agente cadastrado no DG Brasil, o arquivo `.md` com o mesmo `name:`
precisa existir em `%USERPROFILE%\.claude\agents\`. Para testar, copie os agentes
fictícios:

```powershell
copy C:\DGBrasil\dg-brasil\docs\mcp\pilotos\agentes\*.md $env:USERPROFILE\.claude\agents\
```

Como preparar os agentes reais (Clara, Lucas):
[docs/adicionar-agente.md](../adicionar-agente.md).

## 6. Usar

```powershell
cd C:\DGBrasil\sessao
claude
```

1. **Aprove o servidor.** Na primeira vez, o Claude Code pergunta se aprova o
   servidor `dg-brasil` do `.mcp.json`. Aprove.
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
claude "/loop 15m /mcp__dg-brasil__vigiar"
```

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
  alguém responder. Para os agentes reais (`-dg`), libere no `allow` só o que
  eles precisam.
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
