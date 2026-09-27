"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useIsAuthenticated } from "@/features/auth/hooks";
import { useOffice } from "@/features/offices/hooks";
import { HydrationGate, ShellSkeleton } from "@/components/layout/guards";

function RootRedirect() {
  const router = useRouter();
  const isAuthenticated = useIsAuthenticated();
  const office = useOffice();
  useEffect(() => {
    if (!isAuthenticated) router.replace("/login");
    else if (!office.onboarding.completed) router.replace("/onboarding");
    else router.replace("/home");
  }, [isAuthenticated, office.onboarding.completed, router]);
  return <ShellSkeleton />;
}

/** "/" redireciona conforme o estado mockado (sessão e implantação). */
export default function RootPage() {
  return (
    <HydrationGate>
      <RootRedirect />
    </HydrationGate>
  );
}
