import { daysSince } from "@/lib/clock";
import { OPEN_REVIEW_STATUSES, PRIORITY_WEIGHT, type ReviewStatus, type ReviewType } from "@/lib/constants/status";
import type { ID, Process, Review, ReviewDecision } from "@/types";

export function isOpenReview(review: Pick<Review, "status">): boolean {
  return OPEN_REVIEW_STATUSES.includes(review.status);
}

/** Versão atual do conteúdo (revisões antigas, sem o campo, estão na v1). */
export function contentVersionOf(review: Pick<Review, "contentVersion">): number {
  return review.contentVersion ?? 1;
}

export function wasManuallyEdited(review: Pick<Review, "history">): boolean {
  return review.history?.some((h) => h.kind === "MANUAL_EDIT") ?? false;
}

/**
 * Aprovação vale apenas para a versão aprovada. Se a revisão foi reaberta e
 * editada depois, a aprovação anterior deixa de valer e é preciso aprovar de novo.
 */
export function approvalCoversCurrentVersion(review: Pick<Review, "status" | "contentVersion">, decisions: ReviewDecision[]): boolean {
  if (review.status !== "APPROVED") return false;
  const lastApproval = decisions.find((d) => d.decision === "APPROVED");
  return (lastApproval?.contentVersion ?? 1) === contentVersionOf(review);
}

/** Urgente primeiro, depois prioridade maior, depois a mais antiga (FIFO). */
export function compareReviewQueue(a: Review, b: Review): number {
  const ua = a.status === "URGENT" ? 1 : 0;
  const ub = b.status === "URGENT" ? 1 : 0;
  if (ua !== ub) return ub - ua;
  const pa = PRIORITY_WEIGHT[a.priority];
  const pb = PRIORITY_WEIGHT[b.priority];
  if (pa !== pb) return pb - pa;
  return a.createdAt.localeCompare(b.createdAt);
}

export const QUEUE_VIEWS = ["pendentes", "todas", "decididas"] as const;
export type QueueView = (typeof QUEUE_VIEWS)[number];
export const QUEUE_VIEW_LABEL: Record<QueueView, string> = {
  pendentes: "Aguardando decisão",
  todas: "Todas",
  decididas: "Decididas",
};

export const DATE_RANGES = ["today", "7d", "30d"] as const;
export type DateRange = (typeof DATE_RANGES)[number];
export const DATE_RANGE_LABEL: Record<DateRange, string> = {
  today: "Criadas hoje",
  "7d": "Últimos 7 dias",
  "30d": "Últimos 30 dias",
};
const DATE_RANGE_DAYS: Record<DateRange, number> = { today: 0, "7d": 7, "30d": 30 };

export interface ReviewFilters {
  urgentOnly: boolean;
  type: "" | ReviewType;
  agentId: string;
  processId: string;
  clientId: string;
  assignedUserId: string;
  dateRange: "" | DateRange;
  status: "" | ReviewStatus;
  /**
   * Escritório parceiro pela origem RELACIONAL do processo da revisão:
   * "" = todos; INTERNAL_ORIGIN = casos próprios; id = parceiro.
   */
  partnerOfficeId: string;
}

/** Valor do filtro para "Interno / Bárbara Cardoso Advocacia". */
export const INTERNAL_ORIGIN = "INTERNAL";

export const EMPTY_REVIEW_FILTERS: ReviewFilters = {
  urgentOnly: false,
  type: "",
  agentId: "",
  processId: "",
  clientId: "",
  assignedUserId: "",
  dateRange: "",
  status: "",
  partnerOfficeId: "",
};

export function countReviewFilters(f: ReviewFilters): number {
  return Object.values(f).filter(Boolean).length;
}

export function matchesView(review: Review, view: QueueView): boolean {
  if (view === "pendentes") return isOpenReview(review);
  if (view === "decididas") return !isOpenReview(review);
  return true;
}

/**
 * Filtros combináveis. O parceiro é o de ORIGEM DO PROCESSO da revisão —
 * não o autor, o agente nem a origem histórica do cliente. Revisão sem
 * processo (ou de processo próprio) conta como interna.
 */
export function filterReviews(reviews: Review[], view: QueueView, f: ReviewFilters, processes: Map<ID, Process> = new Map()): Review[] {
  return reviews.filter((r) => {
    if (f.partnerOfficeId) {
      const process = r.processId ? processes.get(r.processId) : undefined;
      const partnerId = process?.relationshipOrigin === "PARTNER" ? process.originPartnerOfficeId : undefined;
      if (f.partnerOfficeId === INTERNAL_ORIGIN ? !!partnerId : partnerId !== f.partnerOfficeId) return false;
    }
    if (!matchesView(r, view)) return false;
    if (f.urgentOnly && r.status !== "URGENT" && r.priority !== "URGENT") return false;
    if (f.type && r.type !== f.type) return false;
    if (f.agentId && r.agentId !== f.agentId) return false;
    if (f.processId && r.processId !== f.processId) return false;
    if (f.clientId && r.clientId !== f.clientId) return false;
    if (f.assignedUserId && r.assignedUserId !== f.assignedUserId) return false;
    if (f.status && r.status !== f.status) return false;
    if (f.dateRange && daysSince(r.createdAt) > DATE_RANGE_DAYS[f.dateRange]) return false;
    return true;
  });
}

/** Revisão aguardando há 3 dias ou mais recebe destaque. */
export const LONG_WAIT_DAYS = 3;

/** Mensagem do toast após aprovação, conforme o efeito aplicado pelo store. */
export const APPROVAL_OUTCOME: Record<ReviewType, string> = {
  ANALYSIS_RESULT: "Análise concluída e processo criado em pré-ajuizamento. O Agente de Petições iniciou a minuta.",
  PETITION_DRAFT: "Minuta aprovada. O processo seguiu para protocolo manual pela equipe.",
  DOCUMENT_CHECK: "Conferência documental confirmada na análise do cliente.",
  DEADLINE_PROPOSAL: "Prazo confirmado e registrado nas movimentações do processo.",
  CLIENT_MESSAGE: "Mensagem aprovada e disponível para envio pela equipe.",
  PROCESS_UPDATE: "Providências registradas nas movimentações do processo.",
};
