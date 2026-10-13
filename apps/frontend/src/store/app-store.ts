"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createSeedData } from "@/mocks";
import { createAnalysisSlice } from "./slices/clients-analyses";
import { createImportSlice } from "./slices/data-import";
import { createDgSlice, createFinanceSlice } from "./slices/finance-dg";
import { createReviewSlice } from "./slices/processes-reviews";
import { nowISO } from "@/lib/clock";
import { syncCaseStatuses } from "@/lib/domain/legal-case";
import { createPartnerSlice } from "./slices/partners";
import { createReferenceSlice } from "./slices/references";
import { createOfficeSlice, createSessionSlice, initialSession } from "./slices/session-office";
import type { SetState } from "./helpers";
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
// v4: origem obrigatória do cliente (originOfficeId), gênero padronizado, versões de revisão por agente.
// v5: Cliente → Caso → Processo; parceria nasce no aceite do caso; Referências; sem legado multi-escritório.
// v7: Database V1 — caso com originOrganizationId/createdByOrganizationId/partnerOrganizationId
//     (visibilidade do parceiro só por partnerOrganizationId); vocabulário canônico do banco
//     (prazo COMPLETED/CANCELLED, origem de movimentação JUDICIAL_INTEGRATION/IMPORT,
//     integração JUDICIAL/OTHER); sem autonomia AUTO_LOW_RISK.
// v8: origem do caso nunca concede acesso operacional; vínculo do parceiro só por opt-in explícito.
// v9: identidade real (Supabase Auth): a sessão NÃO é mais persistida no navegador.
const STORAGE_VERSION = 9;

export const useAppStore = create<AppStore>()(
  persist(
    (rawSet, get) => {
      /**
       * Antes da decisão (aceite/rejeição), o status do caso acompanha a
       * análise jurídica dele. A sincronização fica num único lugar: qualquer
       * ação que mude análises atualiza os casos na mesma operação.
       */
      const set = ((partial, replace) => {
        const before = get().analyses;
        (rawSet as (p: unknown, r?: boolean) => void)(partial, replace as boolean | undefined);
        const after = get();
        if (after.analyses !== before) {
          const synced = syncCaseStatuses(after.legalCases, after.analyses, nowISO());
          if (synced !== after.legalCases) rawSet({ legalCases: synced });
        }
      }) as SetState;
      return {
        ...createSeedData(),
        session: initialSession(),
        preferences: {},
        ...createSessionSlice(set, get),
        ...createOfficeSlice(set, get),
        ...createImportSlice(set, get),
        ...createAnalysisSlice(set, get),
        ...createReviewSlice(set, get),
        ...createFinanceSlice(set, get),
        ...createDgSlice(set, get),
        ...createPartnerSlice(set, get),
        ...createReferenceSlice(set, get),
      };
    },
    {
      name: STORAGE_KEY,
      version: STORAGE_VERSION,
      storage: createJSONStorage(() => localStorage),
      // Hidratação manual (ver HydrationGate) para evitar divergência SSR/cliente.
      skipHydration: true,
      partialize: (state): AppState => {
        const data: Partial<AppStore> = {};
        for (const [key, value] of Object.entries(state)) {
          // A sessão nunca vai para o localStorage: vem do servidor a cada carga.
          if (typeof value !== "function" && key !== "session") (data as Record<string, unknown>)[key] = value;
        }
        return data as AppState;
      },
      // Versão diferente = dados antigos incompatíveis: recomeça do seed.
      migrate: () => ({ ...createSeedData(), session: initialSession(), preferences: {} }) as AppStore,
    },
  ),
);

export type { AppStore };
