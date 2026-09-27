"use client";

import { useMemo } from "react";
import { daysSince, daysUntil, now } from "@/lib/clock";
import {
  OPEN_REVIEW_STATUSES,
  PRIORITY_WEIGHT,
  PROCESS_STATUSES,
  type ProcessStatus,
} from "@/lib/constants/status";
import { summarizeAgreement } from "@/lib/domain/finance";
import { useCan } from "@/features/auth/hooks";
import { useAppStore } from "@/store/app-store";
import type { Client, ID, Review } from "@/types";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

export function clientDisplayName(client: Client | undefined): string {
  if (!client) return "Cliente não identificado";
  return client.kind === "INDIVIDUAL" ? client.fullName : (client.tradeName ?? client.legalName);
}

const IN_PROGRESS_ANALYSIS = ["WAITING_DOCUMENTS", "READY", "ANALYZING", "WAITING_REVIEW"] as const;

function useNameMaps() {
  const clients = useAppStore((s) => s.clients);
  const processes = useAppStore((s) => s.processes);
  const agents = useAppStore((s) => s.agents);
  const users = useAppStore((s) => s.users);
  return useMemo(
    () => ({
      client: new Map(clients.map((c) => [c.id, c])),
      process: new Map(processes.map((p) => [p.id, p])),
      agent: new Map(agents.map((a) => [a.id, a])),
      user: new Map(users.map((u) => [u.id, u])),
    }),
    [clients, processes, agents, users],
  );
}

/* ------------------------------------------------------------------ */
/* KPIs                                                                */
/* ------------------------------------------------------------------ */

export interface HomeKpis {
  activeProcesses: number;
  analysesInProgress: number;
  analysesWaitingDocs: number;
  upcomingDeadlines: number;
  overdueDeadlines: number;
  pendingReviews: number;
  urgentReviews: number;
  clientsWaitingDocs: number;
  recentlyUpdatedProcesses: number;
}

export function useHomeKpis(): HomeKpis {
  const processes = useAppStore((s) => s.processes);
  const analyses = useAppStore((s) => s.analyses);
  const deadlines = useAppStore((s) => s.deadlines);
  const reviews = useAppStore((s) => s.reviews);
  const clients = useAppStore((s) => s.clients);
  return useMemo(() => {
    const open = deadlines.filter((d) => d.status === "OPEN");
    const openReviews = reviews.filter((r) => OPEN_REVIEW_STATUSES.includes(r.status));
    return {
      activeProcesses: processes.filter((p) => p.status !== "CLOSED").length,
      analysesInProgress: analyses.filter((a) => (IN_PROGRESS_ANALYSIS as readonly string[]).includes(a.status)).length,
      analysesWaitingDocs: analyses.filter((a) => a.status === "WAITING_DOCUMENTS").length,
      upcomingDeadlines: open.filter((d) => {
        const diff = daysUntil(d.dueDate);
        return diff >= 0 && diff <= 7;
      }).length,
      overdueDeadlines: open.filter((d) => daysUntil(d.dueDate) < 0).length,
      pendingReviews: openReviews.length,
      urgentReviews: openReviews.filter((r) => r.status === "URGENT" || r.priority === "URGENT").length,
      clientsWaitingDocs: clients.filter((c) => c.status === "WAITING_DOCUMENTS").length,
      recentlyUpdatedProcesses: processes.filter((p) => p.lastMovementAt && daysSince(p.lastMovementAt) <= 7).length,
    };
  }, [processes, analyses, deadlines, reviews, clients]);
}

/* ------------------------------------------------------------------ */
/* Financeiro (só é chamado por componente montado com finance.view)   */
/* ------------------------------------------------------------------ */

export interface FinanceSnapshot {
  receivable: number;
  overdue: number;
  receivedThisMonth: number;
  overdueAgreements: number;
}

export function useFinanceSnapshot(): FinanceSnapshot {
  const agreements = useAppStore((s) => s.agreements);
  const payments = useAppStore((s) => s.payments);
  return useMemo(() => {
    const active = agreements.filter((a) => a.status !== "CANCELLED");
    const summaries = active.map((a) => summarizeAgreement(a, payments));
    const today = now();
    const agreementIds = new Set(active.map((a) => a.id));
    const receivedThisMonth = payments
      .filter((p) => {
        if (p.status !== "PAID" || !p.paidAt || !agreementIds.has(p.agreementId)) return false;
        const d = new Date(p.paidAt);
        return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth();
      })
      .reduce((sum, p) => sum + p.amount, 0);
    return {
      receivable: summaries.reduce((s, x) => s + x.outstandingBalance, 0),
      overdue: summaries.reduce((s, x) => s + x.overdueAmount, 0),
      receivedThisMonth,
      overdueAgreements: summaries.filter((x) => x.overdueAmount > 0).length,
    };
  }, [agreements, payments]);
}

