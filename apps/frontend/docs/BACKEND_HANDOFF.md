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

- Acompanhamento processual: `src/services/legal-process-integration.ts`. O fornecedor
  não foi definido. A sincronização por OAB roda em job periódico e cria processos e
  movimentações com `origin = INTEGRATION`, deduplicando pelo número CNJ.
- E-mail e WhatsApp: envio só depois de aprovação em Revisões, com registro do envio.
- Armazenamento externo: opcional, via o mesmo serviço de storage.

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
  intervenção de agente, falha de integração, tarefa atrasada), com severidade
  `info | warning | urgent | critical` e permissão exigida.
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
