import type { ID, ISODateTime } from "@/types";

export const PROCESS_TASK_STATUSES = ["OPEN", "QUEUED", "IN_PROGRESS", "IN_REVIEW", "DONE", "CANCELLED"] as const;
export type ProcessTaskStatus = (typeof PROCESS_TASK_STATUSES)[number];
export type ProcessTaskPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";

/** Tarefa do processo para os agentes, como a equipe interna vê. */
export interface ProcessTaskDTO {
  id: ID;
  processId: ID;
  legalCaseId: ID;
  title: string;
  instructions: string;
  status: ProcessTaskStatus;
  priority: ProcessTaskPriority;
  agentId?: ID;
  agentRunId?: ID;
  attempts: number;
  dueAt?: ISODateTime;
  lastError?: string;
  createdBy?: ID;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  completedBy?: ID;
  completedAt?: ISODateTime;
  completionNote?: string;
  cancelledAt?: ISODateTime;
  cancelReason?: string;
}

export interface TaskAgentDTO {
  id: ID;
  name: string;
  purpose?: string;
  isOrchestrator: boolean;
}
