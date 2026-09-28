# Handoff para o backend

O que o protótipo simula no navegador e precisa ser substituído por backend real.
**Nada disto está implementado nesta etapa.**

Arquitetura-alvo:

```
Next.js / React (este front-end)
        │  HTTPS, sessão
Backend TypeScript (Node)
        │
PostgreSQL ── Storage de documentos ── Filas / jobs
        │
Claude API / Claude Agent SDK ── Skills
        │
Integrações externas ── Human-in-the-loop (Revisões)
```

Python só entra como serviço auxiliar se surgir necessidade concreta (OCR especializado,
ML, pipelines científicos ou análise pesada de dados), não porque o sistema usa IA.

## 1. Autenticação

- Hoje: `session` no store; login só confere o e-mail; "Simular perfil" troca de usuário.
- Backend: autenticação real (e-mail/senha com hash forte e/ou SSO), sessão com cookie
  `HttpOnly`/`Secure`, expiração, revogação (a tela de sessões em Configurações já espera
  isso), 2FA e convites com token de uso único e prazo de validade.
- Remover as ferramentas de demonstração (`NEXT_PUBLIC_DEMO_MODE=false`) fora do protótipo.

## 2. Escritório proprietário único (não é multi-tenant)

O DG Brasil **não** é mais um SaaS vendido para vários escritórios independentes. Existe
um único escritório proprietário — **Bárbara Cardoso Advocacia** (`OwnerOffice`) — que
opera todo o sistema e trabalha com **escritórios parceiros**. As regras completas estão
na seção **13. Parcerias**.

- Todos os tipos mantêm `officeId` (= o escritório proprietário). No backend ele vem da
  configuração/sessão, nunca do cliente.
- O fluxo "Criar escritório" (`/criar-escritorio`) é legado do modelo anterior e só existe
  como ferramenta de demonstração; não faz parte do produto.

## 3. RBAC no servidor

- Replicar `ROLE_PERMISSIONS` (`src/lib/permissions`) no backend e aplicá-la em **todo**
  endpoint. Papéis internos: `ADMIN`, `LAWYER`, `ASSISTANT`. Papéis de parceiro (matriz
  própria, não equivalentes aos internos): `PARTNER_ADMIN`, `PARTNER_USER`.
- Além da permissão, usuários de parceiro têm **escopo de dados** (seção 13.2). Permissão
  diz o que a pessoa pode fazer; escopo diz sobre quais registros.
- Dados financeiros (honorários, pagamentos, contratos) nunca podem sair do servidor para
  quem não tem `finance.view`. Não basta a interface não mostrar.
- Futuro: permissões configuráveis por escritório (a matriz já está centralizada para isso).

## 4. PostgreSQL

Entidades mapeadas em `src/types`: Office (proprietário), PartnerOffice, User (com
`partnerOfficeId` opcional), Invitation, Client (PF/PJ, canônico), ClientOfficeRelationship,
PartnerCaseSubmission, PartnerRequest, ProcessPartnershipAgreement (+ payouts),
LegalRepresentative, Partner, ClientDocument, AnalysisTemplate, LegalAnalysis
(+ steps/timeline), Process, ProcessEvent, Deadline, Review, ReviewDecision, Agent,
AgentTask, Skill, LegalThesis (+ versões), ChangeHistoryEntry, Notification, FeeModel,
FinancialAgreement, Payment, Integration, AIUsage, AuditEvent, Subscription.

As regras de transição estão em `src/store/slices/*` e são a especificação funcional
dos serviços. Principais: reavaliação de documentos, ciclo da análise, efeitos da
decisão de revisão e versionamento de Skills.

## 5. Storage de documentos

- Hoje: só metadados (nome, categoria, tamanho).
- Backend: upload com URL assinada, antivírus, criptografia em repouso, bucket por
  escritório ou prefixo com política, links temporários para download, versionamento,
  trilha de acesso (quem abriu qual documento) e retenção configurável.
- Região de armazenamento no Brasil, se exigido pelo escritório.

## 6. Agentes (Claude Agent SDK)

- Worker em processo contínuo (não serverless) consumindo uma fila de execuções.
- O agente **propõe** e grava o resultado como `Review`. Só a decisão humana aplica
  efeitos, e apenas o backend transforma uma aprovação em ação.
- Nível de autonomia por agente (`AgentAutonomy`): mesmo em `AUTO_LOW_RISK`, ações externas
  continuam exigindo confirmação.
