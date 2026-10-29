# Agentes via Claude Code + MCP e Google Drive: relatório final

**Status: CÓDIGO PRONTO E TESTADO LOCALMENTE. VALIDAÇÃO NO SUPABASE DEV E NO
COMPUTADOR DO ESCRITÓRIO PENDENTE** ([validacao.md](validacao.md)).
Data: 2026-10-30. Plano aprovado em 2026-10-29
([relatorio-diagnostico.md](relatorio-diagnostico.md)).

## Decisões da Barbara (2026-10-29)

| Pergunta | Decisão |
|---|---|
| Modo de execução | **Só assistido**: uma pessoa abre o Claude Code e manda processar a fila. Sem modo automático e sem chave de API. |
| Onde se escrevem agentes e skills | **No Claude Code** (`Agents_for_DG_Brasil`). O DG Brasil registra qual agente local faz cada trabalho e as orientações de entrega. Teses e referências continuam no DG Brasil. |
| Conta do Google Drive | Não se sabe ainda: a integração aceita **as duas** (OAuth e conta de serviço). |
| Agendamentos atuais (Clara, Lucas, Luísa, Bruno) | **Não mexer.** |

## O que foi feito

### Banco

- **Migration 040** (`20261029000040_office_executor.sql`):
  - **Computadores autorizados** (`executors`):
    - o token aparece uma vez; o banco guarda só o SHA-256;
    - capacidades por ferramenta;
    - revogação que vale na hora e devolve à fila o que estava reservado.
  - **Reserva por trabalho:**
    - token de reserva próprio (hash em `agent_runs`);
    - portas `private.executor_*` que conferem token + reserva viva e derivam o
      caso da execução;
    - são cascas finas sobre as funções `worker_*` já testadas.
    - Tipos de proposta estruturais (agente, skill) são recusados ao computador.
  - **Linha do tempo** (`agent_run_events`, só acrescenta): situação, reserva,
    andamento, **qual versão de documento foi aberta** (com checksum) e entregas.
  - **Manutenção no `pg_cron`**, que antes morava no worker:
    - aplica propostas aprovadas;
    - fecha execuções decididas;
    - devolve à fila o trabalho de computador que parou (3 tentativas). Se já
      havia entrega, vira falha parcial, sem duplicar;
    - dispara os lembretes de prazo.
  - **Agente aponta para o agente local** (`configuration.local_agent`). O
    registro de skill no provedor ficou congelado (tabelas e dados ficam).
- **Migration 041** (`20261030000041_google_drive.sql`):
  - cliente → pasta do Drive **pelo ID**: uma pasta por cliente e um cliente por
    pasta, com auditoria;
  - importação **única** por (arquivo, md5);
  - fila de exportação acionada pela **aprovação em Revisões**;
  - funções do servidor (`dg_worker`).

### Servidor (Next.js)

- **`/api/executor/v1/*`** (`server/executor/`):
  - autentica pelo token do computador e pelo token de reserva, que vão ao banco
    só como hash;
  - limite de chamadas por computador;
  - valida a análise (schema v1, com tese e referência autorizadas), as propostas
    e as minutas;
  - assina URLs do Storage só para o caminho que o banco autorizou;
  - fala com o banco como `dg_worker`, pelo pooler.
- **Google Drive** (`server/integrations/google-drive/`, `server/domain/drive/`):
  - cliente da API v3 com OAuth ou conta de serviço;
  - sincronização (entrada e saída);
  - rota agendada `/api/cron/drive-sync`, protegida por `CRON_SECRET`, uma vez
    por dia no plano Hobby da Vercel (`vercel.json`); a cada 15 min na produção
    ([docs/deploy/producao.md](../deploy/producao.md));
  - "Sincronizar agora";
  - sugestões de ligação por nome, com confirmação humana.

### Computador do escritório

- **`apps/executor`:** servidor MCP local `dg-brasil`.
  - Catálogo fechado: 17 ferramentas. Nenhuma apaga, aprova, envia, roda SQL ou
    shell.
  - Pasta por trabalho; download conferido por SHA-256; minuta só de dentro de
    `saida`.
  - Reserva renovada a cada minuto; o token fica só na memória.
  - Comando `/mcp__dg-brasil__trabalhos` (roteiro do modo assistido) e `doctor`.
- **Guia de instalação** ([instalacao.md](instalacao.md)), com uma pasta de sessão
  e regras de permissão próprias:
  - libera as ferramentas do DG Brasil;
  - **pergunta** antes de reservar;
  - **nega** ler o token, a internet e os conectores (WhatsApp, Gmail, ADVBOX,
    Drive).
- **Agentes de teste fictícios:** [pilotos/agentes/](pilotos/agentes/).

### Telas

- **Configurações → Computador do escritório:** situação (conectado, fila),
  interruptor geral, autorizar computador (token mostrado uma vez) e revogar.
