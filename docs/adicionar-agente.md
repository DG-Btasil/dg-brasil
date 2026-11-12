# Como pôr um agente do Claude Code para trabalhar no DG Brasil

Desde 2026-10-29, **os agentes e as skills ficam no Claude Code do computador do
escritório** (repositório `Agents_for_DG_Brasil`, instalado em `~/.claude`). O DG
Brasil não guarda as instruções do agente. Ele guarda:

- **qual agente local** faz cada tipo de trabalho;
- **as orientações do DG Brasil**: o que entregar e como;
- **o conhecimento autorizado**: teses e referências.

Tudo o que o agente entrega vai para **Revisões** e só vale depois de um advogado
aprovar.

## 1. O agente no Claude Code

O agente é um arquivo `.md` em `~/.claude/agents/` (ou no `Agents_for_DG_Brasil`),
com `name:` no cabeçalho. Para trabalhar com o DG Brasil, ele precisa de três
coisas:

- **Ler os documentos na pasta `entrada` que o trabalho informa.** O próprio
  Claude Code, conduzido pelo comando `/mcp__dg-brasil__trabalhos`, baixa os
  documentos do caso para essa pasta antes de chamar o agente.
- **Gravar o que gerar na pasta `saida`** do trabalho: PDF, DOCX, XLSX, TXT ou CSV.
  Para análise, gravar `saida\analise.json` no formato que o trabalho mostra.
- **Não usar, durante um trabalho do DG Brasil:**
  - as pastas do Google Drive por nome;
  - o ChatJurídico ou o WhatsApp;
  - o Gmail;
  - o ADVBOX.

  Os dados vêm do DG Brasil, e a entrega volta para ele.

Os agentes atuais do escritório (Clara, Lucas, Alice, Murilo...) foram escritos
para a esteira do escritório (pastas `G:\Meu Drive\...`, ChatJurídico, ADVBOX).
Desde 11/11/2026 o DG Brasil usa **clones** deles, com o sufixo `-dg`
(`agentes/bancario/<nome>-dg.md`, pasta que fica só no computador do escritório,
fora do GitHub), com as regras de
[agentes/clonagem/contrato-dos-clones.md](agentes/clonagem/contrato-dos-clones.md).
Os originais não são alterados. Os clones também entram pela **ponte**
([ponte.md](ponte.md)); quem os instala e os põe no `ponte.json` é o
`apps/executor/scripts/instalar-agentes-bancario.ps1`. Para pôr outro agente na
ponte:

1. acrescente o agente no `%APPDATA%\DGBrasil\ponte.json` do computador
   principal, com a pasta da etapa onde ficam as pastas dos clientes e os nomes
   dos arquivos que ele gera (`trazer`);
2. confira se tudo o que ele roda está liberado no `settings.json` da sessão
   (scripts, pasta de trabalho, modelos): o instalador já libera o que os
   agentes de hoje usam;
3. rode `node C:\DGBrasil\executor\dg-executor.mjs doctor`: ele mostra o agente
   na ponte e avisa se a pasta não existe.

Agente que **não** está no `ponte.json` segue o fluxo antigo (pastas `entrada` e
`saida` do trabalho): é o caso dos agentes de teste. Agente novo do DG Brasil
segue o contrato dos clones e leva o sufixo `-dg`. Os agendamentos do escritório
continuam como estão.

Exemplos fictícios prontos para testar: [mcp/pilotos/agentes/](mcp/pilotos/agentes/).

## 2. O registro no DG Brasil

Os agentes do **kit básico** (os 13 clones da esteira bancária e o
orquestrador) já vêm cadastrados pela migration 054, ativos. O arquivo de cada
um fica no computador do escritório (pasta local `agentes/bancario/`, fora do
GitHub) e é instalado a partir dela ([mcp/instalacao.md](mcp/instalacao.md),
seção 5.0): o site guarda só o registro. Para outro agente, como ADMIN, em
**DG Brasil → Agentes → Cadastrar agente**:

| Campo | O que pôr |
|---|---|
| Nome | Como a equipe reconhece (ex.: "Clara · Análise do HISCON") |
| Agente no Claude Code | O `name:` real do arquivo `.md` (ex.: `clara-hiscon`, `lucas-procuracao`) |
| Orientações do DG Brasil | O que entregar e como. Vão junto com cada trabalho. Já vem um modelo. |
| Teses e referências | O que o agente pode consultar pelo DG Brasil durante o trabalho |
| Situação | Ativo, para receber trabalhos |

O botão **Importar .md** lê o arquivo do agente só para preencher o nome do agente
local e a descrição.

Mudar as orientações ou o agente local cria uma **versão nova**. Cada execução
registra a versão que usou.

## 3. Como o agente recebe trabalho

- **Análise:** em **DG Brasil → Agentes → (o agente) → Visão geral**, ligue o
  agente a um modelo de análise (ex.: "Análise Bancária"). A partir daí, toda
  análise desse modelo enviada num caso vira trabalho para ele.
- **Execução avulsa:** **Executar em um caso** (ADMIN), no detalhe do agente.

## 4. Como o escritório processa a fila

No computador do escritório, com o Claude Code aberto, digite
`/mcp__dg-brasil__trabalhos`. O Claude:

1. lista a fila;
2. pergunta quais trabalhos processar;
3. reserva cada um;
4. baixa os documentos, conferindo o checksum;
5. chama o agente local;
6. entrega análise, minutas e propostas;
7. encerra o trabalho.

Instalação: [mcp/instalacao.md](mcp/instalacao.md).

## 5. O que o agente pode e não pode fazer

**Pode** (pelas ferramentas do DG Brasil):
- ver o caso e os processos do trabalho reservado;
- baixar os documentos do caso;
- consultar teses e referências autorizadas;
- informar o andamento;
- entregar análise, minuta ou proposta.

**Não pode** (as ferramentas não existem):
- apagar;
- aprovar;
- protocolar;
- mandar mensagem;
- mudar permissão;
- ver outro cliente;
- rodar SQL.

O banco confere em toda chamada que o trabalho está reservado por aquele
computador e deriva o caso do trabalho, nunca de um argumento.
