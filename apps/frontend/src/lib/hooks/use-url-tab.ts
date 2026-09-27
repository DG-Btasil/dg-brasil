"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

/**
 * Sincroniza a aba ativa com `?aba=` na URL, para que links de
 * notificações abram diretamente a aba correta (ex.: ?aba=prazos).
 * Componentes que usam este hook precisam estar dentro de <Suspense>.
 */
export function useUrlTab<K extends string>(allowed: readonly K[], fallback: K, param = "aba"): [K, (key: K) => void] {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const raw = searchParams.get(param);
  const current = (allowed as readonly string[]).includes(raw ?? "") ? (raw as K) : fallback;

  const setTab = useCallback(
    (key: K) => {
      const params = new URLSearchParams(searchParams.toString());
      if (key === fallback) params.delete(param);
      else params.set(param, key);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [searchParams, router, pathname, fallback, param],
  );

  return [current, setTab];
}
