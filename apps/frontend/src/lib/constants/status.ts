/**
 * Status centralizados do domínio.
 *
 * Regra: nenhum componente compara ou exibe string de status solta.
 * Os valores (em inglês, estáveis) ficam aqui; os textos em português ficam
 * nos mapas *_LABEL; o tom visual fica nos mapas *_TONE.
 * Trocar um rótulo é mudar uma linha deste arquivo.
 */

export type Tone = "neutral" | "navy" | "gold" | "info" | "success" | "warning" | "orange" | "danger";

/* ------------------------------------------------------------------ */
/* Clientes                                                            */
/* ------------------------------------------------------------------ */

export const CLIENT_KINDS = ["INDIVIDUAL", "COMPANY"] as const;
export type ClientKind = (typeof CLIENT_KINDS)[number];
export const CLIENT_KIND_LABEL: Record<ClientKind, string> = {
  INDIVIDUAL: "Pessoa Física",
  COMPANY: "Pessoa Jurídica",
};
export const CLIENT_KIND_SHORT: Record<ClientKind, string> = {
  INDIVIDUAL: "PF",
  COMPANY: "PJ",
};

export const CLIENT_STATUSES = ["NEW", "ACTIVE", "WAITING_DOCUMENTS", "INACTIVE"] as const;
export type ClientStatus = (typeof CLIENT_STATUSES)[number];
export const CLIENT_STATUS_LABEL: Record<ClientStatus, string> = {
  NEW: "Novo",
  ACTIVE: "Ativo",
  WAITING_DOCUMENTS: "Aguardando documentos",
  INACTIVE: "Inativo",
};
export const CLIENT_STATUS_TONE: Record<ClientStatus, Tone> = {
  NEW: "info",
  ACTIVE: "success",
  WAITING_DOCUMENTS: "warning",
  INACTIVE: "neutral",
};

/* ------------------------------------------------------------------ */
/* Documentos                                                          */
/* ------------------------------------------------------------------ */

export const DOCUMENT_STATUSES = ["RECEIVED", "PENDING", "MISSING", "NEEDS_UPDATE", "REJECTED"] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];
export const DOCUMENT_STATUS_LABEL: Record<DocumentStatus, string> = {
  RECEIVED: "Recebido",
  PENDING: "Pendente de verificação",
  MISSING: "Ausente",
  NEEDS_UPDATE: "Precisa atualização",
  REJECTED: "Rejeitado",
};
export const DOCUMENT_STATUS_TONE: Record<DocumentStatus, Tone> = {
  RECEIVED: "success",
  PENDING: "info",
  MISSING: "danger",
  NEEDS_UPDATE: "warning",
  REJECTED: "danger",
};

export const DOCUMENT_VERIFICATIONS = ["VERIFIED", "UNVERIFIED", "FAILED"] as const;
export type DocumentVerification = (typeof DOCUMENT_VERIFICATIONS)[number];
export const DOCUMENT_VERIFICATION_LABEL: Record<DocumentVerification, string> = {
  VERIFIED: "Verificado",
  UNVERIFIED: "Não verificado",
  FAILED: "Divergência encontrada",
};

export const DOCUMENT_CATEGORIES = [
  "IDENTIFICATION",
  "ADDRESS_PROOF",
  "INCOME_PROOF",
  "BANK_STATEMENT",
  "LOAN_CONTRACT",
  "BENEFIT_STATEMENT",
  "POWER_OF_ATTORNEY",
  "HARDSHIP_DECLARATION",
  "CORPORATE_DOCUMENTS",
  "PETITION",
  "COURT_DECISION",
  "OTHER",
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];
export const DOCUMENT_CATEGORY_LABEL: Record<DocumentCategory, string> = {
  IDENTIFICATION: "Documento de identificação",
  ADDRESS_PROOF: "Comprovante de residência",
  INCOME_PROOF: "Comprovante de renda",
  BANK_STATEMENT: "Extrato bancário",
  LOAN_CONTRACT: "Contrato bancário",
  BENEFIT_STATEMENT: "Extrato de benefício",
  POWER_OF_ATTORNEY: "Procuração",
  HARDSHIP_DECLARATION: "Declaração de hipossuficiência",
  CORPORATE_DOCUMENTS: "Documentos societários",
  PETITION: "Peça processual",
  COURT_DECISION: "Decisão judicial",
  OTHER: "Outro",
};

/* ------------------------------------------------------------------ */
/* Análise jurídica                                                    */
/* ------------------------------------------------------------------ */

export const ANALYSIS_STATUSES = [
  "NOT_STARTED",
  "WAITING_DOCUMENTS",
  "READY",
  "ANALYZING",
  "WAITING_REVIEW",
  "COMPLETED",
  "INTERRUPTED",
] as const;
export type AnalysisStatus = (typeof ANALYSIS_STATUSES)[number];
export const ANALYSIS_STATUS_LABEL: Record<AnalysisStatus, string> = {
  NOT_STARTED: "Não iniciada",
  WAITING_DOCUMENTS: "Aguardando documentos",
  READY: "Pronta para análise",
  ANALYZING: "Em análise",
  WAITING_REVIEW: "Aguardando revisão humana",
  COMPLETED: "Concluída",
  INTERRUPTED: "Interrompida",
};
export const ANALYSIS_STATUS_TONE: Record<AnalysisStatus, Tone> = {
  NOT_STARTED: "neutral",
  WAITING_DOCUMENTS: "warning",
  READY: "info",
  ANALYZING: "navy",
  WAITING_REVIEW: "gold",
  COMPLETED: "success",
  INTERRUPTED: "danger",
};

