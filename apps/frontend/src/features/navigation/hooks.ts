"use client";

import { useMemo } from "react";
import { OPEN_REVIEW_STATUSES } from "@/lib/constants/status";
import { useAppStore } from "@/store/app-store";
import type { NavKey } from "@/components/navigation/nav-config";

/** Contadores discretos exibidos no menu da casa. */
export function useNavCounts(): Partial<Record<NavKey, string>> {
  const clients = useAppStore((s) => s.clients);
  const processes = useAppStore((s) => s.processes);
  const reviews = useAppStore((s) => s.reviews);
  const agents = useAppStore((s) => s.agents);
  const agreements = useAppStore((s) => s.agreements);
  return useMemo(() => {
    const openReviews = reviews.filter((r) => OPEN_REVIEW_STATUSES.includes(r.status)).length;
    const activeProcesses = processes.filter((p) => p.status !== "CLOSED").length;
    const activeAgents = agents.filter((a) => a.status === "ACTIVE").length;
    const overdue = agreements.filter((a) => a.status === "OVERDUE").length;
    return {
      clients: `${clients.length} clientes`,
      processes: `${activeProcesses} ativos`,
      reviews: openReviews ? `${openReviews} pendentes` : "Nenhuma pendente",
      finance: overdue ? `${overdue} em atraso` : "Em dia",
      dgbrasil: `${activeAgents} agentes ativos`,
    };
  }, [clients, processes, reviews, agents, agreements]);
}

/** true quando o store já leu o localStorage. */
export { useHydrated } from "@/store/hydration";
