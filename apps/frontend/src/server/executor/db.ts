import "server-only";

import { callPrivate } from "@/server/core/worker-db";

/**
 * Banco para o COMPUTADOR DO ESCRITÓRIO: só as portas private.executor_* (040).
 * Cada uma confere token do computador, token de reserva e a reserva viva, e
 * deriva o caso da execução. Conexão dg_worker (server/core/worker-db.ts).
 */

export const EXECUTOR_FUNCTIONS = [
  "executor_authenticate", "executor_list_jobs", "executor_claim", "executor_job_context", "executor_heartbeat",
  "executor_get_case", "executor_get_process", "executor_list_documents", "executor_open_document",
  "executor_list_theses", "executor_list_references", "executor_submit_analysis", "executor_create_proposal",
  "executor_prepare_output", "executor_finalize_output", "executor_record_config", "executor_complete",
  "executor_fail", "executor_release",
] as const;
export type ExecutorFunction = (typeof EXECUTOR_FUNCTIONS)[number];

export interface ExecutorDb {
  call<T = unknown>(fn: ExecutorFunction, args: unknown[]): Promise<T>;
}

export function pgExecutorDb(): ExecutorDb {
  return { call: <T>(fn: ExecutorFunction, args: unknown[]) => callPrivate<T>(EXECUTOR_FUNCTIONS, fn, args) };
}
