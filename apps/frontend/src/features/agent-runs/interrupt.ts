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
