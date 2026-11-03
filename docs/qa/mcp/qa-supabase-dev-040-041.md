# QA — Supabase DEV real: migrations 040 e 041

Commit base: `4735561`. Aplicação das migrations: 2026-10-29. Validação a fundo:
2026-11-03. Projeto: `Digital-Group-Brasil-Dev` (`hco…idb`, sa-east-1).

**Escopo:** só o banco DEV e o servidor contra ele. **Não** inclui o Claude Code
no computador do escritório, as telas (Parte 5 do guia) nem uma conta Google real.

**Resultado: APROVADA COM PENDÊNCIAS.** Pendências na seção F, todas externas
ao banco.

## A. Estado do banco

- **Ambiente comprovado.** Todas as credenciais apontam para o mesmo ref
  `hco…idb`: URL, conexão `postgres`, login `dg_worker`, chaves anon e
  service_role, tanto em `supabase/.env.real` quanto em `apps/frontend/.env.local`.
  Além disso:
  - `DG_ENV=development`;
  - a conta Supabase não tem projeto de produção do DG Brasil (o outro projeto
    listado é "Ágora", inativo e sem relação).
- **Migrations.** As 41 do repositório estão aplicadas, sem nenhuma a mais
  (`migration list` e pré-flight do `validar:real`).
  - 040 e 041 entraram em 2026-10-29 por `db push`, depois de um `--dry-run`
    que listou só as duas.
  - O `create extension pg_cron` passou sem precisar ligar nada no painel.
- **Divergências encontradas e resolução:**

  | ID | O quê | Resolução |
  |---|---|---|
  | ENV-01 | `DG_WORKER_DB_URL` usava o host direto `db.<ref>` (só IPv6) | Trocado para o pooler IPv4 em `.env.real`; o mesmo valor foi copiado para o `.env.local`. Valores fora do Git. |
  | DADO-01 | Cliente de teste "asdasdas" (CPF `121…`, criado pelo usuário de QA em 2026-10-20) travava o pré-flight do `validar:real` | Apagar exigiria furar a proteção append-only de `document_versions`. Com autorização do Miguel, só o CPF virou `999…` (um UPDATE, registrado em `audit_events`). Nada foi apagado. |

## B. pg_cron

- **Extensão:** `pg_cron` 1.6.4 e `pgmq` 1.5.1.
- **Jobs** (os dois ativos, owner `postgres`, nenhum duplicado):
  - `dg-manutencao`, `* * * * *`: `select private.maintenance_tick()`;
  - `dg-lembretes-de-prazo`, `*/15 * * * *`: `select private.notify_deadline_reminders()`.
- **Histórico** de 2026-10-29 17:37 a 2026-11-03 14:38 UTC:
  - 7.022 rodadas da manutenção e 468 dos lembretes;
  - todas `succeeded`, nenhuma lacuna acima de 90 s e nenhuma rodada acima de 1,6 s.
- **O trabalho do worker antigo agora é do pg_cron.** Evidências:
  - **Propostas aprovadas:** nos primeiros 9 minutos a manutenção drenou 27
    propostas fictícias que estavam aprovadas e paradas desde 09/10, porque o
    worker antigo nunca rodou no DEV. Uma foi `APPLIED`. As outras 26, todas
    `UPDATE_AGENT` de rodadas de teste e sem agente no payload, ficaram `FAILED`
    com o motivo gravado, que é o comportamento correto.
  - **Execuções decididas:** houve `WAITING_HUMAN → COMPLETED` sem usuário.
  - **Lembretes:** 28 `DEADLINE_OVERDUE` criados. São só notificações dentro do
    app; o 037 não manda e-mail nem faz chamada HTTP.
  - **Prova controlada** (`mcp-maintenance.int.test.ts`, contra o pg_cron real,
    sem chamar a manutenção à mão):
    - reserva com batimento de 6 minutos atrás voltou à fila em cerca de 48 s,
      com `LEASE_EXPIRED`, evento `RUNNING → QUEUED`, e a reserva antiga passou a
      dar 403;
    - proposta `REQUEST_DOCUMENT` aprovada virou pendência no caso, e a execução
      fechou `COMPLETED`, em cerca de 59 s.
- **Pendências:** nenhuma no banco.

## C. Testes

| Teste | Ambiente | Resultado | Evidência / observações |
|---|---|---|---|
| `validar:real` | DEV real (Auth, PostgREST, Storage, pgmq, pg_cron, login `dg_worker`) | **145/145** | Rodada `rmw0tbit7`. 41f (4 ✓) e 41g (2 ✓) inclusas; a rodada anterior tinha 139. |
| Integração `apps/frontend` | DEV real | **30 arquivos, 229/229** | Inclui os 3 abaixo. |
| ↳ `mcp-executor.int.test.ts` | DEV real | **11/11** | Bug MCP-01 corrigido e caso de isolamento acrescentado (seção D). |
| ↳ `mcp-maintenance.int.test.ts` (novo) | DEV real + pg_cron real | **2/2** | Reserva vencida e proposta aplicada (seção B). |
| ↳ `drive-sync.int.test.ts` (novo) | DEV real; Google simulado | **4/4** | Seção E. |
| ↳ `etapa5-dg-runtime.int.test.ts` | DEV real | **10/10** | Sem regressão da 039. |
| Catálogo: RLS, grants, `search_path` | DEV real (consultas só leitura) | OK | Seção E. |
| `verificar` | PGlite (simulação) | **673/673** em 10 de 11 rodadas | Uma rodada de 29/10 teve 1 falha que não se reproduziu em 10 tentativas; não identificada. Não conta como evidência do DEV. |
| `apps/executor` (typecheck, 13 testes, build, `doctor`) | Local | OK | Sem mudança desde 29/10. |
| Front: unit, lint, `tsc`, build | Local | 479/479, sem erro | O `tsc` exigiu apagar o cache `.next/dev` (ver guia). |

