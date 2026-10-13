"use client";

import { useCallback, useRef } from "react";

/**
 * Chave de idempotência por INTENÇÃO de envio (migration 027).
 *
 * - Clique duplo, retry após timeout ou erro de rede com os MESMOS dados →
 *   mesma chave: o banco devolve o recurso já criado (`deduplicated: true`).
 * - O usuário mudou os dados depois de uma tentativa → é outra intenção →
 *   chave nova (senão o banco recusaria: "chave já usada com outros dados").
 * - Depois do sucesso, `reset()`: o próximo envio é uma intenção nova.
 *
 * A chave vive só na memória do formulário (nunca global, nunca persistida).
 */
export function useIdempotencyKey() {
  const current = useRef<{ key: string; fingerprint: string } | null>(null);

  const keyFor = useCallback((payload: unknown): string => {
    const fingerprint = stableStringify(payload);
    if (!current.current || current.current.fingerprint !== fingerprint) {
      current.current = { key: crypto.randomUUID(), fingerprint };
    }
    return current.current.key;
  }, []);

  const reset = useCallback(() => {
    current.current = null;
  }, []);

  return { keyFor, reset };
}

/** JSON com chaves ordenadas: a ordem das propriedades não muda a "intenção". */
export function stableStringify(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}
