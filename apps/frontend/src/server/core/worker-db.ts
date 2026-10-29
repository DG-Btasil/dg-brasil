import "server-only";

import pg from "pg";

/**
 * Conexão do SERVIDOR do DG Brasil com o banco para o que não tem usuário
 * logado: a API do computador do escritório (040) e a sincronização do Google
 * Drive (041). Login dg_worker (DG_WORKER_DB_URL, só no servidor): não ignora
 * RLS, não lê tabela com dado de cliente e só executa funções private.* que
 * receberam grant explícito — cada chamador passa a SUA lista permitida.
 *
 * Use o pooler do Supabase (IPv4). O host direto db.<ref>.supabase.co é só
 * IPv6 e falha em rede sem IPv6 (QA 5, ENV-01). Sem prepared statement nomeado
 * (funciona com o pooler de transação).
 */

const g = globalThis as unknown as { __dgWorkerPool?: pg.Pool };

function pool(): pg.Pool {
  if (!g.__dgWorkerPool) {
    const connectionString = process.env.DG_WORKER_DB_URL;
    if (!connectionString) throw new Error("DG_WORKER_DB_URL ausente (variável só do servidor).");
    g.__dgWorkerPool = new pg.Pool({
      connectionString,
      max: 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 8_000,
      statement_timeout: 20_000,
      application_name: "dg-brasil-server",
    });
  }
  return g.__dgWorkerPool;
}

/** Chama private.<fn>(args...) e devolve o resultado. Objetos vão como JSON. */
export async function callPrivate<T>(allowed: readonly string[], fn: string, args: unknown[]): Promise<T> {
  if (!allowed.includes(fn) || !/^[a-z_]+$/.test(fn)) throw new Error("função não permitida");
  const params = args.map((a) => (a !== null && typeof a === "object" && !(a instanceof Date) ? JSON.stringify(a) : a));
  const placeholders = params.map((_, i) => `$${i + 1}`).join(", ");
  const { rows } = await pool().query(`select private.${fn}(${placeholders}) as r`, params);
  return rows[0]?.r as T;
}
