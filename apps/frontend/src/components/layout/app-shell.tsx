"use client";

import type { ReactNode } from "react";
import { useIsPartner } from "@/features/auth/hooks";
import { ProductTour } from "@/features/tour/product-tour";
import { AppHeader } from "./app-header";
import { AuthGuard, HydrationGate } from "./guards";

/** O tour apresenta áreas internas: não é montado no portal do parceiro. */
function OwnerTour() {
  return useIsPartner() ? null : <ProductTour />;
}

/** Estrutura da área autenticada: header global + conteúdo + tour. */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <HydrationGate>
      <AuthGuard>
        <a href="#conteudo" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-[80] focus:rounded-md focus:bg-gold focus:px-3 focus:py-2 focus:text-navy">
          Pular para o conteúdo
        </a>
        <AppHeader />
        <main id="conteudo" className="min-h-[calc(100vh-var(--header-height))]">
          {children}
        </main>
        <OwnerTour />
      </AuthGuard>
    </HydrationGate>
  );
}
