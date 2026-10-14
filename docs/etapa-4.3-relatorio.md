# Etapa 4.3 — Relatório final (Front V1 ligado ao backend real)

## 1. Status

**`FRONTEND INTEGRATION NOT READY`**

O código das Fases A–H está completo, commitado e enviado (`master`, até
`e34a681`), com lint, typecheck, 388 testes unitários, build e 481
verificações de banco (PGlite) passando nesta máquina. Falta o que só pode
ser feito no Supabase DEV, e que o critério de conclusão (itens 25 e 26)
exige: `db push` das migrations **028–031**, `validar:real`,
`test:integration` e o QA manual — guia único em
[`docs/etapa-4.3-validacao.md`](etapa-4.3-validacao.md). Com o guia passando,
o status passa a `FRONTEND V1 FULLY CONNECTED TO REAL BACKEND` (com as áreas
de configuração listadas em §3 fora do escopo).

## 2. Domínios migrados

| Fase | Domínios | Commit |
|---|---|---|
| A | Diretório (usuários/escritório), Clientes (+ 028, limpeza de campos PF) | `bc308f9`, `1501505`, `a36360e` |
| B | Casos, Processos, Prazos, Movimentações | `9779f41` |
| C | Documentos (upload assinado em etapas), Pendências documentais | `5ac5647` |
| D | Parceiros (equipe), Solicitações, Portal do Parceiro inteiro | `cfe100b`, `373cfbb` |
| E | Revisões, Análises (+ 029 início atômico) | `bf6d974` |
| F | Financeiro (+ 030 ciclo de vida do acordo) | `30df2c5` |
| G | Execuções de agente (+ 031 paginação) | `f0d49e6` |
| H | Notificações, Auditoria, Início/painéis, resumo de processos, Configurações → Geral | `e34a681` |

## 3. Mocks removidos

Repositórios mock: `clients`, `documents`, `cases`/`processes` (B),
`partnerPortal`, `partners`, `finance`, `analyses`, `reviews`, `office`,
`notifications`. Ações do store de clientes, documentos, casos, processos,
portal, parceiros, financeiro, análises, revisões e notificações. Hooks,
componentes e cálculos no navegador (cronograma e totais de financeiro,
divisão de parceria, KPIs do Início, contadores do menu) e a persona
`useCurrentUser`. Arquivos órfãos removidos por varredura.