/* ------------------------------------------------------------------ */
/* Processos                                                           */
/* ------------------------------------------------------------------ */

export const PROCESS_STATUSES = [
  "PRE_FILING",
  "PREPARING",
  "FILED",
  "ACTIVE",
  "WAITING_CLIENT",
  "WAITING_DEADLINE",
  "SUSPENDED",
  "CLOSED",
] as const;
export type ProcessStatus = (typeof PROCESS_STATUSES)[number];
export const PROCESS_STATUS_LABEL: Record<ProcessStatus, string> = {
  PRE_FILING: "Pré-ajuizamento",
  PREPARING: "Em preparação",
  FILED: "Distribuído",
  ACTIVE: "Em andamento",
  WAITING_CLIENT: "Aguardando cliente",
  WAITING_DEADLINE: "Aguardando prazo",
  SUSPENDED: "Suspenso",
  CLOSED: "Encerrado",
};
export const PROCESS_STATUS_TONE: Record<ProcessStatus, Tone> = {
  PRE_FILING: "neutral",
  PREPARING: "info",
  FILED: "navy",
  ACTIVE: "success",
  WAITING_CLIENT: "warning",
  WAITING_DEADLINE: "gold",
  SUSPENDED: "orange",
  CLOSED: "neutral",
};

export const PROCESS_PHASES = [
  "PRELIMINARY",
  "PLEADINGS",
  "EVIDENCE",
  "JUDGMENT",
  "APPEAL",
  "ENFORCEMENT",
  "ARCHIVED",
] as const;
export type ProcessPhase = (typeof PROCESS_PHASES)[number];
export const PROCESS_PHASE_LABEL: Record<ProcessPhase, string> = {
  PRELIMINARY: "Pré-processual",
  PLEADINGS: "Postulatória",
  EVIDENCE: "Instrutória",
  JUDGMENT: "Decisória",
  APPEAL: "Recursal",
  ENFORCEMENT: "Cumprimento de sentença",
  ARCHIVED: "Arquivado",
};

export const PROCESS_ORIGINS = ["AGENT", "INTEGRATION", "MANUAL", "IMPORT"] as const;
export type ProcessOrigin = (typeof PROCESS_ORIGINS)[number];
export const PROCESS_ORIGIN_LABEL: Record<ProcessOrigin, string> = {
  AGENT: "DG Brasil",
  INTEGRATION: "Integração",
  MANUAL: "Manual",
  IMPORT: "Importação",
};
export const PROCESS_ORIGIN_DESCRIPTION: Record<ProcessOrigin, string> = {
  AGENT: "Criado a partir de uma análise conduzida pelos agentes do DG Brasil",
  INTEGRATION: "Importado de uma fonte da Integração Judicial",
  MANUAL: "Cadastrado manualmente pela equipe",
  IMPORT: "Criado pela importação de planilha (Excel/CSV)",
};

/**
 * Vínculo do processo com o cliente. Cliente e processo têm ciclos de vida
 * independentes: remover o cliente não remove o processo, que passa a
 * exigir revisão do vínculo.
 */
export const CLIENT_LINK_STATUSES = ["LINKED", "PENDING_LINK"] as const;
export type ClientLinkStatus = (typeof CLIENT_LINK_STATUSES)[number];
export const CLIENT_LINK_STATUS_LABEL: Record<ClientLinkStatus, string> = {
  LINKED: "Vinculado",
  PENDING_LINK: "Vínculo pendente",
};

export const CLIENT_POLES = ["ACTIVE", "PASSIVE", "THIRD_PARTY"] as const;
export type ClientPole = (typeof CLIENT_POLES)[number];
export const CLIENT_POLE_LABEL: Record<ClientPole, string> = {
  ACTIVE: "Polo ativo (autor)",
  PASSIVE: "Polo passivo (réu)",
  THIRD_PARTY: "Terceiro interessado",
};

/** Origem da movimentação (vocabulário canônico do banco de dados). */
export const PROCESS_EVENT_SOURCES = ["MANUAL", "JUDICIAL_INTEGRATION", "IMPORT", "AGENT", "SYSTEM"] as const;
export type ProcessEventSource = (typeof PROCESS_EVENT_SOURCES)[number];
export const PROCESS_EVENT_SOURCE_LABEL: Record<ProcessEventSource, string> = {
  MANUAL: "Equipe",
  JUDICIAL_INTEGRATION: "Integração Judicial",
  IMPORT: "Importação",
  AGENT: "DG Brasil",
  SYSTEM: "Sistema",
};

/* ------------------------------------------------------------------ */
/* Prazos                                                              */
/* ------------------------------------------------------------------ */

