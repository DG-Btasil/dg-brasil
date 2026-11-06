import type { SupabaseClient } from "@supabase/supabase-js";
import { unwrap } from "@/server/core/db-errors";
import type { ProcessTaskRow, TaskAgentRow } from "./mappers";

/**
 * Acesso a dados das tarefas (047). Leitura direta (RLS: só equipe interna);
 * toda escrita pelas funções do banco — não há INSERT/UPDATE na tabela.
 */

const TASK_COLUMNS = `id, legal_process_id, legal_case_id, title, instructions, status, priority, agent_id, agent_run_id, attempts,
  due_at, last_error, created_by, created_at, updated_at, completed_by, completed_at, completion_note, cancelled_at, cancel_reason`;

export async function listByProcess(db: SupabaseClient, processId: string): Promise<ProcessTaskRow[]> {
  return (unwrap(
    await db.from("process_tasks").select(TASK_COLUMNS).eq("legal_process_id", processId).order("created_at", { ascending: false }).limit(200),
  ) ?? []) as ProcessTaskRow[];
}

export async function create(
  db: SupabaseClient,
  input: { processId: string; title: string; instructions: string; agentId: string | null; dueAt: string | null; priority: string; send: boolean },
): Promise<{ task_id: string; agent_run_id: string | null; status: string }> {
  return unwrap(
    await db.rpc("create_process_task", {
      p_legal_process_id: input.processId,
      p_title: input.title,
      p_instructions: input.instructions,
      p_agent_id: input.agentId,
      p_due_at: input.dueAt,
      p_priority: input.priority,
      p_send: input.send,
    }),
  ) as { task_id: string; agent_run_id: string | null; status: string };
}

export async function send(db: SupabaseClient, taskId: string, note: string | null): Promise<{ status: string; agent_run_id: string | null }> {
  return unwrap(await db.rpc("send_process_task", { p_task_id: taskId, p_note: note })) as { status: string; agent_run_id: string | null };
}

export async function complete(db: SupabaseClient, taskId: string, note: string | null): Promise<void> {
  unwrap(await db.rpc("complete_process_task", { p_task_id: taskId, p_note: note }));
}

export async function cancel(db: SupabaseClient, taskId: string, reason: string): Promise<void> {
  unwrap(await db.rpc("cancel_process_task", { p_task_id: taskId, p_reason: reason }));
}

export async function listAgents(db: SupabaseClient): Promise<TaskAgentRow[]> {
  return (unwrap(await db.rpc("list_task_agents")) ?? []) as TaskAgentRow[];
}

export async function saveSettings(db: SupabaseClient, orchestratorAgentId: string | null): Promise<void> {
  unwrap(await db.rpc("save_process_task_settings", { p_orchestrator_agent_id: orchestratorAgentId }));
}
