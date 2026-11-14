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