export const DEADLINE_TYPES = [
  "MANIFESTATION",
  "REPLY",
  "APPEAL",
  "HEARING",
  "DOCUMENT_DELIVERY",
  "FILING",
  "INTERNAL",
] as const;
export type DeadlineType = (typeof DEADLINE_TYPES)[number];
export const DEADLINE_TYPE_LABEL: Record<DeadlineType, string> = {
  MANIFESTATION: "Manifestação",
  REPLY: "Réplica",
  APPEAL: "Recurso",
  HEARING: "Audiência",
  DOCUMENT_DELIVERY: "Entrega de documentos",
  FILING: "Protocolo",
  INTERNAL: "Prazo interno",
};

/**
 * Status do prazo (vocabulário canônico do banco de dados).
 * "Vencido" NÃO é status: é derivado da data na UI (ver DeadlineUrgency).
 */
export const DEADLINE_STATUSES = ["OPEN", "COMPLETED", "CANCELLED", "MISSED"] as const;
export type DeadlineStatus = (typeof DEADLINE_STATUSES)[number];
export const DEADLINE_STATUS_LABEL: Record<DeadlineStatus, string> = {
  OPEN: "Em aberto",
  COMPLETED: "Cumprido",
  CANCELLED: "Cancelado",
  MISSED: "Perdido",
};
export const DEADLINE_STATUS_TONE: Record<DeadlineStatus, Tone> = {
  OPEN: "info",
  COMPLETED: "success",
  CANCELLED: "neutral",
  MISSED: "danger",
};

/** Urgência calculada a partir da data de vencimento (ver lib/formatting/deadlines). */
export const DEADLINE_URGENCIES = ["OVERDUE", "TODAY", "TOMORROW", "SOON", "LATER"] as const;
export type DeadlineUrgency = (typeof DEADLINE_URGENCIES)[number];
export const DEADLINE_URGENCY_LABEL: Record<DeadlineUrgency, string> = {
  OVERDUE: "Vencido",
  TODAY: "Vence hoje",
  TOMORROW: "Vence amanhã",
  SOON: "Próximos dias",
  LATER: "No prazo",
};
export const DEADLINE_URGENCY_TONE: Record<DeadlineUrgency, Tone> = {
  OVERDUE: "danger",
  TODAY: "danger",
  TOMORROW: "orange",
  SOON: "warning",
  LATER: "neutral",
};

/* ------------------------------------------------------------------ */
/* Revisões                                                            */
/* ------------------------------------------------------------------ */

export const REVIEW_STATUSES = ["PENDING", "URGENT", "REOPENED", "CHANGES_REQUESTED", "APPROVED", "REJECTED"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];
export const REVIEW_STATUS_LABEL: Record<ReviewStatus, string> = {
  PENDING: "Pendente",
  URGENT: "Urgente",
  REOPENED: "Reaberta",
  CHANGES_REQUESTED: "Alterações solicitadas",
  APPROVED: "Aprovada",
  REJECTED: "Rejeitada",
};
export const REVIEW_STATUS_TONE: Record<ReviewStatus, Tone> = {
  PENDING: "gold",
  URGENT: "danger",
  REOPENED: "info",
  CHANGES_REQUESTED: "orange",
  APPROVED: "success",
  REJECTED: "neutral",
};
/** Revisões que ainda aguardam decisão humana (a reaberta volta a aguardar). */
export const OPEN_REVIEW_STATUSES: readonly ReviewStatus[] = ["PENDING", "URGENT", "REOPENED"];

/** Origem de cada versão do conteúdo de uma revisão. */
export const REVIEW_CONTENT_ORIGINS = ["AGENT", "AGENT_EDIT", "MANUAL_EDIT"] as const;
export type ReviewContentOrigin = (typeof REVIEW_CONTENT_ORIGINS)[number];
export const REVIEW_CONTENT_ORIGIN_LABEL: Record<ReviewContentOrigin, string> = {
  AGENT: "Gerada pelo agente",
  AGENT_EDIT: "Alterada pelo agente a pedido",
  MANUAL_EDIT: "Editada manualmente",
};

export const REVIEW_TYPES = [
  "ANALYSIS_RESULT",
  "PETITION_DRAFT",
  "DOCUMENT_CHECK",
  "DEADLINE_PROPOSAL",
  "CLIENT_MESSAGE",
  "PROCESS_UPDATE",
] as const;
export type ReviewType = (typeof REVIEW_TYPES)[number];
export const REVIEW_TYPE_LABEL: Record<ReviewType, string> = {
  ANALYSIS_RESULT: "Resultado de análise",
  PETITION_DRAFT: "Minuta de petição",
  DOCUMENT_CHECK: "Conferência documental",
  DEADLINE_PROPOSAL: "Proposta de prazo",
  CLIENT_MESSAGE: "Mensagem ao cliente",
  PROCESS_UPDATE: "Atualização processual",
};

export const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_LABEL: Record<Priority, string> = {
  LOW: "Baixa",
  NORMAL: "Normal",
  HIGH: "Alta",
  URGENT: "Urgente",
};
export const PRIORITY_TONE: Record<Priority, Tone> = {
  LOW: "neutral",
  NORMAL: "info",
  HIGH: "orange",
  URGENT: "danger",
};
export const PRIORITY_WEIGHT: Record<Priority, number> = { LOW: 0, NORMAL: 1, HIGH: 2, URGENT: 3 };

