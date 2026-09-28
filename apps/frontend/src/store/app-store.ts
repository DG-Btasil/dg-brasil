"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createSeedData } from "@/mocks";
import { createAnalysisSlice, createClientSlice } from "./slices/clients-analyses";
import { createImportSlice } from "./slices/data-import";
import { createDgSlice, createFinanceSlice } from "./slices/finance-dg";
import { createProcessSlice, createReviewSlice } from "./slices/processes-reviews";
import { createPartnerSlice } from "./slices/partners";
import { createOfficeSlice, createSessionSlice, initialSession } from "./slices/session-office";
import type { AppState, AppStore } from "./types";

/**
 * Store do protótipo.
 *
 * Faz o papel que, no produto real, será dividido entre API + cache
 * (ex.: TanStack Query). Componentes NÃO importam este arquivo:
 * leem por hooks das features e escrevem pelos repositórios.
 *
 * Persistência: localStorage, apenas dados mockados da demonstração.
 * Nenhum segredo ou credencial é gravado aqui.
 */

export const STORAGE_KEY = "dg-brasil:demo";
// v2: status financeiro derivado, dados da Bárbara Cardoso Advocacia, Integração Judicial.
// v3: escritório proprietário único + escritórios parceiros (cliente canônico, origem relacional, snapshot financeiro).
const STORAGE_VERSION = 3;

export const useAppStore = create<AppStore>()(
  persist(
    (set, get) => ({
      ...createSeedData(),
      session: initialSession(),
      preferences: {},
      ...createSessionSlice(set, get),
      ...createOfficeSlice(set, get),
      ...createClientSlice(set, get),
      ...createImportSlice(set, get),
      ...createAnalysisSlice(set, get),
      ...createProcessSlice(set, get),
      ...createReviewSlice(set, get),
      ...createFinanceSlice(set, get),
      ...createDgSlice(set, get),
      ...createPartnerSlice(set, get),
    }),
    {
      name: STORAGE_KEY,
      version: STORAGE_VERSION,
      storage: createJSONStorage(() => localStorage),
      // Hidratação manual (ver HydrationGate) para evitar divergência SSR/cliente.
      skipHydration: true,
      partialize: (state): AppState => {
        const data: Partial<AppStore> = {};
        for (const [key, value] of Object.entries(state)) {
          if (typeof value !== "function") (data as Record<string, unknown>)[key] = value;
        }
        return data as AppState;
      },
      // Versão diferente = dados antigos incompatíveis: recomeça do seed.
      migrate: () => ({ ...createSeedData(), session: initialSession(), preferences: {} }) as AppStore,
    },
  ),
);

export type { AppStore };
