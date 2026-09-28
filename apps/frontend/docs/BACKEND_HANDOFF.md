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

## 2. Multi-tenancy

- Todos os tipos já têm `officeId`. No backend, o `officeId` vem **da sessão**, nunca do cliente.
- Segregação no banco: `office_id` em todas as tabelas, com Row Level Security ou filtro
  obrigatório na camada de acesso. Testes automatizados de isolamento entre escritórios.
- Fluxo: criar escritório → primeiro usuário Administrador → onboarding → convites.

## 3. RBAC no servidor

- Replicar `ROLE_PERMISSIONS` (`src/lib/permissions`) no backend e aplicá-la em **todo**
  endpoint.
- Dados financeiros (honorários, pagamentos, contratos) nunca podem sair do servidor para
  quem não tem `finance.view`. Não basta a interface não mostrar.
- Futuro: permissões configuráveis por escritório (a matriz já está centralizada para isso).

## 4. PostgreSQL

Entidades mapeadas em `src/types`: Office, User, Invitation, Client (PF/PJ),
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
