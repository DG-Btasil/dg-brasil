"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useIsAuthenticated } from "@/features/auth/hooks";
import { HydrationGate, ShellSkeleton } from "@/components/layout/guards";
import { OnboardingWizard } from "./wizard";

function OnboardingGuard() {
  const router = useRouter();
  const isAuthenticated = useIsAuthenticated();
  useEffect(() => {
    if (!isAuthenticated) router.replace("/login");
  }, [isAuthenticated, router]);
  if (!isAuthenticated) return <ShellSkeleton />;
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
