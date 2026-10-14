import "server-only";

import { PROCESS_STATUSES, type LegalCaseStatus, type ProcessStatus } from "@/lib/constants/status";
import type { ActionResult } from "@/lib/actions/result";
import { can } from "@/lib/permissions";
import { requireAppSession } from "@/server/auth/session";
import type { Page } from "@/server/core/pagination";
import { listAgentRunsAction } from "@/server/domain/agents/actions";
import type { AgentRunSummaryDTO } from "@/server/domain/agents/dto";
import { listAuditEventsAction } from "@/server/domain/audit/actions";
import type { AuditEventDTO } from "@/server/domain/audit/dto";
import { listCasesAction } from "@/server/domain/cases/actions";
import type { CaseListItem } from "@/server/domain/cases/dto";
import { listClientsAction } from "@/server/domain/clients/actions";
import type { ClientListItem } from "@/server/domain/clients/dto";
import { getFinanceSummaryAction, getMyPartnerFinanceAction } from "@/server/domain/finance/actions";
import type { FinanceSummaryDTO, PartnerFinanceDTO } from "@/server/domain/finance/dto";
import { listPartnerRequestsAction } from "@/server/domain/partner-requests/actions";
import type { PartnerRequestListItem } from "@/server/domain/partner-requests/dto";
import { getProcessSummaryAction, listProcessesAction } from "@/server/domain/processes/actions";
import type { ProcessListItem, ProcessSummaryDTO } from "@/server/domain/processes/dto";
import { listOverdueDeadlinesAction, listUpcomingDeadlinesAction } from "@/server/domain/processes/deadlines/actions";
import type { DeadlineDTO } from "@/server/domain/processes/deadlines/dto";
import { listReviewsAction } from "@/server/domain/reviews/actions";
import type { ReviewListItem } from "@/server/domain/reviews/dto";

/**
 * Início (Fase H): tudo do SERVIDOR, pelas mesmas Server Actions das telas
 * (sessão + permissão + RLS). Contadores vêm do total das listagens
 * (pageSize 1) — nada de baixar listas para contar no navegador. Cada bloco
 * só é lido se o papel tem a permissão; o resto nem é consultado.
 */

type R<T> = ActionResult<T>;
const total = <T>(r: R<Page<T>>): number | undefined => (r.ok ? r.data.total : undefined);

const ACTIVE_CASE: LegalCaseStatus[] = ["READY_FOR_ANALYSIS", "ANALYZING", "WAITING_REVIEW", "ACCEPTED", "IN_PROGRESS"];
const AWAITING_CASE: LegalCaseStatus[] = ["SUBMITTED", "WAITING_DOCUMENTS"];

export interface HomeKpis {
  activeCases?: number;
  awaitingCases?: number;
  activeProcesses?: number;
  pendingReviews?: number;
  urgentReviews?: number;
  dueSoonDeadlines?: number;
  overdueDeadlines?: number;
}

export interface InternalHomeData {
  firstName: string;
  officeName: string;
  kpis: HomeKpis;
  finance?: R<FinanceSummaryDTO>;
  newCases?: R<Page<CaseListItem>>;
  overdue: R<Page<DeadlineDTO>>;
  upcoming: R<Page<DeadlineDTO>>;
  distribution: { status: ProcessStatus; count: number }[] | null;
  reviews?: R<Page<ReviewListItem>>;
  clients: R<Page<ClientListItem>>;
  feed?: R<Page<AuditEventDTO>>;
  runs?: R<Page<AgentRunSummaryDTO>>;
}

