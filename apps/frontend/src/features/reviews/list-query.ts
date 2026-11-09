import { PRIORITIES, PRIORITY_LABEL, type Priority } from "@/lib/constants/status";

/**
 * Fila de revisões ↔ URL ↔ entrada de `listReviewsAction`. A URL guarda só
 * visão, filtros e página (nenhum conteúdo revisado nem dado pessoal).
 */

export const REVIEW_VIEWS = ["abertas", "minhas", "todas"] as const;
export type ReviewView = (typeof REVIEW_VIEWS)[number];
export const REVIEW_VIEW_LABEL: Record<ReviewView, string> = { abertas: "Aguardando decisão", minhas: "Atribuídas a mim", todas: "Todas" };

export const REVIEW_KINDS = ["ANALYSIS", "DOCUMENT_VERSION", "AGENT_PROPOSAL"] as const;
export type ReviewKind = (typeof REVIEW_KINDS)[number];
export const REVIEW_KIND_LABEL: Record<ReviewKind, string> = { ANALYSIS: "Análise", DOCUMENT_VERSION: "Documento", AGENT_PROPOSAL: "Proposta do agente" };

/** Situação na visão "Todas" (banco). */
export const REVIEW_DB_STATUSES = ["PENDING", "REOPENED", "CHANGES_REQUESTED", "APPROVED", "REJECTED"] as const;
export type ReviewDbStatusFilter = (typeof REVIEW_DB_STATUSES)[number];

/** Atalho de prioridade do indicador "Urgentes e alta prioridade" (URGENT + HIGH no servidor). */
export const REVIEW_TOP_PRIORITY = "URGENT_HIGH";
export type ReviewPriorityFilter = Priority | typeof REVIEW_TOP_PRIORITY;
const REVIEW_PRIORITY_FILTERS: readonly ReviewPriorityFilter[] = [REVIEW_TOP_PRIORITY, ...PRIORITIES];
export const REVIEW_PRIORITY_OPTIONS = REVIEW_PRIORITY_FILTERS.map((p) => ({ value: p, label: p === REVIEW_TOP_PRIORITY ? "Urgente e alta" : PRIORITY_LABEL[p] }));

/** Prazo (`due_at`): vence em até 7 dias, inclusive as vencidas (só em aberto). */
export const REVIEW_DUE_FILTERS = ["NEXT_7_DAYS"] as const;
export type ReviewDueQuery = (typeof REVIEW_DUE_FILTERS)[number];
export const REVIEW_DUE_LABEL: Record<ReviewDueQuery, string> = { NEXT_7_DAYS: "Vence em até 7 dias (inclui vencidas)" };
const DUE_PARAM: Record<ReviewDueQuery, string> = { NEXT_7_DAYS: "7dias" };

export interface ReviewListQuery {
  view: ReviewView;
  priority: ReviewPriorityFilter | "";
  kind: ReviewKind | "";
  status: ReviewDbStatusFilter | "";
  due: ReviewDueQuery | "";
  unassigned: boolean;
  page: number;
}

export const REVIEW_PAGE_SIZE = 25;
export const DEFAULT_REVIEW_QUERY: ReviewListQuery = { view: "abertas", priority: "", kind: "", status: "", due: "", unassigned: false, page: 1 };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const oneOf = <T extends string>(list: readonly T[], v: string): T | "" => ((list as readonly string[]).includes(v) ? (v as T) : "");

export function reviewQueryFromSearchParams(params: Record<string, string | string[] | undefined>): ReviewListQuery {
  const view = oneOf(REVIEW_VIEWS, first(params.visao)) || "abertas";
  const page = Number.parseInt(first(params.pagina), 10);
  const due = REVIEW_DUE_FILTERS.find((d) => DUE_PARAM[d] === first(params.prazo)) ?? "";
  return {
    view,
    priority: oneOf(REVIEW_PRIORITY_FILTERS, first(params.prioridade)),
    kind: oneOf(REVIEW_KINDS, first(params.tipo)),
    status: view === "todas" ? oneOf(REVIEW_DB_STATUSES, first(params.situacao)) : "",
    due,
    unassigned: view !== "minhas" && first(params.sem_responsavel) === "1",
    page: Number.isFinite(page) && page >= 1 && page <= 10_000 ? page : 1,
  };
}