export const REVIEW_DECISIONS = ["APPROVED", "CHANGES_REQUESTED", "REJECTED"] as const;
export type ReviewDecisionKind = (typeof REVIEW_DECISIONS)[number];
export const REVIEW_DECISION_LABEL: Record<ReviewDecisionKind, string> = {
  APPROVED: "Aprovada",
  CHANGES_REQUESTED: "Alterações solicitadas",
  REJECTED: "Rejeitada",
};

/* ------------------------------------------------------------------ */
/* DG Brasil — agentes, Skills, teses                                  */
/* ------------------------------------------------------------------ */

export const AGENT_STATUSES = ["ACTIVE", "PAUSED", "DRAFT"] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];
export const AGENT_STATUS_LABEL: Record<AgentStatus, string> = {
  ACTIVE: "Ativo",
  PAUSED: "Pausado",
  DRAFT: "Em configuração",
};
export const AGENT_STATUS_TONE: Record<AgentStatus, Tone> = {
  ACTIVE: "success",
  PAUSED: "warning",
  DRAFT: "neutral",
};

/**
 * Autonomia do agente. "IA executa. Humano decide.": no V1 não existe
 * aprovação automática — todo material passa por revisão humana.
 */
export const AGENT_AUTONOMY_LEVELS = ["SUGGEST_ONLY", "REVIEW_REQUIRED"] as const;
export type AgentAutonomy = (typeof AGENT_AUTONOMY_LEVELS)[number];
export const AGENT_AUTONOMY_LABEL: Record<AgentAutonomy, string> = {
  SUGGEST_ONLY: "Apenas sugere",
  REVIEW_REQUIRED: "Executa com revisão humana",
};
export const AGENT_AUTONOMY_DESCRIPTION: Record<AgentAutonomy, string> = {
  SUGGEST_ONLY: "O agente apresenta recomendações; nenhuma tarefa é executada sem pedido explícito.",
  REVIEW_REQUIRED: "O agente produz o material e o envia para Revisões. Nada segue sem aprovação.",
};

export const AGENT_TASK_STATUSES = ["COMPLETED", "RUNNING", "WAITING_REVIEW", "BLOCKED", "FAILED"] as const;
export type AgentTaskStatus = (typeof AGENT_TASK_STATUSES)[number];
export const AGENT_TASK_STATUS_LABEL: Record<AgentTaskStatus, string> = {
  COMPLETED: "Concluída",
  RUNNING: "Em execução",
  WAITING_REVIEW: "Aguardando revisão",
  BLOCKED: "Bloqueada",
  FAILED: "Falhou",
};
export const AGENT_TASK_STATUS_TONE: Record<AgentTaskStatus, Tone> = {
  COMPLETED: "success",
  RUNNING: "navy",
  WAITING_REVIEW: "gold",
  BLOCKED: "warning",
  FAILED: "danger",
};

export const SKILL_STATUSES = ["ACTIVE", "DRAFT", "DEPRECATED"] as const;
export type SkillStatus = (typeof SKILL_STATUSES)[number];
export const SKILL_STATUS_LABEL: Record<SkillStatus, string> = {
  ACTIVE: "Ativa",
  DRAFT: "Rascunho",
  DEPRECATED: "Descontinuada",
};
export const SKILL_STATUS_TONE: Record<SkillStatus, Tone> = {
  ACTIVE: "success",
  DRAFT: "neutral",
  DEPRECATED: "warning",
};

export const THESIS_STATUSES = ["ACTIVE", "IN_REVIEW", "DRAFT", "ARCHIVED"] as const;
export type ThesisStatus = (typeof THESIS_STATUSES)[number];
export const THESIS_STATUS_LABEL: Record<ThesisStatus, string> = {
  ACTIVE: "Vigente",
  IN_REVIEW: "Em revisão",
  DRAFT: "Rascunho",
  ARCHIVED: "Arquivada",
};
export const THESIS_STATUS_TONE: Record<ThesisStatus, Tone> = {
  ACTIVE: "success",
  IN_REVIEW: "gold",
  DRAFT: "neutral",
  ARCHIVED: "neutral",
};

export const CHANGE_ENTITY_TYPES = ["SKILL", "AGENT", "THESIS", "RULE"] as const;
export type ChangeEntityType = (typeof CHANGE_ENTITY_TYPES)[number];
export const CHANGE_ENTITY_LABEL: Record<ChangeEntityType, string> = {
  SKILL: "Skill",
  AGENT: "Agente",
  THESIS: "Tese",
  RULE: "Regra",
};

export const CHANGE_STATUSES = ["APPLIED", "PROPOSED", "CANCELLED", "REVERTED"] as const;
export type ChangeStatus = (typeof CHANGE_STATUSES)[number];
export const CHANGE_STATUS_LABEL: Record<ChangeStatus, string> = {
  APPLIED: "Aplicada",
  PROPOSED: "Proposta",
  CANCELLED: "Cancelada",
  REVERTED: "Revertida",
};
export const CHANGE_STATUS_TONE: Record<ChangeStatus, Tone> = {
  APPLIED: "success",
  PROPOSED: "gold",
  CANCELLED: "neutral",
  REVERTED: "orange",
};

/* ------------------------------------------------------------------ */
/* Notificações                                                        */
/* ------------------------------------------------------------------ */