- Registrar para cada execução: agente, versão, Skills e tese usadas, documentos
  consultados, custo e tokens. Guardar e exibir resumo, evidências e ações propostas,
  **nunca** o raciocínio interno do modelo.
- Skills versionadas: o Tutor DG gera propostas, e a aplicação cria nova versão com diff
  (`ChangeHistoryEntry`). Reverter = aplicar a versão anterior.

## 7. Anthropic / Claude Platform

- Contrato: `src/services/ai-provider.ts` (`AIProviderService`).
- Cada escritório conecta a própria organização e arca com o próprio consumo.
- A credencial é enviada direto ao backend, guardada **criptografada** (KMS/secret manager)
  e **nunca** volta ao navegador. O front-end não pede, não guarda e não transmite API key.
- Consumo (tokens, custo por agente e por modelo) apurado no backend e exposto ao front
  como leitura.

## 8. Integrações

### 8.1 Integração Judicial

- Contrato: `src/services/judicial-integration.ts` (`JudicialIntegrationProvider`) e o
  registro `JUDICIAL_PROVIDERS`. A tela (Configurações → Integrações → Integração Judicial)
  se monta a partir do registro: nova fonte ou fornecedor = implementar o contrato e
  registrar, sem reescrever a interface. Estado por escritório: `JudicialSourceState`.
- **Nenhuma fonte fornece tudo.** Cada provedor declara `capabilities`; a UI mostra o que
  cada fonte entrega. Hoje:
  - **DJEN** (Diário de Justiça Eletrônico Nacional): comunicações, publicações e
    intimações; consulta por OAB (número + UF) quando aplicável. Gera prazos **derivados**,
    que entram em Revisões como proposta (nunca prazo confirmado automaticamente).
  - **DataJud** (CNJ): metadados por número CNJ — capa, tribunal, órgão julgador, classe,
    assuntos e o histórico de movimentos disponível. Enriquece processos já cadastrados.
- **Sincronização:** jobs periódicos por fonte e escritório (polling). Se algum fornecedor
  oferecer webhook/push, tratar como gatilho do mesmo job, com verificação de assinatura.
  Botão "Sincronizar agora" = enfileirar job com prioridade, nunca chamada síncrona do navegador.
- **Deduplicação:** processo pelo CNJ normalizado (só dígitos); comunicação pelo
  identificador da fonte + hash do conteúdo; movimento por CNJ + data + código/descrição.
- **OAB e CNJ:** validar formato; OAB monitorada é dado do escritório (e do advogado
  responsável), com trilha de quem configurou.
- **Rate limits e resiliência:** respeitar cotas de cada fonte, backoff exponencial,
  retomada por cursor/data da última comunicação, alerta `INTEGRATION_ISSUE` em falha.
- **Origem do dado:** persistir, em cada registro importado, a fonte, o identificador
  externo, a data de captura e o payload bruto (para auditoria e reprocessamento).
  Processos criados por integração continuam com `origin = INTEGRATION`.
- Credenciais (quando houver) só no backend, criptografadas. O protótipo não pede nenhuma.

### 8.2 Outras integrações

- E-mail e WhatsApp: envio só depois de aprovação em Revisões, com registro do envio.
- Armazenamento externo: opcional, via o mesmo serviço de storage.

### 8.3 Importação de dados (planilhas e outros sistemas)

- Hoje: `src/features/data-import` faz o *dry run* no navegador (CSV lido de verdade; XLSX
  simulado com planilha de exemplo) e `importData` (`store/slices/data-import.ts`) aplica
  um `ImportPlan` já validado.
- Backend:
  - **Parsing** de XLSX/CSV no servidor (encoding, separador, datas BR, números com vírgula),
    com limite de tamanho e antivírus.
  - **Mapeamento** coluna → campo, com sugestão (cabeçalho, amostras, futuramente IA) e
    confirmação humana obrigatória. Salvar mapeamentos por origem para reuso.
  - **Validação e dry run** antes de gravar: erros (CPF/CNPJ/CNJ inválido, cliente sem
    nome, CNJ repetido no arquivo) e alertas (sem responsável, sem vencimento, dado
    financeiro só como referência). **Linha com erro nunca é importada.**
  - **Deduplicação e conflitos:** CPF/CNPJ e CNJ já existentes exigem decisão explícita
    (atualizar / ignorar; "criar novo" só quando não gerar duplicata evidente). Nunca criar
    duplicata em silêncio. O mesmo cliente em várias linhas = um cliente com vários processos.
  - **Import jobs** assíncronos, com progresso, idempotência (hash do arquivo + mapeamento)
    e **rollback**: gravar tudo numa transação ou marcar os registros com `importJobId`
    para desfazer o lote inteiro.
  - **Relatório de erros** por linha, exportável, e alertas `DATA_INTEGRITY` para o que
    ficou pendente (processo sem cliente ou sem responsável, importação incompleta).
  - Atualização via importação só altera os campos presentes na planilha; nunca apaga dado
    existente com valor vazio.

