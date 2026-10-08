/**
 * Adaptadores de vocabulário: front ↔ banco de dados (Database V1).
 *
 * O vocabulário do BANCO é o canônico. O front já usa os mesmos valores
 * sempre que possível; este arquivo cobre apenas os valores que, de propósito,
 * ainda diferem (rótulos de apresentação, estados derivados, convenções de caixa).
 *
 * Uso: base para a futura implementação de `repositories/api/*`. Funções puras
 * e mapas constantes, sem dependências de runtime. O contrato do banco está
 * documentado em `supabase/README.md`.
 */
import type {
  AgentStatus,
  AnalysisStatus,
  ClientStatus,
  DocumentVerification,
  NotificationSeverity,
  PartnerOfficeStatus,
  PartnerRequestType,
  PaymentStatus,
  ProcessStatus,
  ReviewDecisionKind,
  ReviewStatus,
  UserStatus,
} from "@/lib/constants/status";

/* ------------------------------------------------------------------ */
/* Vocabulário do banco (canônico)                                     */
/* ------------------------------------------------------------------ */

export type DbReviewDecision = "APPROVE" | "REQUEST_CHANGES" | "REJECT" | "REOPEN";
export type DbReviewStatus = "PENDING" | "CHANGES_REQUESTED" | "APPROVED" | "REJECTED" | "REOPENED";
export type DbReviewPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";
export type DbNotificationSeverity = "INFO" | "WARNING" | "URGENT" | "CRITICAL";
export type DbPartnerRequestType = "DOCUMENT" | "INFORMATION" | "CORRECTION" | "GENERAL";
export type DbOrganizationStatus = "ACTIVE" | "INACTIVE" | "PENDING" | "SUSPENDED";
export type DbAgentStatus = "ACTIVE" | "INACTIVE" | "DRAFT";
export type DbMembershipStatus = "INVITED" | "ACTIVE" | "SUSPENDED" | "REMOVED";
export type DbAnalysisStatus = "PENDING" | "WAITING_DOCUMENTS" | "QUEUED" | "RUNNING" | "WAITING_REVIEW" | "COMPLETED" | "FAILED" | "CANCELLED";
export type DbClientStatus = "ACTIVE" | "INACTIVE" | "ARCHIVED";
export type DbProcessStatus = ProcessStatus | "ARCHIVED";
export type DbPaymentStatus = "PENDING" | "PARTIAL" | "PAID" | "OVERDUE" | "CANCELLED";
export type DbDocumentVerification = "UNVERIFIED" | "VERIFIED" | "FAILED";

/** Inverte um mapa 1:1 (chaves e valores únicos). */
function invert<K extends string, V extends string>(map: Record<K, V>): Record<V, K> {
  return Object.fromEntries(Object.entries(map).map(([k, v]) => [v, k])) as Record<V, K>;
}

/* ------------------------------------------------------------------ */
/* Revisões                                                            */
/* ------------------------------------------------------------------ */

/** Decisão de revisão: front no particípio, banco no imperativo. REOPEN é tratado à parte (histórico REOPENED). */
export const REVIEW_DECISION_TO_DB: Record<ReviewDecisionKind, Exclude<DbReviewDecision, "REOPEN">> = {
  APPROVED: "APPROVE",
  CHANGES_REQUESTED: "REQUEST_CHANGES",
  REJECTED: "REJECT",
};
export const REVIEW_DECISION_FROM_DB: Record<Exclude<DbReviewDecision, "REOPEN">, ReviewDecisionKind> = invert(REVIEW_DECISION_TO_DB);

/** Decisão do banco → front. `REOPEN` devolve null: no front é um evento de histórico `REOPENED`, não uma decisão. */
export function reviewDecisionFromDb(decision: DbReviewDecision): ReviewDecisionKind | null {
  return decision === "REOPEN" ? null : REVIEW_DECISION_FROM_DB[decision];
}