export async function loadInternalHome(): Promise<InternalHomeData> {
  const session = await requireAppSession();
  const role = session.role;
  const none = Promise.resolve(undefined);
  const [active, awaiting, summary, reviewsOpen, reviewsUrgent, upcoming, overdue, finance, newCases, clients, feed, runs, ...byStatus] = await Promise.all([
    listCasesAction({ status: ACTIVE_CASE, pageSize: 1 }),
    listCasesAction({ status: AWAITING_CASE, pageSize: 1 }),
    getProcessSummaryAction() as Promise<R<ProcessSummaryDTO>>,
    can(role, "reviews.view") ? listReviewsAction({ status: "OPEN", pageSize: 5, sortBy: "createdAt", sortDirection: "asc" }) : none,
    can(role, "reviews.view") ? listReviewsAction({ status: "OPEN", priority: "URGENT", pageSize: 1 }) : none,
    listUpcomingDeadlinesAction({ days: 5, pageSize: 10 }),
    listOverdueDeadlinesAction({ pageSize: 10 }),
    can(role, "finance.view") ? getFinanceSummaryAction() : none,
    can(role, "partners.view") ? listCasesAction({ status: ["SUBMITTED"], pageSize: 5, sortBy: "submittedAt", sortDirection: "desc" }) : none,
    listClientsAction({ pageSize: 6, sortBy: "updatedAt", sortDirection: "desc" }),
    can(role, "audit.view") ? listAuditEventsAction({ pageSize: 8, sortBy: "createdAt", sortDirection: "desc" }) : none,
    can(role, "dgbrasil.activity.view") && can(role, "analyses.start") ? listAgentRunsAction({ pageSize: 5 }) : none,
    ...PROCESS_STATUSES.map((status) => listProcessesAction({ status, pageSize: 1 })),
  ]);
  const distribution = byStatus.every((r) => r.ok) ? PROCESS_STATUSES.map((status, i) => ({ status, count: total(byStatus[i]) ?? 0 })).filter((s) => s.count > 0) : null;
  return {
    firstName: session.displayName || session.fullName,
    officeName: session.organizationName,
    kpis: {
      activeCases: total(active),
      awaitingCases: total(awaiting),
      activeProcesses: summary.ok ? summary.data.active : undefined,
      pendingReviews: reviewsOpen ? total(reviewsOpen) : undefined,
      urgentReviews: reviewsUrgent ? total(reviewsUrgent) : undefined,
      dueSoonDeadlines: total(upcoming),
      overdueDeadlines: total(overdue),
    },
    finance,
    newCases,
    overdue,
    upcoming,
    distribution,
    reviews: reviewsOpen,
    clients,
    feed,
    runs,
  };
}

/* ------------------------------------------------------------------ */
/* Portal do Parceiro                                                  */
/* ------------------------------------------------------------------ */

const PARTNER_IN_ANALYSIS: LegalCaseStatus[] = ["SUBMITTED", "WAITING_DOCUMENTS", "READY_FOR_ANALYSIS", "ANALYZING", "WAITING_REVIEW"];
const PARTNER_ACTIVE: LegalCaseStatus[] = ["ACCEPTED", "IN_PROGRESS"];

export interface PartnerHomeData {
  firstName: string;
  officeName: string;
  inAnalysis?: number;
  activeCases?: number;
  openRequests: R<Page<PartnerRequestListItem>>;
  recentCases: R<Page<CaseListItem>>;
  recentProcesses: R<Page<ProcessListItem>>;
  /** Só PARTNER_ADMIN. */
  finance?: R<PartnerFinanceDTO>;
}

export async function loadPartnerHome(): Promise<PartnerHomeData> {
  const session = await requireAppSession();
  const [inAnalysis, active, openRequests, recentCases, recentProcesses, finance] = await Promise.all([
    listCasesAction({ status: PARTNER_IN_ANALYSIS, pageSize: 1 }),
    listCasesAction({ status: PARTNER_ACTIVE, pageSize: 1 }),
    listPartnerRequestsAction({ status: "OPEN", pageSize: 5, sortBy: "createdAt", sortDirection: "desc" }),
    listCasesAction({ pageSize: 5, sortBy: "updatedAt", sortDirection: "desc" }),
    listProcessesAction({ pageSize: 5, sortBy: "updatedAt", sortDirection: "desc" }),
    can(session.role, "partnerPortal.finance.view") ? getMyPartnerFinanceAction() : Promise.resolve(undefined),
  ]);
  return {
    firstName: session.displayName || session.fullName,
    officeName: session.organizationName,
    inAnalysis: total(inAnalysis),
    activeCases: total(active),
    openRequests,
    recentCases,
    recentProcesses,
    finance,
  };
}