## 8A. Cliente, Processo e integridade

- **Relação explícita, ciclos de vida independentes.** Cliente pode existir sem processo.
  Processo normalmente tem cliente, mas **não desaparece** se o cliente for removido:
  fica com `clientLinkStatus = PENDING_LINK` (vínculo pendente / revisão necessária),
  gera alerta `DATA_INTEGRITY` e aguarda: vincular outro cliente, restaurar o cliente
  (soft delete) ou resolução manual. Implementado no protótipo em `deleteClient` e
  `linkProcessClient`.
- **Sem cascade delete destrutivo.** FKs de processo → cliente com `ON DELETE RESTRICT`
  (ou `SET NULL` + status de vínculo); a exclusão é uma operação de domínio, não um
  cascade do banco.
- **Soft delete primeiro.** Tratar Cliente e Processo com `status` (ativo/inativo),
  `archivedAt` e `deletedAt`, em vez de `DELETE` físico imediato. Inativar é o caminho
  preferencial para quem deixou de ser cliente (continua pesquisável e no histórico).
- **Retenção e auditoria.** Dados jurídicos podem ter exigências de retenção (prazos
  legais, guarda de documentos, defesa do escritório) e de auditoria. A exclusão
  definitiva (expurgo) precisa ser projetada com cuidado: política por tipo de dado,
  aprovação, registro de quem pediu e quando, e atendimento a pedidos de eliminação da
  LGPD sem apagar o que a lei obriga a manter.
- **Quem pode excluir:** somente Administrador (`clients.delete`, `processes.delete`), verificado no servidor. Demais papéis podem inativar cliente (`clients.edit`).
- **Excluir processo** nunca exclui o cliente. Revisões, contratos de honorários e
  documentos associados são mantidos (histórico); prazos em aberto do processo são
  removidos. O front avisa antes quantos itens estão associados.
- Toda ação destrutiva ou reversível (excluir, inativar, reativar, revincular) gera
  `AuditEvent` com `details` (antes/depois, motivo). O histórico nunca é apagado porque
  o estado atual mudou.

## 8B. Revisões: versionamento, edição manual e reabertura

- **Versionamento do conteúdo.** Cada revisão tem `contentVersion`; toda alteração cria
  nova versão e guarda a anterior (`previousVersions`) com autoria e origem
  (`AGENT` ou `MANUAL_EDIT`). Nada é sobrescrito. No banco: tabela `review_content_version`
  append-only.
- **Edição manual** (pequenas correções sem pedir ao agente que regenere): registra
  usuário, horário, seções alteradas e origem `MANUAL_EDIT`. A revisão continua aguardando
  decisão.
- **Decisão atrelada à versão.** `ReviewDecision.contentVersion` guarda a versão decidida.
  **Aprovação vale só para aquela versão:** se a revisão for reaberta e editada, a nova
  versão exige nova aprovação. O backend deve recusar aplicar efeitos de uma aprovação cuja
  versão não seja a atual.
- **Reabertura** de revisão decidida (aprovou/rejeitou por engano, erro percebido depois,
  ajuste de conteúdo): status `REOPENED` (volta a aguardar decisão), evento na trilha e
  `AuditEvent` com decisão anterior, usuário, data e motivo. A decisão anterior **não é
  apagada**. Efeitos já aplicados por ela (ex.: processo criado) não são desfeitos
  automaticamente; desfazer é uma decisão separada e explícita.
- **Histórico imutável:** decisões, edições e reaberturas são append-only.

## 8C. Financeiro: status derivado e fonte única

