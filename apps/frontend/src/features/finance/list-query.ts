import { AGREEMENT_DB_STATUSES, EXPENSE_CATEGORIES, EXPENSE_STATUSES, RECEIPT_KINDS, RECEIPT_METHODS } from "@/server/domain/finance/schemas";
import type { AgreementDbStatus, ExpenseCategory, ExpenseStatus, ReceiptKind } from "@/server/domain/finance/dto";

type Params = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Data civil YYYY-MM-DD que existe (o servidor valida de novo). Qualquer outra coisa na URL vira "sem filtro". */
export function isoDateParam(v: string | string[] | undefined): string {
  const text = first(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "";
  const d = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === text ? text : "";
}

/** Período preenchido ao contrário (de > até): a tela avisa e não consulta. */
export function periodProblem(from: string, to: string): string | undefined {
  return from && to && from > to ? "A data inicial não pode ser depois da final." : undefined;
}

/** Busca com dígitos (CNJ, CPF colado por engano) não vai para a URL. */
const isUrlSafe = (s: string) => !/\d/.test(s);
const searchParam = (params: Params) => {
  const search = first(params.busca).trim().slice(0, 120);
  return isUrlSafe(search) ? search : "";
};
const pageOf = (params: Params) => {
  const page = Number.parseInt(first(params.pagina), 10);
  return Number.isFinite(page) && page >= 1 && page <= 10_000 ? page : 1;
};

/* ------------------------------------------------------------------ */
/* Abas do Financeiro (?aba=)                                          */
/* ------------------------------------------------------------------ */

export const FINANCE_TABS = ["visao-geral", "processos", "contratos", "a-receber", "recebimentos", "despesas", "modelos"] as const;
export type FinanceTab = (typeof FINANCE_TABS)[number];
export const DEFAULT_FINANCE_TAB: FinanceTab = "visao-geral";

export const FINANCE_TAB_LABEL: Record<FinanceTab, string> = {
  "visao-geral": "Visão geral",
  processos: "Por processo",
  contratos: "Contratos",
  "a-receber": "A receber",
  recebimentos: "Recebimentos",
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

/**
 * Lista de contratos ↔ URL ↔ entrada de `listAgreementRowsAction`. Busca por
 * cliente/título/CNJ, período (data do contrato) e vencimento (próximo em
 * aberto): tudo filtrado no servidor. Sem dado pessoal na URL além do nome
 * buscado (busca com dígitos não vai para a URL).
 */

export interface AgreementListQuery {
  status: AgreementDbStatus | "";
  search: string;
  periodFrom: string;
  periodTo: string;
  dueFrom: string;
  dueTo: string;
  page: number;
}

export const AGREEMENT_PAGE_SIZE = 25;
export const DEFAULT_AGREEMENT_QUERY: AgreementListQuery = { status: "", search: "", periodFrom: "", periodTo: "", dueFrom: "", dueTo: "", page: 1 };

export function agreementQueryFromSearchParams(params: Params): AgreementListQuery {
  const status = first(params.situacao);
  return {
    status: (AGREEMENT_DB_STATUSES as readonly string[]).includes(status) ? (status as AgreementDbStatus) : "",
    search: searchParam(params),
    periodFrom: isoDateParam(params.de),
    periodTo: isoDateParam(params.ate),
    dueFrom: isoDateParam(params["vence-de"]),
    dueTo: isoDateParam(params["vence-ate"]),
    page: pageOf(params),
  };
}

export function agreementQueryToSearchParams(q: AgreementListQuery): URLSearchParams {
  const p = new URLSearchParams();
  if (q.search && isUrlSafe(q.search)) p.set("busca", q.search);
  if (q.status) p.set("situacao", q.status);
  if (q.periodFrom) p.set("de", q.periodFrom);
  if (q.periodTo) p.set("ate", q.periodTo);
  if (q.dueFrom) p.set("vence-de", q.dueFrom);
  if (q.dueTo) p.set("vence-ate", q.dueTo);
  if (q.page > 1) p.set("pagina", String(q.page));
  return p;
}

/** Com filtro de vencimento, a lista vem pelo próximo vencimento (mais próximo primeiro); senão, pelos mais recentes. */
export function agreementQueryToInput(q: AgreementListQuery, scope: { legalCaseId?: string; legalProcessId?: string } = {}): Record<string, unknown> {
  const byDue = !!(q.dueFrom || q.dueTo);
  return {
    ...scope,
    status: q.status || undefined,
    q: q.search.trim() || undefined,
    periodFrom: q.periodFrom || undefined,
    periodTo: q.periodTo || undefined,
    dueFrom: q.dueFrom || undefined,
    dueTo: q.dueTo || undefined,
    page: q.page,
    pageSize: AGREEMENT_PAGE_SIZE,
    sortBy: byDue ? "nextDueDate" : "createdAt",
    sortDirection: byDue ? "asc" : "desc",
  };
}

export function agreementQueryIsFiltered(q: AgreementListQuery): boolean {
  return !!(q.status || q.search || q.periodFrom || q.periodTo || q.dueFrom || q.dueTo);
}

/* ------------------------------------------------------------------ */
/* A receber (view finance_receivables)                                */
/* ------------------------------------------------------------------ */

export interface ReceivableListQuery {
  search: string;
  from: string;
  to: string;
  overdueOnly: boolean;
  page: number;
}

export const RECEIVABLE_PAGE_SIZE = 25;
export const DEFAULT_RECEIVABLE_QUERY: ReceivableListQuery = { search: "", from: "", to: "", overdueOnly: false, page: 1 };

export function receivableQueryFromSearchParams(params: Params): ReceivableListQuery {
  return { search: searchParam(params), from: isoDateParam(params.de), to: isoDateParam(params.ate), overdueOnly: first(params.mostrar) === "vencidas", page: pageOf(params) };
}

export function receivableQueryToSearchParams(q: ReceivableListQuery): URLSearchParams {
  const p = new URLSearchParams();
  if (q.search && isUrlSafe(q.search)) p.set("busca", q.search);
  if (q.from) p.set("de", q.from);
  if (q.to) p.set("ate", q.to);
  if (q.overdueOnly) p.set("mostrar", "vencidas");
  if (q.page > 1) p.set("pagina", String(q.page));
  return p;
}

export function receivableQueryToInput(q: ReceivableListQuery): Record<string, unknown> {
  return {
    q: q.search.trim() || undefined,
    from: q.from || undefined,
    to: q.to || undefined,
    overdueOnly: q.overdueOnly || undefined,
    page: q.page,
    pageSize: RECEIVABLE_PAGE_SIZE,
    sortBy: "dueDate",
    sortDirection: "asc",
  };
}

export function receivableQueryIsFiltered(q: ReceivableListQuery): boolean {
  return !!(q.search || q.from || q.to || q.overdueOnly);
}

/* ------------------------------------------------------------------ */
/* Recebimentos: extrato por período (view finance_receipt_statement)  */
/* ------------------------------------------------------------------ */

type ReceiptMethod = (typeof RECEIPT_METHODS)[number];
const RECEIPT_KIND_PARAM: Record<ReceiptKind, string> = { RECEIPT: "recebimentos", ADJUSTMENT: "ajustes", REVERSAL: "estornos" };

export interface ReceiptStatementQuery {
  search: string;
  from: string;
  to: string;
  method: ReceiptMethod | "";
  kind: ReceiptKind | "";
  page: number;
}

export const RECEIPT_STATEMENT_PAGE_SIZE = 25;

/** 1º dia do mês de `today` (YYYY-MM-DD): o extrato abre no mês corrente. */
export function monthStart(today: string): string {
  return `${today.slice(0, 7)}-01`;
}

/** Sem período na URL, o extrato abre no mês corrente (de 1º até hoje). Período na URL vale como veio. */
export function receiptStatementQueryFromSearchParams(params: Params, today: string): ReceiptStatementQuery {
  const from = isoDateParam(params.de);
  const to = isoDateParam(params.ate);
  const untouched = params.de === undefined && params.ate === undefined;
  const method = first(params.forma);
  return {
    search: searchParam(params),
    from: untouched ? monthStart(today) : from,
    to: untouched ? today : to,
    method: (RECEIPT_METHODS as readonly string[]).includes(method) ? (method as ReceiptMethod) : "",
    kind: RECEIPT_KINDS.find((k) => RECEIPT_KIND_PARAM[k] === first(params.tipo)) ?? "",
    page: pageOf(params),
  };
}

/** `de`/`ate` vão sempre para a URL (vazios inclusive): "todo o período" é uma escolha, não o padrão. */
export function receiptStatementQueryToSearchParams(q: ReceiptStatementQuery): URLSearchParams {
  const p = new URLSearchParams();
  if (q.search && isUrlSafe(q.search)) p.set("busca", q.search);
  p.set("de", q.from);
  p.set("ate", q.to);
  if (q.method) p.set("forma", q.method);
  if (q.kind) p.set("tipo", RECEIPT_KIND_PARAM[q.kind]);
  if (q.page > 1) p.set("pagina", String(q.page));
  return p;
}

export function receiptStatementQueryToInput(q: ReceiptStatementQuery): Record<string, unknown> {
  return {
    q: q.search.trim() || undefined,
    from: q.from || undefined,
    to: q.to || undefined,
    method: q.method || undefined,
    kind: q.kind || undefined,
    page: q.page,
    pageSize: RECEIPT_STATEMENT_PAGE_SIZE,
    sortBy: "occurredAt",
    sortDirection: "desc",
  };
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
  /** Período pela data da despesa. */
  from: string;
  to: string;
  page: number;
}

export const EXPENSE_PAGE_SIZE = 25;
export const DEFAULT_EXPENSE_QUERY: ExpenseListQuery = { category: "", status: "", from: "", to: "", page: 1 };

export function expenseQueryFromSearchParams(params: Params): ExpenseListQuery {
  const category = first(params.categoria);
  return {
    category: (EXPENSE_CATEGORIES as readonly string[]).includes(category) ? (category as ExpenseCategory) : "",
    status: EXPENSE_STATUSES.find((s) => EXPENSE_STATUS_PARAM[s] === first(params.situacao)) ?? "",
    from: isoDateParam(params.de),
    to: isoDateParam(params.ate),
    page: pageOf(params),
  };
}

export function expenseQueryToSearchParams(q: ExpenseListQuery): URLSearchParams {
  const p = new URLSearchParams();
  if (q.category) p.set("categoria", q.category);
  if (q.status) p.set("situacao", EXPENSE_STATUS_PARAM[q.status]);
  if (q.from) p.set("de", q.from);
  if (q.to) p.set("ate", q.to);
  if (q.page > 1) p.set("pagina", String(q.page));
  return p;
}

export function expenseQueryToInput(q: ExpenseListQuery, scope: { processId?: string } = {}): Record<string, unknown> {
  return {
    ...scope,
    category: q.category || undefined,
    status: q.status || undefined,
    from: q.from || undefined,
    to: q.to || undefined,
    page: q.page,
    pageSize: EXPENSE_PAGE_SIZE,
    sortBy: "incurredOn",
    sortDirection: "desc",
  };
}
