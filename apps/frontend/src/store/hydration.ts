"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useAppStore } from "./app-store";

function subscribe(callback: () => void) {
  return useAppStore.persist.onFinishHydration(callback);
}

/** Indica se o estado persistido já foi carregado no cliente. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => useAppStore.persist.hasHydrated(),
    () => false,
  );
}

/** Dispara a hidratação uma única vez, no cliente. */
export function useRehydrateOnMount() {
  useEffect(() => {
    if (!useAppStore.persist.hasHydrated()) void useAppStore.persist.rehydrate();
  }, []);
}
