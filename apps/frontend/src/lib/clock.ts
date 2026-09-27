/**
 * Único ponto de acesso ao "agora" da aplicação.
 * Centralizar facilita testes e evita chamadas impuras espalhadas em render.
 */

const DAY_MS = 86_400_000;

export function now(): Date {
  return new Date();
}

export function nowISO(): string {
  return now().toISOString();
}

/** Data local no formato YYYY-MM-DD. */
export function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function todayISO(): string {
  return toISODate(now());
}

/** Converte "YYYY-MM-DD" em Date local (meia-noite), sem deslocamento de fuso. */
export function parseISODate(value: string): Date {
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Diferença em dias de calendário: positiva se `target` está no futuro. */
export function daysUntil(target: string | Date, from: Date = now()): number {
  const t = typeof target === "string" ? (target.length <= 10 ? parseISODate(target) : new Date(target)) : target;
  return Math.round((startOfDay(t).getTime() - startOfDay(from).getTime()) / DAY_MS);
}

/** Dias decorridos desde `past` (0 = hoje). */
export function daysSince(past: string | Date, from: Date = now()): number {
  return -daysUntil(past, from);
}

/** Helpers usados na geração dos mocks, relativos à data atual. */
export function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

export function daysFromNowISO(days: number, hour = 10, minute = 0): string {
  const d = addDays(now(), days);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

export function dateFromNow(days: number): string {
  return toISODate(addDays(now(), days));
}
