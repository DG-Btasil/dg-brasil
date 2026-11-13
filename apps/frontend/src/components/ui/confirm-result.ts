/**
 * Resultado de uma confirmação: `false` ou um resultado de ação `{ ok: false }`
 * significam que a ação não foi feita, e o diálogo continua aberto.
 */
export function confirmFailed(result: unknown): boolean {
  if (result === false) return true;
  return typeof result === "object" && result !== null && "ok" in result && (result as { ok: unknown }).ok === false;
}
