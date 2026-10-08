import pg from 'pg'

/**
 * O mínimo que o worker precisa do Postgres. Existe como interface para os
 * testes rodarem contra o PGlite com as mesmas migrations do Supabase.
 */
export interface Executor {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>
}

export interface Banco extends Executor {
  transacao<T>(fn: (tx: Executor) => Promise<T>): Promise<T>
  fechar(): Promise<void>
}

export async function um<T = Record<string, unknown>>(
  ex: Executor,
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const r = await ex.query<T>(sql, params)
  return r.rows[0] ?? null
}

/**
 * Conexão direta com o papel dg_worker (DATABASE_URL com esse usuário — nunca
 * postgres nem service role). dg_worker não ignora RLS e não lê tabela com dado
 * de cliente: lê a configuração de IA e chama as funções private.worker_*, que
 * exigem a reserva da execução e só devolvem o contexto dela.
 */
export function bancoPostgres(connectionString: string): Banco {
  const pool = new pg.Pool({ connectionString, max: 4, idleTimeoutMillis: 30_000 })

  return {
    query: (sql, params) => pool.query(sql, params) as never,
    async transacao(fn) {
      const cliente = await pool.connect()
      try {
        await cliente.query('begin')
        const r = await fn({ query: (sql, params) => cliente.query(sql, params) as never })
        await cliente.query('commit')
        return r
      } catch (erro) {
        await cliente.query('rollback')
        throw erro
      } finally {
        cliente.release()
      }
    },
    fechar: () => pool.end(),
  }
}