- **DG Brasil:**
  - o agente passa a ser um registro: agente local no Claude Code, orientações do
    DG Brasil, teses e referências;
  - **saíram** a seção Skills, o envio de arquivos de skill e os campos de
    modelo, esforço e limites da Claude API.
- **Execução:** computador, andamento e **linha do tempo**; novos rótulos de erro.
- **Análise no caso:** aviso quando não há computador do escritório conectado.
- **Cliente → Documentos → Pasta no Google Drive:** ligar, trocar, desligar,
  sincronizar.
- **Configurações → Integrações → Google Drive:** situação, testar conexão,
  sugerir ligações.

### Removido

- **`apps/agentes`:**
  - worker da Claude API, Dockerfile e `fly.toml`;
  - Skills API e Files API;
  - teste pago;
  - 54 testes do worker. A parte de banco continua coberta pelo `verificar`.
- **Variáveis do worker** no `.env.example`.
- **Fixtures do sandbox da Etapa 5.** Os PDFs fictícios foram para
  [pilotos/documentos/](pilotos/documentos/).

Nada disso chegou a rodar: não havia chave da Anthropic e o Fly.io nunca foi
configurado.

## Testes executados nesta máquina

| O quê | Resultado |
|---|---|
| `supabase`: `npm run verificar` (PGlite, migrations 001–041) | **673/673** |
| `apps/executor`: `typecheck`, `npm test`, `build` | limpo, **13/13**, build OK |
| `apps/executor`: handshake real por stdio com o cliente MCP oficial | 17 ferramentas, roteiro, logs só em stderr |
| `apps/frontend`: `npm test` | **479/479** (42 arquivos) |
| `apps/frontend`: `tsc`, `eslint`, `next build` | sem erro |

## Não executado aqui (fica para a validação)

- **Testes contra o Supabase DEV:**
  - aplicar 040/041;
  - `validar:real` (seções 41f e 41g, novas);
  - integração completa, inclusive `mcp-executor.int.test.ts`.
- **`pg_cron` no Supabase:** a 040 cria a extensão. Se o projeto exigir ativar
  pelo painel, o guia explica.
- **Ponta a ponta com o Claude Code de verdade:**
  - o nome do comando `/mcp__dg-brasil__trabalhos`;
  - o subagente local;
  - as regras de permissão com caminhos do Windows;
  - os nomes dos conectores do claude.ai no `deny`.
- **Google Drive com credencial real:** depende da Barbara criar a credencial
  ([google-drive.md](google-drive.md)).

## Diferenças em relação ao plano aprovado

1. **Sem executor automático**, por decisão. Também não há chave de API.
2. **MCP local (stdio) e não remoto:** os documentos precisam virar arquivos no
   computador. Um MCP remoto pode vir depois, sobre a mesma API, para usar o DG
   Brasil como conector do claude.ai.
3. **Drive ligado ao cliente, não ao caso.** As pastas de hoje são por cliente,
   com subpastas por banco; a importação lê até 2 níveis.
4. **Sugestões de ligação:** só por nome igual ou que começa igual. O CPF do
   `DADOS DO CADASTRO.txt` fica para depois, porque exigiria ler o conteúdo dos
   arquivos.
5. **Tabelas de skills congeladas, não apagadas** (histórico).

## Riscos que continuam

| # | Risco | Situação |
|---|---|---|
| R1 | Agendamentos atuais com `--dangerously-skip-permissions`, provavelmente com a assinatura | **Fora do escopo por decisão.** Continua sendo o maior risco do escritório (segurança e termos da Anthropic). |
| R2 | Injeção de instruções por documento de terceiro | Mitigado: catálogo fechado, servidor confere tudo, pasta de sessão com `deny` de conectores e internet, revisão humana. A sintaxe do `deny` no Windows ainda precisa ser confirmada (validação 6.7). |
| R3 | Dados de clientes indo ao modelo pela assinatura | **Conferir antes de usar caso real:** em claude.ai → Configurações → Privacidade, o uso das conversas para treinamento deve estar **desligado**. Para dado de cliente, o plano Team/Enterprise (termos comerciais) é o mais adequado. A revisão LGPD do provedor continua pendente. |
| R4 | Um só computador | Fila espera; tela avisa "nenhum computador conectado"; reserva vence e volta à fila. |
| R5 | Token do computador vazar | Escopo limitado (só a fila e o caso reservado), revogação imediata na tela. O guia nega ao Claude a leitura do arquivo do token. |
| R6 | Credencial do Google | Só no servidor. O token de renovação dá acesso ao Drive inteiro da conta: tratar como senha. |

## Próximos passos (depois da validação)

1. Corrigir o que a validação apontar.
2. Preparar as variantes `clara-dg` e `lucas-dg` no `Agents_for_DG_Brasil`, com
   entrada e saída nas pastas do trabalho e a lista de ferramentas mínima, e
   registrá-las no DG Brasil.
3. Configurar o Google Drive e ligar as pastas por "Sugerir ligações".
4. Decidir sobre o R1 (agendamentos atuais) e o R3 (plano e privacidade) antes de
   usar caso real.
