# Agentes via Claude Code + MCP: diagnóstico e plano (Etapa A)

**Status: AGUARDANDO APROVAÇÃO. Nada foi removido nem alterado no sistema.**
Base: `master` em `5609165` (2026-10-29). Fontes: o código deste repositório, o repositório
`Agents_for_DG_Brasil`, a configuração do Claude Code desta máquina e a documentação oficial da
Anthropic (links na seção 12).

---

## Resumo em uma página

**O que existe hoje.** A Etapa 5 construiu um motor de agentes na nuvem:
- um worker Node (`apps/agentes`) que chama a API da Anthropic e roda as skills no ambiente isolado dela;
- uma fila no Postgres;
- a área DG Brasil para cadastrar agentes e skills.

O banco está aplicado no Supabase DEV (migration 039, QA de 2026-10-20). O resto **nunca rodou de
verdade**: não há chave da Anthropic, o worker nunca foi para o Fly.io e o custo até hoje é US$ 0.

**O que muda.** Quem executa passa a ser o Claude Code do computador do escritório, com os agentes
que já funcionam lá (Clara, Lucas, Alice...). O DG Brasil continua dono dos dados, da fila e da
revisão humana. O que sai é o motor na nuvem.

**Cinco achados que mudam o plano:**

1. **O worker não faz só IA.** Ele também faz duas coisas que nada têm a ver com IA:
   - aplica as propostas que o advogado aprovou em Revisões (ex.: criar o prazo);
   - dispara os avisos de "prazo vencendo / vencido".

   Apagar o worker sem mudar isso de lugar quebra as duas coisas em silêncio. Elas precisam ir para
   o próprio banco (agendador `pg_cron`) **antes** da remoção.
2. **Execução automática exige chave de API, não a assinatura.** Os termos da Anthropic restringem
   acesso "automatizado, por bot ou script", exceto por chave de API. Uma pessoa usando o Claude
   Code com a assinatura é o "uso comum" previsto; um script iniciando o Claude Code sozinho com a
   assinatura não tem autorização expressa. Na prática:
   - com o computador iniciando sozinho, o custo por uso da API continua (é o mesmo da Etapa 5);
   - a economia real vem do "modo assistido", em que alguém do escritório abre o Claude Code e
     manda processar a fila.
3. **O computador do escritório já roda agentes sozinho, sem pedir permissão.** O Agendador de
   Tarefas do usuário "Micro" executa `claude.exe --agent ... --dangerously-skip-permissions -p` a
   cada 2 horas (Clara, Lucas, Luísa, Bruno). Isso tem dois problemas:
   - é o padrão que o seu próprio pedido proíbe;
   - pelos termos acima, provavelmente usa a assinatura.

   Isso está **fora** do DG Brasil (repositório `Agents_for_DG_Brasil`) e não vou mexer sem você
   pedir. Mas é o maior risco atual (seção 9).
4. **Os documentos dos clientes estão no Google Drive, identificados pelo nome da pasta.** Hoje os
   agentes leem e gravam em `G:\Meu Drive\...` (o Google Drive para computador), pelo nome do
   cliente. São cerca de 780 pastas. Não há integração do Drive no DG Brasil: só a tabela
   `external_document_exports`, nunca usada, e um plano no `BACKEND_HANDOFF.md`. Usar o Drive
   pelos IDs dos arquivos exige casar as 780 pastas com os clientes do DG Brasil uma vez, com
   confirmação humana.
5. **A segurança local é mais fraca que a da Etapa 5.** Na Etapa 5, a skill rodava num contêiner
   da Anthropic sem internet e sem segredos. No computador do escritório, o Claude Code tem acesso
   a disco, rede, Drive sincronizado e os conectores do claude.ai (WhatsApp/ChatJurídico, Gmail,
   ADVBOX). Um PDF de terceiro com instruções maliciosas tem muito mais o que alcançar. O plano
   compensa com:
   - um usuário Windows só para o executor;
   - lista fechada de ferramentas;
   - nenhum conector além do DG Brasil;
   - o servidor recusando qualquer operação fora do escopo.

**A proposta, em uma frase:** o DG Brasil ganha uma API para o executor. O computador do escritório
ganha um pacote pequeno com duas peças:
- um servidor MCP local, que dá ao Claude Code ferramentas como "ver trabalho", "baixar documento"
  e "entregar análise";
- um executor opcional para o modo automático.

O banco, a fila, a revisão humana e o histórico ficam como estão.

**Decisões que preciso de você** estão no fim (seção 13). As principais:
- modo assistido, automático ou os dois;
- se a criação de agentes continua na tela do DG Brasil;
- qual é a conta Google do Drive.

---

## 1. Diagnóstico da infraestrutura atual de IA

### 1.1 Peças no repositório

