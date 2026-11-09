/**
 * "A receber por vencimento" (E-06): saldo EM ABERTO das obrigações, em faixas
 * de vencimento contadas a partir de hoje no fuso de São Paulo (o mesmo do
 * status OVERDUE da view payment_balances). Funções puras, testadas em
 * aging.test.ts. Somas em centavos inteiros.
 */

/** Faixas, na ordem do gráfico. */
export const RECEIVABLE_AGING_BUCKETS = ["OVERDUE", "UP_TO_30", "DAYS_31_60", "DAYS_61_90", "OVER_90"] as const;
export type ReceivableAgingBucket = (typeof RECEIVABLE_AGING_BUCKETS)[number];

export interface ReceivableAgingPoint {
  bucket: ReceivableAgingBucket;
  amount: number;
  /** Obrigações com saldo na faixa. */
  count: number;
}

export interface ReceivableAging {
  buckets: ReceivableAgingPoint[];
  /** Saldo em aberto de obrigações SEM vencimento (não cabe em nenhuma faixa). */
  undated: { amount: number; count: number };
  total: number;
}

/** Linha mínima da view payment_balances. */
export interface AgingBalanceRow {
  financial_agreement_id: string;
  due_date: string | null;
  balance: number | string;
  status: string;
}

const OPEN = new Set(["PENDING", "PARTIAL", "OVERDUE"]);
const DAY_MS = 86_400_000;
const SP_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });

/** "AAAA-MM-DD" de hoje em São Paulo. */
export function saoPauloToday(now: Date): string {
  return SP_DATE.format(now);
}

const utcDay = (isoDate: string) => {
  const [y, m, d] = isoDate.slice(0, 10).split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};

/** Dias corridos de `today` até `dueDate` (negativo = vencida). Datas puras: sem fuso nem horário de verão no meio. */
export function daysUntil(dueDate: string, today: string): number {
  return Math.round((utcDay(dueDate) - utcDay(today)) / DAY_MS);
}

/**
 * Faixa da obrigação. Vencida = antes de hoje (vence hoje ainda está "até 30
 * dias", como no status do banco). `null` = sem vencimento.
 */
export function agingBucket(dueDate: string | null, today: string): ReceivableAgingBucket | null {
  if (!dueDate) return null;
  const days = daysUntil(dueDate, today);
  if (days < 0) return "OVERDUE";
  if (days <= 30) return "UP_TO_30";
  if (days <= 60) return "DAYS_31_60";
  if (days <= 90) return "DAYS_61_90";
  return "OVER_90";
}

/**
 * Soma o saldo em aberto (PENDING, PARTIAL ou OVERDUE, saldo > 0) por faixa.
 * O status OVERDUE do banco manda: vencida para o banco é "Em atraso", como
 * no indicador. `eligibleAgreementIds` restringe aos contratos de processo
 * (contratos antigos, só do caso, ficam fora — mesma regra dos totais).
 */
export function receivableAging(rows: AgingBalanceRow[], now: Date, eligibleAgreementIds?: ReadonlySet<string>): ReceivableAging {
  const today = saoPauloToday(now);
  const sums = Object.fromEntries(RECEIVABLE_AGING_BUCKETS.map((b) => [b, { cents: 0, count: 0 }])) as Record<ReceivableAgingBucket, { cents: number; count: number }>;
  const undated = { cents: 0, count: 0 };
  let totalCents = 0;
  for (const r of rows) {
    if (!OPEN.has(r.status)) continue;
    if (eligibleAgreementIds && !eligibleAgreementIds.has(r.financial_agreement_id)) continue;
    const value = Math.round(Number(r.balance) * 100);
    if (!(value > 0)) continue;
    const bucket = r.status === "OVERDUE" ? "OVERDUE" : agingBucket(r.due_date, today);
    const slot = bucket ? sums[bucket] : undated;
    slot.cents += value;
    slot.count += 1;
    totalCents += value;
  }
  return {
    buckets: RECEIVABLE_AGING_BUCKETS.map((bucket) => ({ bucket, amount: sums[bucket].cents / 100, count: sums[bucket].count })),
    undated: { amount: undated.cents / 100, count: undated.count },
    total: totalCents / 100,
  };
}
