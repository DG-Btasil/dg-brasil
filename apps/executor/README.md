# apps/executor: o computador do escritório

Ponte entre o **Claude Code** do computador do escritório e o **DG Brasil**. É um
servidor MCP local (stdio) chamado `dg-brasil`, que o Claude Code inicia.

- **Instalação e uso:** [docs/mcp/instalacao.md](../../docs/mcp/instalacao.md).
- **Arquitetura:** [docs/mcp/relatorio-diagnostico.md](../../docs/mcp/relatorio-diagnostico.md).

```
dg-executor mcp      servidor MCP (o Claude Code chama: node dist/index.js mcp)
dg-executor doctor   confere configuração, conexão com o DG Brasil, pasta e Claude Code
dg-executor --version
```

## O que ele faz

- **Catálogo fechado de ferramentas** (`src/ferramentas.ts`):
  - **fila:** `listar_trabalhos`, `reservar_trabalho`, `ver_trabalho`;
  - **caso:** `ver_caso`, `ver_processo`, `listar_documentos`, `baixar_documentos`;
  - **conhecimento:** `consultar_teses`, `listar_referencias`, `abrir_referencia`;
  - **entregas:** `informar_progresso`, `entregar_analise`, `entregar_minuta`,
    `propor`;
  - **encerramento:** `concluir_trabalho`, `informar_falha`, `devolver_trabalho`.

  Não existe ferramenta de apagar, aprovar, protocolar, mandar mensagem, mudar
  permissão, SQL ou shell.
- **Roteiro do modo assistido:** o MCP traz o prompt `trabalhos`. No Claude Code,
  ele aparece como `/mcp__dg-brasil__trabalhos`.
- **Pasta por trabalho:** `<pasta_trabalhos>\<id>\entrada` e `saida`.
  - O download confere o SHA-256 que o DG Brasil tem da versão.
  - A minuta só sai de dentro de `saida`: nada de `..`, caminho de fora ou atalho.
  - A pasta é apagada ao terminar. Ao iniciar, apaga sobras de sessões
    anteriores.
- **Reserva:**
  - o token de reserva de cada trabalho fica **só na memória** deste processo; o
    Claude passa o número do trabalho;
  - a reserva é renovada a cada minuto;
  - interrupção pedida na tela é percebida na renovação seguinte;
  - ao fechar a sessão, o que estiver reservado é devolvido. O que não der tempo,
    a reserva vence em 5 minutos e o DG Brasil devolve.
- **Logs:** só em stderr (o stdout é o protocolo MCP), sem token, nome de cliente
  ou conteúdo.

## Configuração

Arquivo `%APPDATA%\DGBrasil\executor.json`. Variáveis de ambiente com o mesmo
papel têm prioridade.

| Chave | Variável | O que é |
|---|---|---|
| `url` | `DG_EXECUTOR_URL` | Endereço do DG Brasil (`https://`; `http` só em localhost) |
| `token` | `DG_EXECUTOR_TOKEN` | Token do computador (`dgx_…`), gerado em Configurações → Computador do escritório |
| `pasta_trabalhos` | `DG_EXECUTOR_WORKDIR` | Onde ficam as pastas dos trabalhos (padrão `%LOCALAPPDATA%\DGBrasil\trabalhos`) |

`DG_EXECUTOR_CONFIG` aponta para outro arquivo de configuração.

## Testes

```bash
npm ci && npm test   # 13 testes
```

Os testes usam o cliente MCP oficial contra o servidor, com um DG Brasil de
mentira (HTTP local). Cobrem:
- o catálogo fechado;
- a reserva;
- o pedido marcado como dado;
- o checksum do download;
- a minuta fora da `saida`;
- a análise por arquivo JSON;
- a interrupção, a falha, a devolução e a sessão fechando;
- as sobras de sessão anterior;
- a configuração.
