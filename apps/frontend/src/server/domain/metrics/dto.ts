/** Indicadores do período (049). Números vêm do banco já somados. */

export const METRIC_PERIODS = ["7", "30", "90", "365", "all"] as const;
export type MetricPeriod = (typeof METRIC_PERIODS)[number];
export const METRIC_PERIOD_LABEL: Record<MetricPeriod, string> = {
  "7": "7 dias",
  "30": "30 dias",
  "90": "90 dias",
  "365": "12 meses",
  all: "Desde o início",
};

const fmt = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

/** Datas (YYYY-MM-DD, fuso do escritório) do período: hoje e N−1 dias atrás. "Tudo" começa em 2024. */
export function periodRange(period: MetricPeriod, now = new Date()): { from: string; to: string } {
  const to = fmt(now);
  if (period === "all") return { from: "2024-01-01", to };
  return { from: fmt(new Date(now.getTime() - (Number(period) - 1) * 86_400_000)), to };
}

export interface Keyed {
  key: string;
  name?: string;
  total: number;
}

export interface MetricsPoint {
  bucket: string;
  clients: number;
  cases: number;
  accepted: number;
  processes: number;
  received: number;
  expenses: number;
  partner_share: number;
}

export interface DashboardMetricsDTO {
  period: { from: string; to: string; unit: "week" | "month" };
  clients: { total: number; active: number; new: number; by_kind: Record<string, number>; by_channel: Keyed[]; by_origin: Keyed[] };
  cases: {
    total: number;
    new: number;
    accepted: number;
    rejected: number;
    awaiting: number;
    in_analysis: number;
    active: number;
    by_status: Record<string, number>;
    by_channel: Keyed[];
    by_origin: Keyed[];
    by_area: Keyed[];
  };
  processes: { total: number; active: number; new: number; distributed: number; case_value_total: number; by_status: Record<string, number>; by_phase: Record<string, number> };
  deadlines: { overdue: number; next_7_days: number; completed: number };
  reviews: { pending: number; decided: number };
  tasks: { open: number; in_review: number; done: number };
  finance: { received: number; expenses_paid: number; partner_share: number };
  series: MetricsPoint[];
}
