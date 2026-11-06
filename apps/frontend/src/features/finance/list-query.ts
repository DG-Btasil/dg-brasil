import { AGREEMENT_DB_STATUSES, EXPENSE_CATEGORIES, EXPENSE_STATUSES } from "@/server/domain/finance/schemas";
import type { AgreementDbStatus, ExpenseCategory, ExpenseStatus } from "@/server/domain/finance/dto";

type Params = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const pageOf = (params: Params) => {
  const page = Number.parseInt(first(params.pagina), 10);
  return Number.isFinite(page) && page >= 1 && page <= 10_000 ? page : 1;
};

/* ------------------------------------------------------------------ */
/* Abas do Financeiro (?aba=)                                          */
/* ------------------------------------------------------------------ */

export const FINANCE_TABS = ["visao-geral", "processos", "contratos", "despesas", "modelos"] as const;
export type FinanceTab = (typeof FINANCE_TABS)[number];
export const DEFAULT_FINANCE_TAB: FinanceTab = "visao-geral";

export const FINANCE_TAB_LABEL: Record<FinanceTab, string> = {
  "visao-geral": "Visão geral",
  processos: "Por processo",
  contratos: "Contratos",
  despesas: "Despesas",
  modelos: "Modelos de honorários",
};

export function financeTabFromSearchParams(params: Params): FinanceTab {
  const tab = first(params.aba);
  return (FINANCE_TABS as readonly string[]).includes(tab) ? (tab as FinanceTab) : DEFAULT_FINANCE_TAB;
}

/** `aba` primeiro (omitida na aba padrão), depois os parâmetros da lista. */
export function withFinanceTab(params: URLSearchParams, tab: FinanceTab | undefined): URLSearchParams {
  const out = new URLSearchParams();
  if (tab && tab !== DEFAULT_FINANCE_TAB) out.set("aba", tab);
  params.forEach((value, key) => out.set(key, value));
  return out;
}

/* ------------------------------------------------------------------ */
/* Contratos                                                           */
/* ------------------------------------------------------------------ */

/** Lista de acordos ↔ URL ↔ entrada de `listAgreementRowsAction`. Sem dado pessoal na URL. */

export interface AgreementListQuery {
  status: AgreementDbStatus | "";
  page: number;
}

export const AGREEMENT_PAGE_SIZE = 25;
export const DEFAULT_AGREEMENT_QUERY: AgreementListQuery = { status: "", page: 1 };

export function agreementQueryFromSearchParams(params: Params): AgreementListQuery {
  const status = first(params.situacao);
  return {
    status: (AGREEMENT_DB_STATUSES as readonly string[]).includes(status) ? (status as AgreementDbStatus) : "",
    page: pageOf(params),
  };
}

export function agreementQueryToSearchParams(q: AgreementListQuery): URLSearchParams {
  const p = new URLSearchParams();
  if (q.status) p.set("situacao", q.status);
  if (q.page > 1) p.set("pagina", String(q.page));
  return p;
}

export function agreementQueryToInput(q: AgreementListQuery, scope: { legalCaseId?: string; legalProcessId?: string } = {}): Record<string, unknown> {
  return { ...scope, status: q.status || undefined, page: q.page, pageSize: AGREEMENT_PAGE_SIZE, sortBy: "createdAt", sortDirection: "desc" };
}

/* ------------------------------------------------------------------ */
/* Por processo (view process_finance_overview)                        */
/* ------------------------------------------------------------------ */

export const PROCESS_FINANCE_FILTERS = ["OVERDUE", "OPEN_EXPENSES", "WITHOUT_AGREEMENT"] as const;
export type ProcessFinanceFilter = (typeof PROCESS_FINANCE_FILTERS)[number];
export const PROCESS_FINANCE_SORTS = ["received", "contracted", "expenses", "net", "title"] as const;
export type ProcessFinanceSort = (typeof PROCESS_FINANCE_SORTS)[number];

export const PROCESS_FINANCE_FILTER_LABEL: Record<ProcessFinanceFilter, string> = {
  OVERDUE: "Com atraso",
  OPEN_EXPENSES: "Com despesas a pagar",
  WITHOUT_AGREEMENT: "Sem contrato de honorários",
};
export const PROCESS_FINANCE_SORT_LABEL: Record<ProcessFinanceSort, string> = {
  received: "Maior recebido",
  contracted: "Maior contratado",
  expenses: "Maiores despesas",
  net: "Maior resultado",
  title: "Título (A–Z)",
};

