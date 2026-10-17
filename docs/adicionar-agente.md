# Como adicionar um agente

Desde a Etapa 5, agente, skill, tese e referência são **cadastro**, feito pela
área **DG Brasil** (só ADMIN). Nenhum agente é programado no código: o worker
executa qualquer agente cadastrado, dentro das mesmas regras.

Antes de começar, descubra em qual nível você está: **o agente precisa de
alguma informação ou de algum efeito que o catálogo de ferramentas ainda não
tem?** Quase sempre não — e aí é só cadastro.

---

## Nível 1 — Cadastro pela tela (minutos, sem deploy)

### Skills (DG Brasil → Skills → Criar skill)

Uma skill é **instruções (o SKILL.md) + arquivos** (scripts `.py`, modelos
`.docx`, referências `.md`/`.pdf`/`.json`…), igual ao Claude Code.

- **Enviar pasta**: escolha a pasta da skill do Claude Code. O `SKILL.md` vira
  nome, descrição e instruções; os outros arquivos vão junto, com as subpastas
  (`scripts/gerar.py` continua `scripts/gerar.py`).
- **Descrição** é obrigatória (até 1.024 caracteres): é por ela que o agente
  decide usar a skill.
- Limites: 10 MB por arquivo, 25 MB por skill, 200 arquivos. Identificador sem
  "anthropic"/"claude" (nome reservado do provedor).
- Mudar instruções ou arquivos cria **versão nova**; a anterior fica no
  histórico e nas execuções que a usaram.

Os scripts rodam **só no ambiente isolado do provedor** (contêiner sem
internet, sem instalação de pacote, sem acesso ao DG Brasil). Disponíveis lá:
Python 3.11 com `python-docx`, `reportlab`, `pypdf`, `pypdfium2`, `pdfplumber`,
`pdf2image`, `openpyxl`, `pandas` e outros. **Não há Word nem LibreOffice**:
script que dependia do Word para gerar PDF precisa gerar o PDF direto (ex.:
`reportlab`) ou entregar `.docx`.

### Agentes (DG Brasil → Agentes → Criar agente)

- **Importar .md**: o arquivo do agente do Claude Code preenche nome,
  descrição e instruções. `tools` e `model` do Claude Code **não** são copiados
  (no DG Brasil as ferramentas são as do catálogo e o modelo é escolhido aqui).
- **Instruções**: o papel e o passo a passo. Adapte o que dependia da máquina
  local: Drive (`G:\`), ChatJurídico, PowerShell, Word — no DG Brasil o agente
  lê os **documentos do caso** e entrega para **Revisões**.
- **Execução**: modelo (Opus para redação/análise jurídica; Haiku só para
  tarefas simples), esforço, ambiente isolado (ligado para skills com scripts
  e para gerar arquivos), limites (passos, chamadas de ferramenta, tempo, teto
  de custo em dólares) e, se quiser, restrição das ferramentas de leitura.
- **Conhecimento**: skills (até 20), teses autorizadas, referências.
- Situação **Ativo** para receber execuções.

Para o agente executar **análises**, ligue-o a um modelo de análise (aba Visão
geral do agente → "Análises executadas por este agente").

### Ferramentas que o agente tem

| Ferramenta | O que faz |
|---|---|
| `ver_caso` | O caso da execução: cliente, processos, prazos, documentos (com o id da última versão), pendências |
| `ver_processo` | Um processo do caso: dados, partes, movimentações |
| `abrir_documento` | Uma versão de documento do caso: para LER (PDF/texto/imagem) e/ou para o ambiente isolado (scripts). Até 12 por execução, 25 MB cada |
| `consultar_teses` | Teses ativas autorizadas (do agente e do modelo de análise) |
| `listar_referencias` / `abrir_referencia` | Referências ativas vinculadas ao agente |
| `propor` | Proposta para revisão humana (prazo, pedido de documento, atualização do caso, processo, providência) |
| `entregar_documento` | Minuta que o agente GEROU nesta execução no ambiente isolado → documento interno, versão nova, revisão pendente |
| `entregar_analise` | Resultado estruturado da análise → revisão humana do resultado exato |

Não existe ferramenta de SQL, shell do servidor, URL, nem leitura de arquivo
do servidor. Tudo que o agente lê é do caso da execução; tudo que entrega vai
para Revisões.

### O que o agente pode propor

| Tipo | Efeito depois da aprovação |
|---|---|
| `CREATE_DEADLINE` | Cria prazo no caso (origem `AGENT`) |
| `REQUEST_DOCUMENT` | Cria pendência de documento; em caso de parceiro, também uma solicitação ao parceiro |
| `UPDATE_CASE` | Título, resumo ou status de triagem. Nunca aceita, rejeita ou encerra caso |
| `CREATE_PROCESS` | Cria processo em preparação no caso |
| `UPDATE_SKILL` / `UPDATE_AGENT` | Cria versão nova e a torna corrente. **Só ADMIN aprova** |
| `OTHER` | Nenhum efeito automático: aprovado, vira providência da equipe |

---

## Nível 2 — Agente que precisa de algo novo (é código, com revisão)

**a) Precisa LER algo que nenhuma ferramenta expõe.**
→ Nova ferramenta em [`apps/agentes/src/ferramentas.ts`](../apps/agentes/src/ferramentas.ts).
Se lê dado de cliente, a leitura é uma função `private.worker_*` nova (migration
nova) que recebe a execução, confere a reserva e deriva o caso dela — o
`dg_worker` não tem SELECT em tabela de domínio, de propósito.

**b) Precisa PRODUZIR um efeito que ainda não existe.**
→ Novo tipo em `agent_proposals.proposal_type` (migration nova), o schema do
payload em [`propostas.ts`](../apps/agentes/src/propostas.ts) e o ramo em
`private.apply_proposal_effect`. Tipo sem aplicador não entra no CHECK. Se o
efeito altera configuração do DG Brasil, confira `private.proposal_requires_admin`.

**c) Precisa de uma integração externa (Drive, WhatsApp, tribunal).**
→ Não é ferramenta genérica de rede para o agente: é um provider próprio, com
credencial no servidor, escopo por caso e efeito por proposta. Etapa futura.
