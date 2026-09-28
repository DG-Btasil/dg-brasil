"use client";

import * as RadixDialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}

/**
 * Modal acessível (foco preso, ESC fecha, aria). Usar apenas para
 * confirmações e formulários curtos — formulários longos têm página própria.
 */
export function Dialog({ open, onOpenChange, title, description, children, footer, size = "md" }: DialogProps) {
  const width = { sm: "max-w-[420px]", md: "max-w-[560px]", lg: "max-w-[760px]", xl: "max-w-[1040px]" }[size];
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-navy-950/40 animate-fade-in" />
        <RadixDialog.Content
          className={cn(
            "fixed left-1/2 top-[12vh] z-50 w-[calc(100vw-32px)] -translate-x-1/2 rounded-lg border border-line bg-surface shadow-overlay animate-panel-down focus:outline-none",
            width,
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
            <div>
              <RadixDialog.Title className="text-[15px] font-semibold text-foreground">{title}</RadixDialog.Title>
              {description ? (
                <RadixDialog.Description className="mt-1 text-[13px] leading-relaxed text-muted">{description}</RadixDialog.Description>
              ) : (
                <RadixDialog.Description className="sr-only">{title}</RadixDialog.Description>
              )}
            </div>
            <RadixDialog.Close aria-label="Fechar" className="-mr-2 rounded-md p-1.5 text-subtle hover:bg-surface-sunken hover:text-foreground">
              <X className="size-4" />
            </RadixDialog.Close>
          </div>
          {children && <div className="max-h-[62vh] overflow-y-auto px-6 py-5">{children}</div>}
          {footer && <div className="flex items-center justify-end gap-2 border-t border-line bg-surface-muted px-6 py-3.5 rounded-b-lg">{footer}</div>}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

interface DrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}

/** Painel lateral para contexto secundário (não é navegação). */
export function Drawer({ open, onOpenChange, title, description, children, footer, width = 520 }: DrawerProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-navy-950/30 animate-fade-in" />
        <RadixDialog.Content
          style={{ width }}
          className="fixed inset-y-0 right-0 z-50 flex max-w-[calc(100vw-32px)] flex-col border-l border-line bg-surface shadow-overlay animate-slide-in-right focus:outline-none"
        >
          <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
            <div>
              <RadixDialog.Title className="text-[15px] font-semibold text-foreground">{title}</RadixDialog.Title>
              {description ? (
                <RadixDialog.Description className="mt-1 text-[13px] text-muted">{description}</RadixDialog.Description>
              ) : (
                <RadixDialog.Description className="sr-only">{title}</RadixDialog.Description>
              )}
            </div>
            <RadixDialog.Close aria-label="Fechar" className="-mr-2 rounded-md p-1.5 text-subtle hover:bg-surface-sunken hover:text-foreground">
              <X className="size-4" />
            </RadixDialog.Close>
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
          {footer && <div className="flex items-center justify-end gap-2 border-t border-line px-6 py-3.5">{footer}</div>}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
