import { daysUntil } from "@/lib/clock";
import type { ProcessOrigin, ProcessPhase, ProcessStatus } from "@/lib/constants/status";
import { onlyDigits } from "@/lib/formatting";
import type { Client, Deadline, ID, Process } from "@/types";

/** Nome de exibição do cliente (PF ou PJ). */
export function clientDisplayName(client: Client | undefined): string {
  if (!client) return "Cliente não encontrado";
  if (client.kind === "INDIVIDUAL") return client.socialName || client.fullName;
  return client.tradeName || client.legalName;
}

/** "TJSP · Ribeirão Preto/SP" */
export function courtLocation(process: Pick<Process, "court" | "district" | "state">): string {
  const place = [process.district, process.state].filter(Boolean).join("/");
  return [process.court, place].filter(Boolean).join(" · ");
}

/** Prazo em aberto mais próximo de cada processo. */
export function nextOpenDeadlineByProcess(deadlines: Deadline[]): Map<ID, Deadline> {
  const map = new Map<ID, Deadline>();
  for (const d of deadlines) {
    if (d.status !== "OPEN") continue;
    const current = map.get(d.processId);
    if (!current || d.dueDate < current.dueDate) map.set(d.processId, d);
  }
  return map;
}

export const DEADLINE_FILTERS = ["OVERDUE_TODAY", "NEXT_5", "NONE"] as const;
export type DeadlineFilter = (typeof DEADLINE_FILTERS)[number];
export const DEADLINE_FILTER_LABEL: Record<DeadlineFilter, string> = {
  OVERDUE_TODAY: "Vencidos ou vencendo hoje",
  NEXT_5: "Próximos 5 dias",
  NONE: "Sem prazo em aberto",
};

export interface ProcessFilters {
  q: string;
  clientId: string;
  responsibleUserId: string;
  court: string;
  status: "" | ProcessStatus;
  origin: "" | ProcessOrigin;
  deadline: "" | DeadlineFilter;
  phase: "" | ProcessPhase;
}

export const EMPTY_PROCESS_FILTERS: ProcessFilters = {
  q: "",
  clientId: "",
  responsibleUserId: "",
  court: "",
  status: "",
  origin: "",
  deadline: "",
  phase: "",
};

export function countActiveFilters(filters: ProcessFilters): number {
  return Object.values(filters).filter(Boolean).length;
}

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export interface ProcessRow {
  process: Process;
  clientName: string;
  responsibleName: string;
  nextDeadline?: Deadline;
}

export function matchesDeadlineFilter(filter: DeadlineFilter, deadline: Deadline | undefined): boolean {
  if (filter === "NONE") return !deadline;
  if (!deadline) return false;
  const diff = daysUntil(deadline.dueDate);
  if (filter === "OVERDUE_TODAY") return diff <= 0;
  return diff >= 0 && diff <= 5;
}

export function filterProcessRows(rows: ProcessRow[], filters: ProcessFilters): ProcessRow[] {
  const q = normalize(filters.q.trim());
  const qDigits = onlyDigits(filters.q);
  return rows.filter(({ process: p, clientName, nextDeadline }) => {
    if (q) {
      const haystack = normalize([p.title, clientName, p.opposingParty ?? "", p.actionType, p.cnj ?? ""].join(" "));
      const digitHit = qDigits.length >= 3 && onlyDigits(p.cnj ?? "").includes(qDigits);
      if (!haystack.includes(q) && !digitHit) return false;
    }
    if (filters.clientId && p.clientId !== filters.clientId) return false;
    if (filters.responsibleUserId && p.responsibleUserId !== filters.responsibleUserId) return false;
    if (filters.court && p.court !== filters.court) return false;
    if (filters.status && p.status !== filters.status) return false;
    if (filters.origin && p.origin !== filters.origin) return false;
    if (filters.phase && p.phase !== filters.phase) return false;
    if (filters.deadline && !matchesDeadlineFilter(filters.deadline, nextDeadline)) return false;
    return true;
  });
}

/** Status considerados "ativos" para o resumo da listagem. */
export const INACTIVE_PROCESS_STATUSES: readonly ProcessStatus[] = ["CLOSED", "SUSPENDED"];
