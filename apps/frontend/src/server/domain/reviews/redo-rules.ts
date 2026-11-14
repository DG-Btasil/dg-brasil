/**
 * "Pedir para o agente refazer" (070): regras e textos puros, usados no
 * servidor e na tela. O banco é a autoridade (`public.redo_agent_review`):
 * papel, revisão em aberto, um refazer por trabalho e no máximo 3 em cadeia.
 */

/** Tamanho do recado (o banco exige o mesmo). */
export const REDO_MESSAGE_MIN = 10;
export const REDO_MESSAGE_MAX = 4000;

/** Refazeres em cadeia a partir do trabalho original. No quarto, trata-se à mão. */
export const MAX_REDO_ROUNDS = 3;

/** "Refazer 1 de 3", para quem vai pedir o refazer número `round`. */
export function redoRoundLabel(round: number): string {
  return `Este será o refazer ${Math.min(Math.max(round, 1), MAX_REDO_ROUNDS)} de ${MAX_REDO_ROUNDS} a partir do trabalho original.`;
}

/** Situação do computador do escritório (getOfficeStatusAction). */
export interface OfficeState {
  executionEnabled: boolean;
  online: boolean;
}

/**
 * Aviso quando o pedido vai esperar na fila: execução desligada ou nenhum
 * computador do escritório conectado. Os mesmos textos da tela do caso
 * (análise) e da gaveta da publicação. Nulo = o agente pega logo.
 */
export function officeQueueNotice(office: OfficeState | undefined): { title: string; message: string; short: string } | null {
  if (!office) return null;
  if (!office.executionEnabled) {
    return {
      title: "A execução pelo escritório está desligada pelo administrador.",
      message: "O pedido entra na fila mesmo assim e só começa quando a execução for religada em DG Brasil → Computador do escritório.",
      short: "A execução está desligada: o pedido fica na fila até ser religada.",
    };
  }
  if (!office.online) {
    return {
      title: "Nenhum computador do escritório conectado agora.",
      message: "O pedido entra na fila mesmo assim e começa quando alguém no escritório abrir o Claude Code e processar os trabalhos do DG Brasil.",
      short: "Nenhum computador do escritório conectado: o pedido fica na fila.",
    };
  }
  return null;
}

/**
 * O que dizer sobre o trabalho refeito, conforme a situação dele agora. O
 * texto antigo ("os itens chegam em Revisões") só vale enquanto ele roda;
 * interrompido ou com falha, nada mais vai chegar e o item é tratado à mão.
 */
export function redoneSituation(status: string | undefined): { text: string; tone: "info" | "warning" | "neutral"; ended: boolean } {
  switch (status) {
    case "QUEUED":
      return { tone: "info", ended: false, text: "O trabalho refeito está na fila. O que o agente entregar chega em Revisões." };
    case "RUNNING":
      return { tone: "info", ended: false, text: "O agente está no trabalho refeito. O que ele entregar chega em Revisões." };
    case "WAITING_HUMAN":
    case "COMPLETED":
      return { tone: "neutral", ended: true, text: "O trabalho refeito já entregou: os itens dele estão em Revisões." };
    case "CANCELLED":
      return {
        tone: "warning",
        ended: true,
        text: "O trabalho refeito foi interrompido e não vai entregar nada. Trate este item aqui: aprove, corrija e aprove, ou rejeite.",
      };
    case "FAILED":
      return {
        tone: "warning",
        ended: true,
        text: "O trabalho refeito não terminou e não vai entregar nada. Trate este item aqui: aprove, corrija e aprove, ou rejeite.",
      };
    default:
      return { tone: "neutral", ended: false, text: "O que o agente refizer chega em Revisões." };
  }
}
