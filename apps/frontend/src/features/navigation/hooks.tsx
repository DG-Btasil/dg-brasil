"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { NavKey } from "@/components/navigation/nav-config";

/**
 * Contadores do menu da casa, contados no servidor (features/navigation/load)
 * e entregues pelo layout. Sem dado de demonstração.
 */
type NavCounts = Partial<Record<NavKey, string>>;
const NavCountsContext = createContext<NavCounts>({});

export function NavCountsProvider({ counts, children }: { counts: NavCounts; children: ReactNode }) {
  return <NavCountsContext.Provider value={counts}>{children}</NavCountsContext.Provider>;
}

export function useNavCounts(): NavCounts {
  return useContext(NavCountsContext);
}

/** true quando o store já leu o localStorage. */
export { useHydrated } from "@/store/hydration";
