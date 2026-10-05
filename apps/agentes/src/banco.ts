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
 * Conexão direta (DATABASE_URL, usuário postgres do Supabase). O worker não tem
 * sessão de usuário: auth.uid() é null, então a RLS não se aplica e os triggers
 * tratam a escrita como do backend. As regras de dados (CHECKs, FKs, triggers de
 * integridade e o gate de revisão humana) continuam valendo.
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