const FILTER_PARAM: Record<ProcessFinanceFilter, string> = { OVERDUE: "atraso", OPEN_EXPENSES: "despesas-a-pagar", WITHOUT_AGREEMENT: "sem-contrato" };
const SORT_PARAM: Record<ProcessFinanceSort, string> = { received: "recebido", contracted: "contratado", expenses: "despesas", net: "resultado", title: "titulo" };

export interface ProcessFinanceListQuery {
  search: string;
  filter: ProcessFinanceFilter | "";
  sort: ProcessFinanceSort;
  page: number;
}

export const PROCESS_FINANCE_PAGE_SIZE = 25;
export const DEFAULT_PROCESS_FINANCE_QUERY: ProcessFinanceListQuery = { search: "", filter: "", sort: "received", page: 1 };

/** Busca com dígitos (CNJ, CPF colado por engano) não vai para a URL. */
const isUrlSafe = (s: string) => !/\d/.test(s);

export function processFinanceQueryFromSearchParams(params: Params): ProcessFinanceListQuery {
  const search = first(params.busca).trim().slice(0, 120);
  const filter = PROCESS_FINANCE_FILTERS.find((f) => FILTER_PARAM[f] === first(params.mostrar)) ?? "";
  const sort = PROCESS_FINANCE_SORTS.find((s) => SORT_PARAM[s] === first(params.ordem)) ?? "received";
  return { search: isUrlSafe(search) ? search : "", filter, sort, page: pageOf(params) };
}

export function processFinanceQueryToSearchParams(q: ProcessFinanceListQuery): URLSearchParams {
  const p = new URLSearchParams();
  if (q.search && isUrlSafe(q.search)) p.set("busca", q.search);
  if (q.filter) p.set("mostrar", FILTER_PARAM[q.filter]);
  if (q.sort !== "received") p.set("ordem", SORT_PARAM[q.sort]);
  if (q.page > 1) p.set("pagina", String(q.page));
  return p;
}

export function processFinanceQueryToInput(q: ProcessFinanceListQuery, scope: { legalCaseId?: string } = {}): Record<string, unknown> {
  return {
    ...scope,
    q: q.search.trim() || undefined,
    overdueOnly: q.filter === "OVERDUE" || undefined,
    openExpensesOnly: q.filter === "OPEN_EXPENSES" || undefined,
    withoutAgreement: q.filter === "WITHOUT_AGREEMENT" || undefined,
    sortBy: q.sort,
    sortDirection: q.sort === "title" ? "asc" : "desc",
    page: q.page,
    pageSize: PROCESS_FINANCE_PAGE_SIZE,
  };
}

/* ------------------------------------------------------------------ */
/* Despesas                                                            */
/* ------------------------------------------------------------------ */

const EXPENSE_STATUS_PARAM: Record<ExpenseStatus, string> = { OPEN: "a-pagar", PAID: "pagas", CANCELLED: "canceladas" };

export interface ExpenseListQuery {
  category: ExpenseCategory | "";
  status: ExpenseStatus | "";
  page: number;
}

export const EXPENSE_PAGE_SIZE = 25;
export const DEFAULT_EXPENSE_QUERY: ExpenseListQuery = { category: "", status: "", page: 1 };

export function expenseQueryFromSearchParams(params: Params): ExpenseListQuery {
  const category = first(params.categoria);
  return {
    category: (EXPENSE_CATEGORIES as readonly string[]).includes(category) ? (category as ExpenseCategory) : "",
    status: EXPENSE_STATUSES.find((s) => EXPENSE_STATUS_PARAM[s] === first(params.situacao)) ?? "",
    page: pageOf(params),
  };
}

export function expenseQueryToSearchParams(q: ExpenseListQuery): URLSearchParams {
  const p = new URLSearchParams();
  if (q.category) p.set("categoria", q.category);
  if (q.status) p.set("situacao", EXPENSE_STATUS_PARAM[q.status]);
  if (q.page > 1) p.set("pagina", String(q.page));
  return p;
}

export function expenseQueryToInput(q: ExpenseListQuery, scope: { processId?: string } = {}): Record<string, unknown> {
  return { ...scope, category: q.category || undefined, status: q.status || undefined, page: q.page, pageSize: EXPENSE_PAGE_SIZE, sortBy: "incurredOn", sortDirection: "desc" };
}
