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
- Não há "Criar escritório", implantação de tenant, plano SaaS nem assinatura (removidos do
  front-end). Escritórios parceiros entram por **Parceiros → Adicionar parceiro**.
- Domínios (mesmo app, mesmo deploy): `app.barbaracardoso.adv.br` (equipe interna) e
  `portal.barbaracardoso.adv.br` (parceiros). Configuráveis por `NEXT_PUBLIC_APP_HOST` /
  `NEXT_PUBLIC_PORTAL_HOST` (`src/lib/hosts.ts`). O host só ajusta textos do login; o acesso é
  decidido pelo papel na sessão, no servidor.

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
LegalCase, PartnerRequest, CasePartnershipAgreement (+ payouts), ReferenceMaterial,
LegalRepresentative, Partner, ClientDocument, AnalysisTemplate, LegalAnalysis
(+ steps/timeline), Process, ProcessEvent, Deadline, Review, ReviewDecision, Agent,
AgentTask, Skill, LegalThesis (+ versões), ChangeHistoryEntry, Notification, FeeModel,
FinancialAgreement (pertence ao caso: `legal_case_id`), Payment, Integration, AIUsage,
AuditEvent. `Process` (= `LegalProcess`) tem `legal_case_id NOT NULL`.

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

## 7. Conexão Claude

- Contrato: `src/services/ai-provider.ts` (`AIProviderService`).
- Cada escritório conecta a própria organização e arca com o próprio consumo.
- A credencial é enviada direto ao backend, guardada **criptografada** (KMS/secret manager)
  e **nunca** volta ao navegador. O front-end não pede, não guarda e não transmite API key.
