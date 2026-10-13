"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { callAction, type ActionResult } from "@/lib/actions/result";
import type { Page } from "@/server/core/pagination";

/**
 * Listagem paginada NO SERVIDOR (padrão único das telas da Etapa 4.3).
 *
 * - A primeira página chega pronta do Server Component (sem flash de vazio).
 * - Mudou filtro/página/ordem → chama a Server Action de listagem (nunca
 *   baixa tudo para filtrar no navegador); a resposta de uma consulta antiga
 *   nunca sobrescreve a de uma mais nova.
 * - A consulta vai para a URL (`toSearch`) com `history.replaceState`:
 *   recarregar ou abrir em nova aba mostra a mesma lista. Dado sensível
 *   (CPF/CNPJ) não entra na URL — `toSearch` decide o que pode ir.
 * - Falha de rede vira erro recuperável (`retry`), não quebra a tela.
 */
export function useServerList<Q, T>({
  initialQuery,
  initialResult,
  load,
  toSearch,
}: {
  initialQuery: Q;
  initialResult: ActionResult<Page<T>>;
  load: (query: Q) => Promise<ActionResult<Page<T>>>;
  toSearch: (query: Q) => URLSearchParams;
}) {
  const [query, setQueryState] = useState(initialQuery);
  const [result, setResult] = useState(initialResult);
  const [pending, startTransition] = useTransition();
  const seq = useRef(0);
  const loadRef = useRef(load);
  const toSearchRef = useRef(toSearch);
  useEffect(() => {
    loadRef.current = load;
    toSearchRef.current = toSearch;
  });

  const run = useCallback((next: Q) => {
    const id = ++seq.current;
    startTransition(async () => {
      const r = await callAction(() => loadRef.current(next));
      if (id === seq.current) setResult(r);
    });
  }, []);

  const setQuery = useCallback(
    (next: Q) => {
      setQueryState(next);
      const qs = toSearchRef.current(next).toString();
      window.history.replaceState(null, "", qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
      run(next);
    },
    [run],
  );

  const retry = useCallback(() => run(query), [run, query]);

  return { query, setQuery, result, pending, retry };
}

/** Atraso da busca digitada (ms): não dispara uma consulta por tecla. */
export const SEARCH_DEBOUNCE_MS = 300;

/** Valor com atraso, para campos de busca. */
export function useDebouncedCallback<A extends unknown[]>(fn: (...args: A) => void, delay = SEARCH_DEBOUNCE_MS) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });
  useEffect(() => () => clearTimeout(timer.current), []);
  return useCallback(
    (...args: A) => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => fnRef.current(...args), delay);
    },
    [delay],
  );
}
