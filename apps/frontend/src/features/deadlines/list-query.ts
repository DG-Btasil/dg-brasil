import { DEADLINE_TYPES, type DeadlineType } from "@/lib/constants/status";
import type { DeadlineDTO } from "@/server/domain/processes/deadlines/dto";

/**
 * Estado da agenda de prazos (/prazos) ↔ URL ↔ entrada de `listDeadlinesAction`.
 * Tudo é filtrado e paginado no servidor. Puro e testado (list-query.test.ts).
 */

/** Situação escolhida na tela. "abertos" = em aberto, com os vencidos (o padrão). */
export const AGENDA_SITUATIONS = ["abertos", "vencidos", "no-prazo", "cumpridos", "cancelados", "perdidos", "todos"] as const;
export type AgendaSituation = (typeof AGENDA_SITUATIONS)[number];
export const AGENDA_SITUATION_LABEL: Record<AgendaSituation, string> = {
  abertos: "Em aberto (com os vencidos)",
  vencidos: "Vencidos",
  "no-prazo": "Em aberto, no prazo",
  cumpridos: "Cumpridos",
  cancelados: "Cancelados",
  perdidos: "Perdidos",
  todos: "Todas as situações",
};

/** Período do vencimento. "datas" usa `from` e `until`; os demais contam a partir de hoje. */
export const AGENDA_PERIODS = ["hoje", "5dias", "7dias", "30dias", "datas"] as const;
export type AgendaPeriod = (typeof AGENDA_PERIODS)[number];
export const AGENDA_PERIOD_LABEL: Record<AgendaPeriod, string> = {
  hoje: "Vence hoje",
  "5dias": "Próximos 5 dias",
  "7dias": "Próximos 7 dias",
  "30dias": "Próximos 30 dias",
  datas: "Escolher datas",
};
const PERIOD_DAYS: Record<Exclude<AgendaPeriod, "datas">, number> = { hoje: 0, "5dias": 5, "7dias": 7, "30dias": 30 };

export interface DeadlineAgendaQuery {
  situation: AgendaSituation;
  /** UUID do responsável ou "me" (os meus). */
  responsible: string;
  type: DeadlineType | "";
  period: AgendaPeriod | "";
  /** Datas civis (YYYY-MM-DD), só com `period = "datas"`. */
  from: string;
  until: string;
  /** Só prazos lançados por agente que ninguém conferiu. */
  agentUnchecked: boolean;
  /** Prazos de um caso (vem de links da Home e das notificações). */
  caseId: string;
  page: number;
}

export const AGENDA_PAGE_SIZE = 25;

