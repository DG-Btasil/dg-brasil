"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useIsAuthenticated, usePermission } from "@/features/auth/hooks";
import { AccessDenied, HydrationGate, ShellSkeleton } from "@/components/layout/guards";
import { OnboardingWizard } from "./wizard";

function OnboardingGuard() {
  const router = useRouter();
  const isAuthenticated = useIsAuthenticated();
  useEffect(() => {
    if (!isAuthenticated) router.replace("/login");
  }, [isAuthenticated, router]);
  // Implantação é do escritório proprietário: parceiros (e papéis sem permissão) não acessam.
  const canConfigure = usePermission("settings.office.edit");
  if (!isAuthenticated) return <ShellSkeleton />;
  if (!canConfigure) return <AccessDenied />;
  return <OnboardingWizard />;
}

/** Tela de implantação do escritório (fora do grupo autenticado com AppHeader). */
export function OnboardingScreen() {
  return (
    <HydrationGate>
      <OnboardingGuard />
    </HydrationGate>
  );
}