**Continuam de demonstração, fora do escopo (documentado):** configuração da
área DG Brasil (agentes, skills, teses, referências, histórico — regra "não
expandir a configuração de agentes"), Integrações e Importação de dados
(integrações externas proibidas nesta etapa), Configurações → IA e
preferências de notificação (envio/SMTP fora da etapa). Nenhuma guarda dado
jurídico.

## 4. Zustand/localStorage removido como source of truth

Nenhuma tela jurídica lê o store: clientes, casos, processos, prazos,
movimentações, documentos, pendências, solicitações, portal, revisões,
análises, financeiro, execuções, notificações, auditoria e Início vêm do
servidor. O store ficou com estado de UI e com os dados das áreas de
configuração de demonstração (§3). A forma persistida não mudou (só ações
saíram), então não houve bump de versão; os dados jurídicos antigos que
ainda estão no `localStorage` de quem usou a demonstração não são lidos por
nenhuma tela.

## 5. Request hash

O hash da idempotência (027) é calculado no banco sobre `jsonb`, que
normaliza a ordem das chaves e os espaços. Validado: (a) verificações do
PGlite — mesma intenção com chaves em outra ordem/aninhadas/espaços → mesmo
hash; array em outra ordem, `null` × ausente, `1234.5` × `1234.50`, NFC × NFD
→ hashes diferentes; (b) a checagem que você rodou no DEV ("Tudo passou");
(c) no front, `stableStringify` só decide quando gerar uma chave nova
(intenção mudou) — testado em `phase-b-ui.test.ts`. Na 029, a correlação
técnica (`request_id`) ficou **fora** do hash (muda a cada tentativa) —
testado no `[029]`.

## 6. Clients

Lista com busca/filtros/ordem/páginas no servidor (CPF fora da URL), ficha
por rota direta com registro LGPD, cadastro e edição PF/PJ, representantes e
sócios atômicos (028), inativar/reativar/excluir, documentos, casos,
processos e atividade (ADMIN). Portal: carteira do parceiro, ficha com
`ClientPartnerDTO` e edição só de contato/endereço.

## 7. Cases

Lista/filtros/páginas, ficha, cadastro idempotente, edição, envio, aceite,
rejeição (motivo público × interno), andamento, encerramento, arquivamento,
origem, advogado; abas de documentos/pendências, análise, revisões,
processos, financeiro e atividade conforme o papel. Portal: situações
simplificadas, envio de caso (cliente + caso atômicos e idempotentes; limite
de consulta de CPF/CNPJ com aviso próprio; arquivos enviados depois para o
caso).

## 8. Processes / Deadlines / Events

Lista com cliente, caso e próximo prazo; resumo da carteira e filtro de prazo
(Fase H) no banco; cadastro idempotente com prazo inicial; edição que limpa;
exclusão (ADMIN); partes; prazos (criar/editar/cumprir/cancelar; vencido
derivado na view); andamentos (equipe registra só MANUAL). Portal: lista sem
colunas internas, ficha com movimentações oficiais/sistema, cadastro
idempotente pelo parceiro.

## 9. Documents / Requirements

Upload em etapas (criar → URL assinada → envio → confirmação idempotente,
com retomada sem reenviar), nova versão, histórico, download por URL
assinada de 60 s, verificação por versão, compartilhar/recolher com regras do
servidor, arquivar, excluir (ADMIN). Pendências: solicitar, receber (versão
concreta), aprovar/rejeitar. Portal: só `PARTNER_VISIBLE`, envio em
caso/processo, pendências só leitura.

## 10. Partner Portal / Requests

Todas as telas do portal no ramo `partner` das mesmas rotas, com DTO do
parceiro: clientes, casos, processos, documentos, pendências, envio de caso,
cadastro de processo, Minha Conta (sessão real, escritório, divisão e equipe
só PARTNER_ADMIN), financeiro (só PARTNER_ADMIN), Início e notificações.
Solicitações nas duas superfícies: conversa, nova solicitação, pedir nova
resposta, resolver/cancelar.

## 11. Reviews / Analysis

**Hardening antes:** migration 029 — análise + execução + entrada + fila +
auditoria numa transação, idempotente; envio com lock da linha (nunca duas
execuções). Revisões: fila com visões/filtros/páginas, ficha com o conteúdo
do alvo lido na hora, atribuição, decisão **só** por `decide_review`,
reabertura, proposta estrutural só ADMIN. Análises: assistente com modelos
reais da área e checklist do caso; aba do caso com envio/reenvio atômico.
Nenhuma IA executada.

## 12. Finance

**Hardening antes:** auditoria do ciclo de vida mostrou que o acordo não tinha
guarda no banco → migration 030 (transições, termos congelados fora do
rascunho, concluir/cancelar sem obrigação em aberto, obrigação só em acordo
aberto, entrada só em acordo ativo, locks contra corrida; estorno continua
como correção). UI: visão geral com totais e recebido mensal somados no
servidor; contratos paginados com totais do ledger; obrigações, recebimento,
ajuste, estorno (ledger append-only), status do acordo; novo contrato;
financeiro do caso e da parceria (repasses); portal só PARTNER_ADMIN e só do
próprio escritório; modelos de honorários. BRL; nenhuma conta de divisão no
navegador.

## 13. Agent Runs

Migration 031: `get_agent_run_summaries_page` (página + total + filtros por
caso/situação/agente), mesmas regras e colunas fixas da RPC antiga (que
continua intacta). DG Brasil → Execuções (ADMIN, cancelar ativa) e
execuções do caso na aba Análise (ADMIN/LAWYER).

## 14. Notifications / Audit

Notificações reais do usuário (sino e página), não lidas, marcar lida/todas.
Ainda não existe produtor de notificações no banco (a caixa começa vazia).
Auditoria (ADMIN): linha do tempo humanizada e paginada por registro (cliente,
caso, parceiro) e registro global com filtros; sem IP, user agent ou texto
livre.

## 15. Home / Dashboards

Início interno e do portal carregados no servidor por permissão, com totais
das listagens (pageSize 1) — nada é baixado para contar no navegador; o
portal só usa consultas que a RLS recorta ao escritório (nunca "consulta
interna e filtra depois"). Contadores do menu no servidor (layout).

## 16. Authorization / RLS

Nenhuma regra de RLS foi relaxada; nenhum papel novo; MFA obrigatório sem
bypass. Toda tela passa por Server Action (sessão + permissão) e RLS;
escritório/papel/usuário nunca vêm do navegador. Rotas protegidas por
`RequirePermission`/`AudienceSwitch` no servidor; abas sensíveis nem são
consultadas sem permissão. "Não encontrado" para id de outro escritório.

## 17. UI states

Loading (esmaecido com `aria-busy`, esqueletos), empty (com e sem filtros),
error recuperável ("Tentar novamente", código de referência do `requestId`)
e pending (botões com carregando; sem UI otimista em operações críticas) em
todas as listas, fichas e diálogos.

## 18. Idempotency UX

`useIdempotencyKey`: uma chave por intenção de envio, nova se os dados
mudam, `reset()` após sucesso. Usada em caso, processo, envio do parceiro,
processo do parceiro, análise (início e envio), contrato, obrigação,
recebimento, ajuste, estorno e repasse. Após criar, a tela navega para o
recurso devolvido pelo servidor (inclusive `deduplicated`). Nenhum id de
domínio gerado no navegador.

## 19. Tests

- **Unitários:** 388 (32 arquivos) — passam aqui.
- **Banco (PGlite):** 481 verificações — passam aqui (novas: `[029]` 21,
  `[030]` 16, `[031]` 11).
- **Integração (DEV):** ≈172 casos em 20 arquivos; novos nesta etapa
  `frontend-analyses`, `frontend-finance`, `frontend-agent-runs`,
  `frontend-phase-h` (além de A–C). **Não executados aqui** (sem `.env` do
  DEV nesta máquina) — no guia.
- **E2E:** não criado.
- **QA manual:** checklists por fase em `docs/frontend-integration.md` +
  transversais no guia — **pendente**.

## 20. Migrations novas

`028_company_people_replace`, `029_atomic_analysis_start`,
`030_financial_agreement_lifecycle`, `031_agent_run_summaries_page`. Nenhuma
migration aplicada foi alterada; nenhuma mudança de schema "para facilitar a
UI" — cada uma corrige uma lacuna real (atomicidade, ciclo de vida,
paginação). Todas aguardando `db push` no DEV; próxima livre: 032.

## 21. Service role

**Nenhum uso novo.** O cliente admin continua só em `server/auth/team-actions`
(equipe e reset de MFA) e `server/domain/documents/signed-storage` (URLs
assinadas). Os testes de integração usam a service role apenas no setup de
dados fictícios, como antes.

## 22. Performance

Listas paginadas no servidor; contadores por `count` (head); embeds para
evitar N+1 (rótulos de revisões, acordos, parcerias); totais do financeiro
somados no servidor com teto de leitura e aviso de "parcial"; filtro de prazo
por embed obrigatório (sem lista de ids na URL). O Início faz ~20 consultas
leves em paralelo; o layout, ~6 contagens por carregamento completo. Se o
volume crescer, candidatos a read model/RPC: totais do financeiro e Início.

## 23. Diferenças do plano

- 028–031 (o plano previa "029+ se necessário"): atomicidade de análise,
  ciclo de vida do acordo e paginação de execuções exigiram banco.
- Removidos por não terem backend correspondente (documentados por fase):
  edição de conteúdo dentro da revisão, interromper análise, gerador de
  cronograma de parcelas, "valores da parceria" editáveis, gráfico
  "contratado por modelo", aba Histórico do caso no portal, contagens por
  cliente na lista do portal, lista de sessões em Segurança.
- Acrescentados para viabilizar telas: rótulos de leitura (embeds), resumo
  de processos, filtro de prazo, filtro de revisões por processo, setup do
  assistente de análise, lista de acordos com totais, visão geral do
  financeiro — só TypeScript, sem schema.
- Validação conjunta no fim (a seu pedido), em vez de pausa por fase.

## 24. Riscos restantes

- Validação real e QA ainda não executados (status deste relatório).
- Embeds novos do PostgREST (rótulos, `deadlines!deadlines_process_fkey!inner`)
  só são exercitados de verdade no DEV — cobertos pelos testes de integração.
- Notificações sem produtor: a caixa real fica vazia até existir regra que
  gere avisos.
- Áreas de configuração ainda de demonstração (§3) podem confundir quem não
  conhece o escopo — o selo "Demonstração" continua no cabeçalho.
- Totais do financeiro e do Início somados no servidor em memória: adequados
  ao volume atual; viram RPC/read model se crescer.
- Worker de agentes: precisa ficar parado no DEV durante QA, senão execuções
  enfileiradas chamariam a IA.
- SMTP customizado do Auth continua pendente (fora da etapa).

## 25. Próximo passo recomendado

Não iniciado. Recomendo: **(1)** rodar o guia de validação e corrigir o que
aparecer; **(2)** depois, uma etapa curta de "fechamento da 4.3" para as
áreas de configuração (DG Brasil/agentes no backend que já existe,
preferências de notificação e o produtor de notificações in-app); **(3)** só
então a etapa de execução real dos agentes (worker + IA) com o gate humano
já ligado às revisões, e o SMTP do Auth antes de qualquer cliente real.