| Peça | Onde | O que faz | Situação |
|---|---|---|---|
| Worker de agentes | `apps/agentes/` (~3.700 linhas, 54 testes) | Lê a fila, chama a API da Anthropic (`@anthropic-ai/sdk` 0.131.0), registra skills na Skills API, manda documentos pela Files API, valida a saída e grava os resultados. Na manutenção: aplica as propostas aprovadas e manda os avisos de prazo. | Nunca rodou com a API real. Nunca foi para o Fly. |
| Provedores | `apps/agentes/src/provedor/{anthropic,falso,tipos}.ts` | Abstração `AIProvider`, a Claude API e o provedor falso dos testes | Exclusivo da nuvem |
| Ferramentas do agente | `apps/agentes/src/ferramentas.ts` | `ver_caso`, `ver_processo`, `abrir_documento`, `consultar_teses`, `listar_referencias`, `abrir_referencia`, `propor`, `entregar_documento`, `entregar_analise`, com validação zod | A lógica serve ao MCP |
| Formato da análise | `apps/agentes/src/analise.ts` | Esquema estrito do resultado (`ResultadoAnalise`) | Serve ao MCP |
| Deploy | `apps/agentes/{Dockerfile,fly.toml,.dockerignore}` | Máquina no Fly.io (`gru`) | Nunca usado |
| Teste pago | `apps/agentes/src/smoke-real.ts` | Teste opcional contra a API real | Nunca rodou |
| Banco (base) | migrations 012, 018 | Tabelas de agentes, skills, teses, referências, execuções e propostas; fila `agent_execution` (pgmq); `claim_agent_run`, `heartbeat_agent_run`; funções `worker_*` com escopo da execução; `apply_proposal_effect` | Aplicado no DEV |
| Banco (evolução) | 029, 031, 033, 037 | Envio de análise atômico, página de execuções, interrupção, notificações (inclusive lembretes de prazo) | Aplicado no DEV |
| Banco (Etapa 5) | 039 (1.770 linhas) | Interruptor da IA; arquivos de skill e registro no provedor; `legal_analysis_results`; ligação com Revisões; nova tentativa; RPCs da área DG Brasil | Aplicado no DEV (QA 2026-10-20) |
| Papel `dg_worker` | 016/018/039 | Login do worker no Postgres, sem leitura direta de dado de cliente | Aplicado no DEV |
| Tela DG Brasil | `apps/frontend/src/features/dg-brasil/`, `server/domain/dg/` | Agentes (modelo, esforço, limites, ferramentas), skills com envio de pasta, teses, referências, histórico, "Executar em um caso" | Pronta, ainda não validada como ADMIN |
| Tela das execuções | `features/agent-runs/`, `/execucoes/[id]` | Situação, tentativas, interromper, tentar de novo, uso/custo (ADMIN) | Pronta |
| Análise e Revisões | `features/analyses/`, `features/reviews/` | Enviar análise (vira execução), resultado estruturado, revisão humana | Pronta e validada |
| Configurações → IA | `features/settings/components/sections/ai-section.tsx` | Interruptor geral e uso de 30 dias | Pronta |
| Integrações | `features/integrations/` | Cartões de integração (IA, judicial, armazenamento) | **Demonstração** (dados locais, sem backend) |
| Variáveis | `.env.example` (raiz) | `ANTHROPIC_API_KEY`, `AI_EXECUTION_ENABLED`, `WORKER_CONCURRENCY`, `TETO_USD` etc. | Só do worker |
| Documentação | `docs/etapa-5-*`, `docs/adicionar-agente.md`, `apps/agentes/README.md`, `ARQUITETURA.md` (linha "Motor de agentes: Fly.io"), `ROADMAP.md` (Etapa 6 "agente na nuvem") | | |

### 1.2 O que existe fora do repositório (computador do escritório)