export const NOTIFICATION_SEVERITIES = ["info", "warning", "urgent", "critical"] as const;
export type NotificationSeverity = (typeof NOTIFICATION_SEVERITIES)[number];
export const NOTIFICATION_SEVERITY_LABEL: Record<NotificationSeverity, string> = {
  info: "Informativo",
  warning: "Atenção",
  urgent: "Urgente",
  critical: "Crítico",
};
export const NOTIFICATION_SEVERITY_TONE: Record<NotificationSeverity, Tone> = {
  info: "info",
  warning: "warning",
  urgent: "orange",
  critical: "danger",
};
export const SEVERITY_WEIGHT: Record<NotificationSeverity, number> = { info: 0, warning: 1, urgent: 2, critical: 3 };

export const NOTIFICATION_TYPES = [
  "DEADLINE",
  "REVIEW_WAITING",
  "DOCUMENT_MISSING",
  "PROCESS_MOVEMENT",
  "AGENT_INTERVENTION",
  "INTEGRATION_ISSUE",
  "TASK_OVERDUE",
  "DATA_INTEGRITY",
  "CASE_SUBMITTED",
  "CASE_DOCUMENTS_PENDING",
  "CASE_READY_FOR_ANALYSIS",
  "CASE_WAITING_REVIEW",
  "CASE_ACCEPTED",
  "CASE_REJECTED",
  "CASE_LAWYER_REQUIRED",
  "CASE_UPDATE",
  "PARTNER_REQUEST",
  "DOCUMENT_APPROVED",
  "PAYOUT_UPDATE",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
export const NOTIFICATION_TYPE_LABEL: Record<NotificationType, string> = {
  DEADLINE: "Prazo",
  REVIEW_WAITING: "Revisão aguardando",
  DOCUMENT_MISSING: "Documento ausente",
  PROCESS_MOVEMENT: "Movimentação processual",
  AGENT_INTERVENTION: "Agente solicita intervenção",
  INTEGRATION_ISSUE: "Integração",
  TASK_OVERDUE: "Tarefa atrasada",
  DATA_INTEGRITY: "Integridade de dados",
  CASE_SUBMITTED: "Novo caso enviado",
  CASE_DOCUMENTS_PENDING: "Documentos pendentes",
  CASE_READY_FOR_ANALYSIS: "Caso pronto para análise",
  CASE_WAITING_REVIEW: "Caso aguardando revisão",
  CASE_ACCEPTED: "Caso aceito",
  CASE_REJECTED: "Caso não aceito",
  CASE_LAWYER_REQUIRED: "Advogado responsável necessário",
  CASE_UPDATE: "Atualização do caso",
  PARTNER_REQUEST: "Solicitação",
  DOCUMENT_APPROVED: "Documento aprovado",
  PAYOUT_UPDATE: "Repasse",
};

/* ------------------------------------------------------------------ */
/* Financeiro                                                          */
/* ------------------------------------------------------------------ */

export const BILLING_MOMENTS = ["ON_SIGNING", "MONTHLY", "ON_FILING", "ON_SUCCESS", "CUSTOM"] as const;
export type BillingMoment = (typeof BILLING_MOMENTS)[number];
export const BILLING_MOMENT_LABEL: Record<BillingMoment, string> = {
  ON_SIGNING: "Na assinatura do contrato",
  MONTHLY: "Mensalmente",
  ON_FILING: "No ajuizamento",
  ON_SUCCESS: "No êxito",
  CUSTOM: "Personalizado",
};

/** Status do contrato: derivado das parcelas (exceto CANCELLED, que é decisão manual). */
export const AGREEMENT_STATUSES = ["ACTIVE", "SETTLED", "OVERDUE", "CANCELLED"] as const;
export type AgreementStatus = (typeof AGREEMENT_STATUSES)[number];
export const AGREEMENT_STATUS_LABEL: Record<AgreementStatus, string> = {
  ACTIVE: "Em dia",
  SETTLED: "Quitado",
  OVERDUE: "Em atraso",
  CANCELLED: "Cancelado",
};
export const AGREEMENT_STATUS_TONE: Record<AgreementStatus, Tone> = {
  ACTIVE: "success",
  SETTLED: "navy",
  OVERDUE: "danger",
  CANCELLED: "neutral",
};

/**
 * Status de parcela. Nunca é gravado: é DERIVADO do valor pago, do valor
 * devido e do vencimento (ver lib/domain/finance.ts → paymentStatus).
 */
export const PAYMENT_STATUSES = ["PAID", "PARTIALLY_PAID", "PENDING", "OVERDUE"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  PAID: "Pago",
  PARTIALLY_PAID: "Parcialmente pago",
  PENDING: "A vencer",
  OVERDUE: "Em atraso",
};
export const PAYMENT_STATUS_TONE: Record<PaymentStatus, Tone> = {
  PAID: "success",
  PARTIALLY_PAID: "warning",
  PENDING: "info",
  OVERDUE: "danger",
};

/* ------------------------------------------------------------------ */
/* Integrações                                                         */
/* ------------------------------------------------------------------ */

/** Tipo de integração (vocabulário canônico do banco de dados). */
export const INTEGRATION_KINDS = ["AI_PROVIDER", "JUDICIAL", "STORAGE", "EMAIL", "WHATSAPP", "OTHER"] as const;
export type IntegrationKind = (typeof INTEGRATION_KINDS)[number];
export const INTEGRATION_KIND_LABEL: Record<IntegrationKind, string> = {
  AI_PROVIDER: "Conexão Claude",
  JUDICIAL: "Provedor de acompanhamento processual",
  STORAGE: "Armazenamento de documentos",
  EMAIL: "E-mail",
  WHATSAPP: "WhatsApp",
  OTHER: "Outra integração",
};

export const INTEGRATION_STATUSES = ["CONNECTED", "DISCONNECTED", "ERROR", "PENDING"] as const;
export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number];
export const INTEGRATION_STATUS_LABEL: Record<IntegrationStatus, string> = {
  CONNECTED: "Conectado",
  DISCONNECTED: "Desconectado",
  ERROR: "Com problema",
  PENDING: "Configuração pendente",
};
export const INTEGRATION_STATUS_TONE: Record<IntegrationStatus, Tone> = {
  CONNECTED: "success",
  DISCONNECTED: "neutral",
  ERROR: "danger",
  PENDING: "warning",
};