- Uso apurado no backend e exposto ao front como leitura. A interface ("Configuração
  Claude") mostra apenas status, uso, **execuções** (por dia, agente e modelo) e limites;
  tokens e custo ficam no backend (`AIUsage.inputTokens/outputTokens/estimatedCostUsd`
  existem só como dado técnico) — não é cobrança por token.

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
- **Duas formas de editar, nunca misturadas** (menu "Editar ▾" na barra do documento):
  - **Editar manualmente**: o advogado altera o texto no editor; registra usuário, horário,
    seções alteradas e origem `MANUAL_EDIT`.
  - **Editar com agente**: o advogado dá uma instrução ("O que deseja alterar?"); o agente
    gera nova versão com origem `AGENT_EDIT`, guardando instrução, solicitante e horário.
    No protótipo a reescrita é simulada (a versão registra a instrução e mantém o texto);
    no backend é um job do worker do agente.
  - Em ambos: versão anterior preservada, nova versão **aguarda decisão** (nunca aprovada
    automaticamente). "Solicitar alterações" continua existindo como **decisão formal**
    (devolução no fluxo), distinta de "Editar com agente".
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

### 13.6 Origem do caso (substitui a origem relacional do processo)

- **Atualizado na rodada 3 (seção 15):** a origem relacional saiu do processo e passou para o
  **caso** (`legal_case.origin_office_id`). O processo guarda só a origem técnica
  (`origin` = `MANUAL | AGENT | INTEGRATION | IMPORT`) e `legal_case_id`.
- Cliente e caso **não** compartilham automaticamente a mesma origem: um cliente próprio da
  Bárbara pode ter um caso originado pelo Parceiro A.
- Processo cadastrado pelo parceiro só pode ser vinculado a caso do próprio parceiro e
  aparece imediatamente para a equipe interna.

### 13.7 Financial Snapshot (regra crítica)

- A divisão do `PartnerOffice` é o padrão **vigente para NOVOS casos**.
- No **aceite** do caso de origem parceiro, a divisão vigente é **copiada** para
  `CasePartnershipAgreement` (`legal_case_id`, `partner_percentage`, `owner_percentage`,
  `effective_at`).
- Os percentuais do acordo são **imutáveis**, salvo alteração explícita e auditada no próprio
  acordo. Mudar o padrão do parceiro (ex.: 50/50 → 60/40) **não** recalcula casos antigos:
  casos existentes continuam 50/50; somente novos usam 60/40. Auditoria:
  `PARTNER_SHARE_CHANGED` com antes/depois e quantidade de acordos preservados.
- O financeiro da parceria pertence ao **caso/acordo**, não ao cliente nem ao processo.
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
- O único sinal é o status genérico "Em revisão interna" (e a situação simplificada do caso,
  "Em análise"). Conteúdo, comentários,
  sugestões da IA, instruções e versões internas nunca saem do servidor para o parceiro.
- Após aprovação humana, o documento pode ser disponibilizado (13.9) e aparece como
  "Documento aprovado" com visualização.

### 13.12 Casos enviados pelo parceiro e solicitações (PartnerRequest)

- `PartnerCaseSubmission` **deixou de existir**: o envio cria diretamente um `LegalCase`
  (seção 15). Fluxo do portal: Cliente (CPF/CNPJ, duplicidade, cadastro básico) → Novo caso
  (com origem permitida) → documentos → revisar → **"Confirmar e enviar para Bárbara
  Cardoso Advocacia"** → `SUBMITTED`. Em uma transação: cliente (se novo) + relacionamento +
  caso + documentos (com `legal_case_id`) + notificação interna + auditoria. Nenhum
  processo nem acordo é criado no envio.
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
3. A origem de parceria é do **caso** (`legal_case.origin_office_id`).
4. Cliente e caso não compartilham automaticamente a mesma origem.
5. O financeiro da parceria pertence ao caso/acordo.
6. Percentuais históricos são imutáveis, salvo alteração explícita auditada.
7. Mudança da parceria padrão não altera casos antigos.
8. Documentos enviados são versionados; nunca sobrescritos.
9. Documentos internos não são retornados pela API ao parceiro.
10. Autorização e escopo acontecem **server-side**, a partir da sessão.

## 14. Rodada de refinamento: origem do cliente, versões e exportação

### 14.1 Origem do cliente (`Client.originOfficeId`)

- Todo cliente tem **origem obrigatória**: o escritório (proprietário ou parceiro) ao qual a
  entrada comercial foi atribuída **no cadastro**. Campo `origin_office_id NOT NULL`.
- Não confundir com: quem digitou (`created_by_office_id` + usuário na auditoria), origem
  técnica do processo, origem relacional do processo, nem parceiro financeiro de um caso.
- Opções atribuíveis (regra em `src/lib/permissions/client-origin.ts`,
  `getAllowedClientOrigins`), validadas **server-side** a partir da sessão:
  - equipe interna com permissão de cadastro: escritório proprietário ou qualquer parceiro ATIVO;
  - `PARTNER_ADMIN` / `PARTNER_USER`: **somente** o próprio `PartnerOffice` ou o `OwnerOffice`.
  - Nunca aceitar arbitrariamente um `officeId` enviado pelo navegador: rejeitar com 422/403.
- Padrão ao abrir o cadastro: o escritório do usuário (Bárbara para a equipe interna; o
  próprio parceiro para usuários de parceiro).
- **Deduplicação não sobrescreve a origem histórica.** Se o CPF/CNPJ já existe, o cliente
  canônico mantém `origin_office_id` original; o novo vínculo/processo segue com a própria
  origem de processo. Ex.: João foi cadastrado pela Bárbara; Almeida informa o CPF → origem
  do cliente continua "Bárbara Cardoso Advocacia"; o novo processo tem origem Almeida.
- Alteração posterior de origem é ação explícita, permitida a quem pode atribuir o novo
  valor, e sempre auditada (`CLIENT_ORIGIN_CHANGED`, antes/depois). A definição inicial gera
  `CLIENT_ORIGIN_SET`.
- Ao parceiro, a origem só é retornada quando é o próprio parceiro ou o escritório
  proprietário (nunca revelar outro parceiro).

### 14.2 Origem do caso continua independente do cliente

- `Client.originOfficeId` **não** determina a origem do caso. Cada caso tem origem própria,
  definida na criação. É ela que alimenta divisão de honorários, relatórios e auditoria.
- O filtro "Escritório parceiro" de Revisões usa **revisão → caso → origem do caso** (não o
  autor, o agente nem a origem do cliente). Revisão sem caso = interna.

### 14.3 Document, DocumentVersion, Review e Approval

```
Document (id, kind, client_id, process_id, title)
 └─ DocumentVersion (id, document_id, version_number, source, created_by, created_at,
                     content | storage_key, approval_status, instruction?)   -- append-only
Review (id, document_id, status, …)                 -- fila humana
Approval / ReviewDecision (id, review_id, document_version_id, decision, user_id, at, comment)
```

- `source`: `AGENT | AGENT_EDIT | MANUAL_EDIT` (futuro: `EXTERNAL_UPLOAD`).
- `approval_status` por versão: `PENDING | APPROVED | SUPERSEDED` (no protótipo, derivado em
  `src/lib/domain/review-versions.ts`; tipo `DocumentVersion` em `src/types/review.ts`).
- **A aprovação aponta para `document_version_id`, não só para `document_id`.** Nova versão
  (manual, pelo agente, ou após reabertura) exige nova aprovação. Ex.: v3 APROVADA → reabre e
  edita → v4 PENDENTE; a aprovação de v3 continua no histórico e não vale para v4.
- Nunca apagar nem sobrescrever versões. A UI permite visualizar versões anteriores
  (somente leitura) pelo seletor de versão.

### 14.4 Exportação / download (PDF e DOCX)

- Contrato: `src/services/document-export.ts` (`DocumentExportService`) e
  `ReviewRepository.exportVersion(reviewId, versionNumber, format)`.
- Protótipo: o arquivo é gerado **no navegador** só para demonstrar a experiência
  (`src/lib/export/*`). **Produto: gerar no backend.** Documentos sensíveis não devem ser
  montados no browser. O backend deve:
  1. validar autorização (inclusive escopo de parceiro);
  2. identificar a versão exata (`document_version_id`);
  3. gerar ou obter o arquivo (PDF/DOCX), com cache por versão;
  4. aplicar a marca **"RASCUNHO — NÃO APROVADO"** (cabeçalho e marca d'água) em toda
     versão não aprovada — decidido no servidor, nunca pela tela;
  5. registrar o download (`DOCUMENT_DRAFT_DOWNLOADED` / `DOCUMENT_APPROVED_DOWNLOADED`);
  6. devolver URL temporária assinada ou stream autorizado.
- UI: o botão fica na barra do documento (não junto às decisões). Versão não aprovada →
  "Baixar rascunho ▾"; versão aprovada → "Baixar versão aprovada ▾" (sem marca). Sempre
  baixa a versão exibida/aprovada específica.

### 14.5 DOCX e edição externa

- O DOCX existe para o advogado continuar editando no Word, revisar fora do sistema e usar
  em outros fluxos.
- Alterações feitas externamente **não** alteram a versão armazenada no DG Brasil.
- Futuro: "Enviar nova versão" (upload do DOCX editado) criaria `DocumentVersion` com
  `source = EXTERNAL_UPLOAD`, pendente de aprovação como qualquer versão nova. Não
  implementado nesta etapa.

### 14.6 Auditoria desta rodada

`CLIENT_ORIGIN_SET`, `CLIENT_ORIGIN_CHANGED`, `REVIEW_EDITED` (manual),
`REVIEW_AGENT_EDITED`, `REVIEW_VERSION_CREATED`, `REVIEW_APPROVED` (com a versão),
`DOCUMENT_DRAFT_DOWNLOADED`, `DOCUMENT_APPROVED_DOWNLOADED`. Visualizações não geram evento
nesta etapa.

### 14.7 Gênero

`IndividualClient.gender`: `MALE | FEMALE | OTHER`, opcional (ausente = "Não informado").
Rótulos em `src/lib/constants/legal.ts`.

## 15. Rodada final do front-end: Client → LegalCase → LegalProcess

### 15.1 Modelo

```
Client (canônico)
 └─ LegalCase (legal_case)         -- a demanda; existe antes (ou sem) processo
     ├─ origin_office_id            -- Bárbara ou parceiro (independe da origem do cliente)
     ├─ created_by_office_id, created_by
     ├─ assigned_lawyer_id NULL     -- obrigatório para aceitar
     ├─ status, submitted_at, accepted_at, accepted_by, rejected_at, closed_at, archived_at
     ├─ rejection_reason_public     -- visível ao parceiro
     ├─ rejection_reason_internal   -- NUNCA retornado ao parceiro
     ├─ Documents (legal_case_id)   -- documento pode pertencer a cliente, caso ou processo
     ├─ LegalAnalysis (legal_case_id)
     ├─ Review (legal_case_id, process_id opcional)
     ├─ LegalProcess (legal_case_id NOT NULL; 0..n por caso)
     ├─ FinancialAgreement (legal_case_id NOT NULL)
     └─ CasePartnershipAgreement (legal_case_id; criado no aceite; cancelled_at)
```

Tipos: `src/types/case.ts`, `src/types/process.ts`, `src/types/partner.ts`,
`src/types/reference.ts`. Regras: `src/store/slices/cases.ts`, `src/lib/domain/legal-case.ts`.

### 15.2 Status do caso

`DRAFT → SUBMITTED → WAITING_DOCUMENTS → READY_FOR_ANALYSIS → ANALYZING → WAITING_REVIEW →
ACCEPTED | REJECTED → IN_PROGRESS → CLOSED → ARCHIVED`.

- Os estados de análise são **derivados** da análise do caso (`syncCaseStatuses`).
- Aceitar/rejeitar: só em `SUBMITTED … WAITING_REVIEW`, com `cases.decide`.
- Parceiro vê rótulos simplificados (`PARTNER_CASE_STATUS_LABEL`): estados de análise →
  "Em análise"; `REJECTED` → "Não aceito"; `CLOSED` → "Concluído".

### 15.3 Regras definitivas (checklist do backend)

1. Todo processo pertence a um caso (`legal_case_id NOT NULL`); o cliente do processo é o do caso.
2. Um caso pode existir sem processo e ter vários processos.
3. Processo não pode ser vinculado a caso em rascunho, rejeitado ou arquivado.
4. A origem do caso é independente da origem do cliente; o mesmo cliente pode ter casos de
   origens diferentes.
5. Origens permitidas na criação (`getAllowedClientOrigins`, mesma regra do cliente):
   interno → Bárbara + parceiros ATIVOS (padrão Bárbara); parceiro → próprio escritório ou
   Bárbara (padrão o próprio). Validar no servidor; rejeitar qualquer outro valor.
6. Antes do aceite, a origem pode ser corrigida por quem tem a origem nas opções permitidas.
7. Depois do aceite, **somente Administrador** (`cases.origin.override`) altera a origem,
   com confirmação forte ("Alterar a origem de um caso aceito pode afetar regras financeiras
   e de parceria.") e auditoria antes/depois. O acordo de parceria vigente é encerrado
   (`cancelled_at`, nunca apagado) e, se a nova origem for parceiro, um novo snapshot é criado.
8. Aceitar exige advogado responsável: usuário interno ATIVO com papel `LAWYER`, ou `ADMIN`
   com OAB. Sem ele, o aceite é recusado ("Defina o advogado responsável antes de aceitar o caso.").
9. O acordo de parceria nasce **no aceite**, copiando a divisão vigente do parceiro
   (snapshot). Mudar a divisão padrão (ex.: 50/50 → 60/40) não altera casos já aceitos;
   novos aceites usam a nova divisão.
10. Rejeição exige `rejection_reason_public`; `rejection_reason_internal` é opcional e **nunca**
    sai do servidor para o parceiro (nem em notificações, auditoria visível ou exportações).
11. Contrato de honorários (`FinancialAgreement`) pertence ao caso e abrange todos os
    processos dele. A estimativa de êxito usa a soma do valor da causa dos processos do caso.
12. Revisões têm `legal_case_id` (+ `process_id` opcional). Filtro por parceiro = revisão →
    caso → origem.
13. Parceiro vê: casos com origem nele ou criados por ele; documentos `PARTNER_VISIBLE` ou
    enviados por ele; processos dos seus casos; financeiro só com `PARTNER_ADMIN`.
14. Cadastro de CPF/CNPJ duplicado: "Cliente já cadastrado no sistema." + "Criar novo caso
    para este cliente", sem revelar dados (13.5).
15. Importação (XLSX/CSV) cria um caso próprio por processo importado.
16. Exatamente 5 papéis: `ADMIN`, `LAWYER`, `ASSISTANT`, `PARTNER_ADMIN`, `PARTNER_USER`.

### 15.4 Notificações de caso

`CASE_SUBMITTED` (novo caso enviado), `CASE_DOCUMENTS_PENDING`, `CASE_READY_FOR_ANALYSIS`,
`CASE_WAITING_REVIEW`, `CASE_ACCEPTED`, `CASE_REJECTED` (ao parceiro só com o motivo
público), `CASE_LAWYER_REQUIRED` (caso aguardando decisão sem responsável).

### 15.5 Auditoria

`CASE_CREATED`, `CASE_SUBMITTED`, `CASE_UPDATED`, `CASE_STATUS_CHANGED`,
`CASE_ORIGIN_CHANGED` (antes/depois), `CASE_ACCEPTED`, `CASE_REJECTED`,
`CASE_REJECTION_PUBLIC`, `CASE_REJECTION_INTERNAL_NOTE` (só interno), `CASE_LAWYER_ASSIGNED`
(antes/depois), `PARTNERSHIP_SNAPSHOT_CREATED`, `REFERENCE_CREATED`.

### 15.6 Referências (DG Brasil)

- `/dg-brasil/referencias`, somente Administrador (`dgbrasil.manage`).
- `ReferenceMaterial`: título, categoria (`APPROVED_PETITION | WRITING_EXAMPLE |
  LEGAL_REFERENCE | INTERNAL_GUIDELINE | DOCTRINE | OTHER`), descrição, área, arquivo
  (protótipo: só metadados; backend: `storage_key`), tags e vínculos com Skills, Teses e
  Agentes. Sem embeddings/RAG nesta etapa: indexação e recuperação são decisão do backend.

### 15.7 Google Drive

"Exportar para Google Drive" aparece desabilitado no menu de download da **versão aprovada**
("Disponível após configuração do backend"). Não há sincronização. Backend: OAuth do
escritório, pasta por cliente/caso, exportar somente versões aprovadas, auditoria.

### 15.8 Convite e acesso

Convite → criar senha → aceitar documentos legais (Termos de Uso, Política de Privacidade/LGPD,
Termo de Confidencialidade; registrar versão e data) → configurar 2FA TOTP (placeholder na
interface) → acessar. Tudo real fica no backend (Supabase Auth ou equivalente).

### 15.9 Fora do escopo do front-end

Sem ADVBOX (importação genérica por planilha permanece), sem Asaas, sem cobrança SaaS.
Não implementados: Supabase/Postgres/RLS, autenticação real, TOTP, storage, worker de
agentes, chamadas ao Claude, APIs e geração de PDF no servidor.
