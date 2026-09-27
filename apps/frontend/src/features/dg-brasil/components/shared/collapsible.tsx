"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";

/** Seção recolhível (área técnica, detalhes avançados). Fechada por padrão. */
export function Collapsible({
  title,
  description,
  icon,
  children,
  defaultOpen = false,
  className,
}: {
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <section className={cn("rounded-lg border border-line bg-surface shadow-hairline", className)}>
      <h2>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-start gap-3 px-5 py-3.5 text-left hover:bg-surface-muted"
        >
          <ChevronRight aria-hidden className={cn("mt-0.5 size-4 shrink-0 text-subtle transition-transform", open && "rotate-90")} />
          {icon && <span className="mt-0.5 shrink-0 text-muted">{icon}</span>}
          <span className="min-w-0">
            <span className="block text-[14px] font-semibold text-foreground">{title}</span>
            {description && <span className="mt-0.5 block text-[12.5px] font-normal text-muted">{description}</span>}
          </span>
        </button>
      </h2>
      {open && (
        <div id={id} className="border-t border-line px-5 py-4">
          {children}
        </div>
      )}
    </section>
  );
}
