"use client";

import { useMemo } from "react";
import { todayISO } from "@/lib/clock";
import { ACTIVE_CASE_STATUSES, DECIDABLE_CASE_STATUSES, IN_ANALYSIS_CASE_STATUSES, OPEN_REVIEW_STATUSES } from "@/lib/constants/status";
import { agreementStatus } from "@/lib/domain/finance";
import { useIsPartner } from "@/features/auth/hooks";
import { useScopedStore } from "@/store/scope";
import type { NavKey } from "@/components/navigation/nav-config";

/**
 * Contadores discretos exibidos no menu da casa. Calculados sobre o estado
 * recortado: no portal, contam só os dados do próprio parceiro.
 */
export function useNavCounts(): Partial<Record<NavKey, string>> {
  const isPartner = useIsPartner();
  const clients = useScopedStore((s) => s.clients);
  const processes = useScopedStore((s) => s.processes);
  const reviews = useScopedStore((s) => s.reviews);
  const agents = useScopedStore((s) => s.agents);
  const agreements = useScopedStore((s) => s.agreements);
  const payments = useScopedStore((s) => s.payments);
  const partners = useScopedStore((s) => s.partnerOffices);
  const cases = useScopedStore((s) => s.legalCases);
  const office = useScopedStore((s) => s.office);
  const requests = useScopedStore((s) => s.partnerRequests);
  const notifications = useScopedStore((s) => s.notifications);
  return useMemo(() => {
    const activeProcesses = processes.filter((p) => p.status !== "CLOSED").length;
    if (isPartner) {
      const open = requests.filter((r) => r.status === "OPEN").length;
      const unread = notifications.filter((n) => !n.read).length;
      const inAnalysis = cases.filter((c) => IN_ANALYSIS_CASE_STATUSES.includes(c.status)).length;
      return {
        clients: `${clients.length} clientes`,
        cases: inAnalysis ? `${inAnalysis} em análise` : `${cases.length} casos`,
        processes: `${activeProcesses} ativos`,
        pending: open ? `${open} em aberto` : "Nada pendente",
        notifications: unread ? `${unread} não lidas` : "Tudo em dia",
      };
    }
    const openReviews = reviews.filter((r) => OPEN_REVIEW_STATUSES.includes(r.status)).length;
    const activeAgents = agents.filter((a) => a.status === "ACTIVE").length;
    const today = todayISO();
    const overdue = agreements.filter((a) => agreementStatus(a, payments, today) === "OVERDUE").length;
    const newCases = cases.filter((c) => c.createdByOrganizationId !== office.id && c.status === "SUBMITTED").length;
    const awaiting = cases.filter((c) => DECIDABLE_CASE_STATUSES.includes(c.status)).length;
    const activePartners = partners.filter((p) => p.status === "ACTIVE").length;
    return {
      clients: `${clients.length} clientes`,
      cases: awaiting ? `${awaiting} aguardando análise` : `${cases.filter((c) => ACTIVE_CASE_STATUSES.includes(c.status)).length} ativos`,
      processes: `${activeProcesses} ativos`,
      reviews: openReviews ? `${openReviews} pendentes` : "Nenhuma pendente",
      finance: overdue ? `${overdue} em atraso` : "Em dia",
      partners: newCases ? `${newCases} ${newCases === 1 ? "caso novo" : "casos novos"}` : `${activePartners} ativos`,
      dgbrasil: `${activeAgents} agentes ativos`,
    };
  }, [isPartner, clients, processes, reviews, agents, agreements, payments, partners, cases, office.id, requests, notifications]);
}

/** true quando o store já leu o localStorage. */
export { useHydrated } from "@/store/hydration";
