import { PRIORITIES, type Priority } from "@/lib/constants/status";

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

export interface ReviewListQuery {
  view: ReviewView;
  priority: Priority | "";
  kind: ReviewKind | "";
  status: ReviewDbStatusFilter | "";
  unassigned: boolean;
  page: number;
}

export const REVIEW_PAGE_SIZE = 25;
export const DEFAULT_REVIEW_QUERY: ReviewListQuery = { view: "abertas", priority: "", kind: "", status: "", unassigned: false, page: 1 };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const oneOf = <T extends string>(list: readonly T[], v: string): T | "" => ((list as readonly string[]).includes(v) ? (v as T) : "");

export function reviewQueryFromSearchParams(params: Record<string, string | string[] | undefined>): ReviewListQuery {
  const view = oneOf(REVIEW_VIEWS, first(params.visao)) || "abertas";
  const page = Number.parseInt(first(params.pagina), 10);
  return {
    view,
    priority: oneOf(PRIORITIES, first(params.prioridade)),
    kind: oneOf(REVIEW_KINDS, first(params.tipo)),
    status: view === "todas" ? oneOf(REVIEW_DB_STATUSES, first(params.situacao)) : "",
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
  if (q.unassigned && q.view !== "minhas") p.set("sem_responsavel", "1");
  if (q.page > 1) p.set("pagina", String(q.page));
  return p;
}

/** Abertas: urgentes primeiro não é ordenável no banco — ordem por prazo e depois criação (mais antigas primeiro). */
export function reviewQueryToInput(q: ReviewListQuery): Record<string, unknown> {
  const open = q.view !== "todas";
  return {
    status: open ? "OPEN" : q.status || undefined,
    priority: q.priority || undefined,
    targetKind: q.kind || undefined,
    assignee: q.view === "minhas" ? "me" : q.unassigned ? "unassigned" : undefined,
    sortBy: "createdAt",
    sortDirection: open ? "asc" : "desc",
    page: q.page,
    pageSize: REVIEW_PAGE_SIZE,
  };
}
