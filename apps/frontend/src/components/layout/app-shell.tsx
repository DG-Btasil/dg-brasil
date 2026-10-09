"use client";

import { useEffect, type ReactNode } from "react";
import { useIsPartner } from "@/features/auth/hooks";
import { useClientSession } from "@/features/auth/session-context";
import { ProductTour } from "@/features/tour/product-tour";
import { useAppStore } from "@/store/app-store";
import { demoPersonaId } from "@/store/slices/session-office";
import { AppHeader } from "./app-header";
import { HydrationGate, ShellSkeleton } from "./guards";

/** O tour apresenta áreas internas: não é montado no portal do parceiro. */
function OwnerTour() {
  return useIsPartner() ? null : <ProductTour />;
}

/**
 * Ponte temporária com os dados mock (até a 4.3): associa a sessão real à
 * persona de demonstração do mesmo papel, para recortar os dados fictícios.
 * Renderiza o app só depois da associação — nunca com a persona errada.
 */
function DemoPersonaGate({ children }: { children: ReactNode }) {
  const session = useClientSession();
  const target = useAppStore((s) => (session ? demoPersonaId(s, session.role, session.organizationName) : ""));
  const bound = useAppStore((s) => s.session.currentUserId);
  const bind = useAppStore((s) => s.bindDemoPersona);

  useEffect(() => {
    if (target && bound !== target) bind(target);
  }, [target, bound, bind]);

  if (!target || bound !== target) return <ShellSkeleton />;
  return <>{children}</>;
}

/**
 * Estrutura da área autenticada. O ACESSO já foi decidido no servidor
 * ((app)/layout.tsx → requireAppSession); aqui só se monta a interface.: 
 * Header global + conteúdo + tour.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <HydrationGate>
      <DemoPersonaGate>
        <a href="#conteudo" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-[80] focus:rounded-md focus:bg-gold focus:px-3 focus:py-2 focus:text-navy">
          Pular para o conteúdo
        </a>
        <AppHeader />
        <main id="conteudo" className="min-h-[calc(100vh-var(--header-height))]">
          {children}
        </main>
        <OwnerTour />
      </DemoPersonaGate>
    </HydrationGate>
  );
}
