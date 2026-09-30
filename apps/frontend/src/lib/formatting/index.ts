import { daysSince, daysUntil, now, parseISODate } from "@/lib/clock";
import type { DeadlineUrgency } from "@/lib/constants/status";

export * from "./masks";

const currencyFmt = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const currencyCompactFmt = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  notation: "compact",
  maximumFractionDigits: 1,
});
const usdFmt = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD" });
const numberFmt = new Intl.NumberFormat("pt-BR");
const compactFmt = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });
const dateFmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
const dateShortFmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" });
const dateLongFmt = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const timeFmt = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });

export function formatCurrency(value: number | undefined | null): string {
  if (value == null || Number.isNaN(value)) return "—";
  return currencyFmt.format(value);
}

export function formatCurrencyCompact(value: number): string {
  return currencyCompactFmt.format(value);
}

export function formatUsd(value: number): string {
  return usdFmt.format(value);
}

export function formatNumber(value: number): string {
  return numberFmt.format(value);
}

export function formatCompact(value: number): string {
  return compactFmt.format(value);
}

export function formatPercent(value: number | undefined, digits = 0): string {
  if (value == null) return "—";
  return `${value.toFixed(digits).replace(".", ",")}%`;
}

function toDate(value: string | Date): Date {
  if (value instanceof Date) return value;
  return value.length <= 10 ? parseISODate(value) : new Date(value);
}

export function formatDate(value: string | Date | undefined): string {
  if (!value) return "—";
  return dateFmt.format(toDate(value));
}

export function formatDateShort(value: string | Date): string {
  return dateShortFmt.format(toDate(value)).replace(".", "");
}

export function formatDateLong(value: string | Date): string {
  return dateLongFmt.format(toDate(value));
}

export function formatDateTime(value: string | Date | undefined): string {
  if (!value) return "—";
  return dateTimeFmt.format(toDate(value)).replace(",", " ·");
}

export function formatTime(value: string | Date): string {
  return timeFmt.format(toDate(value));
}

/** "hoje", "ontem", "há 3 dias", "em 2 dias"… */
export function formatRelativeDay(value: string | Date): string {
  const diff = daysUntil(toDate(value));
  if (diff === 0) return "hoje";
  if (diff === 1) return "amanhã";
  if (diff === -1) return "ontem";
  if (diff > 1) return `em ${diff} dias`;
  return `há ${Math.abs(diff)} dias`;
}

/** Para eventos com hora: "hoje, 14:32" / "ontem, 09:10" / "12/09/2026". */
export function formatEventTime(value: string): string {
  const diff = daysSince(value);
  if (diff === 0) return `hoje, ${formatTime(value)}`;
  if (diff === 1) return `ontem, ${formatTime(value)}`;
  if (diff < 7) return `há ${diff} dias`;
  return formatDate(value);
}

/** "há 18 minutos", "há 3 horas"; acima de um dia, igual a formatEventTime. */
export function formatSince(value: string, reference: Date = now()): string {
  const minutes = Math.floor((reference.getTime() - new Date(value).getTime()) / 60_000);
  if (minutes < 1) return "há instantes";
  if (minutes < 60) return `há ${minutes} ${minutes === 1 ? "minuto" : "minutos"}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} ${hours === 1 ? "hora" : "horas"}`;
  return formatEventTime(value);
}

/** "aguardando há 4 dias" → devolve só o trecho temporal. */
export function formatWaitingTime(since: string): string {
  const days = daysSince(since);
  if (days <= 0) return "menos de 1 dia";
  if (days === 1) return "1 dia";
  return `${days} dias`;
}

export function deadlineUrgency(dueDate: string): DeadlineUrgency {
  const diff = daysUntil(dueDate);
  if (diff < 0) return "OVERDUE";
  if (diff === 0) return "TODAY";
  if (diff === 1) return "TOMORROW";
  if (diff <= 5) return "SOON";
  return "LATER";
}

/** Texto curto para o vencimento: "Vence hoje", "Vence em 3 dias", "Venceu há 2 dias". */
export function formatDeadline(dueDate: string): string {
  const diff = daysUntil(dueDate);
  if (diff === 0) return "Vence hoje";
  if (diff === 1) return "Vence amanhã";
  if (diff > 1) return `Vence em ${diff} dias`;
  if (diff === -1) return "Venceu ontem";
  return `Venceu há ${Math.abs(diff)} dias`;
}

export function initials(name: string): string {
  const parts = name
    .replace(/^(Dra?\.|Sr\.|Sra\.)\s+/i, "")
    .split(/\s+/)
    .filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

export function pluralize(count: number, singular: string, plural: string): string {
  return `${formatNumber(count)} ${count === 1 ? singular : plural}`;
}

export function greeting(date: Date): string {
  const h = date.getHours();
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
}