/* ------------------------------------------------------------------ */
/* Distribuição dos processos                                          */
/* ------------------------------------------------------------------ */

export interface StatusSlice {
  key: string;
  statuses: ProcessStatus[];
  count: number;
  color: string;
}

const MAX_SLICES = 5;

export function useProcessDistribution(): { slices: StatusSlice[]; total: number } {
  const processes = useAppStore((s) => s.processes);
  return useMemo(() => {
    const counts = PROCESS_STATUSES.map((status) => ({
      status,
      count: processes.filter((p) => p.status === status).length,
    }))
      .filter((x) => x.count > 0)
      .sort((a, b) => b.count - a.count);
    const top = counts.slice(0, MAX_SLICES);
    const rest = counts.slice(MAX_SLICES);
    const slices: StatusSlice[] = top.map((x, i) => ({
      key: x.status,
      statuses: [x.status],
      count: x.count,
      color: `var(--chart-${i + 1})`,
    }));
    if (rest.length > 0) {
      slices.push({
        key: "OTHER",
        statuses: rest.map((x) => x.status),
        count: rest.reduce((s, x) => s + x.count, 0),
        color: "var(--chart-6)",
      });
    }
    return { slices, total: processes.length };
  }, [processes]);
}

/* ------------------------------------------------------------------ */
/* Precisa da sua atenção                                              */
/* ------------------------------------------------------------------ */

export type AttentionKind = "DEADLINE" | "ANALYSIS_BLOCKED" | "REVIEW_WAITING" | "PROCESS_MOVEMENT" | "INTEGRATION_ERROR";
export type AttentionLevel = "CRITICAL" | "HIGH" | "MEDIUM" | "INFO";

export interface AttentionItem {
  id: string;
  kind: AttentionKind;
  level: AttentionLevel;
  weight: number;
  at: string;
  title: string;
  context: string;
  /** Texto de urgência exibido junto ao ícone (nunca só cor). */
  urgencyText: string;
  dueDate?: string;
  href: string;
  ctaLabel: string;
}

function levelFromWeight(weight: number): AttentionLevel {
  if (weight >= 85) return "CRITICAL";
  if (weight >= 60) return "HIGH";
  if (weight >= 40) return "MEDIUM";
  return "INFO";
}

