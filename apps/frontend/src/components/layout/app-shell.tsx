"use client";

import { useEffect, type ReactNode } from "react";
import { useIsPartner } from "@/features/auth/hooks";
import { ProductTour } from "@/features/tour/product-tour";
import { AppHeader } from "./app-header";
import { ClientGate } from "./guards";

/** O tour apresenta áreas internas: não é montado no portal do parceiro. */
function OwnerTour() {
  return useIsPartner() ? null : <ProductTour />;
}

/** Chave em que o protótipo antigo gravava dados fictícios no navegador. */
const LEGACY_DEMO_STORAGE_KEY = "dg-brasil:demo";

/**
 * O protótipo guardava dados de demonstração no navegador. O sistema não usa
 * mais essa cópia: o que sobrou de visitas antigas é apagado ao abrir.
 */
function useClearLegacyDemoData() {
  useEffect(() => {
    try {
      window.localStorage.removeItem(LEGACY_DEMO_STORAGE_KEY);
    } catch {
      // Navegador sem acesso ao armazenamento local: nada a limpar.
    }
  }, []);
}

/**
 * Estrutura da área autenticada. O ACESSO já foi decidido no servidor
 * ((app)/layout.tsx → requireAppSession); aqui só se monta a interface.: 
 * Header global + conteúdo + tour.
 */
export function AppShell({ children }: { children: ReactNode }) {
  useClearLegacyDemoData();
  return (
    <ClientGate>
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-[80] focus:rounded-md focus:bg-gold focus:px-3 focus:py-2 focus:text-navy">
        Pular para o conteúdo
      </a>
      <AppHeader />
      <main id="conteudo" className="min-h-[calc(100vh-var(--header-height))]">
        {children}
      </main>
      <OwnerTour />
    </ClientGate>
  );
}
