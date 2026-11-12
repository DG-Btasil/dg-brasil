import { formatDateTime, formatTime } from "@/lib/formatting";
import type { ExecutorWakeDTO } from "@/server/domain/dg/dto";

/**
 * "Verificar agora" (052): o que a tela diz sobre o último pedido. Regra pura,
 * sem React, para testar sem navegador.
 *
 * A Vigia consulta o DG Brasil a cada 15 a 30 s. Sem resposta em 2 minutos, o
 * mais provável é a janela da Vigia estar fechada (ou o computador desligado).
 * O pedido continua valendo por 10 minutos no banco: se a Vigia abrir nesse
 * tempo, ela atende e a tela muda para "atendido".
 */

export const WAKE_NO_ANSWER_MS = 120_000;
/** Depois disso, o pedido vira só histórico ("última verificação"). */
export const WAKE_RECENT_MS = 30 * 60_000;

export type WakeTone = "info" | "success" | "warning" | "neutral";

export interface WakeView {
  tone: WakeTone;
  text: string;
  /** A tela continua perguntando ao DG Brasil (pedido ainda pendente). */
  waiting: boolean;
  /** Já há um pedido esperando: o botão fica desabilitado. */
  pending: boolean;
}

type Last = NonNullable<ExecutorWakeDTO["last"]>;

export function describeWake(last: Last | undefined, now: number): WakeView | null {
  if (!last) return null;
  const requested = Date.parse(last.requestedAt);
  const age = now - requested;
  const who = last.attendedByName ? ` pelo ${last.attendedByName}` : "";

  if (last.status === "ATTENDED" && last.attendedAt) {
    if (now - Date.parse(last.attendedAt) > WAKE_RECENT_MS) {
      return { tone: "neutral", text: `Última verificação: ${formatDateTime(last.attendedAt)}${who}.`, waiting: false, pending: false };
    }
    return { tone: "success", text: `Atendido às ${formatTime(last.attendedAt)}${who}. A Vigia está processando a fila.`, waiting: false, pending: false };
  }
  if (last.status === "PENDING") {
    if (age < WAKE_NO_ANSWER_MS) {
      return { tone: "info", text: `Pedido enviado às ${formatTime(last.requestedAt)}. Aguardando a Vigia…`, waiting: true, pending: true };
    }
    return {
      tone: "warning",
      text: `A Vigia não respondeu (janela fechada?). Pedido das ${formatTime(last.requestedAt)} ainda vale por alguns minutos: abra o atalho "DG Brasil - Vigia" no computador do escritório.`,
      waiting: true,
      pending: true,
    };
  }
  // EXPIRED: ninguém atendeu em 10 minutos.
  if (age > WAKE_RECENT_MS) {
    return { tone: "neutral", text: `Última verificação pedida em ${formatDateTime(last.requestedAt)} não foi atendida.`, waiting: false, pending: false };
  }
  return {
    tone: "warning",
    text: `A Vigia não respondeu ao pedido das ${formatTime(last.requestedAt)} (janela fechada?). Abra o atalho "DG Brasil - Vigia" e peça de novo.`,
    waiting: false,
    pending: false,
  };
}

/** Intervalo entre as perguntas da tela: 3 s nos 2 primeiros minutos, depois 10 s. */
export function wakePollMs(last: Last | undefined, now: number): number {
  if (!last) return 10_000;
  return now - Date.parse(last.requestedAt) < WAKE_NO_ANSWER_MS ? 3_000 : 10_000;
}
