import pg from 'pg'

// O worker conecta com a service_role: ignora RLS por natureza.
// O limite dele é a allowlist de ferramentas em `agente.ferramentas`, não o banco.
export const pool = new pg.Pool({
  connectionString: obrigatorio('DATABASE_URL'),
  max: 4,
  idleTimeoutMillis: 30_000,
})

export function obrigatorio(nome: string): string {
  const v = process.env[nome]
  if (!v) throw new Error(`variável de ambiente ausente: ${nome}`)
  return v
}

export async function consulta<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
  const r = await pool.query(sql, params)
  return r.rows as T[]
}

export async function um<T = unknown>(sql: string, params: unknown[] = []): Promise<T | null> {
  const linhas = await consulta<T>(sql, params)
  return linhas[0] ?? null
}
