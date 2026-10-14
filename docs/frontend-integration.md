# Etapa 4.3 — Front V1 ligado ao backend real

Substituição **progressiva** dos mocks pelo backend da 4.2/4.2.1, domínio por
domínio. O Front V1 (layout, navegação, identidade) não é redesenhado; só
muda o que o comportamento real exige: carregando, vazio, erro, paginação e
retorno das operações.

## Estado por domínio

| Fase | Domínio | Estado | Observação |
|---|---|---|---|
| A | Diretório (usuário/escritório) | ✅ real | `server/directory.ts`: integrantes ativos, escritório proprietário, parceiros visíveis |
| A | Clientes (equipe interna) | ✅ real | lista, busca, filtros, detalhe, cadastro, edição, representantes/sócios de PJ (028), inativar/reativar/excluir |
| A | Clientes no Portal do Parceiro | ✅ real (D) | lista, ficha (ClientPartnerDTO), edição de contato/endereço |
| B | Casos (equipe interna) | ✅ real | lista, filtros, ficha, cadastro idempotente, editar, enviar, aceitar, rejeitar, andamento, encerrar, arquivar, origem, advogado |
| B | Processos, Prazos, Movimentações (equipe interna) | ✅ real | lista, filtros, ficha, partes (leitura), cadastro idempotente, edição, exclusão; prazos (criar, editar, cumprir, cancelar); andamentos |
| B | Casos e Processos no Portal do Parceiro | ✅ real (D) | listas, fichas (DTO do parceiro), envio de caso e cadastro de processo idempotentes |
| C | Documentos (equipe interna) | ✅ real | cliente, caso e processo: lista, envio em etapas com URL assinada, nova versão, histórico, download por URL assinada curta, verificação por versão, compartilhar/recolher, arquivar, excluir (ADMIN) |
| C | Pendências documentais do caso | ✅ real | criar, solicitar, registrar recebimento (versão concreta), aprovar/rejeitar |
| C | Documentos no Portal do Parceiro | ✅ real (D) | só PARTNER_VISIBLE; envio/nova versão em caso e processo; pendências documentais só leitura |
| D | Parceiros (equipe interna), Solicitações, Portal do Parceiro | ✅ real | Início e Financeiro do portal ficam para H e F |
| E | Revisões, Análises | ✅ real | início/envio de análise atômico e idempotente (migration 029); decisão só por `decide_review` |
| F | Financeiro | ✅ real | ciclo de vida do acordo garantido no banco (migration 030); totais somados no servidor; ledger append-only |
| G | Execuções de agente / Agentes | ⏳ | paginar o read model antes |
| H | Notificações, Auditoria, Home/painéis | ⏳ | painéis por último |

## Padrão de integração (vale para todos os domínios)

**Leitura — server-first.** A página (Server Component) chama a Server Action
de leitura do domínio — a mesma porta do navegador: sessão, permissão, Zod,
RLS — e entrega o DTO pronto ao componente. Rota direta, nova aba e recarregar
funcionam sem estado prévio no navegador. ID inexistente, malformado ou de
outro escritório → "não encontrado" (nunca revela existência).

**Listas.** `useServerList` (`lib/hooks/use-server-list.ts`) + `Pagination`
(`components/ui/pagination.tsx`) — padrão único:

- primeira página vem do servidor; mudança de filtro/página/ordem chama a
  action de listagem (nada de baixar tudo e filtrar no navegador);
- busca com atraso (300 ms); resposta antiga nunca sobrescreve a nova;
- filtros, ordem e página ficam na URL (`history.replaceState`);
- **CPF/CNPJ nunca vai para a URL**: busca com dígitos fica só na tela.

**Escritas.** Componente → Server Action → service → repository. A tela só
muda depois da resposta do banco (sem atualização otimista nas operações
críticas); em seguida, navega para o recurso devolvido pelo servidor ou
recarrega os dados (`router.refresh()`).

- Botão desabilitado durante o envio + guarda contra o segundo clique.
- Erros de campo do Zod do servidor viram mensagens nos campos
  (`mapFieldErrors`); demais erros viram aviso com a mensagem segura e o
  **código de referência** (8 primeiros caracteres do `requestId`, que liga a
  tela ao log do servidor).
