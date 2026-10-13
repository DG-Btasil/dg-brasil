import type { ID, ISODateTime } from "@/types";
import type { AgentRunStatus } from "./schemas";

/**
 * Resumo de execução de agente — exatamente as colunas fixas da RPC
 * get_agent_run_summaries. Sem metadata, pedido em texto, tokens, custo,
 * modelo nem mensagem de erro bruta (só o código).
 */
export interface AgentRunSummaryDTO {
  id: ID;
  agentId: ID;
  agentSlug: string;
  agentName: string;
  legalCaseId?: ID;
  processId?: ID;
  status: AgentRunStatus;
  operation: string;
  requestedById?: ID;
  attempt: number;
  errorCode?: string;
  createdAt: ISODateTime;
  startedAt?: ISODateTime;
  completedAt?: ISODateTime;
  proposalCount: number;
}

/** Resultado do pedido. `deduplicated`: o mesmo pedido acabou de ser feito (duplo clique) e a execução existente foi devolvida. */
export interface AgentRunRequestDTO {
  runId: ID;
  deduplicated: boolean;
}
