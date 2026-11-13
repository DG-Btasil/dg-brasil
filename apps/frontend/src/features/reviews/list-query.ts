import { PRIORITIES, PRIORITY_LABEL, type Priority } from "@/lib/constants/status";

/**
 * Fila de revisões ↔ URL ↔ entrada de `listReviewsAction` e de
 * `listReviewGroupsAction`. A URL guarda só modo, visão, filtros e página
 * (nenhum conteúdo revisado). A busca por texto vai para a URL quando não tem
 * dígito, como nas outras listas (CPF e número de processo ficam de fora).
 */

/** Como a fila aparece: agrupada por execução do agente (padrão) ou em lista, item a item. */
export const REVIEW_MODES = ["grupos", "lista"] as const;
export type ReviewMode = (typeof REVIEW_MODES)[number];
export const REVIEW_MODE_LABEL: Record<ReviewMode, string> = { grupos: "Agrupar por execução", lista: "Lista" };

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
  mode: ReviewMode;
  view: ReviewView;
  /** Texto livre: cliente, caso, título do item ou agente. */
  search: string;
  priority: ReviewPriorityFilter | "";
  kind: ReviewKind | "";
  status: ReviewDbStatusFilter | "";
  due: ReviewDueQuery | "";
  unassigned: boolean;
  page: number;
}

export const REVIEW_PAGE_SIZE = 25;
/** Itens carregados ao abrir um grupo (o teto de uma página no servidor; também o teto da decisão em conjunto). */
export const REVIEW_GROUP_ITEMS_PAGE_SIZE = 50;
export const REVIEW_SEARCH_MAX = 120;
export const DEFAULT_REVIEW_QUERY: ReviewListQuery = { mode: "grupos", view: "abertas", search: "", priority: "", kind: "", status: "", due: "", unassigned: false, page: 1 };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const oneOf = <T extends string>(list: readonly T[], v: string): T | "" => ((list as readonly string[]).includes(v) ? (v as T) : "");
const isUrlSafe = (s: string) => !/\d/.test(s);

