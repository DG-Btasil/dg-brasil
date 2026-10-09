"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { ClientSession } from "@/lib/auth/types";

const AuthContext = createContext<ClientSession | null>(null);

/**
 * Sessão que o SERVIDOR validou nesta requisição (requireAppSession) e
 * entregou ao navegador. Só leitura: o navegador não muda papel nem escritório.
 * A cada navegação de servidor, o layout reenvia a sessão atualizada.
 */
export function AuthProvider({ session, children }: { session: ClientSession; children: ReactNode }) {
  return <AuthContext.Provider value={session}>{children}</AuthContext.Provider>;
}

export function useClientSession(): ClientSession | null {
  return useContext(AuthContext);
}
