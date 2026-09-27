"use client";

import type { ReactNode } from "react";
import { Toaster } from "@/components/feedback/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider>
      {children}
      <Toaster />
    </TooltipProvider>
  );
}