- **Status nunca é gravado.** Parcela guarda só fatos (`amount`, `dueDate`, `paidAmount`,
  `paidAt`); contrato guarda termos e, se for o caso, `cancelledAt`. Status é calculado
  por uma regra central (`src/lib/domain/finance.ts`):
  - parcela: saldo 0 → `PAID`; saldo > 0 e vencida → `OVERDUE`; saldo > 0 com algo pago →
    `PARTIALLY_PAID`; senão `PENDING`;
  - contrato: cancelado → `CANCELLED`; alguma parcela em atraso → `OVERDUE`; todas quitadas
    (sem mensalidade recorrente) → `SETTLED`; senão `ACTIVE`.
- Isso corrigiu no protótipo o bug em que o detalhe mostrava "Pago" e a visão geral
  continuava "Em atraso": havia status gravado em dois lugares. Agora tabela, drawer, KPIs,
  gráficos, Home e menu leem os mesmos arrays e derivam com a mesma função.
- **Backend:** recebimentos como lançamentos (`payment_receipt`, append-only) e
  `paidAmount` como soma; status calculado em view/consulta (ou materializado por trigger
  na mesma transação, nunca por job assíncrono que deixe janelas de inconsistência).
  Registrar, alterar, estornar recebimento e mudar vencimento são transações únicas, com
  `AuditEvent` contendo situação anterior e atual. "Em atraso" depende da data: calcular
  na leitura ou reavaliar diariamente.

## 8D. DG Brasil: CRUD de Agentes, Skills e Teses

- Criação e edição manuais já existem no protótipo (`createAgent`, `createSkill`,
  `createThesis`, `updateAgent`), além das alterações via Tutor DG.
- **Toda** criação e alteração — manual ou pelo Tutor — entra no Histórico de Alterações
  (`ChangeHistoryEntry`, `action = CREATED | UPDATED`, `responsible = USER | TUTOR_DG`) e na
  auditoria. Criação = versão 0 → versão inicial.
- Versionar agentes, Skills e teses (tabelas de versão append-only); reverter = aplicar
  uma versão anterior como nova versão.
- Relações: Skill ↔ agente em `agent.skillIds`; tese ↔ agente autorizado em
  `agent.thesisIds`; tese ↔ Skill em `thesis.skillIds`. No banco, tabelas de junção.
- Teses criadas pela interface têm referências marcadas como demonstração (`demo`) até
  validação jurídica. O sistema não deve apresentar jurisprudência não verificada como real.
- Permissão: `dgbrasil.manage`, aplicada no servidor.

## 9. Auditoria

- Hoje: `AuditEvent` gerado pelas ações do store.
- Backend: log **append-only** gravado no mesmo commit da ação, com ator (usuário, agente
  ou sistema), escritório, entidade, antes/depois quando aplicável, IP e user agent.
  Consulta filtrável e exportável para o administrador.

## 10. Jobs

Sincronização processual; cálculo e alerta de prazos; execução de agentes; lembretes de
revisões paradas; vencimento de pagamentos (marcar em atraso); expiração de convites;
apuração de consumo de IA; limpeza conforme a política de retenção.

## 11. Notificações

- Geração no backend a partir de eventos (prazo, revisão, documento, movimentação,
  intervenção de agente, falha de integração, tarefa atrasada, integridade de dados), com
  severidade `info | warning | urgent | critical` e permissão exigida.
- `DATA_INTEGRITY`: processo sem cliente ativo, cliente removido com processo associado,
  pagamento inconsistente, importação incompleta, processo importado sem responsável. A
  severidade depende do caso (a maioria é `warning` ou `info`, não `critical`).
- Entrega in-app (tempo real via SSE/WebSocket) e e-mail, respeitando as preferências
  (`UserPreferences`) já modeladas.

## 12. Segurança e LGPD

O protótipo **não** é conforme à LGPD; ele só prepara a interface. O backend precisa de:

- criptografia em trânsito (TLS) e em repouso (banco, storage, backups);
- segregação multi-tenant verificada por testes;
- RBAC server-side e princípio do menor privilégio;
- gestão de credenciais em cofre, com rotação;
- audit logging completo e à prova de adulteração;
- proteção de documentos (links temporários, trilha de acesso);
- minimização de dados (os formulários já separam obrigatório, recomendado e opcional);
- políticas de retenção e descarte, com atendimento a direitos do titular (acesso,
  correção, eliminação);
- registro de operações de tratamento, base legal e DPO do escritório;
- avaliação dos operadores (provedor de IA, storage, integrações) e cláusulas contratuais;
- logs sem dados pessoais nem conteúdo de documentos.