export function useAttentionItems(): AttentionItem[] {
  const deadlines = useAppStore((s) => s.deadlines);
  const analyses = useAppStore((s) => s.analyses);
  const reviews = useAppStore((s) => s.reviews);
  const processEvents = useAppStore((s) => s.processEvents);
  const integrations = useAppStore((s) => s.integrations);
  const maps = useNameMaps();
  const can = useCan();

  return useMemo(() => {
    const items: AttentionItem[] = [];
    const push = (item: Omit<AttentionItem, "level">) => items.push({ ...item, level: levelFromWeight(item.weight) });
    const processContext = (processId: ID) => {
      const p = maps.process.get(processId);
      return p ? `${clientDisplayName(maps.client.get(p.clientId))} · ${p.title}` : "Processo";
    };

    if (can("processes.view")) {
      for (const d of deadlines) {
        if (d.status !== "OPEN") continue;
        const diff = daysUntil(d.dueDate);
        if (diff > 5) continue;
        const weight = diff < 0 ? 100 : diff === 0 ? 92 : diff === 1 ? 80 : 62 - diff;
        push({
          id: `dl-${d.id}`,
          kind: "DEADLINE",
          weight,
          at: d.dueDate,
          title: d.title,
          context: processContext(d.processId),
          urgencyText: diff < 0 ? "Prazo vencido" : "Prazo próximo",
          dueDate: d.dueDate,
          href: `/processos/${d.processId}?aba=prazos`,
          ctaLabel: "Ver prazos",
        });
      }

      const cutoff = 3;
      for (const e of processEvents) {
        if (!e.important || daysSince(e.at) > cutoff) continue;
        push({
          id: `mov-${e.id}`,
          kind: "PROCESS_MOVEMENT",
          weight: 30,
          at: e.at,
          title: e.title,
          context: processContext(e.processId),
          urgencyText: "Movimentação relevante",
          href: `/processos/${e.processId}?aba=movimentacoes`,
          ctaLabel: "Ver movimentação",
        });
      }
    }

    if (can("clients.view")) {
      for (const a of analyses) {
        if (a.status !== "WAITING_DOCUMENTS" && a.status !== "INTERRUPTED") continue;
        const interrupted = a.status === "INTERRUPTED";
        const missing = a.missingDocuments.length;
        push({
          id: `ana-${a.id}`,
          kind: "ANALYSIS_BLOCKED",
          weight: interrupted ? 52 : 48,
          at: a.updatedAt,
          title: interrupted ? "Análise interrompida" : "Análise bloqueada por documentos",
          context: interrupted
            ? `${clientDisplayName(maps.client.get(a.clientId))}${a.interruptionReason ? ` · ${a.interruptionReason}` : ""}`
            : `${clientDisplayName(maps.client.get(a.clientId))} · ${missing} ${missing === 1 ? "documento pendente" : "documentos pendentes"}`,
          urgencyText: interrupted ? "Interrompida" : "Bloqueada",
          href: `/clientes/${a.clientId}?aba=${interrupted ? "analise" : "documentos"}`,
          ctaLabel: interrupted ? "Ver análise" : "Ver documentos",
        });
      }
    }

    if (can("reviews.view")) {
      for (const r of reviews) {
        if (!OPEN_REVIEW_STATUSES.includes(r.status)) continue;
        const waiting = daysSince(r.createdAt);
        if (waiting < 3) continue;
        const urgent = r.status === "URGENT" || r.priority === "URGENT";
        push({
          id: `rev-${r.id}`,
          kind: "REVIEW_WAITING",
          weight: urgent ? 84 : Math.min(58, 42 + waiting),
          at: r.createdAt,
          title: r.title,
          context: clientDisplayName(r.clientId ? maps.client.get(r.clientId) : undefined),
          urgencyText: `Aguardando há ${waiting} dias`,
          href: `/revisoes/${r.id}`,
          ctaLabel: "Revisar",
        });
      }
    }

    if (can("settings.integrations.manage")) {
      for (const i of integrations) {
        if (i.status !== "ERROR") continue;
        push({
          id: `int-${i.id}`,
          kind: "INTEGRATION_ERROR",
          weight: 66,
          at: i.lastSyncAt ?? "",
          title: `${i.name} com problema`,
          context: i.statusMessage ?? "A integração não está sincronizando.",
          urgencyText: "Integração com erro",
          href: "/configuracoes?secao=integracoes",
          ctaLabel: "Ver integração",
        });
      }
    }

    return items.sort((a, b) => b.weight - a.weight || a.at.localeCompare(b.at));
  }, [deadlines, analyses, reviews, processEvents, integrations, maps, can]);
}

/* ------------------------------------------------------------------ */
/* Revisões pendentes                                                  */
/* ------------------------------------------------------------------ */

export interface PendingReviewRow {
  review: Review;
  clientName: string;
  agentName: string;
}

export function usePendingReviews(limit = 6): { rows: PendingReviewRow[]; total: number } {
  const reviews = useAppStore((s) => s.reviews);
  const maps = useNameMaps();
  return useMemo(() => {
    const open = reviews
      .filter((r) => OPEN_REVIEW_STATUSES.includes(r.status))
      .sort((a, b) => {
        const ua = a.status === "URGENT" ? 1 : 0;
        const ub = b.status === "URGENT" ? 1 : 0;
        return ub - ua || PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority] || a.createdAt.localeCompare(b.createdAt);
      });
    return {
      total: open.length,
      rows: open.slice(0, limit).map((review) => ({
        review,
        clientName: review.clientId ? clientDisplayName(maps.client.get(review.clientId)) : "—",
        agentName: maps.agent.get(review.agentId)?.name ?? "Agente",
      })),
    };
  }, [reviews, maps, limit]);
}

/* ------------------------------------------------------------------ */
/* Clientes recentes                                                   */
/* ------------------------------------------------------------------ */

export interface RecentClientRow {
  client: Client;
  name: string;
  responsibleName: string;
}

export function useRecentClients(limit = 6): RecentClientRow[] {
  const clients = useAppStore((s) => s.clients);
  const maps = useNameMaps();
  return useMemo(
    () =>
      [...clients]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, limit)
        .map((client) => ({
          client,
          name: clientDisplayName(client),
          responsibleName: maps.user.get(client.responsibleUserId)?.name ?? "—",
        })),
    [clients, maps, limit],
  );
}
