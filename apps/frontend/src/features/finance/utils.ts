import { addDays, parseISODate, toISODate, todayISO } from "@/lib/clock";
import type { PaymentStatus } from "@/lib/constants/status";
import type { AgreementSummary, Client, FeeModel, FinancialAgreement, PaymentView, Process } from "@/types";

/** Linha consolidada da tabela de contratos. */
export interface AgreementRow extends AgreementSummary {
  clientName: string;
  process?: Process;
  feeModel?: FeeModel;
  payments: PaymentView[];
}

export function clientLabel(client: Client | undefined): string {
  if (!client) return "Cliente não encontrado";
  return client.kind === "INDIVIDUAL" ? client.fullName : (client.tradeName ?? client.legalName);
}

export function processLabel(process: Process): string {
  return process.cnj ? `${process.title} · ${process.cnj}` : process.title;
}

const moneyInputFmt = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Número → texto de campo monetário ("1.500,00"). Zero/indefinido viram vazio. */
export function toMoneyInput(value: number | undefined): string {
  return value ? moneyInputFmt.format(value) : "";
}

export function toPercentInput(value: number | undefined): string {
  return value == null ? "" : String(value).replace(".", ",");
}

/** Valores de honorários usados tanto no modelo quanto no contrato. */
export interface FeeValues {
  upfrontFee: number;
  fixedFee: number;
  installments: number;
  monthlyFee?: number;
  successFeePercent?: number;
}

export interface ScheduleItem {
  key: string;
  description: string;
  amount: number;
  dueDate: string;
  status: PaymentStatus;
}

/** Quantidade de mensalidades lançadas no cronograma inicial do protótipo. */
export const MONTHLY_PREVIEW_COUNT = 6;

/**
 * Prévia do cronograma. Espelha a geração feita ao salvar o contrato
 * (entrada na data de início, parcelas a cada 30 dias, mensalidades
 * iniciais). As regras de cobrança reais de cada escritório virão do backend.
 */
export function previewSchedule(values: FeeValues, startDate: string): ScheduleItem[] {
  if (!startDate) return [];
  const start = parseISODate(startDate);
  const today = todayISO();
  const list: ScheduleItem[] = [];
  const push = (description: string, amount: number, offsetDays: number) => {
    const dueDate = toISODate(addDays(start, offsetDays));
    list.push({ key: `${description}-${offsetDays}-${list.length}`, description, amount, dueDate, status: dueDate < today ? "OVERDUE" : "PENDING" });
  };
  if (values.upfrontFee > 0) push("Entrada", values.upfrontFee, 0);
  if (values.fixedFee > 0) {
    const n = Math.max(1, values.installments);
    const each = Math.round((values.fixedFee / n) * 100) / 100;
    for (let i = 1; i <= n; i += 1) push(`Parcela ${i}/${n}`, each, 30 * i);
  }
  if (values.monthlyFee && values.monthlyFee > 0) {
    for (let i = 0; i < MONTHLY_PREVIEW_COUNT; i += 1) push("Mensalidade", values.monthlyFee, 30 * i);
  }
  return list;
}

export function contractedTotal(values: FeeValues): number {
  return values.upfrontFee + values.fixedFee + (values.monthlyFee ? values.monthlyFee * MONTHLY_PREVIEW_COUNT : 0);
}

export function estimateSuccessFee(percent: number | undefined, caseValue: number | undefined): number | undefined {
  if (!percent || !caseValue) return undefined;
  return Math.round(caseValue * (percent / 100));
}

/** Contratos que valem para o processo: vinculados a ele ou ao cliente como um todo. */
export function agreementAppliesToProcess(agreement: FinancialAgreement, process: Process): boolean {
  if (agreement.processId) return agreement.processId === process.id;
  return agreement.clientId === process.clientId;
}

/* ------------------------------------------------------------------ */
/* Séries para os gráficos                                             */
/* ------------------------------------------------------------------ */

const monthFmt = new Intl.DateTimeFormat("pt-BR", { month: "short", year: "2-digit" });

export interface MonthlyPoint {
  key: string;
  label: string;
  received: number;
  open: number;
}

/** Janela de 6 meses: 4 anteriores, o atual e o próximo. */
export function monthlyReceipts(payments: PaymentView[], today: string): MonthlyPoint[] {
  const base = parseISODate(today);
  const months: MonthlyPoint[] = [];
  for (let offset = -4; offset <= 1; offset += 1) {
    const d = new Date(base.getFullYear(), base.getMonth() + offset, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    months.push({ key, label: monthFmt.format(d).replace(".", ""), received: 0, open: 0 });
  }
  const byKey = new Map(months.map((m) => [m.key, m]));
  for (const p of payments) {
    // Recebido entra no mês do recebimento; saldo em aberto, no mês do vencimento.
    if (p.paidAmount > 0) {
      const bucket = byKey.get((p.paidAt ?? p.dueDate).slice(0, 7));
      if (bucket) bucket.received += p.paidAmount;
    }
    if (p.balance > 0) {
      const bucket = byKey.get(p.dueDate.slice(0, 7));
      if (bucket) bucket.open += p.balance;
    }
  }
  return months;
}

export interface CompositionPoint {
  name: string;
  total: number;
  count: number;
}

/** Total contratado por modelo de honorários (até 4 modelos + "Outros"). */
export function compositionByFeeModel(rows: AgreementRow[]): CompositionPoint[] {
  const map = new Map<string, CompositionPoint>();
  for (const row of rows) {
    if (row.agreement.status === "CANCELLED") continue;
    const name = row.feeModel?.name ?? "Sem modelo (valores próprios)";
    const current = map.get(name) ?? { name, total: 0, count: 0 };
    current.total += row.agreement.totalContracted;
    current.count += 1;
    map.set(name, current);
  }
  const sorted = [...map.values()].sort((a, b) => b.total - a.total);
  if (sorted.length <= 5) return sorted;
  const rest = sorted.slice(4).reduce((acc, p) => ({ name: "Outros", total: acc.total + p.total, count: acc.count + p.count }), { name: "Outros", total: 0, count: 0 });
  return [...sorted.slice(0, 4), rest];
}