/** Status da revisão (banco + prioridade) → front. URGENT é PRIORIDADE no banco, nunca status. */
export function reviewStatusFromDb(status: DbReviewStatus, priority: DbReviewPriority): ReviewStatus {
  return status === "PENDING" && priority === "URGENT" ? "URGENT" : status;
}

/** Status da revisão front → banco. URGENT vira PENDING + prioridade URGENT; os demais mantêm a prioridade atual. */
export function reviewStatusToDb(status: ReviewStatus, currentPriority: DbReviewPriority = "NORMAL"): { status: DbReviewStatus; priority: DbReviewPriority } {
  return status === "URGENT" ? { status: "PENDING", priority: "URGENT" } : { status, priority: currentPriority };
}

/* ------------------------------------------------------------------ */
/* Notificações                                                        */
/* ------------------------------------------------------------------ */

/** Severidade: front em minúsculas, banco em maiúsculas. */
export const NOTIFICATION_SEVERITY_TO_DB: Record<NotificationSeverity, DbNotificationSeverity> = {
  info: "INFO",
  warning: "WARNING",
  urgent: "URGENT",
  critical: "CRITICAL",
};
export const NOTIFICATION_SEVERITY_FROM_DB: Record<DbNotificationSeverity, NotificationSeverity> = invert(NOTIFICATION_SEVERITY_TO_DB);

/* ------------------------------------------------------------------ */
/* Parceiros                                                           */
/* ------------------------------------------------------------------ */

/** Tipo de solicitação ao parceiro: o banco não usa o sufixo `_REQUEST`. */
export const PARTNER_REQUEST_TYPE_TO_DB: Record<PartnerRequestType, DbPartnerRequestType> = {
  DOCUMENT_REQUEST: "DOCUMENT",
  INFORMATION_REQUEST: "INFORMATION",
  CORRECTION_REQUEST: "CORRECTION",
  GENERAL_REQUEST: "GENERAL",
};
export const PARTNER_REQUEST_TYPE_FROM_DB: Record<DbPartnerRequestType, PartnerRequestType> = invert(PARTNER_REQUEST_TYPE_TO_DB);

/** Status do escritório parceiro: `PENDING_INVITE` no front é `PENDING` na organização; os demais são iguais. */
export const PARTNER_OFFICE_STATUS_TO_DB: Record<PartnerOfficeStatus, DbOrganizationStatus> = {
  ACTIVE: "ACTIVE",
  INACTIVE: "INACTIVE",
  PENDING_INVITE: "PENDING",
  SUSPENDED: "SUSPENDED",
};
export const PARTNER_OFFICE_STATUS_FROM_DB: Record<DbOrganizationStatus, PartnerOfficeStatus> = invert(PARTNER_OFFICE_STATUS_TO_DB);

/* ------------------------------------------------------------------ */
/* Agentes e usuários                                                  */
/* ------------------------------------------------------------------ */

/** Status do agente: `PAUSED` no front é `INACTIVE` no banco. */
export const AGENT_STATUS_TO_DB: Record<AgentStatus, DbAgentStatus> = {
  ACTIVE: "ACTIVE",
  PAUSED: "INACTIVE",
  DRAFT: "DRAFT",
};
export const AGENT_STATUS_FROM_DB: Record<DbAgentStatus, AgentStatus> = invert(AGENT_STATUS_TO_DB);

/** Status do usuário = vínculo (membership) + perfil ativo. SUSPENDED/REMOVED ou perfil inativo → DISABLED. */
export function userStatusFromDb(membership: DbMembershipStatus, profileActive: boolean): UserStatus {
  if (!profileActive || membership === "SUSPENDED" || membership === "REMOVED") return "DISABLED";
  return membership;
}

/** Status do usuário front → vínculo no banco. DISABLED é gravado como SUSPENDED (reversível; REMOVED é ação explícita). */
export const USER_STATUS_TO_DB: Record<UserStatus, DbMembershipStatus> = {
  ACTIVE: "ACTIVE",
  INVITED: "INVITED",
  DISABLED: "SUSPENDED",
};

