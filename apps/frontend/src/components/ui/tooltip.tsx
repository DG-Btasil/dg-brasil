"use client";

import * as RadixTooltip from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";

export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <RadixTooltip.Provider delayDuration={250} skipDelayDuration={100}>
      {children}
    </RadixTooltip.Provider>
  );
}

/** Tooltip seletivo. O filho precisa ser focável (botão, link). */
export function Tooltip({ content, children, side = "top" }: { content: ReactNode; children: ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          sideOffset={6}
          className="z-[60] max-w-[260px] rounded-md bg-navy-900 px-2.5 py-1.5 text-[12px] leading-snug text-white shadow-overlay animate-fade-in"
        >
          {content}
          <RadixTooltip.Arrow className="fill-navy-900" />
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}

export const NEXT_STAGE_MESSAGE = "Disponível em uma próxima etapa";

/**
 * Ação ainda não implementada: aparece desabilitada com explicação.
 * Nunca deixar um botão aparentemente funcional que não faz nada.
 */
export function NotAvailable({ children, message = NEXT_STAGE_MESSAGE }: { children: ReactNode; message?: string }) {
  return (
    <Tooltip content={message}>
      <span tabIndex={0} className="inline-flex cursor-not-allowed rounded-md" aria-label={message}>
        <span className="pointer-events-none inline-flex opacity-50" aria-hidden>
          {children}
        </span>
      </span>
    </Tooltip>
  );
}
