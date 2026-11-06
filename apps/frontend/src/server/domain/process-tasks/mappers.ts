import { PROCESS_TASK_STATUSES, type ProcessTaskDTO, type ProcessTaskPriority, type ProcessTaskStatus, type TaskAgentDTO } from "./dto";

export interface ProcessTaskRow {
  id: string;
  legal_process_id: string;
  legal_case_id: string;
  title: string;
  instructions: string;
  status: string;
  priority: string;
  agent_id: string | null;
  agent_run_id: string | null;
  attempts: number;
  due_at: string | null;
  last_error: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  completed_by: string | null;
  completed_at: string | null;
  completion_note: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
}

export interface TaskAgentRow {
  id: string;
  name: string;
  purpose: string | null;
  is_orchestrator: boolean | null;
}

const opt = <T>(v: T | null | undefined): T | undefined => (v === null ? undefined : v);
const status = (v: string): ProcessTaskStatus => ((PROCESS_TASK_STATUSES as readonly string[]).includes(v) ? (v as ProcessTaskStatus) : "OPEN");
const priority = (v: string): ProcessTaskPriority => (["LOW", "NORMAL", "HIGH", "URGENT"].includes(v) ? (v as ProcessTaskPriority) : "NORMAL");

export function taskFromRow(row: ProcessTaskRow): ProcessTaskDTO {
  return {
    id: row.id,
    processId: row.legal_process_id,
    legalCaseId: row.legal_case_id,
    title: row.title,
    instructions: row.instructions,
    status: status(row.status),
    priority: priority(row.priority),
    agentId: opt(row.agent_id),
    agentRunId: opt(row.agent_run_id),
    attempts: row.attempts,
    dueAt: opt(row.due_at),
    lastError: opt(row.last_error),
    createdBy: opt(row.created_by),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedBy: opt(row.completed_by),
    completedAt: opt(row.completed_at),
    completionNote: opt(row.completion_note),
    cancelledAt: opt(row.cancelled_at),
    cancelReason: opt(row.cancel_reason),
  };
}

export function agentFromRow(row: TaskAgentRow): TaskAgentDTO {
  return { id: row.id, name: row.name, purpose: opt(row.purpose), isOrchestrator: !!row.is_orchestrator };
}

/** Ordem da lista: o que pede ação da equipe primeiro, depois o que está com os agentes, por fim o encerrado. */
const ORDER: Record<ProcessTaskStatus, number> = { IN_REVIEW: 0, OPEN: 1, QUEUED: 2, IN_PROGRESS: 3, DONE: 4, CANCELLED: 5 };
export function sortTasks(tasks: ProcessTaskDTO[]): ProcessTaskDTO[] {
  return [...tasks].sort((a, b) => ORDER[a.status] - ORDER[b.status] || b.createdAt.localeCompare(a.createdAt));
}