## 13. Parcerias: escritório proprietário + escritórios parceiros

Implementado no protótipo com mocks. Referências:
`src/types/partner.ts` (entidades), `src/lib/permissions/partner-scope.ts` (regras de
visibilidade, puras), `src/store/scope.ts` (recorte aplicado ao estado inteiro),
`src/store/slices/partners.ts` (ações — especificação dos serviços),
`src/lib/domain/partnership.ts` (regra financeira).

### 13.1 Single Owner Architecture

- Existe **um** `OwnerOffice`. Ele tem visão global: clientes próprios e de parceiros,
  todos os processos, documentos, revisões, agentes, Skills, teses, financeiro,
  integrações, auditoria e configurações.
- `PartnerOffice` é uma entidade **dentro** do escritório proprietário: nome, razão social,
  CNPJ opcional, responsável + OAB/UF, contatos, endereço, `status`
  (`ACTIVE | INACTIVE | PENDING_INVITE | SUSPENDED`), `partnershipPercentage`,
  `ownerPercentage`, `activatedAt`, `notes` (internas) e `metadata`.
- Usuários de parceiro são `users` com `partner_office_id NOT NULL` e papel de parceiro.
  Parceiro inativo/suspenso não autentica. O primeiro aceite de convite ativa um parceiro
  `PENDING_INVITE`.

### 13.2 Partner Isolation (escopo por `partnerOfficeId`)

- **Todas** as consultas feitas por usuário de parceiro aplicam escopo por
  `partnerOfficeId`. O valor vem **da sessão/autorização server-side**. Nunca confiar em
  filtro, parâmetro ou id enviado pelo cliente (o protótipo não recebe `partnerOfficeId`
  em nenhuma ação do portal: `requirePartnerViewer` o lê da sessão).
- O que o parceiro recebe (espelhar `partner-scope.ts`):
  - processos com `relationship_origin = 'PARTNER' AND origin_partner_office_id = :pid`;
  - clientes com relacionamento `PARTNER` ativo para `:pid` — **sem** `notes`,
    `legalSummary` e histórico de inativação;
  - documentos `PARTNER_VISIBLE` enviados pelo próprio parceiro ou ligados a processos dele;
  - movimentações de origem tribunal/integração/sistema (notas internas e registros de
    agentes ficam de fora);
  - solicitações, submissões e notificações do próprio parceiro;
  - acordos financeiros do próprio parceiro **somente** para `PARTNER_ADMIN`;
  - auditoria: nunca. Apenas eventos com `partnerSummary` (texto seguro), sem `details`, e
    com autoria interna substituída pelo nome do escritório.
- O que o parceiro **nunca** recebe: clientes exclusivos da Bárbara, dados de outros
  parceiros, revisões (conteúdo, comentários, versões internas), agentes, Skills, teses,
  prompts, configurações de IA, consumo de tokens, financeiro global, contratos de
  honorários internos, integrações, auditoria interna e configurações administrativas.
- Revisão em andamento aparece ao parceiro só como sinal genérico ("Em revisão interna",
  `InternalReviewSignal`: processo, tipo e data — sem conteúdo nem autoria).
- Recurso fora do escopo acessado por URL responde **404** (não 403), para não confirmar
  existência. Rotas de áreas internas respondem 403.
- Recomendação: Row Level Security no PostgreSQL com a política derivada da sessão, além
  do filtro na camada de serviço; testes automatizados de isolamento parceiro × parceiro e
  parceiro × proprietário.

### 13.3 Canonical Client

- `Client` é a **identidade canônica** da pessoa/empresa. Chave de deduplicação: CPF (PF) e
  CNPJ (PJ), normalizados (só dígitos), com índice **único**.
- Nunca criar outra pessoa porque outro escritório cadastrou o mesmo CPF/CNPJ.
- `createdByOfficeId` registra quem criou o cadastro (auditoria). **Não** define a origem de
  processos futuros nem a divisão financeira.

### 13.4 ClientOfficeRelationship

- Tabela separada (`client_id`, `office_type` OWNER|PARTNER, `partner_office_id`, `status`,
  `created_at`, `created_by`). É ela que libera visibilidade: o registro canônico sozinho
  não dá acesso a nada.
- Um cliente canônico pode ter **vários** relacionamentos autorizados (ex.: Helena: OWNER +
  Ferreira & Lima).
