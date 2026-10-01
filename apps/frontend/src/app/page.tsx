"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useIsAuthenticated } from "@/features/auth/hooks";
import { HydrationGate, ShellSkeleton } from "@/components/layout/guards";

function RootRedirect() {
  const router = useRouter();
  const isAuthenticated = useIsAuthenticated();
  useEffect(() => {
    router.replace(isAuthenticated ? "/home" : "/login");
  }, [isAuthenticated, router]);
  return <ShellSkeleton />;
}

/** "/" redireciona conforme a sessão mockada. */
export default function RootPage() {
  return (
    <HydrationGate>
      <RootRedirect />
    </HydrationGate>
  );
}