- Falha de rede vira erro recuperável (`callAction`), nunca tela quebrada;
  exceção inesperada cai no `app/(app)/error.tsx` (menu continua, "Tentar
  novamente").
- Nenhum ID de domínio é gerado no navegador (exceção futura:
  `idempotencyKey`, uma por intenção de envio).

**Diretório.** `loadOrgDirectory()` roda no layout autenticado e alimenta
`OrgDirectoryProvider`: nomes de responsáveis, opções de responsável e de
origem. Equipe interna sem `partners.view` (ASSISTANT) vê só o escritório
proprietário como origem.

**Sem fallback para mock.** Erro do backend aparece como erro. Domínio
migrado não tem mais escrita no mock.

## Fase A — Clientes

- Lista: busca por nome/razão social ou CPF/CNPJ (prefixo), tipo, situação
  (ativos/inativos/todos), responsável, origem (com `partners.view`); ordem
  por nome, cadastro, atualização; 25 por página.
- Colunas que dependiam de outros domínios ainda em mock (análise, processos
  ativos, progresso documental) e seus filtros **saíram da lista**: o
  backend de clientes não os fornece e não pode haver duas fontes. Voltam
  com os domínios correspondentes, se fizer sentido, via read model.
- Detalhe: `getClientAction` (registro LGPD de acesso no banco). As abas de
  Documentos, Casos, Processos e Atividade ainda leem os módulos de
  demonstração (fases C, B e H) — para clientes reais, ficam vazias até lá.
- Edição: PATCH só com o que a tela edita; CPF/CNPJ só vai quando muda (só
  ADMIN corrige — a tela avisa no campo, o servidor recusa de todo modo).
  **PF — campos com três estados** (data de nascimento, gênero, estado civil,
  documento de identidade): ausente = não mexe; valor = grava; `null` =
  apaga (NULL no banco, nunca ""). A tela manda `null` quando o controle
  fica vazio. Documento de identidade é um bloco: tipo e número andam juntos
  (constraint `individual_client_details_identity_complete`); limpar tipo e
  número apaga também emissor e UF. Sem migration: as colunas já eram
  nuláveis e `save_client` já gravava NULL para chave presente com `null` —
  faltava o schema do servidor aceitar `null` e o mapper distinguir
  `undefined` de `null`.
- **Representantes e sócios de PJ (migration 028).** Lacuna real da 025
  (`save_client` só os gravava no cadastro; sem DELETE). Agora:
  `replace_company_people(cliente, representantes, sócios)` — UMA operação
  para o bloco inteiro, com o **estado final** das duas listas:
  - item com `id` (sempre o id do banco) = linha existente, atualizada no
    lugar; sem `id` = nova; linha que não veio = removida; `id` de outro
    cliente ou repetido = recusa tudo;
  - tudo numa transação: qualquer item inválido desfaz a chamada inteira;
  - autorização no banco: equipe interna (ADMIN/LAWYER/ASSISTANT, a mesma
    regra de `clients.edit`), aal2, cliente PJ existente; parceiro recusado;
  - auditoria: triggers de linha (inclusões/alterações, só nomes de campos)
    + resumo `COMPANY_PEOPLE_REPLACED` com contagens (sem nome/CPF), com ator,
    escritório, `request_id` e data;
  - sem histórico temporal: estado atual + trilha de auditoria.
  Na tela de edição de PJ, representantes e sócios têm **formulário e botão
  próprios** ("Salvar representantes e sócios"): cada gravação é uma única
  transação confirmada — o restante do cadastro continua no botão principal.
  Por que uma operação para os dois blocos: são editados e salvos juntos na
  mesma seção, e a regra do representante principal precisa da lista inteira;
  duas RPCs separadas permitiriam salvar metade.
- Mock: removidas as escritas de cliente do store, do contrato e do
  repositório mock. Os clientes do seed continuam porque Casos, Processos,
  Financeiro e o Portal (ainda mock) os referenciam; saem quando esses
  domínios migrarem.

## Fase B — Casos, Processos, Prazos e Movimentações

**Pré-requisito cumprido:** determinismo do `request_hash` (027) comprovado
antes de ligar as telas de criação (testes `[027] determinismo`, commit
e3bf3ba).

**Idempotência na UI** — `useIdempotencyKey` (`lib/hooks/use-idempotency-key.ts`):
uma chave por INTENÇÃO de envio. Clique duplo, retry ou nova tentativa com
os MESMOS dados reutilizam a chave (o banco devolve o mesmo recurso,
`deduplicated: true`, tratado como sucesso); se o usuário muda os dados, é
outra intenção e a chave é nova (impressão digital do envio com chaves
ordenadas). Depois do sucesso a chave é descartada. Nunca global nem
persistida. A tela navega para o id devolvido pelo servidor.

**Casos**
- Lista: busca por título ou parte contrária; filtros de situação, área,
  responsável, cliente (seletor com busca no servidor), origem (com
  `partners.view`) e período de criação; ordem e paginação no servidor;
  número de processos por caso (uma consulta por página).
- Ficha: visão geral real (cliente, origem, responsável, autoria, datas,
  rejeição, notas). Ações no backend: enviar (`cases.edit`); aceitar,
  rejeitar, marcar em andamento, encerrar, arquivar (`cases.decide` — o
  Front V1 mostrava algumas para `cases.edit`, o servidor sempre exigiu
  `cases.decide`); editar dados, origem (após o aceite: ADMIN, com MOTIVO —
  campo novo, o banco exige) e advogado responsável (Advogado ou ADMIN com
  OAB). Nada muda na tela antes da resposta do banco.
- Origem × acesso: `originOrganizationId` (comercial) e
  `partnerOrganizationId` (acesso) continuam separados; vincular o parceiro
  é opt-in explícito.
- Tipo do caso: o Front V1 tinha texto livre; o banco usa o catálogo
  `case_types` (vazio por enquanto) — o campo virou seleção opcional por
  área, com o catálogo lido do servidor.
- Cadastro: a seção de anexos saiu (upload real é da Fase C); o resumo
  continua obrigatório na tela.
- Abas Documentos, Análise, Revisões, Financeiro e Atividade mostram
  "Seção em integração" (fases C, E, F, H). **Iniciar análise** foi
  retirado do cabeçalho até a Fase E (início ainda não atômico).

**Processos**
- Lista: busca por CNJ ou título; filtros de cliente, responsável, tribunal,
  status, fase, origem do cadastro e origem do caso (com `partners.view`);
  o servidor devolve cliente, caso e PRÓXIMO PRAZO em aberto (uma consulta
  por página; parceiro não recebe prazo).
- Saíram da lista até a Fase H (dados derivados da carteira inteira): a
  faixa de contadores e o filtro "Prazo" (vencidos/próximos 5 dias).
- Ficha: visão geral (com as partes cadastradas, documento mascarado),
  movimentações (página do servidor + "carregar mais", origem de cada uma;
  a equipe registra só nota MANUAL — movimentação oficial vem da
  integração), prazos (situação do banco: "Vencido" é derivado na view,
  nunca gravado; criar, editar, cumprir, cancelar). Documentos, Revisões e
  Financeiro: "Seção em integração".
- Cadastro: o caso é escolhido com busca no servidor (casos que aceitam
  processo); a área saiu do formulário (é a do caso); prazo inicial
  obrigatório como no Front V1. Edição: rota nova `/processos/[id]/editar`
  (o Front V1 dizia "edição em uma próxima etapa"); vazio limpa.
- Exclusão (ADMIN, `processes.delete`): lógica e auditada; volta para o
  caso. O fluxo de "vínculo pendente / trocar cliente" do mock saiu: no
  modelo real o processo pertence ao caso e o cliente é o do caso.

**Cliente (Fase A, completado):** as abas Casos e Processos da ficha do
cliente agora leem o servidor; Documentos e Atividade mostram "Seção em
integração"; o botão "Adicionar documento" saiu até a Fase C.

**Mock removido:** escritas de caso e processo (slice `cases`, ações de
processo do slice `processes-reviews`, repositórios mock `cases` e
`processes`, contratos), hooks de escrita e de leitura sem uso, componentes
substituídos (filtros/tabela/abas antigas de processo). Continuam, só para
leitura, os dados de caso/processo do seed que o Portal do Parceiro, o
Financeiro, as Revisões e a Home (ainda mock) usam. Sem mudança no formato
persistido do store (sem bump de versão).

**Backend (só TypeScript, sem migration):** filtros novos de caso (área,
origem, período; busca também por parte contrária, com escape do filtro
`or`) e de processo (fase, tribunal, origem do cadastro, origem do caso);
leitura do catálogo; nome do cliente na ficha do caso; caso/cliente/próximo
prazo na lista de processos; diretório com OAB.

## Fase C — Documentos e Pendências documentais

**Modelo real (diferente do Front V1).** No V1, "documento" era um item do
cliente com status (faltando/pendente/recebido/rejeitado) e um checklist do
modelo de análise. No banco:

- **documento** = registro lógico (categoria, título, visibilidade) com
  **versões imutáveis**; cada versão tem a **própria verificação**
  (Não verificado / Verificado / Divergência). Versão nova nasce não
  verificada e nunca herda o resultado da anterior;
- **pendência** = "o que falta" no CASO (Não solicitado → Solicitado →
  Arquivo recebido → Aprovado/Rejeitado), atendida por uma VERSÃO concreta.
  A tela separa "documento solicitado" de "arquivo recebido".

**Envio (upload)** — `features/documents/upload.ts`, sempre pelo servidor:
1. `createDocumentAction` (documento + vínculo; só no primeiro envio);
2. `prepareDocumentUploadAction`: o banco autoriza com o JWT do usuário e o
   servidor devolve uma URL assinada de upload (id da versão gerado no
   servidor; o navegador nunca monta caminho);
3. envio do arquivo para a URL assinada (`uploadToSignedUrl`);
4. `confirmDocumentUploadAction`: registra a versão (idempotente pelo id).

A tela mostra cada etapa. Falha no envio: nada foi registrado, "Tentar
novamente" pede outra URL. Arquivo enviado mas confirmação falhou: a tela
**não** mostra sucesso e oferece "Confirmar de novo" com a MESMA versão
(sem reenviar; confirmar duas vezes não duplica). Objeto enviado e nunca
confirmado fica para a limpeza de órfãos do Storage (mecanismo existente).
Tipo e tamanho são conferidos antes (mesma lista do bucket, testada) e de
novo no servidor/bucket.

**Download:** `downloadDocumentAction` — o banco autoriza, registra o
acesso (LGPD + auditoria) e o servidor devolve URL assinada de **60 s**;
nenhuma URL de Storage é montada no navegador nem guardada.

**Visibilidade:** "Compartilhar com o parceiro" só aparece em caso/processo
com parceiro vinculado, e o SERVIDOR confere as regras (caso de parceiro,
arquivo enviado, versão não rejeitada em revisão, minuta de agente só
aprovada). O parceiro só recebe `PARTNER_VISIBLE` (RLS) — nada é filtrado no
navegador. Portal do parceiro: Fase D.

**Onde aparece:** ficha do cliente (todos os documentos do cliente), caso
(pendências + documentos do caso e dos processos dele) e processo. Ações:
enviar, nova versão, histórico de versões (com download por versão e
situação da revisão), verificar / registrar divergência, compartilhar /
recolher, arquivar / reativar, excluir (ADMIN; versões ficam no histórico).

**Diferenças do Front V1:** sem busca por texto e sem filtro de "status"
antigo (o backend filtra por categoria e ativo/arquivado); sem pré-visualização
embutida (o download por URL assinada substitui); o checklist por modelo de
análise volta com a Fase E (análises) — as pendências do caso são o
mecanismo real de "o que falta".

**Mock removido:** escritas de documento (slice de cliente, repositório e
contrato `documents`) e os componentes do V1 que só gravavam no mock (lista,
diálogo de inclusão, área de soltar, prévia, rejeição). Ficam o checklist e o
indicador de verificação (usados pelo assistente de análise, Fase E).

## Fase D — Parceiros, Solicitações e Portal do Parceiro

**D1 — equipe interna.** `/parceiros`: lista (busca, situação, páginas e
contadores reais), ficha (cadastro, divisão — só ADMIN —, situação, equipe,
clientes relacionados, casos com origem ou acesso do parceiro, processos),
cadastro e edição pelas Server Actions de `organizations`. Solicitações ao
parceiro (`RequestsPanel`, as duas superfícies): lista paginada, conversa,
nova solicitação por caso, pedir nova resposta, resolver/cancelar.

**D2 — Portal do Parceiro.** Todas as telas leem do servidor no ramo
`partner` das mesmas rotas (`AudienceSwitch`), com o **DTO do parceiro** — o
navegador nunca recebe campo interno, e o escritório nunca vem da tela (a RLS
recorta tudo ao escritório da sessão):

| Tela | Fonte | Observação |
|---|---|---|
| `/clientes` | `listClientsAction` | busca por nome/CPF/CNPJ no servidor; dígitos nunca na URL |
| `/clientes/[id]` | `getClientAction` (ClientPartnerDTO) | casos, processos e documentos compartilhados; "Editar" = `updateClientBasicsAction` (só contato e endereço; vazio apaga) |
| `/clientes/novo`, `/casos/novo` | `lookupClientDocumentAction` + `partnerSubmitCaseAction` | ver "Envio de caso" abaixo |
| `/casos` | `listCasesAction` | situações simplificadas do parceiro (um rótulo → várias situações reais no filtro) |
| `/casos/[id]` | `getCaseAction` (CasePartnerDTO) | visão geral (só motivo PÚBLICO de rejeição), documentos (envio pelo parceiro), pendências documentais (leitura), solicitações (responder), processos |
| `/processos` | `listProcessesAction` | sem colunas internas (responsável, prazo, origem técnica) |
| `/processos/[id]` | `getProcessAction` (ProcessPartnerDTO) | movimentações oficiais e do sistema (nota manual/agente nunca chegam), documentos, solicitações do caso |
| `/processos/novo` | `createPartnerProcessAction` | idempotente (chave por intenção); caso escolhido por busca no servidor |
| `/pendencias` | `listPartnerRequestsAction` (escopo vazio = "as minhas") | responder enquanto aberta |
| `/minha-conta` | sessão + `getMyPartnerOfficeAction`; `getMyPartnerSettingsAction` só PARTNER_ADMIN | gestão de usuários (TeamManager, já real) só PARTNER_ADMIN |

**Envio de caso.** Identificação por CPF/CNPJ (`lookupClientDocumentAction`:
NOT_FOUND → cadastro básico; EXISTS → caso para o cadastro canônico, sem
revelar nome/escritório; ALREADY_RELATED → abrir cliente ou criar caso).
Limite de consultas (RATE_LIMITED, best-effort na aplicação) vira aviso no
próprio passo. Cliente + caso nascem numa operação atômica e idempotente
(`partnerSubmitCaseAction`, chave por intenção, 027); cliente existente leva
só tipo + documento (o banco nunca sobrescreve o cadastro de outro
escritório). A origem vai como `OWN_OFFICE`/`OWNER` — o id sai da
sessão/banco. **Arquivos** escolhidos no assistente sobem DEPOIS, para o caso
criado, pelo fluxo de URL assinada da Fase C; falha num arquivo não desfaz o
caso e tem "Tentar de novo" (retoma a confirmação sem reenviar).

**Documentos no portal.** O parceiro só recebe `PARTNER_VISIBLE` (RLS). Envia
arquivo e nova versão em caso/processo (`partnerPortal.documents.submit`; o
servidor grava como `PARTNER_VISIBLE`); nunca só para o cliente. Caso
recusado ou arquivado: sem envio. Verificação, visibilidade, arquivar e
excluir continuam só da equipe interna.

**Diferenças do Front V1 (portal):** a lista de clientes não mostra mais
contagem de processos/pendências por cliente (não há read model; a ficha
mostra); a aba "Histórico" do caso saiu (auditoria é interna); "Tipo" do caso
é o catálogo real (opcional; o catálogo de tipos ainda está vazio);
"Representante legal" de PJ saiu do envio (o schema do parceiro não tem); a
aba "Financeiro" do caso volta na Fase F; o Início do portal é a Fase H.

**Mock removido:** repositório `partnerPortal` (consulta, envio de caso,
processo, contato, documento, resposta), as ações correspondentes do store e
os diálogos do portal que só gravavam no mock. Restam no mock só os hooks do
Início (H) e do Financeiro (F) do portal.

## Fase E — Revisões e Análises

**Auditoria do início da análise (antes de conectar).** O backend da 4.2
criava a análise (insert sem chave) e, ao enviar, pedia a execução
(`request_agent_run_once`) e DEPOIS ligava a análise — duas escritas. Falha
entre elas deixava execução na fila sem análise ligada; clique duplo no
início criava duas análises. **Migration 029** (`start_legal_analysis_once`,
`send_legal_analysis_once`): análise + execução + entrada + fila + auditoria
numa transação, idempotente (mecanismo da 027). O servidor confere antes
(leitura) os documentos obrigatórios do modelo; o banco reconfere papel,
caso, modelo ativo da área e agente, e decide o status (lock da linha).
Nenhuma IA roda: "enviar" = enfileirar.

**Revisões** (`/revisoes`, ADMIN/LAWYER): fila do servidor com visões
(aguardando decisão, atribuídas a mim, todas), filtros (prioridade, tipo,
situação, sem responsável) e páginas, estado na URL. A linha mostra só
rótulos (modelo da análise, documento e versão, tipo da proposta, agente,
caso e cliente — embeds de leitura sob RLS). A ficha lê o CONTEÚDO do alvo na
hora (resultado da análise, versão do documento com download assinado da
versão, proposta do agente), mostra o histórico de decisões e permite
atribuir (responsável, prioridade, prazo). **Decidir é só pela RPC
`decide_review`** (aprovar, pedir alterações, rejeitar — justificativa
obrigatória nas duas últimas); proposta estrutural só ADMIN; reabrir (não
para proposta de agente). Sem UI otimista.

**Análises** (aba Análise do caso e `/casos/[id]/analise/nova`, ADMIN/
LAWYER): assistente com os modelos ATIVOS da área do caso
(`getAnalysisSetupAction`: campos e checklist do tipo de cliente, com o que
já está no caso), campos validados contra a definição do modelo e
"Enviar ao agente agora" (só com agente configurado e documentos
obrigatórios presentes). A aba mostra a análise atual (documentos que
faltam, resultado estruturado, link para a revisão), envio/reenvio atômico e
o histórico. ASSISTANT não vê as abas Análise e Revisões (nem as lê).

**Diferenças do Front V1:** sem edição do conteúdo dentro da revisão
(editar manualmente / "editar com agente" / exportar versão) — o conteúdo é
do alvo e o backend não tem essas operações; sem "interromper análise"
(cancelar execução é operação de ADMIN em Agentes, Fase G); sem simulação de
resultado do agente; sem navegação "próxima pendente". O modelo bancário do
seed não tem agente configurado: a análise é criada e fica pendente até
haver agente (configuração de agente fora do escopo da 4.3).

**Mock removido:** repositórios `analyses` e `reviews`, as ações de análise e
revisão do store e as telas do V1 que só gravavam no mock (editor, barra de
decisão, contexto, painel de status, interrupção).

## Fase F — Financeiro

**Auditoria do ciclo de vida do acordo (antes de conectar as mutações).**
`financial_agreements` não tinha guarda no banco: transições de situação,
termos congelados fora do rascunho e "nenhuma obrigação em aberto ao
concluir/cancelar" existiam só no TypeScript, com janela de corrida entre
conferir e gravar; obrigação nova e recebimento também só conferiam a
situação do acordo no TypeScript. **Migration 030** coloca essas regras no
banco (ver `supabase/README.md`), com locks que serializam obrigação/entrada
com a conclusão do acordo. Estorno e ajuste para menos continuam valendo em
qualquer situação (correção). Histórico: os triggers de auditoria já
registravam acordo, obrigação e lançamento.

**Visão geral** (`/financeiro`, ADMIN): totais (em aberto, recebido,
contratado, em atraso, contratos por situação) e recebido líquido por mês
(12 meses, fuso de São Paulo) **somados no servidor** sobre a view
`payment_balances` e o ledger (`getFinanceSummaryAction`) — o navegador não
recebe listas inteiras nem faz conta de divisão. Teto de leitura com aviso
"Totais parciais" se ultrapassado.

**Contratos** (lista paginada no servidor, filtro por situação na URL;
`listAgreementRowsAction` traz caso, cliente, modelo e totais do ledger por
página). Gaveta do contrato: termos, obrigações com situação derivada
(`listPaymentsAction`) e lançamentos (`listReceiptsAction`); ações:
ativar/concluir/cancelar o acordo, nova obrigação, corrigir obrigação
(nunca o recebido), cancelar obrigação (motivo), registrar recebimento
(vazio = quitar o saldo), ajuste (justificativa) e estorno. **Lançamentos
nunca se editam** (ledger append-only). Toda mutação com chave de
idempotência por intenção; sem UI otimista. Valores em BRL; moeda sempre do
acordo.

**Novo contrato** (`/financeiro/contratos/novo`, aceita `?caso=`): caso por
busca no servidor, modelo de honorários (o servidor copia os termos quando
não personalizados), rascunho ou "ativar agora". As obrigações (parcelas)
são registradas na gaveta — o gerador de cronograma do V1 (várias gravações
sem transação) não foi mantido.

**Caso → Financeiro** (ADMIN): contratos do caso + histórico da parceria
(snapshot congelado no aceite). **Parceiro → Financeiro** (ADMIN): totais da
participação, participação por caso e repasses (registrar — o banco escolhe
as divisões, 026 —, marcar pago, cancelar). **Portal → Financeiro** (só
PARTNER_ADMIN): a MESMA visão, só leitura, só o próprio escritório (o
escritório vem da sessão; DTO do parceiro sem receita do escritório).
PARTNER_USER não tem financeiro (rota bloqueada). **Configurações → Modelos
de honorários**: lista, criação e edição reais.

**Diferenças do Front V1:** sem gráfico "contratado por modelo" e sem
"êxito previsto" (estimativa sobre valor da causa não é dado do ledger);
sem filtro de origem na visão geral (a participação por parceiro fica na
ficha do parceiro); sem "valores da parceria" editáveis (o snapshot é
imutável; mudar a divisão padrão vale para casos novos); a aba Financeiro
do caso no portal não existe (a participação por caso está em
`/financeiro`).

**Mock removido:** repositórios `finance` e `partners`, ações do store de
financeiro e de parceiros, hooks e cálculos de financeiro no navegador
(totais, cronograma, divisão) e os diálogos mock de "valores da parceria" e
"repasse".

## Testes

- Unitários: `src/features/clients/clients-ui.test.ts` (URL ↔ filtros, CPF
  fora da URL, formulário → schema real do servidor, PATCH, erros de campo,
  falha de rede, bloco societário: só id do banco vai ao servidor, payload do
  banco, dois principais recusados).
- Banco (PGlite): `supabase/tests/verificar.mjs`, seção `[028]`.
- Fase B, unitários: `src/features/processes/phase-b-ui.test.ts` (URL das
  listas, impressão digital da idempotência, formulário de processo →
  schemas reais, embed do caso, data local do prazo, escape do filtro).
- Fase C, unitários: `src/features/documents/documents-ui.test.ts` (limites
  iguais aos do bucket, consulta da lista, ordem das etapas do envio, falha
  no envio sem confirmar, falha na confirmação retomada sem reenviar, rede).
- Fase C, integração: `tests/integration/frontend-documents.int.test.ts`
  (envio real com confirmação idempotente, confirmar sem arquivo, verificação
  por versão, download assinado, compartilhamento × parceiro A/B,
  pendência solicitado → recebido → aprovado, ASSISTANT não aprova).
- Fase D, unitários: `src/features/partner-portal/portal-ui.test.ts` (URL
  das listas sem CPF/CNPJ, rótulo simplificado → situações reais, entrada sem
  escritório, envio de caso → schema real com origem OWN_OFFICE/OWNER e
  cliente existente só com documento, processo do parceiro sem campo interno).
- Fase E, unitários: `src/features/reviews/phase-e-ui.test.ts` (URL da fila,
  entrada no schema real, rótulos sem conteúdo e com embed nulo, campos do
  modelo → payload, chave de envio obrigatória, modelo → assistente).
- Fase E, banco (PGlite): `supabase/tests/verificar.mjs`, seção `[029]`.
- Fase E, integração: `tests/integration/frontend-analyses.int.test.ts`
  (criar e enviar numa transação, repetição e corrida com a mesma chave,
  falha no envio sem resto gravado, conflito de chave, reenvio recusado
  com outra chave, papéis, assistente).
- Fase F, unitários: `src/features/finance/phase-f-ui.test.ts` (totais em
  centavos, recebido por mês no fuso de SP, linha da lista, formulários →
  schemas reais, URL da lista).
- Fase F, banco (PGlite): `supabase/tests/verificar.mjs`, seção `[030]`.
- Fase F, integração: `tests/integration/frontend-finance.int.test.ts`
  (ciclo de vida pelo service e direto no banco com o JWT do ADMIN,
  concluído sem obrigação/entrada e com estorno, histórico imutável,
  lista e visão geral, papéis sem acesso).
- Fase B, integração: `tests/integration/frontend-cases-processes.int.test.ts`
  (caso idempotente, filtros e contagem, catálogo, isolamento, processo
  idempotente com próximo prazo, edição que limpa, ciclo do prazo,
  andamento MANUAL invisível ao parceiro, ASSISTANT sem cadastro).
- Integração (Supabase DEV): `tests/integration/frontend-clients.int.test.ts`
  (formulário → service real, PATCH que apaga, LAWYER sem correção de CPF,
  URL da lista → listagem, diretório por papel) e
  `tests/integration/company-people.int.test.ts` (028 por papel, PF recusada,
  parcial inválido não altera nada, 3 → 2 sócios, IDOR, auditoria sem PII).

## QA manual — Fase A (Supabase DEV, dados fictícios)

Marque cada item com os cinco papéis indicados.

**ADMIN / LAWYER / ASSISTANT**

- [ ] `/clientes` abre sem flash de dados de demonstração; banco vazio mostra
      "Nenhum cliente cadastrado."
- [ ] Busca por nome responde após parar de digitar; busca por parte do CPF
      encontra; a URL **não** mostra os dígitos.
- [ ] Filtros (tipo, situação, responsável, origem) e ordenação refazem a
      consulta; recarregar a página mantém filtros e página.
- [ ] Paginação com mais de 25 clientes.
- [ ] Cadastrar PF e PJ: botão fica em "carregando", duplo clique não cria
      dois; ao terminar, abre a ficha do cliente criado.
- [ ] CPF já cadastrado: mensagem no campo CPF ("Cliente já cadastrado no
      sistema.").
- [ ] Editar: salvar volta para a ficha com os dados novos; apagar o nome
      social apaga de fato.
- [ ] PF: apagar data de nascimento, gênero, estado civil e documento de
      identidade e salvar; recarregar a ficha mostra os campos vazios.
      Tipo de documento sem número (ou o contrário) é apontado no campo.
- [ ] LAWYER/ASSISTANT alterando o CPF: aviso no campo, nada é salvo.
      ADMIN: corrige.
- [ ] Inativar/reativar: a ficha muda depois da resposta; lista "Inativos"
      mostra o cliente.
- [ ] PJ — "Salvar representantes e sócios": adicionar, editar, remover e
      trocar o principal; após salvar, recarregar a página mostra o mesmo
      quadro. Erro (ex.: CPF inválido) mantém o que foi digitado e não muda
      nada no banco. "Descartar alterações" volta ao último estado salvo.
- [ ] ADMIN exclui: volta para a lista; o cliente sumiu. LAWYER/ASSISTANT não
      veem "Ações perigosas".
- [ ] ASSISTANT: "Origem" só oferece o escritório proprietário.
- [ ] Abrir `/clientes/<uuid inexistente>` e `/clientes/abc` → "Cliente não
      encontrado."
- [ ] Ficha em nova aba e após recarregar funciona.
- [ ] Desligar a rede e mudar um filtro → erro com "Tentar novamente"; religar
      e tentar → volta.

**PARTNER_ADMIN / PARTNER_USER**

- [ ] `/clientes/<id de cliente interno>` não mostra dados internos (ver QA
      da Fase D).
- [ ] `/clientes/<id>/editar` → acesso negado.

## QA manual — Fase B (Supabase DEV, dados fictícios)

**ADMIN / LAWYER**

- [ ] `/casos`: lista do banco; filtros (situação, área, responsável, cliente,
      origem, período), ordem e páginas; recarregar mantém os filtros.
- [ ] Novo caso: buscar cliente pelo nome; "Salvar rascunho" e "Enviar para
      análise" abrem a ficha do caso criado. Clique duplo rápido → um caso só.
- [ ] Ficha do caso: editar dados (área/tipo), definir advogado, aceitar
      (sem advogado → aviso no campo), rejeitar (motivo obrigatório), marcar
      em andamento, encerrar, arquivar. A situação só muda depois da resposta.
- [ ] ADMIN altera a origem de caso aceito: pede motivo + confirmação.
      LAWYER não vê "Alterar origem" em caso aceito.
- [ ] Aba Processos do caso lista os processos; "Cadastrar processo" já vem
      com o caso escolhido.
- [ ] `/processos`: lista com cliente, caso e próximo prazo; filtros; busca
      por CNJ (os dígitos NÃO aparecem na URL).
- [ ] Cadastrar processo (CNJ válido e sem CNJ): abre a ficha; prazo inicial
      aparece em Prazos. CNJ com dígito errado → erro no campo.
- [ ] Editar processo: apagar a vara e o valor da causa apaga de fato.
- [ ] Registrar andamento (nota da equipe, origem "Equipe").
- [ ] Prazos: adicionar, editar, cumprir, cancelar; prazo vencido aparece
      como "Vencido".
- [ ] ADMIN exclui processo → volta para o caso; LAWYER não vê "Excluir".
- [ ] `/casos/<uuid de outro escritório ou inexistente>` e
      `/processos/<idem>` → "não encontrado".

**ASSISTANT**

- [ ] Vê casos e processos; cria caso (rascunho/envio); não vê Aceitar/
      Rejeitar/Encerrar/Arquivar; não cadastra processo nem prazo.

**PARTNER_ADMIN / PARTNER_USER**

- [ ] Rotas de caso/processo de outro escritório → "não encontrado" (ver QA
      da Fase D).

## QA manual — Fase C (Supabase DEV, arquivos fictícios)

**ADMIN / LAWYER / ASSISTANT**

- [ ] Ficha do cliente → Documentos: arrastar um PDF e enviar; as etapas
      aparecem; o documento entra como "Não verificado".
- [ ] Tipo não aceito (.zip) ou arquivo > 50 MB: aviso antes de enviar.
- [ ] Desligar a rede durante o envio: a tela mostra em que etapa parou e
      "Tentar novamente" funciona depois de religar.
- [ ] Baixar: o arquivo abre/baixa (o link expira em 60 s; abrir de novo pede
      outro link).
- [ ] Mais → Enviar nova versão: vira v2 "Não verificado"; Histórico de
      versões mostra v1 e v2, com download de cada uma.
- [ ] Marcar como verificado / Registrar divergência (com nota).
- [ ] Arquivar → some de "Ativos", aparece em "Arquivados"; Reativar volta.
- [ ] ADMIN exclui documento; LAWYER/ASSISTANT não veem "Excluir documento".
- [ ] Caso → Documentos: "Nova pendência" (já solicitada), enviar o arquivo,
      "Registrar recebimento" escolhendo o arquivo; LAWYER aprova (ASSISTANT
      não vê Aprovar/Rejeitar); rejeitar → "Solicitar de novo".
- [ ] Caso de parceiro: "Compartilhar com o parceiro" em documento com
      arquivo; em caso interno a opção não aparece. Minuta de agente não
      aprovada é recusada pelo servidor com mensagem.
- [ ] Processo → Documentos: enviar; o documento aparece também no caso.

## QA manual — Fase D (Supabase DEV, dados fictícios)

Use dois parceiros fictícios (A e B), cada um com um PARTNER_ADMIN e um
PARTNER_USER (@dgbrasil.test, CPF 999…).

**ADMIN / LAWYER / ASSISTANT — parceiros e solicitações**

- [ ] `/parceiros`: busca, situação e páginas; contadores (clientes, casos
      novos, ativos, pendências) batem com os dados. LAWYER/ASSISTANT não
      veem a divisão.
- [ ] ADMIN cadastra parceiro, edita, muda a divisão (vale para casos novos)
      e a situação. LAWYER não vê esses botões.
- [ ] Ficha do parceiro: equipe, clientes, casos, processos e solicitações
      listam só o que é desse parceiro.
- [ ] Caso de parceiro → Solicitações: "Nova solicitação"; responder na
      conversa; resolver e cancelar; a situação muda depois da resposta do
      servidor.

**PARTNER_ADMIN / PARTNER_USER — portal**

- [ ] `/clientes`: só clientes do próprio escritório; busca por nome e por
      CPF (os dígitos não aparecem na URL); recarregar mantém a página.
- [ ] Ficha do cliente: "Editar" contato/endereço; apagar o e-mail apaga de
      fato; recarregar mostra o salvo. Nenhum campo interno.
- [ ] `/clientes/novo`: CPF novo → cadastro básico → caso → documentos →
      revisão → enviar. Clique duplo em "Confirmar e enviar" → um caso só.
      Os arquivos sobem depois do envio, com indicação por arquivo.
- [ ] CPF já cadastrado por OUTRO escritório: "Cliente já cadastrado no
      sistema." sem nome nem escritório; o caso é criado para o cadastro
      existente e o cliente passa a aparecer na carteira.
- [ ] CPF já na carteira: "Abrir cliente" / "Criar novo caso".
- [ ] Muitas consultas seguidas de CPF/CNPJ → aviso "Consulta
      temporariamente bloqueada" (limite best-effort).
- [ ] `/casos`: filtro "Em análise" traz prontos para análise, em análise e
      aguardando revisão. Caso recusado mostra só o motivo público.
- [ ] Caso → Documentos: enviar arquivo; nova versão; baixar. Documento
      interno não compartilhado NÃO aparece. Caso recusado/arquivado: sem
      área de envio. Pendências documentais só para leitura.
- [ ] Caso → Pendências: responder solicitação aberta; resolvida não aceita
      resposta.
- [ ] Caso → Processos → "Cadastrar processo" (já com o caso); clique duplo
      → um processo só. Em `/processos` sem responsável/prazo interno.
- [ ] Processo → Movimentações: só oficiais e do sistema (nota manual da
      equipe não aparece).
- [ ] `/pendencias`: todas as solicitações do escritório; filtro por
      situação.
- [ ] `/minha-conta`: dados da sessão real; PARTNER_ADMIN vê divisão padrão
      e "Usuários do escritório"; PARTNER_USER não vê nenhum dos dois.
- [ ] Parceiro A abrindo `/clientes|casos|processos/<id do parceiro B>` →
      "não encontrado".
- [ ] Desligar a rede e mudar um filtro → erro com "Tentar novamente".

## QA manual — Fase E (Supabase DEV, dados fictícios; nada executa IA)

Prepare (service role, DEV): um agente fictício ATIVO com versão e um modelo
de análise da área bancária com esse agente (o do seed fica sem agente).

**ADMIN / LAWYER — análises**

- [ ] Caso → Análise sem análises: estado vazio com "Nova análise".
- [ ] Nova análise com o modelo SEM agente: "Enviar ao agente agora"
      desabilitado; criar → aba Análise mostra "Pendente" e os documentos
      que faltam.
- [ ] Nova análise com o modelo COM agente e documentos completos: marcar
      "Enviar ao agente agora", clique duplo em "Iniciar e enviar" → UMA
      análise "Na fila do agente" e UMA execução (Agentes/execuções ou SQL).
- [ ] Faltando documento obrigatório: o envio não é oferecido; depois de
      enviar o documento ao caso, "Enviar ao agente" aparece e funciona.
- [ ] Com análise na fila, "Nova análise" mostra "já possui uma análise em
      andamento".
- [ ] Campo obrigatório do modelo vazio → erro no campo; o servidor recusa
      campo fora do modelo.

**ADMIN / LAWYER — revisões**

- [ ] `/revisoes`: visões, filtros e páginas; recarregar mantém tudo.
- [ ] Abrir revisão de análise/documento/proposta: conteúdo do alvo; baixar
      a versão do documento.
- [ ] Atribuir responsável, prioridade e prazo; salvar muda depois da
      resposta.
- [ ] Aprovar (comentário opcional), pedir alterações e rejeitar
      (justificativa obrigatória); a decisão aparece no histórico.
- [ ] Reabrir revisão decidida (não aparece para proposta de agente).
- [ ] LAWYER em proposta estrutural (alteração de agente/skill): só aviso
      "Decisão do administrador"; ADMIN decide.
- [ ] Caso → Revisões lista as revisões do caso.

**ASSISTANT / parceiros**

- [ ] ASSISTANT: sem abas Análise/Revisões no caso; `/revisoes` e
      `/casos/<id>/analise/nova` → acesso negado.
- [ ] Parceiro: nenhuma rota de revisão/análise acessível.

## QA manual — Fase F (Supabase DEV, valores fictícios)

**ADMIN**

- [ ] `/financeiro`: totais e gráfico mensal; contratos paginados; filtro de
      situação vai para a URL e sobrevive ao recarregar.
- [ ] Novo contrato (com modelo e sem modelo; "Ativar agora" marcado e
      desmarcado). Clique duplo em "Criar contrato" → um contrato só. Segundo
      contrato ATIVO no mesmo caso → "Este caso já tem um acordo financeiro
      ativo."
- [ ] Gaveta: nova obrigação; registrar recebimento parcial e "quitar" (valor
      em branco); estornar parte; ajuste para menos com justificativa. A
      situação da obrigação muda (A vencer → Parcial → Recebida) depois da
      resposta.
- [ ] Concluir com obrigação em aberto → recusado com mensagem; quitada →
      conclui. Concluído: sem "Nova obrigação" nem "Registrar recebimento";
      estorno continua disponível.
- [ ] Cancelar obrigação (motivo obrigatório); com recebimento → pede
      estorno antes.
- [ ] Caso → Financeiro: contratos do caso e parceria (caso de origem
      parceira mostra o percentual congelado).
- [ ] Parceiro → Financeiro: participação, por caso e repasses; registrar
      repasse maior que o disponível → recusado; marcar pago; cancelar
      (motivo).
- [ ] Configurações → Modelos de honorários: criar, editar, inativar.

**LAWYER / ASSISTANT**

- [ ] Sem item Financeiro; `/financeiro` → acesso negado; sem aba Financeiro
      no caso.

**PARTNER_ADMIN**

- [ ] `/financeiro`: só a participação do próprio escritório (sem receita do
      escritório, sem outros parceiros); repasses só leitura.

**PARTNER_USER**

- [ ] `/financeiro` → acesso negado.