/* ------------------------------------------------------------------ */
/* Integração Judicial                                                 */
/* ------------------------------------------------------------------ */

/** Fontes de dados jurídicos externos. Nova fonte = novo valor aqui + provedor no registro. */
export const JUDICIAL_SOURCES = ["DJEN", "DATAJUD"] as const;
export type JudicialSource = (typeof JUDICIAL_SOURCES)[number];

export const JUDICIAL_CAPABILITIES = [
  "COMMUNICATIONS",
  "PUBLICATIONS",
  "INTIMATIONS",
  "DERIVED_DEADLINES",
  "PROCESS_METADATA",
  "MOVEMENTS",
  "COURT_BODY",
  "CLASS_SUBJECTS",
] as const;
export type JudicialCapability = (typeof JUDICIAL_CAPABILITIES)[number];
export const JUDICIAL_CAPABILITY_LABEL: Record<JudicialCapability, string> = {
  COMMUNICATIONS: "Comunicações processuais",
  PUBLICATIONS: "Publicações",
  INTIMATIONS: "Intimações",
  DERIVED_DEADLINES: "Prazos derivados (sugeridos para revisão)",
  PROCESS_METADATA: "Capa e metadados processuais",
  MOVEMENTS: "Movimentos processuais",
  COURT_BODY: "Tribunal e órgão julgador",
  CLASS_SUBJECTS: "Classe e assuntos",
};

/* ------------------------------------------------------------------ */
/* Importação de dados                                                 */
/* ------------------------------------------------------------------ */

export const IMPORT_ISSUE_SEVERITIES = ["ERROR", "WARNING"] as const;
export type ImportIssueSeverity = (typeof IMPORT_ISSUE_SEVERITIES)[number];

/** Ações possíveis para uma linha que conflita com registro já existente. */
export const IMPORT_CONFLICT_ACTIONS = ["UPDATE", "IGNORE", "CREATE_NEW"] as const;
export type ImportConflictAction = (typeof IMPORT_CONFLICT_ACTIONS)[number];
export const IMPORT_CONFLICT_ACTION_LABEL: Record<ImportConflictAction, string> = {
  UPDATE: "Atualizar o existente",
  IGNORE: "Ignorar esta linha",
  CREATE_NEW: "Criar novo registro",
};

/* ------------------------------------------------------------------ */
/* Usuários                                                            */
/* ------------------------------------------------------------------ */

export const USER_STATUSES = ["ACTIVE", "INVITED", "DISABLED"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];
export const USER_STATUS_LABEL: Record<UserStatus, string> = {
  ACTIVE: "Ativo",
  INVITED: "Convite enviado",
  DISABLED: "Desativado",
};
export const USER_STATUS_TONE: Record<UserStatus, Tone> = {
  ACTIVE: "success",
  INVITED: "gold",
  DISABLED: "neutral",
};

/* ------------------------------------------------------------------ */
/* Escritórios parceiros                                               */
/* ------------------------------------------------------------------ */

export const PARTNER_OFFICE_STATUSES = ["ACTIVE", "INACTIVE", "PENDING_INVITE", "SUSPENDED"] as const;
export type PartnerOfficeStatus = (typeof PARTNER_OFFICE_STATUSES)[number];
export const PARTNER_OFFICE_STATUS_LABEL: Record<PartnerOfficeStatus, string> = {
  ACTIVE: "Ativo",
  INACTIVE: "Inativo",
  PENDING_INVITE: "Convite pendente",
  SUSPENDED: "Suspenso",
};
export const PARTNER_OFFICE_STATUS_TONE: Record<PartnerOfficeStatus, Tone> = {
  ACTIVE: "success",
  INACTIVE: "neutral",
  PENDING_INVITE: "gold",
  SUSPENDED: "orange",
};

/**
 * Origem RELACIONAL do caso (de quem é o caso na operação). Não confundir
 * com PROCESS_ORIGINS, que é a origem TÉCNICA do cadastro (manual, integração…).
 */
