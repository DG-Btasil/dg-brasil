import type { AgentRunCancelDTO, AgentRunSummaryDTO } from "@/server/domain/agents/dto";

/**
 * Regras de tela do "Interromper" (033). Puras e testadas; o banco decide de
 * verdade (request_agent_run_cancel) — aqui só se esconde o botão onde ele
 * seria recusado.
 */

/** Quem pode pedir: ADMIN e LAWYER (`analyses.start`). WAITING_HUMAN só ADMIN (o advogado decide em Revisões). */
export function canInterrupt(run: Pick<AgentRunSummaryDTO, "status" | "cancelRequested">, isAdmin: boolean): boolean {
  if (run.status === "QUEUED") return true;
  if (run.status === "RUNNING") return !run.cancelRequested;
  if (run.status === "WAITING_HUMAN") return isAdmin;
  return false;
}

export function interruptOutcomeMessage(outcome: AgentRunCancelDTO["outcome"]): { title: string; description?: string } {
  switch (outcome) {
    case "CANCELLED":
      return { title: "Execução interrompida", description: "Ela não será processada pelo agente." };
    case "CANCEL_REQUESTED":
      return { title: "Interrupção solicitada", description: "O agente vai parar e confirmar. O que já tiver entregue fica em Revisões." };
    case "ALREADY_REQUESTED":
      return { title: "A interrupção já tinha sido solicitada", description: "Aguardando o agente confirmar." };
    case "ALREADY_CANCELLED":
      return { title: "A execução já estava interrompida" };
  }
}

/**
 * A tela passa a mostrar a resposta do servidor ao "Interromper" logo que ela
 * chega (não é otimismo: é o que o banco gravou), sem esperar a recarga da
 * página. Na fila, a execução fica "Cancelada"; rodando, "Interrupção
 * solicitada". Resposta de outra execução não muda nada.
 */
export function withCancelAnswer<T extends Pick<AgentRunSummaryDTO, "id" | "status" | "cancelRequested">>(run: T, answer: AgentRunCancelDTO | null | undefined): T {
  if (!answer || answer.agentRunId !== run.id) return run;
  const requested = answer.outcome === "CANCEL_REQUESTED" || answer.outcome === "ALREADY_REQUESTED";
  return { ...run, status: answer.status, cancelRequested: requested || run.cancelRequested };
}

/** Situação do computador do escritório (getOfficeStatusAction). */
export interface OfficeRunState {
  executionEnabled: boolean;
  online: boolean;
}

/**
 * Por que uma execução está parada na fila, quando a causa é do escritório:
 * execução desligada pelo administrador ou nenhum computador conectado.
 * Nulo = o computador está conectado e vai pegar o trabalho.
 */
export function queuedRunNotice(office: OfficeRunState | undefined): { tone: "warning" | "info"; title: string; message: string } | null {
  if (!office) return null;
  if (!office.executionEnabled) {
    return {
      tone: "warning",
      title: "A execução pelo escritório está desligada.",
      message: "O administrador desligou o interruptor. O trabalho fica na fila e só começa quando a execução for religada em DG Brasil, Computador do escritório.",
    };
  }
  if (!office.online) {
    return {
      tone: "info",
      title: "Nenhum computador do escritório conectado agora.",
      message: "O trabalho fica na fila e começa quando alguém no escritório abrir o Claude Code e processar os trabalhos do DG Brasil.",
    };
  }
  return null;
}
