/**
 * Situação do sistema para um monitor externo (`GET /api/health`).
 *
 * Sem segredo e sem dado: diz só se o site responde e se o banco de dados
 * responde. A consulta ao banco é guardada por alguns segundos, para a rota
 * (que é pública) não virar um jeito de martelar o banco.
 */

export type DatabaseHealth = "ok" | "down" | "not_configured";

export interface HealthReport {
  status: "ok" | "degraded";
  database: DatabaseHealth;
  checkedAt: string;
}

export interface HealthDeps {
  /** `select 1` no banco; lança se não responder. `null` = conexão não configurada. */
  ping: (() => Promise<void>) | null;
  now?: () => number;
  /** Por quanto tempo vale a última resposta do banco. Padrão: 15 s. */
  cacheMs?: number;
  timeoutMs?: number;
}

export function createHealthCheck(deps: HealthDeps): () => Promise<HealthReport> {
  const now = deps.now ?? Date.now;
  const cacheMs = deps.cacheMs ?? 15_000;
  const timeoutMs = deps.timeoutMs ?? 4_000;
  let last: { at: number; database: DatabaseHealth } | null = null;
  let running: Promise<DatabaseHealth> | null = null;

  const probe = async (): Promise<DatabaseHealth> => {
    if (!deps.ping) return "not_configured";
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        deps.ping(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
        }),
      ]);
      return "ok";
    } catch {
      return "down";
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  return async () => {
    const t = now();
    if (!last || t - last.at >= cacheMs) {
      // Várias chamadas ao mesmo tempo esperam a mesma consulta.
      running ??= probe().finally(() => {
        running = null;
      });
      last = { at: t, database: await running };
    }
    return { status: last.database === "ok" ? "ok" : "degraded", database: last.database, checkedAt: new Date(last.at).toISOString() };
  };
}
