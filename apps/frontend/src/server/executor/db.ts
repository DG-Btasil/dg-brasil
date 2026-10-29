import "server-only";

import pg from "pg";

/**
 * Conexão do servidor do DG Brasil com o banco PARA O COMPUTADOR DO
 * ESCRITÓRIO: login dg_worker (DG_WORKER_DB_URL, só no servidor), que não
 * ignora RLS, não lê tabela com dado de cliente e só executa as portas
 * private.executor_* — cada uma confere token do computador, token de reserva
 * e a reserva viva, e deriva o caso da execução.
 *
 * Use o pooler do Supabase (IPv4). O host direto db.<ref>.supabase.co é só
 * IPv6 e falha em rede sem IPv6 (QA 5, ENV-01). Em serverless, o pooler de
 * transação (porta 6543) é o indicado: aqui não há prepared statement nomeado.
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

const g = globalThis as unknown as { __dgExecutorPool?: pg.Pool };

function pool(): pg.Pool {
  if (!g.__dgExecutorPool) {
    const connectionString = process.env.DG_WORKER_DB_URL;
    if (!connectionString) throw new Error("DG_WORKER_DB_URL ausente (variável só do servidor).");
    g.__dgExecutorPool = new pg.Pool({
      connectionString,
      max: 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 8_000,
      statement_timeout: 20_000,
      application_name: "dg-brasil-executor-api",
    });
  }
  return g.__dgExecutorPool;
}

export function pgExecutorDb(): ExecutorDb {
  return {
    async call<T>(fn: ExecutorFunction, args: unknown[]) {
      if (!EXECUTOR_FUNCTIONS.includes(fn)) throw new Error("função não permitida");
      const params = args.map((a) => (a !== null && typeof a === "object" ? JSON.stringify(a) : a));
      const placeholders = params.map((_, i) => `$${i + 1}`).join(", ");
      const { rows } = await pool().query(`select private.${fn}(${placeholders}) as r`, params);
      return rows[0]?.r as T;
    },
  };
}