- Novo vínculo com cliente existente dá acesso **apenas** ao que nasce do novo vínculo:
  o parceiro não ganha processos anteriores, observações, documentos privados, financeiro
  nem histórico interno.

### 13.5 Consulta de CPF/CNPJ sem vazamento

- Endpoint de verificação do parceiro responde apenas `NOT_FOUND`, `ALREADY_RELATED`
  (cliente já é dele) ou `EXISTS` + **token opaco, curto e assinado**, vinculado à sessão
  e ao parceiro. Nunca devolver nome, id interno, escritório que cadastrou, quantidade de
  processos, responsáveis, situação financeira ou histórico.
- O relacionamento só é criado quando o envio é **confirmado** (não na consulta).
- Registrar `CLIENT_DUPLICATE_DETECTED` na auditoria interna. Aplicar rate limit na
  consulta (evita enumeração de CPFs).

### 13.6 Process Origin

- Cada processo guarda **duas** origens distintas:
  - técnica: `origin` = `MANUAL | AGENT | INTEGRATION | IMPORT` ("Origem do cadastro processual");
  - relacional: `relationship_origin` = `INTERNAL | PARTNER` + `origin_partner_office_id`
    ("Origem do caso").
- Cliente e processo **não** compartilham automaticamente a mesma origem: um cliente próprio
  da Bárbara pode ter um novo processo originado pelo Parceiro A, e esse processo tem
  `origin_partner_office_id = A`.
- Processo criado pelo portal recebe a origem do parceiro **da sessão** — o usuário não
  escolhe escritório. A origem relacional não muda em edições comuns (`updateProcess` a
  ignora); alterá-la seria operação explícita e auditada.
- Processo cadastrado pelo parceiro aparece imediatamente para a equipe interna.

### 13.7 Financial Snapshot (regra crítica)

- A divisão do `PartnerOffice` é o padrão **vigente para NOVOS casos**.
- Quando o caso passa a ter acordo financeiro (no protótipo: na criação de processo de
  origem PARTNER), a divisão vigente é **copiada** para `ProcessPartnershipAgreement`
  (`partner_percentage`, `owner_percentage`, `effective_at`).
- Os percentuais do acordo são **imutáveis**, salvo alteração explícita e auditada no próprio
  acordo. Mudar o padrão do parceiro (ex.: 50/50 → 60/40) **não** recalcula casos antigos:
  casos existentes continuam 50/50; somente novos usam 60/40. Auditoria:
  `PARTNER_SHARE_CHANGED` com antes/depois e quantidade de acordos preservados.
- O financeiro da parceria pertence ao **processo/acordo**, não ao cliente.
- Soma das participações = 100%, validada no front **e** no servidor (`CHECK`).

### 13.8 Conceitos financeiros separados

| Conceito | Campo | Observação |
|---|---|---|
| Valor da causa | `process.case_value` | Dado jurídico. **Nunca** é dividido. |
| Resultado econômico estimado | `process.economic_estimate` | Estimativa (futuramente dos agentes). Interno. |
| Honorários estimados | `agreement.revenue_base` | Base da divisão. Sempre rotulado "estimado". |
| Honorários realizados | `agreement.realized_revenue` | Efetivamente recebido pelo escritório. |
| Participação | derivada | `partner_percentage` × base. |
| Repasses | `agreement.payouts[]` | Fatos append-only; não há transferência pelo sistema. |

Valores derivados (`estimatedPartnerAmount`, `realizedPartnerAmount`, `paidPartnerAmount`,
`pendingPartnerAmount`, status) são calculados por `lib/domain/partnership.ts`, nunca
gravados. Exemplo do protótipo: honorários R$ 4.000, 50/50 → R$ 2.000 / R$ 2.000; pago
R$ 1.000 → a receber R$ 1.000. Estimativas nunca são apresentadas como garantia
("Honorários estimados", nunca "Você receberá").

Visões: administrador interno vê tudo; `PARTNER_ADMIN` vê só a participação do próprio
escritório (sem custos internos, outros parceiros ou consumo de IA); `PARTNER_USER` não
recebe valores de parceria (valor da causa continua visível como dado jurídico).

### 13.9 Document Visibility

- `visibility` = `INTERNAL | PARTNER_VISIBLE`. Padrão: `INTERNAL`.
- Documentos internos **não são retornados** pela API ao parceiro (não basta a interface não
  mostrar).