export const RELATIONSHIP_ORIGINS = ["INTERNAL", "PARTNER"] as const;
export type RelationshipOrigin = (typeof RELATIONSHIP_ORIGINS)[number];
export const RELATIONSHIP_ORIGIN_LABEL: Record<RelationshipOrigin, string> = {
  INTERNAL: "Próprio",
  PARTNER: "Parceiro",
};

/** Filtro de origem usado nas listagens internas. */
export const ORIGIN_FILTERS = ["ALL", "INTERNAL", "PARTNER"] as const;
export type OriginFilter = (typeof ORIGIN_FILTERS)[number];
export const ORIGIN_FILTER_LABEL: Record<OriginFilter, string> = {
  ALL: "Todos",
  INTERNAL: "Próprio",
  PARTNER: "Parceiro",
};

/** Situação do relacionamento de um escritório com um cliente canônico. */
export const CLIENT_RELATIONSHIP_STATUSES = ["ACTIVE", "ENDED"] as const;
export type ClientRelationshipStatus = (typeof CLIENT_RELATIONSHIP_STATUSES)[number];

export const PARTNER_REQUEST_TYPES = ["DOCUMENT_REQUEST", "INFORMATION_REQUEST", "CORRECTION_REQUEST", "GENERAL_REQUEST"] as const;
export type PartnerRequestType = (typeof PARTNER_REQUEST_TYPES)[number];
export const PARTNER_REQUEST_TYPE_LABEL: Record<PartnerRequestType, string> = {
  DOCUMENT_REQUEST: "Documento solicitado",
  INFORMATION_REQUEST: "Informação solicitada",
  CORRECTION_REQUEST: "Correção solicitada",
  GENERAL_REQUEST: "Solicitação geral",
};

export const PARTNER_REQUEST_STATUSES = ["OPEN", "ANSWERED", "RESOLVED", "CANCELLED"] as const;
export type PartnerRequestStatus = (typeof PARTNER_REQUEST_STATUSES)[number];
export const PARTNER_REQUEST_STATUS_LABEL: Record<PartnerRequestStatus, string> = {
  OPEN: "Aberta",
  ANSWERED: "Respondida",
  RESOLVED: "Resolvida",
  CANCELLED: "Cancelada",
};
export const PARTNER_REQUEST_STATUS_TONE: Record<PartnerRequestStatus, Tone> = {
  OPEN: "warning",
  ANSWERED: "info",
  RESOLVED: "success",
  CANCELLED: "neutral",
};

/**
 * Visibilidade de documento. INTERNAL nunca é entregue ao parceiro;
 * PARTNER_VISIBLE fica disponível ao parceiro do caso.
 */
export const DOCUMENT_VISIBILITIES = ["INTERNAL", "PARTNER_VISIBLE"] as const;
export type DocumentVisibility = (typeof DOCUMENT_VISIBILITIES)[number];
export const DOCUMENT_VISIBILITY_LABEL: Record<DocumentVisibility, string> = {
  INTERNAL: "Interno",
  PARTNER_VISIBLE: "Compartilhado com o parceiro",
};

/** Situação financeira de um acordo de parceria. Derivada, nunca gravada. */
export const PARTNERSHIP_STATUSES = ["AWAITING_ESTIMATE", "ESTIMATED", "TO_RECEIVE", "SETTLED"] as const;
export type PartnershipStatus = (typeof PARTNERSHIP_STATUSES)[number];
export const PARTNERSHIP_STATUS_LABEL: Record<PartnershipStatus, string> = {
  AWAITING_ESTIMATE: "Aguardando estimativa",
  ESTIMATED: "Em andamento",
  TO_RECEIVE: "Repasse pendente",
  SETTLED: "Repassado",
};
export const PARTNERSHIP_STATUS_TONE: Record<PartnershipStatus, Tone> = {
  AWAITING_ESTIMATE: "neutral",
  ESTIMATED: "info",
  TO_RECEIVE: "gold",
  SETTLED: "success",
};

/* ------------------------------------------------------------------ */
/* Exportação de documentos                                            */
/* ------------------------------------------------------------------ */

