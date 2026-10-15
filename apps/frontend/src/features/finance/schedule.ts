import type { ScheduleFrequency } from "@/server/domain/finance/schemas";

/**
 * PRÉVIA do cronograma de parcelas (4.3.1). Espelha EXATAMENTE a regra do
 * banco (private.payment_schedule_amounts / payment_schedule_due, 035) —
 * testado com os mesmos exemplos do verificador. A criação de verdade é no
 * banco: o navegador só mostra; nunca manda a lista de valores.
 *
 * Centavos: total em centavos inteiros; cada parcela = total ÷ N (inteiro);
 * o resto vai para as PRIMEIRAS parcelas, um centavo em cada.
 * Vencimentos: mensal = 1º + (i−1) meses a partir do 1º (dia preservado
 * quando o mês permite: 31/01 → 28/02 → 31/03); quinzenal +14; semanal +7.
 */

export const FREQUENCY_LABEL: Record<ScheduleFrequency, string> = {
  MONTHLY: "Mensal",
  BIWEEKLY: "Quinzenal",
  WEEKLY: "Semanal",
};

/** null = total inválido (zero, fração de centavo ou parcela abaixo de R$ 0,01). */
export function scheduleAmountsCents(total: number, count: number): number[] | null {
  if (!Number.isInteger(count) || count < 1 || !(total > 0)) return null;
  const cents = Math.round(total * 100);
  if (Math.abs(cents - total * 100) > 1e-6 || cents < count) return null;
  const base = Math.floor(cents / count);
  const rest = cents % count;
  return Array.from({ length: count }, (_, i) => base + (i < rest ? 1 : 0));
}

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Vencimento da i-ésima parcela (1-based), em AAAA-MM-DD, sem fuso (datas de calendário). */
export function scheduleDueDate(first: string, frequency: ScheduleFrequency, index: number): string {
  const [y, m, d] = first.split("-").map(Number);
  if (frequency === "MONTHLY") {
    const total = m - 1 + (index - 1);
    const year = y + Math.floor(total / 12);
    const month = (total % 12) + 1;
    return iso(year, month, Math.min(d, daysIn(year, month)));
  }
  const step = frequency === "BIWEEKLY" ? 14 : 7;
  const t = new Date(Date.UTC(y, m - 1, d + step * (index - 1)));
  return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export interface SchedulePreviewItem {
  index: number;
  description: string;
  dueDate: string;
  amount: number;
}

export function previewSchedule(input: { total: number; count: number; firstDueDate: string; frequency: ScheduleFrequency; description?: string }): SchedulePreviewItem[] | null {
  const cents = scheduleAmountsCents(input.total, input.count);
  if (!cents || !/^\d{4}-\d{2}-\d{2}$/.test(input.firstDueDate)) return null;
  const label = input.description?.trim() || "Parcela";
  return cents.map((c, i) => ({
    index: i + 1,
    description: `${label} ${i + 1}/${input.count}`,
    dueDate: scheduleDueDate(input.firstDueDate, input.frequency, i + 1),
    amount: c / 100,
  }));
}