export function reviewQueryToSearchParams(q: ReviewListQuery): URLSearchParams {
  const p = new URLSearchParams();
  if (q.view !== "abertas") p.set("visao", q.view);
  if (q.priority) p.set("prioridade", q.priority);
  if (q.kind) p.set("tipo", q.kind);
  if (q.view === "todas" && q.status) p.set("situacao", q.status);
  if (q.due) p.set("prazo", DUE_PARAM[q.due]);
  if (q.unassigned && q.view !== "minhas") p.set("sem_responsavel", "1");
  if (q.page > 1) p.set("pagina", String(q.page));
  return p;
}

/** Abertas: urgentes primeiro não é ordenável no banco — ordem por prazo e depois criação (mais antigas primeiro). */
export function reviewQueryToInput(q: ReviewListQuery): Record<string, unknown> {
  const open = q.view !== "todas";
  return {
    status: open ? "OPEN" : q.status || undefined,
    priority: q.priority === REVIEW_TOP_PRIORITY ? ["URGENT", "HIGH"] : q.priority || undefined,
    targetKind: q.kind || undefined,
    due: q.due || undefined,
    assignee: q.view === "minhas" ? "me" : q.unassigned ? "unassigned" : undefined,
    sortBy: "createdAt",
    sortDirection: open ? "asc" : "desc",
    page: q.page,
    pageSize: REVIEW_PAGE_SIZE,
  };
}

export function countReviewFilters(q: ReviewListQuery): number {
  return [q.priority, q.kind, q.status, q.due, q.unassigned].filter(Boolean).length;
}

/* ------------------------------------------------------------------ */
/* Indicadores clicáveis (E-05)                                        */
/* ------------------------------------------------------------------ */

/** Um indicador por chave de ReviewSummaryDTO. */
export type ReviewCounter = "open" | "topPriority" | "dueSoon" | "unassigned";

/** O indicador está aplicado na consulta atual? (vira o aria-pressed do botão) */
export function isReviewCounterActive(q: ReviewListQuery, counter: ReviewCounter): boolean {
  switch (counter) {
    case "open":
      return q.view === "abertas";
    case "topPriority":
      return q.priority === REVIEW_TOP_PRIORITY;
    case "dueSoon":
      return q.due === "NEXT_7_DAYS";
    case "unassigned":
      return q.unassigned && q.view !== "minhas";
  }
}

/**
 * Clique no indicador: aplica o filtro (os demais filtros ficam) ou, se já
 * aplicado, limpa só ele. Os indicadores contam revisões EM ABERTO, então
 * aplicar a partir de "Todas" volta para "Aguardando decisão"; "Sem
 * responsável" não combina com "Atribuídas a mim" e também volta para lá.
 * Sempre recomeça da página 1.
 */
export function toggleReviewCounter(q: ReviewListQuery, counter: ReviewCounter): ReviewListQuery {
  const active = isReviewCounterActive(q, counter);
  const openView = (view: ReviewView): Pick<ReviewListQuery, "view" | "status"> => (view === "todas" ? { view: "abertas", status: "" } : { view, status: q.status });
  switch (counter) {
    case "open":
      return active ? { ...q, view: "todas", page: 1 } : { ...q, view: "abertas", status: "", page: 1 };
    case "topPriority":
      return active ? { ...q, priority: "", page: 1 } : { ...q, ...openView(q.view), priority: REVIEW_TOP_PRIORITY, page: 1 };
    case "dueSoon":
      return active ? { ...q, due: "", page: 1 } : { ...q, ...openView(q.view), due: "NEXT_7_DAYS", page: 1 };
    case "unassigned":
      return active ? { ...q, unassigned: false, page: 1 } : { ...q, view: "abertas", status: "", unassigned: true, page: 1 };
  }
}