- Material produzido por agentes ou advogados começa `INTERNAL`. Ao aprovar em Revisões uma
  minuta de caso de parceiro, o sistema guarda uma cópia congelada da versão aprovada
  (`approvedContent`, `sourceReviewId`) ainda `INTERNAL`. Ela só vira `PARTNER_VISIBLE` por
  ação explícita da equipe ("Disponibilizar ao parceiro"), com auditoria
  `DOCUMENT_SHARED_WITH_PARTNER` e notificação ao parceiro. Conteúdo não aprovado permanece
  interno.

### 13.10 Document Versioning

- Documento enviado oficialmente (`submittedAt`) **não** pode ser editado, substituído
  silenciosamente nem apagado pelo parceiro.
- Correção = **nova versão**: novo registro com o mesmo `version_group_id` e `version + 1`;
  a versão anterior recebe `superseded_at` e continua acessível (Contrato v1, v2…). Nada é
  sobrescrito. Auditoria `DOCUMENT_VERSION_ADDED`.
- No storage: objetos imutáveis (write-once) por versão.

### 13.11 Reviews

- Parceiro não acessa a área de Revisões nem nenhum endpoint dela.
- O único sinal é o status genérico "Em revisão interna" por processo. Conteúdo, comentários,
  sugestões da IA, instruções e versões internas nunca saem do servidor para o parceiro.
- Após aprovação humana, o documento pode ser disponibilizado (13.9) e aparece como
  "Documento aprovado" com visualização.

### 13.12 Casos enviados (PartnerCaseSubmission) e solicitações (PartnerRequest)

- Envio pelo portal: PF/PJ → CPF/CNPJ → verificação → cadastro básico → documentos →
  informações do caso → **Revisar envio** → Confirmar e enviar. Em uma transação: cliente
  (se novo) + relacionamentos + processo PARTNER + acordo (snapshot) + documentos + submissão
  + notificação interna + auditoria.
- Situações: `DRAFT → READY_TO_SUBMIT → SUBMITTED → UNDER_ANALYSIS → WAITING_DOCUMENTS →
  ACCEPTED → IN_PROGRESS → CLOSED`. No protótipo, DRAFT/READY_TO_SUBMIT existem apenas
  enquanto o assistente está aberto (não há rascunho persistido); o backend pode persistir
  rascunhos editáveis livremente até o envio. Depois de `SUBMITTED`, valem as regras de
  documentos (13.10); a equipe interna altera a situação e o parceiro é notificado.
- Edição de dados básicos do cliente pelo parceiro (contato, endereço) é permitida e
  auditada (`CLIENT_UPDATED` com os campos). Dados críticos (nome, CPF/CNPJ) podem exigir
  validação futura.
- `PartnerRequest`: tipos `DOCUMENT_REQUEST | INFORMATION_REQUEST | CORRECTION_REQUEST |
  GENERAL_REQUEST`; status `OPEN | ANSWERED | RESOLVED | CANCELLED`; cliente, processo,
  criado por, data, prazo recomendado e mensagens (append-only). Resposta com documento
  vincula o documento à mensagem.

### 13.13 Audit Trail (parcerias)

Registrar (append-only, mesmo commit): parceiro cadastrado/editado/situação alterada,
porcentagem modificada, usuário parceiro criado/alterado, cliente enviado, cliente
duplicado identificado, vínculo criado, processo parceiro criado, situação do caso,
documento enviado, nova versão, solicitação criada/respondida/encerrada, documento tornado
visível ao parceiro, valor financeiro atualizado e repasse registrado. Cada evento guarda
`partner_office_id`; `partner_summary` (opcional) é o único texto que o parceiro pode ver.

### 13.14 Regras obrigatórias para o backend (checklist)

1. Um cliente canônico pode possuir múltiplos relacionamentos autorizados.
2. Um parceiro não pode descobrir relacionamentos privados por consultas de CPF/CNPJ.
3. Processo possui origem de parceria própria (`origin_partner_office_id`).
4. Cliente e processo não compartilham automaticamente a mesma origem.
5. O financeiro da parceria pertence ao processo/acordo.
6. Percentuais históricos são imutáveis, salvo alteração explícita auditada.
7. Mudança da parceria padrão não altera casos antigos.
8. Documentos enviados são versionados; nunca sobrescritos.
9. Documentos internos não são retornados pela API ao parceiro.
10. Autorização e escopo acontecem **server-side**, a partir da sessão.