export const EXPORT_FORMATS = ["PDF", "DOCX"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
export const EXPORT_FORMAT_LABEL: Record<ExportFormat, string> = { PDF: "PDF", DOCX: "DOCX" };

/** Situação de aprovação de uma versão de documento. */
export const VERSION_APPROVAL_STATUSES = ["PENDING", "APPROVED", "SUPERSEDED"] as const;
export type VersionApprovalStatus = (typeof VERSION_APPROVAL_STATUSES)[number];
export const VERSION_APPROVAL_STATUS_LABEL: Record<VersionApprovalStatus, string> = {
  PENDING: "Aguardando aprovação",
  APPROVED: "Aprovada",
  SUPERSEDED: "Substituída",
};

/** Marca obrigatória em qualquer exportação de versão não aprovada. */
export const DRAFT_WATERMARK = "RASCUNHO — NÃO APROVADO";

/* ------------------------------------------------------------------ */
/* Casos jurídicos                                                     */
/* ------------------------------------------------------------------ */

export const LEGAL_CASE_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "WAITING_DOCUMENTS",
  "READY_FOR_ANALYSIS",
  "ANALYZING",
  "WAITING_REVIEW",
  "ACCEPTED",
  "REJECTED",
  "IN_PROGRESS",
  "CLOSED",
  "ARCHIVED",
] as const;
export type LegalCaseStatus = (typeof LEGAL_CASE_STATUSES)[number];
export const LEGAL_CASE_STATUS_LABEL: Record<LegalCaseStatus, string> = {
  DRAFT: "Rascunho",
  SUBMITTED: "Enviado",
  WAITING_DOCUMENTS: "Aguardando documentos",
  READY_FOR_ANALYSIS: "Pronto para análise",
  ANALYZING: "Em análise",
  WAITING_REVIEW: "Aguardando revisão",
  ACCEPTED: "Aceito",
  REJECTED: "Rejeitado",
  IN_PROGRESS: "Em andamento",
  CLOSED: "Encerrado",
  ARCHIVED: "Arquivado",
};
export const LEGAL_CASE_STATUS_TONE: Record<LegalCaseStatus, Tone> = {
  DRAFT: "neutral",
  SUBMITTED: "gold",
  WAITING_DOCUMENTS: "warning",
  READY_FOR_ANALYSIS: "info",
  ANALYZING: "navy",
  WAITING_REVIEW: "gold",
  ACCEPTED: "success",
  REJECTED: "danger",
  IN_PROGRESS: "success",
  CLOSED: "neutral",
  ARCHIVED: "neutral",
};
/**
 * Como o parceiro vê a situação: os estados técnicos de análise viram
 * simplesmente "Em análise"; rejeitado vira "Não aceito".
 */
export const PARTNER_CASE_STATUS_LABEL: Record<LegalCaseStatus, string> = {
  DRAFT: "Rascunho",
  SUBMITTED: "Enviado",
  WAITING_DOCUMENTS: "Aguardando documentos",
  READY_FOR_ANALYSIS: "Em análise",
  ANALYZING: "Em análise",
  WAITING_REVIEW: "Em análise",
  ACCEPTED: "Aceito",
  REJECTED: "Não aceito",
  IN_PROGRESS: "Em andamento",
  CLOSED: "Concluído",
  ARCHIVED: "Arquivado",
};
/** Estados anteriores à decisão (aceite/rejeição). Origem pode ser corrigida por quem tem permissão. */
export const PRE_DECISION_CASE_STATUSES: readonly LegalCaseStatus[] = ["DRAFT", "SUBMITTED", "WAITING_DOCUMENTS", "READY_FOR_ANALYSIS", "ANALYZING", "WAITING_REVIEW"];
/** Estados em que o caso pode ser aceito ou rejeitado. */
export const DECIDABLE_CASE_STATUSES: readonly LegalCaseStatus[] = ["SUBMITTED", "WAITING_DOCUMENTS", "READY_FOR_ANALYSIS", "ANALYZING", "WAITING_REVIEW"];
/** Estados após o aceite (origem só muda por Administrador). */
export const ACCEPTED_CASE_STATUSES: readonly LegalCaseStatus[] = ["ACCEPTED", "IN_PROGRESS", "CLOSED", "ARCHIVED"];
/** Casos "ativos" para indicadores. */
export const ACTIVE_CASE_STATUSES: readonly LegalCaseStatus[] = ["SUBMITTED", "WAITING_DOCUMENTS", "READY_FOR_ANALYSIS", "ANALYZING", "WAITING_REVIEW", "ACCEPTED", "IN_PROGRESS"];
export const IN_ANALYSIS_CASE_STATUSES: readonly LegalCaseStatus[] = ["SUBMITTED", "WAITING_DOCUMENTS", "READY_FOR_ANALYSIS", "ANALYZING", "WAITING_REVIEW"];

/* ------------------------------------------------------------------ */
/* Referências (DG Brasil)                                             */
/* ------------------------------------------------------------------ */

export const REFERENCE_MATERIAL_TYPES = ["APPROVED_PETITION", "WRITING_EXAMPLE", "LEGAL_REFERENCE", "INTERNAL_GUIDELINE", "DOCTRINE", "OTHER"] as const;
export type ReferenceMaterialType = (typeof REFERENCE_MATERIAL_TYPES)[number];
export const REFERENCE_MATERIAL_TYPE_LABEL: Record<ReferenceMaterialType, string> = {
  APPROVED_PETITION: "Petição aprovada",
  WRITING_EXAMPLE: "Exemplo de redação",
  LEGAL_REFERENCE: "Referência jurídica",
  INTERNAL_GUIDELINE: "Orientação interna",
  DOCTRINE: "Material doutrinário",
  OTHER: "Outro",
};

export const REFERENCE_MATERIAL_STATUSES = ["ACTIVE", "DRAFT", "ARCHIVED"] as const;
export type ReferenceMaterialStatus = (typeof REFERENCE_MATERIAL_STATUSES)[number];
export const REFERENCE_MATERIAL_STATUS_LABEL: Record<ReferenceMaterialStatus, string> = {
  ACTIVE: "Em uso",
  DRAFT: "Rascunho",
  ARCHIVED: "Arquivada",
};
export const REFERENCE_MATERIAL_STATUS_TONE: Record<ReferenceMaterialStatus, Tone> = {
  ACTIVE: "success",
  DRAFT: "neutral",
  ARCHIVED: "neutral",
};