export const DEFAULT_AGENDA_QUERY: DeadlineAgendaQuery = {
  situation: "abertos",
  responsible: "",
  type: "",
  period: "",
  from: "",
  until: "",
  agentUnchecked: false,
  caseId: "",
  page: 1,
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const oneOf = <T extends string>(values: readonly T[], v: string): T | "" => ((values as readonly string[]).includes(v) ? (v as T) : "");
const isDate = (v: string) => ISO_DATE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

export function agendaQueryFromSearchParams(params: Record<string, string | string[] | undefined>): DeadlineAgendaQuery {
  const page = Number.parseInt(first(params.pagina), 10);
  const responsible = first(params.responsavel);
  const from = first(params.de);
  const until = first(params.ate);
  const period = oneOf(AGENDA_PERIODS, first(params.periodo));
  const dates = period === "datas" || (!period && (isDate(from) || isDate(until)));
  return {
    situation: oneOf(AGENDA_SITUATIONS, first(params.situacao)) || "abertos",
    responsible: responsible === "eu" ? "me" : UUID.test(responsible) ? responsible : "",
    type: oneOf(DEADLINE_TYPES, first(params.tipo)),
    period: dates ? "datas" : period,
    from: dates && isDate(from) ? from : "",
    until: dates && isDate(until) ? until : "",
    agentUnchecked: first(params.agente) === "nao-conferidos",
    caseId: UUID.test(first(params.caso)) ? first(params.caso) : "",
    page: Number.isFinite(page) && page >= 1 && page <= 10_000 ? page : 1,
  };
}

export function agendaQueryToSearchParams(q: DeadlineAgendaQuery): URLSearchParams {
  const p = new URLSearchParams();
  if (q.situation !== DEFAULT_AGENDA_QUERY.situation) p.set("situacao", q.situation);
  if (q.responsible) p.set("responsavel", q.responsible === "me" ? "eu" : q.responsible);
  if (q.type) p.set("tipo", q.type);
  if (q.period && q.period !== "datas") p.set("periodo", q.period);
  if (q.period === "datas") {
    p.set("periodo", "datas");
    if (q.from) p.set("de", q.from);
    if (q.until) p.set("ate", q.until);
  }
  if (q.agentUnchecked) p.set("agente", "nao-conferidos");
  if (q.caseId) p.set("caso", q.caseId);
  if (q.page > 1) p.set("pagina", String(q.page));
  return p;
}

/** Endereço da agenda com filtros (links da Home, do processo e das notificações). */
export function agendaHref(q: Partial<DeadlineAgendaQuery> = {}): string {
  const qs = agendaQueryToSearchParams({ ...DEFAULT_AGENDA_QUERY, ...q }).toString();
  return qs ? `/prazos?${qs}` : "/prazos";
}

/** Data civil de hoje no fuso do escritório (YYYY-MM-DD). */
export function officeToday(at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

function plusDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Entrada de `listDeadlinesAction` (o servidor valida de novo). `today` = hoje no fuso do escritório. */
export function agendaQueryToInput(q: DeadlineAgendaQuery, today: string = officeToday()): Record<string, unknown> {
  const closed = q.situation === "cumpridos" || q.situation === "cancelados" || q.situation === "perdidos";
  const range =
    q.period === "datas"
      ? { fromDate: q.from || undefined, untilDate: q.until || undefined }
      : q.period
        ? { fromDate: today, untilDate: plusDays(today, PERIOD_DAYS[q.period]) }
        : {};
  return {
    page: q.page,
    pageSize: AGENDA_PAGE_SIZE,
    status: q.situation === "abertos" ? "OPEN" : q.situation === "cumpridos" ? "COMPLETED" : q.situation === "cancelados" ? "CANCELLED" : q.situation === "perdidos" ? "MISSED" : undefined,
    effectiveStatus: q.situation === "vencidos" ? "OVERDUE" : q.situation === "no-prazo" ? "OPEN" : undefined,
    responsibleUserId: q.responsible || undefined,
    type: q.type || undefined,
    ...range,
    agentUnchecked: q.agentUnchecked || undefined,
    caseId: q.caseId || undefined,
    // Pendentes: o mais antigo primeiro (vencidos no topo). Encerrados: o mais recente primeiro.
    sortDirection: closed ? "desc" : "asc",
  };
}

export function countAgendaFilters(q: DeadlineAgendaQuery): number {
  return [q.situation !== DEFAULT_AGENDA_QUERY.situation, q.responsible, q.type, q.period, q.agentUnchecked, q.caseId].filter(Boolean).length;
}

export interface AgendaGroup {
  /** "overdue" ou a data civil do grupo. */
  key: string;
  overdue: boolean;
  date?: string;
  items: DeadlineDTO[];
}

/**
 * Agrupa a página por dia, na ordem em que veio do servidor. Os vencidos (em
 * aberto com a data no passado) formam um grupo só, sempre no topo.
 */
export function groupAgenda(items: DeadlineDTO[]): AgendaGroup[] {
  const overdue = items.filter((d) => d.effectiveStatus === "OVERDUE");
  const groups: AgendaGroup[] = overdue.length ? [{ key: "overdue", overdue: true, items: overdue }] : [];
  const byDate = new Map<string, AgendaGroup>();
  for (const d of items) {
    if (d.effectiveStatus === "OVERDUE") continue;
    let group = byDate.get(d.dueDateLocal);
    if (!group) {
      group = { key: d.dueDateLocal, overdue: false, date: d.dueDateLocal, items: [] };
      byDate.set(d.dueDateLocal, group);
      groups.push(group);
    }
    group.items.push(d);
  }
  return groups;
}
