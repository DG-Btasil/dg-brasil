import "server-only";

import { cache } from "react";
import type { LegalCaseStatus } from "@/lib/constants/status";
import { pluralize } from "@/lib/formatting";
import { can } from "@/lib/permissions";
import type { NavKey } from "@/components/navigation/nav-config";
import { requireAppSession } from "@/server/auth/session";
import { listCasesAction } from "@/server/domain/cases/actions";
import { listClientsAction } from "@/server/domain/clients/actions";
import { countUnreadNotificationsAction } from "@/server/domain/notifications/actions";
import { listPartnersAction } from "@/server/domain/organizations/actions";
import { listPartnerRequestsAction } from "@/server/domain/partner-requests/actions";
import { getProcessSummaryAction, listProcessesAction } from "@/server/domain/processes/actions";
import { listReviewsAction } from "@/server/domain/reviews/actions";

/**
 * Contadores discretos do menu da casa, contados no SERVIDOR (totais das
 * listagens, pageSize 1) com a sessão e a RLS — no portal, só os dados do
 * próprio escritório. Carregados uma vez por carregamento da área; falha em
 * um contador só esconde aquele rótulo.
 */

const AWAITING: LegalCaseStatus[] = ["SUBMITTED", "WAITING_DOCUMENTS", "READY_FOR_ANALYSIS", "ANALYZING", "WAITING_REVIEW"];
const ACTIVE: LegalCaseStatus[] = ["ACCEPTED", "IN_PROGRESS"];

type Counted = { ok: true; data: { total: number } } | { ok: false };
const n = (r: Counted | undefined) => (r && r.ok ? r.data.total : undefined);

export const loadNavCounts = cache(async (): Promise<Partial<Record<NavKey, string>>> => {
  const session = await requireAppSession();
  const role = session.role;
  const none = Promise.resolve(undefined);
  if (session.surface === "PARTNER") {
    const [clients, inAnalysis, cases, processes, requests, unread] = await Promise.all([
      listClientsAction({ pageSize: 1 }),
      listCasesAction({ status: AWAITING, pageSize: 1 }),
      listCasesAction({ pageSize: 1 }),
      listProcessesAction({ pageSize: 1 }),
      listPartnerRequestsAction({ status: "OPEN", pageSize: 1 }),
      countUnreadNotificationsAction(),
    ]);
    const open = n(requests);
    const unreadCount = unread.ok ? unread.data.unread : undefined;
    return {
      clients: n(clients) !== undefined ? pluralize(n(clients) ?? 0, "cliente", "clientes") : undefined,
      cases: n(inAnalysis) ? `${n(inAnalysis)} em análise` : n(cases) !== undefined ? pluralize(n(cases) ?? 0, "caso", "casos") : undefined,
      processes: n(processes) !== undefined ? pluralize(n(processes) ?? 0, "processo", "processos") : undefined,
      pending: open === undefined ? undefined : open ? `${open} em aberto` : "Nada pendente",
      notifications: unreadCount === undefined ? undefined : unreadCount ? `${unreadCount} não lidas` : "Tudo em dia",
    };
  }
  const [clients, awaiting, active, summary, reviews, partners] = await Promise.all([
    listClientsAction({ pageSize: 1 }),
    listCasesAction({ status: AWAITING, pageSize: 1 }),
    listCasesAction({ status: ACTIVE, pageSize: 1 }),
    getProcessSummaryAction(),
    can(role, "reviews.view") ? listReviewsAction({ status: "OPEN", pageSize: 1 }) : none,
    can(role, "partners.view") ? listPartnersAction({ status: "ACTIVE", pageSize: 1 }) : none,
  ]);
  const openReviews = n(reviews);
  return {
    clients: n(clients) !== undefined ? pluralize(n(clients) ?? 0, "cliente", "clientes") : undefined,
    cases: n(awaiting) ? `${n(awaiting)} aguardando análise` : n(active) !== undefined ? `${n(active)} ativos` : undefined,
    processes: summary.ok ? `${summary.data.active} ativos` : undefined,
    reviews: openReviews === undefined ? undefined : openReviews ? `${openReviews} pendentes` : "Nenhuma pendente",
    partners: n(partners) !== undefined ? `${n(partners)} ativos` : undefined,
  };
});