/* ------------------------------------------------------------------ */
/* Análise jurídica                                                    */
/* ------------------------------------------------------------------ */

/**
 * Status da análise banco → front. PENDING vira READY quando nenhum documento
 * obrigatório falta; senão NOT_STARTED. QUEUED/RUNNING → ANALYZING; FAILED/CANCELLED → INTERRUPTED.
 */
export function analysisStatusFromDb(status: DbAnalysisStatus, requiredDocumentsComplete: boolean): AnalysisStatus {
  switch (status) {
    case "PENDING":
      return requiredDocumentsComplete ? "READY" : "NOT_STARTED";
    case "QUEUED":
    case "RUNNING":
      return "ANALYZING";
    case "FAILED":
    case "CANCELLED":
      return "INTERRUPTED";
    default:
      return status;
  }
}

/** Status da análise front → banco. NOT_STARTED/READY → PENDING; ANALYZING → RUNNING; INTERRUPTED → FAILED. */
export const ANALYSIS_STATUS_TO_DB: Record<AnalysisStatus, DbAnalysisStatus> = {
  NOT_STARTED: "PENDING",
  WAITING_DOCUMENTS: "WAITING_DOCUMENTS",
  READY: "PENDING",
  ANALYZING: "RUNNING",
  WAITING_REVIEW: "WAITING_REVIEW",
  COMPLETED: "COMPLETED",
  INTERRUPTED: "FAILED",
};

/* ------------------------------------------------------------------ */
/* Clientes e processos                                                */
/* ------------------------------------------------------------------ */

/** Status do cliente front → banco. NEW e WAITING_DOCUMENTS são estados derivados de apresentação: gravam ACTIVE. */
export const CLIENT_STATUS_TO_DB: Record<ClientStatus, DbClientStatus> = {
  NEW: "ACTIVE",
  ACTIVE: "ACTIVE",
  WAITING_DOCUMENTS: "ACTIVE",
  INACTIVE: "INACTIVE",
};

/** Status do cliente banco → front (antes de derivar NEW/WAITING_DOCUMENTS). ARCHIVED aparece como INACTIVE. */
export const CLIENT_STATUS_FROM_DB: Record<DbClientStatus, ClientStatus> = {
  ACTIVE: "ACTIVE",
  INACTIVE: "INACTIVE",
  ARCHIVED: "INACTIVE",
};

/** Status do processo banco → front. O banco tem ARCHIVED a mais, exibido como CLOSED. */
export function processStatusFromDb(status: DbProcessStatus): ProcessStatus {
  return status === "ARCHIVED" ? "CLOSED" : status;
}

/* ------------------------------------------------------------------ */
/* Financeiro                                                          */
/* ------------------------------------------------------------------ */

/**
 * Status de pagamento (view `payment_balances`) → front. PARTIAL → PARTIALLY_PAID.
 * CANCELLED não tem equivalente no front (parcela cancelada não é exibida como
 * pendência): devolve null e quem chama decide omitir a parcela.
 */
export function paymentStatusFromDb(status: DbPaymentStatus): PaymentStatus | null {
  switch (status) {
    case "PARTIAL":
      return "PARTIALLY_PAID";
    case "CANCELLED":
      return null;
    default:
      return status;
  }
}

/* ------------------------------------------------------------------ */
/* Documentos                                                          */
/* ------------------------------------------------------------------ */

/**
 * Verificação do documento: valores idênticos (mapa identidade). No banco a
 * verificação pertence à VERSÃO do documento; a view expõe a da versão atual.
 */
export const DOCUMENT_VERIFICATION_FROM_DB: Record<DbDocumentVerification, DocumentVerification> = {
  UNVERIFIED: "UNVERIFIED",
  VERIFIED: "VERIFIED",
  FAILED: "FAILED",
};
export const DOCUMENT_VERIFICATION_TO_DB: Record<DocumentVerification, DbDocumentVerification> = invert(DOCUMENT_VERIFICATION_FROM_DB);