export function reviewQueryFromSearchParams(params: Record<string, string | string[] | undefined>): ReviewListQuery {
  const view = oneOf(REVIEW_VIEWS, first(params.visao)) || "abertas";
  const page = Number.parseInt(first(params.pagina), 10);
  const due = REVIEW_DUE_FILTERS.find((d) => DUE_PARAM[d] === first(params.prazo)) ?? "";
  const search = first(params.busca).trim().slice(0, REVIEW_SEARCH_MAX);
  return {
    mode: oneOf(REVIEW_MODES, first(params.modo)) || "grupos",
    view,
    search: isUrlSafe(search) ? search : "",
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
  if (q.mode !== "grupos") p.set("modo", q.mode);
  if (q.view !== "abertas") p.set("visao", q.view);
  if (q.search && isUrlSafe(q.search)) p.set("busca", q.search);
  if (q.priority) p.set("prioridade", q.priority);
  if (q.kind) p.set("tipo", q.kind);
  if (q.view === "todas" && q.status) p.set("situacao", q.status);
  if (q.due) p.set("prazo", DUE_PARAM[q.due]);
  if (q.unassigned && q.view !== "minhas") p.set("sem_responsavel", "1");
  if (q.page > 1) p.set("pagina", String(q.page));
  return p;
}

/** Os filtros, iguais para a lista e para os grupos. Abertas: mais antigas primeiro; "Todas": mais recentes primeiro. */
function filterInput(q: ReviewListQuery): Record<string, unknown> {
  const open = q.view !== "todas";
  return {
    status: open ? "OPEN" : q.status || undefined,
    priority: q.priority === REVIEW_TOP_PRIORITY ? ["URGENT", "HIGH"] : q.priority || undefined,
    targetKind: q.kind || undefined,
    due: q.due || undefined,
    assignee: q.view === "minhas" ? "me" : q.unassigned ? "unassigned" : undefined,
    search: q.search.trim() || undefined,
    sortDirection: open ? "asc" : "desc",
  };
}

/** Abertas: urgentes primeiro não é ordenável no banco — ordem por prazo e depois criação (mais antigas primeiro). */
export function reviewQueryToInput(q: ReviewListQuery): Record<string, unknown> {
  return { ...filterInput(q), sortBy: "createdAt", page: q.page, pageSize: REVIEW_PAGE_SIZE };
}

/** Entrada de `listReviewGroupsAction`: os mesmos filtros, paginando grupos. */
export function reviewQueryToGroupInput(q: ReviewListQuery): Record<string, unknown> {
  return { ...filterInput(q), page: q.page, pageSize: REVIEW_PAGE_SIZE };
}

/** Itens de UM grupo, com os filtros da fila: os de uma execução ou, sem execução, os de um caso. */
export function reviewGroupItemsInput(q: ReviewListQuery, group: { agentRunId?: string; legalCaseId?: string }, page = 1): Record<string, unknown> {
  return {
    ...filterInput(q),
    ...(group.agentRunId ? { groupRunId: group.agentRunId } : { groupCaseId: group.legalCaseId }),
    sortBy: "createdAt",
    page,
    pageSize: REVIEW_GROUP_ITEMS_PAGE_SIZE,
  };
}

/** A consulta inteira cabe na URL? (Busca com dígito fica só na tela: recarregar a página a perderia.) */
export function reviewQueryFitsUrl(q: ReviewListQuery): boolean {
  return isUrlSafe(q.search);
}

export function countReviewFilters(q: ReviewListQuery): number {
  return [q.search.trim(), q.priority, q.kind, q.status, q.due, q.unassigned].filter(Boolean).length;
}

/** Sem filtros, mantendo o modo (agrupado ou lista) e a visão escolhidos. */
export function clearReviewFilters(q: ReviewListQuery, view: ReviewView = q.view): ReviewListQuery {
  return { ...DEFAULT_REVIEW_QUERY, mode: q.mode, view };
}

/* ------------------------------------------------------------------ */
/* Indicadores clicáveis (E-05)                                        */
/* ------------------------------------------------------------------ */

/** Um indicador por chave de ReviewSummaryDTO. */
export type ReviewCounter = "open" | "topPriority" | "dueSoon" | "unassigned";

/**
 * O indicador está aplicado na consulta atual? "Aguardando decisão" conta a
 * fila em aberto inteira: só fica marcado quando a lista mostra exatamente
 * isso (visão "Aguardando decisão" sem nenhum filtro).
 */
export function isReviewCounterActive(q: ReviewListQuery, counter: ReviewCounter): boolean {
  switch (counter) {
    case "open":
      return q.view === "abertas" && countReviewFilters(q) === 0;
    case "topPriority":
      return q.priority === REVIEW_TOP_PRIORITY;
    case "dueSoon":
      return q.due === "NEXT_7_DAYS";
    case "unassigned":
      return q.unassigned && q.view !== "minhas";
  }
}

/**
 * Clique no indicador. "Aguardando decisão" mostra a fila em aberto inteira
 * (limpa os filtros; nunca leva para "Todas" — QA rodada 2, E-05). Os outros
 * três aplicam o filtro (os demais filtros ficam) ou, se já aplicado, limpam
 * só ele. Os indicadores contam revisões EM ABERTO, então aplicar a partir de
 * "Todas" volta para "Aguardando decisão"; "Sem responsável" não combina com
 * "Atribuídas a mim" e também volta para lá. Sempre recomeça da página 1.
 */
export function toggleReviewCounter(q: ReviewListQuery, counter: ReviewCounter): ReviewListQuery {
  const active = isReviewCounterActive(q, counter);
  const openView = (view: ReviewView): Pick<ReviewListQuery, "view" | "status"> => (view === "todas" ? { view: "abertas", status: "" } : { view, status: q.status });
  switch (counter) {
    case "open":
      return clearReviewFilters(q, "abertas");
    case "topPriority":
      return active ? { ...q, priority: "", page: 1 } : { ...q, ...openView(q.view), priority: REVIEW_TOP_PRIORITY, page: 1 };
    case "dueSoon":
      return active ? { ...q, due: "", page: 1 } : { ...q, ...openView(q.view), due: "NEXT_7_DAYS", page: 1 };
    case "unassigned":
      return active ? { ...q, unassigned: false, page: 1 } : { ...q, view: "abertas", status: "", unassigned: true, page: 1 };
  }
}
