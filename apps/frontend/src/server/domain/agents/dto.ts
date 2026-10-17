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
  /** RUNNING com pedido de interrupção aguardando o worker confirmar (033). */
  cancelRequested?: boolean;
}

/** Resultado do pedido de interrupção (033). */
export interface AgentRunCancelDTO {
  agentRunId: ID;
  status: AgentRunStatus;
  /** CANCELLED: parou já. CANCEL_REQUESTED: o worker vai confirmar. ALREADY_*: repetição (idempotente). */
  outcome: "CANCELLED" | "CANCEL_REQUESTED" | "ALREADY_CANCELLED" | "ALREADY_REQUESTED";
}

/** Resultado do pedido. `deduplicated`: o mesmo pedido acabou de ser feito (duplo clique) e a execução existente foi devolvida. */
export interface AgentRunRequestDTO {
  runId: ID;
  deduplicated: boolean;
}

/** Uma execução, para a tela (get_agent_run_detail, 039). `usage`/`config` só para ADMIN. */
export interface AgentRunDetailDTO {
  id: ID;
  agent: { id: ID; name: string; slug: string };
  status: AgentRunStatus;
  cancelRequested: boolean;
  errorCode?: string;
  attempt: number;
  legalCaseId?: ID;
  processId?: ID;
  createdAt: ISODateTime;
  startedAt?: ISODateTime;
  completedAt?: ISODateTime;
  retryOfId?: ID;
  retriedByIds: ID[];
  analysisId?: ID;
  proposals: { id: ID; type: string; status: string; summary?: string; reviewId?: ID; applicationError?: string }[];
  documents: { versionId: ID; documentId: ID; title: string; versionNumber: number; reviewId?: ID; reviewStatus?: string }[];
  analysisResult?: { id: ID; summary: string; reviewId?: ID; reviewStatus?: string };
  usage?: {
    provider: string;
    model?: string;
    inputTokens?: number;
    outputTokens?: number;
    estimatedCost?: number;
    currency?: string;
    details?: Record<string, unknown>;
    toolsUsed?: Record<string, number>;
    errorMessage?: string;
  };
  config?: Record<string, unknown>;
}

export interface AgentRunRetryDTO {
  runId: ID;
  retryOfId: ID;
  deduplicated: boolean;
}