Fonte: `Agents_for_DG_Brasil`, instalado em `~/.claude` pelo `instalar.ps1`. Os caminhos apontam
para `C:\Users\Micro\`.

- **Agentes:** subagentes do Claude Code em Markdown.
  - Redação (Opus): Alice, Murilo, Rafael, Gabriel, Pedro, Laura, Beatriz, Paulo.
  - Comercial: Clara (HISCON → roteiro), Lucas (kit do cliente), Luísa (documentos do WhatsApp),
    Bruno e Carlos (atendimento).
  - Otávio (orquestrador).
- **Scripts:** Python e PowerShell. O Lucas converte DOCX em PDF pelo Word (`docx_para_pdf.ps1`).
  Isso **só roda em Windows com Word**, e é um bom motivo para executar no escritório e não na
  nuvem.
- **Documentos:** lidos e gravados em `G:\Meu Drive\...`, com a pasta do cliente encontrada pelo
  nome:
  - `000. PASTA CLIENTES NOVOS\7. KIT DO CLIENTE\<NOME>`;
  - `01. ADVOCACIA — CLIENTES\CLIENTE - ESCRITÓRIO\<NOME>`.
- **Conectores do claude.ai** usados pelos agentes: ChatJurídico (WhatsApp/CRM), ADVBOX, Gmail,
  Google Drive, DJEN. O DJEN local (`conector-djen/servidor.py`) é um servidor MCP stdio do próprio
  escritório.
- **Execução agendada:** `scripts/rodar_{clara,lucas,luisa,bruno}.cmd`, pelo Agendador de Tarefas
  (Clara a cada 2 h), com `--dangerously-skip-permissions -p`. Nenhuma chave de API aparece nos
  scripts.
- **Skills sincronizadas do claude.ai** (gratuidade-procuracao, roteiro-peticao-consignado etc.)
  esperam os caminhos do sandbox do claude.ai (`/mnt/user-data/uploads`, `/mnt/user-data/outputs`).
  Para rodar no Claude Code local, precisam de ajuste de caminho.

---

## 2. O que pode ser removido

Remoção só depois da aprovação e **depois** do passo B1 (seção 10). Nenhuma tabela com dados é
apagada.

| Componente | Por quê | Dependências a resolver antes |
|---|---|---|
| `apps/agentes/` inteiro: worker, provedores, `smoke-real.ts`, `carregar.ts`, `prompt.ts`, `config.ts`, `index.ts`, `fila.ts`, `saude.ts`, `banco.ts`, `armazenamento.ts`, Dockerfile, `fly.toml`, `.dockerignore` | Motor de inferência na nuvem | 1) Manutenção (propostas aprovadas, lembretes de prazo, fechamento de execuções) passa ao `pg_cron`. 2) Validações de `ferramentas.ts`, `analise.ts` e `erros.ts` passam à API do executor. 3) Os testes de função SQL de `worker.test.ts` passam a `supabase/tests`. |
| Dependência `@anthropic-ai/sdk` | Só o worker usa | — |
| Variáveis do worker no `.env.example` da raiz | Sem uso | Substituídas pelas do executor |
| Envio de arquivos de skill na tela (`skill-form-drawer` em modo pasta, `prepareDgSkillFilesAction`, aviso "carregada no ambiente do provedor") | Skills passam a morar no Claude Code | Decisão 13.2 |
| Campos da Claude API no formulário de agente (esforço, `code_execution`, `max_tool_calls`, `max_budget_usd` etc.) | Feitos para a API direta | Substituídos pelo "perfil de execução" (seção 7.4) |
| Validação de fixtures da Etapa 5 (`docs/etapa-5/pilotos/skill-kit-documentos-teste`, Partes 5 e 7 de `docs/etapa-5-validacoes.md`) | Específicas do sandbox e do Fly | Arquivar, não apagar o histórico |
| Pastas vazias `agentes-claude/.claude/{agents,skills}` (não versionadas) | Sobra local | — |

**Congelar, não apagar** (no banco, com dados históricos):
- `skill_provider_versions` e `private.worker_register_skill_upload`;
- o bucket `skill-files` e `skill_version_files`.

Revogar os acessos de escrita numa migration nova. Apagar, se for o caso, só numa limpeza futura e
com sua aprovação.

---

## 3. O que deve ser preservado

| Componente | Por quê |
|---|---|
| Fila `agent_execution` (pgmq), `claim_agent_run`, `heartbeat_agent_run`, interrupção (033) | É exatamente a reserva exclusiva, a renovação e a recuperação que o executor precisa |
| `agent_runs`, `agent_run_inputs`, `agent_proposals`, `apply_proposal_effect` | Histórico das execuções e o portão humano das propostas |
| `legal_analysis_results`, ligação com `reviews`, `send_legal_analysis_once`, nova tentativa (039) | Análise estruturada com revisão; a aprovação jurídica já é separada da conclusão técnica |
| Revisões, decisões e notificações (037) | Portão humano e avisos |
| Auditoria (014; `agent_runs` e `agent_proposals` já auditados) | Exigência do pedido |
| Idempotência (027) | Escrita repetida não duplica |
| Storage privado e URLs assinadas | Os documentos continuam canônicos no Supabase |
| RLS e o papel `dg_worker` | Acesso por funções com escopo, sem chave administrativa |
| Fluxo "Enviar análise" e "Executar em um caso" | Continuam criando o trabalho. Só muda quem executa. |
| Tela da execução, lista de execuções, interromper, tentar de novo | Continuam valendo para o executor local |
| Versões de agente (`agent_versions`) | `agent_runs.agent_version_id` aponta para elas. É histórico. |

---

## 4. O que precisa ser adaptado

| Componente | De | Para |
|---|---|---|
| Interruptor geral (`ai_runtime_settings`) | "IA ligada" para o worker | "Execução pelo escritório ligada": o servidor recusa reservas quando desligado |
| Funções `worker_*` | Chamadas pelo worker com login `dg_worker` | Chamadas pela API do executor (servidor do DG Brasil) com o mesmo login, com mais uma checagem: o **token de reserva** do trabalho (seção 6.3) |
| Catálogo de ferramentas e esquema da análise | `ferramentas.ts` / `analise.ts` no worker | Validação na API do executor; o MCP local só repassa |
| Categorias de erro (`erros.ts`) | Erros do provedor | Mais: computador desligado, documento divergente (checksum), Claude Code terminou com erro, token revogado |
| `agent_runs.config_snapshot` | Modelo, esforço, skills enviadas | Versão do Claude Code, nome do agente local, modo (assistido/automático), perfil de permissões, modelo se informado |
| Uso e custo (`input_tokens`, `estimated_cost`) | Medidos pelo worker | Informados pelo executor quando houver (o modo automático devolve `total_cost_usd`); vazio no modo assistido |
| Área DG Brasil → Agentes | Editor completo de agente da Claude API | Cadastro: nome do agente no Claude Code local, que modelos de análise ele executa, perfil de execução. O texto das instruções fica no Claude Code (decisão 13.2). |
| Configurações → IA | Interruptor e uso | "Computador do escritório": online/offline, último contato, criar/revogar acesso, interruptor, uso |
| Tela da execução | Uso, configuração, tentativas | Mais: qual computador executou, progresso ("baixando documentos", "analisando") e linha do tempo |
| `external_document_exports` | Nunca usada | Base da exportação para o Google Drive (seção 8) |
| Cartão "Armazenamento" em Integrações | Demonstração | Conexão real com o Google Drive (Etapa E) |

**INVESTIGAR** (depende de decisão ou de teste):

| Componente | Dúvida |
|---|---|
| Teses e referências na tela do DG Brasil | Continuam como base de conhecimento servida pelo MCP (`consultar_teses`)? Ou o conhecimento fica só nas skills locais? (decisão 13.3) |
| Tabelas de skills (`skills`, `skill_versions`) | Viram só registro (nome da skill local) ou saem da tela? |
| Seção Integrações inteira (demonstração) | Fora do objetivo, exceto o Drive. Fica como está. |
| `pg_cron` no projeto Supabase | Precisa estar habilitado (verificar no painel; ver seção 12) |

---

## 5. Impactos no banco e no RLS

Tudo em **migrations novas** (040 em diante). A 039 e as anteriores não são reescritas. Nenhuma
operação destrutiva.

**Migration 040: executor (só acrescenta)**

- **`executors`** (computadores autorizados):
  - campos: organização (só a do escritório, `OWNER`), nome, hash SHA-256 do token (o token
    aparece uma vez na tela), prefixo para exibir, capacidades, modo (assistido/automático),
    `last_seen_at`, versão do Claude Code, `revoked_at`, quem criou;
  - RLS: só ADMIN lê e gerencia, via RPC idempotente;
  - o `dg_worker` não lê a tabela: valida por função `security definer`.
- **`agent_runs`**, colunas novas:
  - `executor_id`;
  - `lease_token_hash` (hash do token de reserva);
  - `lease_expires_at`;
  - `progress_message` (texto curto) e `progress_at`.

  O gatilho `agent_runs_guard` continua valendo para quem não é o banco.
- **`agent_run_events`** (linha do tempo, só acrescenta):
  - mudança de situação (de → para), progresso, documento aberto (com `document_version_id` e
    checksum), arquivo entregue, erro;
  - quem fez: computador ou pessoa;
  - RLS igual à de `agent_runs`.

  A auditoria (014) continua registrando tudo. Esta tabela existe para a tela e para saber
  **quais versões de documento foram processadas**.
- **Funções `private.executor_*`** (definer, `execute` só para `dg_worker`):
  - `authenticate`, `heartbeat`, `claim_next`, `renew_lease`, `job_context`, `list_documents`,
    `document_for_download`, `submit_analysis`, `create_proposal`, `register_output`,
    `finalize_output`, `report_progress`, `complete`, `fail`;
  - cada função de trabalho confere token do executor + token de reserva + reserva válida e deriva
    o caso **da execução**, nunca de um argumento;
  - são casca fina sobre as `worker_*` já testadas.
- **Manutenção no `pg_cron`**, passando a função `private.maintenance_tick()`:
  - a cada minuto: aplica propostas aprovadas, fecha execuções decididas, devolve reservas vencidas
    à fila ou falha após o limite de tentativas;
  - a cada 15 min: `notify_deadline_reminders()`.

  É o que hoje mora no worker.

**Migration 041: Google Drive** (Etapa E)
- `external_folder_links`:
  - campos: cliente ou caso → ID da pasta no Drive, `external_path_snapshot` (só para exibir),
    quem ligou e quando;
  - o nome da pasta **nunca** é chave.
- `external_document_imports`: arquivo do Drive → `document_version`, com ID do arquivo, revisão e
  `md5Checksum`, para não duplicar.
- `external_document_exports` ganha status e unicidade (versão, provedor).

**Migration de congelamento** (junto da remoção, Etapa B2): revoga escrita em
`skill_version_files` e `skill_provider_versions`, e `execute` de `worker_register_skill_upload`.

**RLS:**
- o executor **não é usuário do Supabase Auth** e não passa por RLS de tabela;
- ele só alcança o banco pela API do DG Brasil, que usa o `dg_worker` e as funções com escopo;
- parceiros não veem executores nem a linha do tempo técnica;
- **nenhuma chave `service_role`** vai para o computador do escritório.

**Exceção já existente, documentada na Etapa 5:** a assinatura de URLs do Storage usa a
`service_role` no servidor do DG Brasil. Continua só no servidor.

---

## 6. Proposta de MCP

### 6.1 Onde fica o servidor MCP

**Recomendo um servidor MCP local (stdio), instalado junto do executor, que conversa com uma API do
DG Brasil.** A outra opção seria um servidor MCP remoto (HTTP) hospedado na Vercel.

| | MCP local + API do DG Brasil | MCP remoto na Vercel |
|---|---|---|
| Documentos | Baixa o PDF para a pasta do trabalho. O Claude Code lê com a ferramenta nativa, e os scripts (Python, Word) usam o arquivo. | O servidor remoto não grava arquivo no computador. PDF como resultado de ferramenta MCP **não foi verificado** no Claude Code. |
| Minutas geradas | Envia direto da pasta `saida\` para o Storage, por URL assinada | Mesmo problema, no sentido inverso |
| Tokens | O token de reserva fica na memória do processo MCP. O Claude só passa o número do trabalho. | O token vai no cabeçalho do Claude Code |
| Limite de 4,5 MB do corpo na Vercel | Não se aplica: o arquivo vai direto ao Storage | Arquivos teriam de passar pela função |
| Instalação | Um pacote em cada computador que usar | Nenhuma |
| Uso futuro pelo claude.ai | Não | Sim, como conector |

A regra de acesso fica **no servidor do DG Brasil** nos dois casos. O MCP local é um tradutor sem
poder próprio. Um MCP remoto pode ser acrescentado depois sobre a mesma API, se você quiser usar o
DG Brasil como conector no claude.ai.

### 6.2 Ferramentas

| Pedido original | Ferramenta | Modo | O que faz / limite |
|---|---|---|---|
| `list_pending_jobs` | `listar_trabalhos` | Assistido | Fila: tipo, data, agente. **Sem nome de cliente** antes da reserva. |
| `claim_job` | `reservar_trabalho` | Assistido | Reserva exclusiva. O Claude Code **pergunta à pessoa** antes (regra `ask`). |
| `get_job_status` | `ver_trabalho` | Ambos | Situação, pedido, prazo da reserva |
| `get_case_context` + `get_client_context` | `ver_caso` | Ambos | Caso do trabalho e dados mínimos do cliente (o que hoje sai em `worker_get_case`). **Não existe busca livre de cliente**: na Etapa 5 ela foi retirada de propósito. |
| `list_case_documents` + `get_document_metadata` | `listar_documentos` | Ambos | Documentos do caso, com versão, tipo, tamanho e checksum |
| (novo) | `baixar_documento` | Ambos | Baixa para `entrada\`, confere o SHA-256 e registra no evento qual versão foi aberta |
| `update_job_progress` | `informar_progresso` | Ambos | Texto curto, renova a reserva |
| `submit_analysis` | `entregar_analise` | Ambos | Esquema estrito, validado no servidor. Erro volta ao Claude para corrigir. Vai para Revisões. |
| `create_draft` | `entregar_minuta` | Ambos | Arquivo de `saida\` → versão **INTERNA** + revisão pendente |
| (existente) | `propor` | Ambos | Prazo, pedido de documento, alteração de caso, novo processo, outro. **Toda alteração relevante vira proposta** para um humano aprovar. |
| (se mantidas) | `consultar_teses`, `abrir_referencia` | Ambos | Só as ativas e autorizadas para o agente |
| `complete_job` | `concluir_trabalho` | Ambos | Com entregas → "Aguardando decisão humana"; sem entregas → concluído |
| `report_job_failure` | `informar_falha` | Ambos | Categoria + mensagem curta, e se vale tentar de novo |

**Fora do catálogo de propósito** (o servidor nem tem a rota):
- excluir;
- aprovar;
- protocolar;
- enviar mensagem;
- mudar permissão;
- SQL;
- shell;
- buscar cliente fora do trabalho.

**Requisitos atendidos pelo desenho:**
- **Autenticação:** token do computador (32 bytes aleatórios, só o hash no banco, revogável) +
  token de reserva por trabalho (curto, preso ao trabalho e à reserva).
- **Autorização:** capacidade por ferramenta (`executors.capabilities`) + recurso derivado da
  reserva.
- **Validação:** zod na API e checagem de novo no banco.
- **Idempotência:** chave por escrita (027) e unicidade por execução (já existe para análise e
  proposta).
- **Execução duplicada:** pgmq + `claim_agent_run` + reserva com validade.
- **Auditoria:** leitura de documento vira evento; escrita, auditoria.
- **Credenciais:** nenhuma chave do Supabase no computador.

### 6.3 API do DG Brasil para o executor

Rotas `app/api/executor/v1/*` (route handlers do Next.js):
- `Authorization: Bearer <token do computador>`;
- nas rotas de trabalho, também `X-DG-Lease: <token de reserva>`;
- `Idempotency-Key` nas escritas;
- respostas curtas, sem conteúdo de documento.

Os arquivos vão e voltam **direto do Storage** por URL assinada de poucos minutos. A API conecta ao
banco com o `dg_worker` pelo **pooler IPv4** do Supabase. O QA viu o host direto falhar por IPv6
(ENV-01).

---

## 7. Proposta do executor local

### 7.1 Dois modos, a mesma ferramenta

- **Modo assistido (assinatura, sem custo por uso):**
  - alguém abre o Claude Code no computador do escritório e digita, por exemplo,
    `/dg-trabalhos`;
  - o Claude lista a fila, pede confirmação para reservar e executa com o agente certo;
  - é o "uso comum" previsto nos termos;
  - **não precisa de serviço rodando.**
- **Modo automático (chave de API, custo por uso):**
  - um serviço consulta a fila e, para cada trabalho, inicia `claude -p --agent <agente>` com a
    chave de API **só no ambiente desse processo**;
  - é o caminho que a documentação indica para scripts e uso não supervisionado.

O servidor MCP é o mesmo nos dois modos. O pacote chama-se `apps/executor`, em Node/TypeScript como
o resto do sistema, e tem três comandos:
- `dg-executor mcp`: o servidor MCP stdio;
- `dg-executor run`: o executor automático;
- `dg-executor doctor`: o diagnóstico.

### 7.2 Ciclo do modo automático

1. **Autentica** com o token do computador, guardado no Gerenciador de Credenciais do Windows,
   nunca em arquivo da pasta de trabalho.
2. **Consulta** a fila a cada 30–60 s. Só conexões de saída por HTTPS; **nenhuma porta aberta** no
   computador.
3. **Reserva** um trabalho e recebe o token de reserva.
4. **Prepara** `C:\DGBrasil\trabalhos\<id>\entrada` e `saida`, baixa os documentos e confere os
   checksums. Se faltar documento ou o checksum divergir, falha com essa causa e não chama o Claude.
5. **Inicia** o Claude Code (7.4) com o diretório da pasta do trabalho.
6. **Renova** a reserva a cada 60 s enquanto o processo vive. Se a resposta disser "interrompido",
   encerra a árvore de processos.
7. **Ao terminar:** confere se o agente chamou `concluir_trabalho` ou `informar_falha`. Senão,
   registra a falha com a saída do Claude Code (sem conteúdo do cliente).
8. **Apaga** a pasta do trabalho.
9. **Ao reiniciar:**
   - pastas locais que sobraram são apagadas;
   - o servidor devolve à fila as reservas vencidas (até 3 tentativas) e depois marca "falhou:
     computador indisponível".

Nada é instalado de forma permanente nesta fase. O registro no Agendador de Tarefas ("ao fazer
logon") fica para quando você aprovar o guia de instalação.

### 7.3 Autenticação

- **A autenticação fica separada da execução:**
  - o executor só lê "qual credencial usar" (Gerenciador de Credenciais do Windows);
  - não copia arquivo de sessão (`.credentials.json`);
  - não converte login pessoal em API.
- **Modo automático:** `ANTHROPIC_API_KEY` de um workspace "DG Brasil" no Console, com limite
  mensal de gasto. Pela documentação, no `-p` a chave tem prioridade sobre o login.
- **Modo assistido:** o login normal do Claude Code da pessoa.

### 7.4 Perfil de permissões (sem `--dangerously-skip-permissions`)

Cada execução automática roda com:

```text
claude -p --agent <agente>
  --strict-mcp-config --mcp-config <só o MCP do DG Brasil>
  --settings <perfil do agente>          (regras allow/deny + hook PreToolUse)
  --permission-mode dontAsk              (negar o que não está liberado, sem perguntar; confirmar em teste)
  --allowedTools "mcp__dg-brasil__*" "Read(./**)" "Write(./saida/**)" <scripts do agente>
  --disallowedTools WebFetch WebSearch <shell livre>
  --max-turns N --max-budget-usd X --output-format json
```

- `--strict-mcp-config` **desliga os conectores do claude.ai** (WhatsApp, Gmail, ADVBOX) nessa
  execução. O agente não consegue mandar mensagem ao cliente nem que um PDF malicioso peça.
- **Shell só para scripts nomeados** de cada agente (ex.: `python scripts/gerar_procuracao.py`). O
  hook `PreToolUse` recusa o resto. As regras exatas dependem de cada agente: é preciso inventariar
  os scripts.
- **Usuário Windows dedicado** (padrão, sem administrador):
  - sem o Drive sincronizado;
  - sem acesso à pasta do usuário "Micro";
  - **BitLocker** ligado.
- O "perfil de execução" de cada agente (o que fica na tela do DG Brasil) é este conjunto: scripts
  liberados, limite de turnos, teto de custo, tempo máximo.

---

## 8. Estratégia do Google Drive

**Princípios:**
- o Supabase continua a fonte de verdade;
- o Drive é integração e espelho para a equipe;
- a identidade é sempre o **ID do arquivo ou da pasta**, nunca o nome;
- arquivo jurídico nunca fica público.

**Quem sincroniza: o servidor do DG Brasil**, não o executor:
- o executor não precisa de credencial do Google: recebe documentos do DG Brasil e devolve ao DG
  Brasil;
- a sincronização funciona com o computador do escritório desligado;
- o token do Google fica num lugar só, no servidor.

**Fluxos:**

1. **Ligação das pastas (uma vez, com humano):**
   - o DG Brasil lista as pastas do Drive e sugere o par com cada cliente (nome normalizado, CPF do
     `DADOS DO CADASTRO.txt` quando houver);
   - um ADMIN confirma;
   - grava `external_folder_links` com o ID da pasta.

   Renomear ou mover a pasta no Drive não quebra a ligação.
2. **Drive → DG Brasil (entrada):**
   - arquivos novos nas pastas ligadas viram versões de documento;
   - sem duplicata: (ID do arquivo, revisão/`md5Checksum`) é único;
   - a origem é registrada.
3. **DG Brasil → Drive (saída):**
   - só versões **aprovadas** em Revisões são exportadas para a pasta do cliente (já era o plano em
     `BACKEND_HANDOFF.md` §15.7);
   - grava `external_document_exports` com o ID do arquivo criado;
   - nunca sobrescreve: cria arquivo novo.
4. **Falhas:**
   - fila de sincronização com nova tentativa e erro visível na tela;
   - falha do Drive não bloqueia a análise.

**Credencial:** depende de a conta ser Gmail pessoal ou Google Workspace (o próprio
`ARQUITETURA-SISTEMA-BC.md` do escritório deixa isso em aberto):
- **Workspace + Drive compartilhado:** conta de serviço;
- **Gmail pessoal:** OAuth da conta do escritório com token de renovação guardado no servidor.

Conta de serviço não tem cota para gravar no "Meu Drive" de uma pessoa, por isso a distinção
importa.

**O que não muda agora:** os agentes atuais (Clara, Lucas) continuam trabalhando em
`G:\Meu Drive\...` até você decidir migrar cada fluxo para o DG Brasil. Os dois convivem.

---

## 9. Riscos técnicos e de segurança

| # | Risco | Gravidade | Tratamento |
|---|---|---|---|
| R1 | **Execuções agendadas atuais com `--dangerously-skip-permissions` e provavelmente com a assinatura** (fora do DG Brasil) | Alta | Recomendo trocar por (a) modo assistido ou (b) o novo executor com chave de API e perfil de permissões. Não mexo sem sua decisão. |
| R2 | Injeção de instruções em documento de terceiro (HISCON, contestação, carta do banco), agora com acesso a disco e rede | Alta | Sem conectores (`--strict-mcp-config`), shell só para scripts nomeados, sem WebFetch, usuário Windows dedicado, escrita só em `saida\`. O servidor só aceita as ferramentas do catálogo e tudo vira revisão humana. |
| R3 | Termos da Anthropic para início automático | Alta (jurídico) | Automático só com chave de API. Assinatura só no modo assistido. Para usar a assinatura no automático, só com confirmação escrita da Anthropic (vendas). |
| R4 | Ponto único de falha: um computador | Média | Fila espera, a tela mostra "computador offline", a reserva vence e volta à fila. Configurar o computador para não hibernar no horário de trabalho. |
| R5 | Cópias locais de documentos de clientes (LGPD) | Média | Pasta por trabalho apagada ao terminar, BitLocker, usuário dedicado. Os dados continuam indo à Anthropic, como na Etapa 5: revisão LGPD do provedor ainda pendente. |
| R6 | Vazamento do token do computador | Média | Escopo limitado (só a fila do escritório), dados só depois de reservar, revogação na tela, alerta de reservas fora do padrão, o Claude não lê o arquivo de configuração (regra `deny`) |
| R7 | Atualização do Claude Code muda opções da linha de comando | Média | `dg-executor doctor` confere a versão; a versão vai para o `config_snapshot`; atualização controlada |
| R8 | Skills sincronizadas do claude.ai usam `/mnt/user-data` | Média | Versão local das skills usadas pelos agentes do DG Brasil (trabalho no `Agents_for_DG_Brasil`) |
| R9 | Manutenção sem dono ao remover o worker | Alta se esquecido | B1 antes de B2 (seção 10), com teste |
| R10 | Casar 780 pastas do Drive com clientes | Média | Sugestão automática + confirmação humana; nada é ligado sozinho |
| R11 | Custo: o automático continua pagando por uso; o Claude Code acrescenta as instruções dele a cada chamada | Média | Teto por execução (`--max-budget-usd`, estimado pelo próprio cliente), limite mensal no Console, uso visível na tela |

---

## 10. Ordem de implementação

Cada etapa deixa o sistema funcionando. A IA continua desligada até a Etapa D ser validada.

| Etapa | O que | Testes |
|---|---|---|
| **B1: manutenção e base** (antes de remover) | Migration 040: `executors`, colunas da reserva, `agent_run_events`, `maintenance_tick` no `pg_cron` | Tudo em `verificar.mjs` (PGlite) e `validar:real` (DEV): proposta aprovada é aplicada; lembrete de prazo dispara; reserva vencida volta à fila; limite de tentativas |
| **B2: limpeza** | Remove `apps/agentes`, Fly, SDK e o envio de arquivos de skill; congela as tabelas da Etapa 5; atualiza docs | `npm test`, `lint`, `tsc`, `build`, integração completa sem regressão |
| **C: API do executor** | Rotas `/api/executor/v1/*` + funções `private.executor_*` | Autenticação, token revogado, token de outro trabalho, caso de outro cliente por UUID direto, reserva dupla, idempotência, interruptor desligado, auditoria |
| **D: executor local** | `apps/executor`: MCP stdio, `run`, `doctor`; `/dg-trabalhos` para o modo assistido | Com um `claude` falso: queda no meio, reinício, documento ausente/divergente, falha ao gravar resultado, interrupção. No computador do escritório (pendente de acesso): modo assistido real, depois automático com chave. |
| **E: Google Drive** | Migration 041, conexão, ligação de pastas, entrada e saída | Sem duplicata, renomear pasta, falha da API do Google, arquivo nunca público |
| **F: telas e documentação** | Computador do escritório, linha do tempo, cadastro simplificado de agentes, guia de instalação e de validação | Unitários e integração; validação pelo agente da outra máquina, como nas etapas anteriores |

---

## 11. Complexidade e redução de infraestrutura

| Etapa | Complexidade |
|---|---|
| B1 | Média (banco; padrão já conhecido) |
| B2 | Baixa |
| C | Média |
| D | Média-alta (processos no Windows, permissões do Claude Code, teste no computador real) |
| E | Média-alta (OAuth do Google, reconciliação das pastas) |
| F | Média |

**Sai:**
- o serviço do worker no Fly.io (previsto ~US$ 10/mês; nunca chegou a custar);
- a integração direta com a API da Anthropic (Skills API, Files API, sandbox);
- ~3.700 linhas de worker;
- metade da área DG Brasil (editor de agente da API e envio de skills).

**Entra:**
- um pacote local (estimativa: 1.500–2.500 linhas com testes);
- ~15 rotas de API;
- duas migrations.

**Custo recorrente, sendo franco:**
- **Infraestrutura:** fica Supabase + Vercel.
- **Modelo, modo assistido:** sem custo extra além da assinatura que vocês já têm.
- **Modelo, modo automático:** paga por uso, como na Etapa 5, possivelmente um pouco mais por
  trabalho por causa das instruções do próprio Claude Code.

A grande redução de custo **só existe no modo assistido**.

---

## 12. Não verificado (não presumir resolvido)

1. **PDF como resultado de ferramenta MCP no Claude Code:** não verificado. O plano não depende
   disso (usa arquivos locais).
2. **Pacote oficial do MCP em TypeScript:** o repositório principal está na v2
   (`@modelcontextprotocol/server`). O nome do pacote v1 e a classe exata do transporte stdio
   precisam ser conferidos na instalação.
3. **Sintaxe das regras de permissão com caminhos do Windows** e o comportamento de
   `--permission-mode dontAsk` com o Bash no Windows: precisam de teste no computador do escritório.
4. **`pg_cron` no projeto Supabase:** a migration não habilita nada hoje; pode exigir ativação no
   painel.
5. **Conta do Google Drive:** Gmail pessoal ou Workspace, e se há Drive compartilhado.
6. **Computador do escritório:**
   - qual é (o usuário "Micro"?), se fica ligado no horário de trabalho;
   - versão do Windows e do Claude Code;
   - se o Word está instalado para o usuário dedicado;
   - qual login o Claude Code usa hoje.
7. **Agendamentos atuais:** se usam a assinatura (os scripts não mostram chave de API, o que indica
   que sim).
8. **Scripts de cada agente:** quais o Clara e o Lucas precisam rodar, e se algum acessa a rede
   (para montar a lista fechada de comandos).
9. **Termos da Anthropic:** o uso de assinatura em execução por script não está expressamente
   permitido nem proibido para o Claude Code. Os termos de consumidor restringem acesso automatizado
   fora de chave de API. Só uma confirmação da Anthropic resolve.
10. **Produção:** nenhuma migration foi aplicada em produção (só DEV). Se houver produção, o plano
    de migração do banco muda.

**Fontes oficiais consultadas:**
- code.claude.com/docs: `mcp`, `headless`, `cli-reference`, `permissions`, `authentication`,
  `legal-and-compliance`, `hooks`, `managed-settings`, `agent-sdk/overview`;
- anthropic.com/legal: consumer-terms, commercial-terms;
- github.com/modelcontextprotocol/typescript-sdk.

---

## 13. Decisões que preciso de você

1. **Modo de execução:** só assistido (sem custo extra), só automático (chave de API) ou os dois?
   *Recomendo: começar pelo assistido e ligar o automático só para os trabalhos repetitivos (ex.:
   Clara), com limite de gasto.*
2. **Onde se escrevem os agentes:** a Etapa 5 decidiu "criados na tela do DG Brasil". Com o Claude
   Code como executor, o natural é que as instruções e skills fiquem no `Agents_for_DG_Brasil`, e o
   DG Brasil só registre "qual agente executa qual tipo de trabalho". *Recomendo esse caminho.*
3. **Teses e referências:** continuam na tela do DG Brasil, servidas aos agentes pelo MCP? Ou o
   conhecimento fica só nas skills? *Recomendo manter: são versionadas, auditadas e iguais para
   todos os agentes.*
4. **Google Drive:** a conta é Gmail pessoal ou Google Workspace?
5. **Agendamentos atuais com `--dangerously-skip-permissions`:** quer que eu inclua a migração
   deles para o novo executor (Etapa D), ou ficam como estão por enquanto?
6. **Aprovação deste plano:** com o "ok", começo pela Etapa B1. Nada é removido antes de B1 estar
   testada.
