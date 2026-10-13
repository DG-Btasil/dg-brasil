"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { completeProductTour } from "@/server/onboarding";

interface ProductTourCompletion {
  /** Quando o usuário concluiu ou pulou a introdução; `null` = nunca (mostrar). */
  completedAt: string | null;
  /** Concluir/pular: some na hora e grava no banco (vale em qualquer navegador). */
  markCompleted: () => void;
}

const Ctx = createContext<ProductTourCompletion>({ completedAt: null, markCompleted: () => {} });

/** Estado inicial vem do SERVIDOR ((app)/layout.tsx), nunca do navegador. */
export function ProductTourStateProvider({ initialCompletedAt, children }: { initialCompletedAt: string | null; children: ReactNode }) {
  const [completedAt, setCompletedAt] = useState(initialCompletedAt);
  const markCompleted = useCallback(() => {
    setCompletedAt((current) => current ?? new Date().toISOString());
    void completeProductTour();
  }, []);
  return <Ctx.Provider value={{ completedAt, markCompleted }}>{children}</Ctx.Provider>;
}

export function useProductTourCompletion(): ProductTourCompletion {
  return useContext(Ctx);
}