## D. Alterações

Nenhuma migration nova. Nenhuma alteração de código da aplicação.

| Arquivo | Mudança | Por quê |
|---|---|---|
| `apps/frontend/tests/integration/mcp-executor.int.test.ts` | **MCP-01:** o 1º teste lia `executors.token_hash` com a service_role, mas a 040 revoga isso de propósito (falhava sempre). Agora prova o contrário: a tabela é fechada e o servidor autentica pelo SHA-256 do token (e não pelo token cru). **Novo caso:** com reserva válida, documento de outro cliente não abre e não gera "Documento aberto". | O teste contradizia o desenho de segurança da 040, e o critério de isolamento não tinha prova real. |
| `apps/frontend/tests/integration/mcp-maintenance.int.test.ts` | Novo | Prova real do pg_cron (seção B). |
| `apps/frontend/tests/integration/drive-sync.int.test.ts` | Novo | Estruturas e regras da 041 no banco real, sem conta Google. |
| `docs/mcp/validacao.md` | Totais novos, aviso do `.next/dev`, como tratar cliente fora do padrão | Para a próxima validação. |
| `supabase/.env.real`, `apps/frontend/.env.local` (fora do Git) | ENV-01 | Seção A. |
| Banco DEV | CPF do cliente de teste "asdasdas" | DADO-01, autorizado. |

## E. Segurança

- **Autenticação:**
  - o token do computador só existe em hash;
  - `executors` está fechada a anon, authenticated, service_role e `dg_worker`;
  - token cru, desconhecido ou revogado é recusado;
  - a revogação vale na hora (41f e integração).
- **RLS:**
  - `executors`, `agent_run_events`, `external_folder_links` e
    `external_document_imports` têm RLS ligado, sem política e sem grant: só
    se acessam pelas funções;
  - `agent_runs` tem SELECT só para ADMIN (política da 039).
    `external_document_exports` tem SELECT só para ADMIN/LAWYER (política da 013).
- **Escopo das funções:**
  - telas: `authenticated`, e cada função confere o papel;
  - portas do servidor (`executor_*` e `drive_*` do servidor): só `dg_worker`;
  - `maintenance_tick` e as funções internas de reserva: ninguém além do dono;
  - nenhuma função tem grant para `PUBLIC`, e toda `security definer` tem
    `search_path` fixo;
  - `dg_worker` não lê `executors`, não chama a manutenção e não liga pasta
    (41f e 41g).
- **Isolamento:**
  - a fila não traz nome do cliente nem título do caso;
  - a reserva é exclusiva;
  - outro computador, reserva inválida, reserva vencida ou trabalho já
    concluído dão 403;
  - documento de outro cliente é recusado.
- **Reservas e tokens:**
  - a reserva troca a cada claim, e o token velho deixa de valer depois de
    devolvida ou vencida;
  - o limite de 3 tentativas é testado no PGlite. No DEV, a 2ª tentativa
    aparece no teste do pg_cron.
- **Drive:**
  - uma pasta por cliente e um cliente por pasta, sempre pelo ID;
  - (arquivo, md5) é importado uma vez só, e o que o DG Brasil exportou não
    volta como importação;
  - pasta pública não recebe arquivo;
  - desligar a pasta tira da fila sem apagar nada; parceiro não liga pasta.
- **Observação sem risco prático:** ADMIN consegue ler
  `agent_runs.lease_token_hash` pelo PostgREST. É o SHA-256 de um token aleatório,
  e a API exige o token original, então não dá para usar a reserva.

## F. Pendências

- **Supabase DEV:** nenhuma.
- **Google Drive real:**
  - credencial da Barbara ([google-drive.md](../../mcp/google-drive.md));
  - "Testar conexão", busca de pasta, envio real e checagem de pasta pública
    na API do Google (Parte 7 do guia).
- **Computador do escritório** (nada disso foi validado; a integração Claude Code
  + MCP **não** está validada de ponta a ponta):
  - instalação, `doctor` com configuração e `/mcp`;
  - o comando `/mcp__dg-brasil__trabalhos` e o subagente local;
  - regras `ask`/`deny` com caminhos do Windows e os nomes dos conectores;
  - queda real do terminal e interrupção pela tela (Partes 6.1 a 6.7).
- **Telas:** Parte 5 do guia (exige login ADMIN com MFA).
- **Segurança geral:**
  - R1 (agendamentos atuais com `--dangerously-skip-permissions`) e R3 (plano e
    privacidade da assinatura) seguem abertos;
  - a falha única e não reproduzida do `verificar` merece atenção se voltar.

## G. Resultado final

**APROVADA COM PENDÊNCIAS.** O banco DEV está consistente com o código atual:
- as 41 migrations estão aplicadas;
- o pg_cron está operacional e provadamente fazendo o trabalho do worker antigo;
- autenticação, autorização e isolamento do executor estão comprovados contra o
  banco real;
- as estruturas do Drive estão íntegras.

Isto valida o **banco**, não o sistema MCP completo: o computador do escritório,
as telas e o Google real continuam pendentes.

Custo: nenhuma chamada paga de API.
