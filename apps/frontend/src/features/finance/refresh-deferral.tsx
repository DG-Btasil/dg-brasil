"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Gaveta do contrato (achados F3/F4 dos testes): depois de cada gravação, a
 * recarga da PÁGINA inteira (router.refresh) entrava na fila do Next antes da
 * leitura das parcelas da gaveta, que só chegava quando a página terminava
 * (10 a 15 s, sem nada mudar na gaveta). Dentro da gaveta, as gravações não
 * recarregam a página: marcam que algo mudou, a gaveta relê só o que mostra
 * (parcelas e o contrato) e a página é recarregada ao fechar a gaveta.
 */
export interface FinanceRefreshDeferral {
  /** Algo foi gravado: a página precisa ser recarregada quando a gaveta fechar. */
  markDirty: () => void;
}

const FinanceRefreshDeferralContext = createContext<FinanceRefreshDeferral | null>(null);

export function FinanceRefreshDeferralProvider({ value, children }: { value: FinanceRefreshDeferral; children: ReactNode }) {
  return <FinanceRefreshDeferralContext.Provider value={value}>{children}</FinanceRefreshDeferralContext.Provider>;
}

/** null fora da gaveta: a gravação recarrega a página na hora, como sempre. */
export function useFinanceRefreshDeferral(): FinanceRefreshDeferral | null {
  return useContext(FinanceRefreshDeferralContext);
}
