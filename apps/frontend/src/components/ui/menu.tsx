"use client";

import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { useDismiss } from "@/lib/hooks/use-dismiss";
import { buttonClasses, type ButtonSize, type ButtonVariant } from "./button";

export interface MenuItem {
  key: string;
  label: string;
  description?: string;
  icon?: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
}

/**
 * Botão com menu suspenso (ex.: "Editar ▾", "Baixar ▾"). Clique abre/fecha,
 * ESC e clique fora fecham, setas navegam entre as opções.
 */
export function MenuButton({
  label,
  icon,
  items,
  variant = "secondary",
  size = "sm",
  align = "right",
  disabled,
}: {
  label: string;
  icon?: ReactNode;
  items: MenuItem[];
  variant?: ButtonVariant;
  size?: ButtonSize;
  align?: "left" | "right";
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useDismiss(ref, open, (reason) => {
    setOpen(false);
    if (reason === "escape") buttonRef.current?.focus();
  });

  function onItemKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const next = event.key === "ArrowDown" ? Math.min(index + 1, items.length - 1) : Math.max(index - 1, 0);
    itemRefs.current[next]?.focus();
  }

  return (
    <div ref={ref} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            requestAnimationFrame(() => itemRefs.current[0]?.focus());
          }
        }}
        className={buttonClasses(variant, size)}
      >
        {icon}
        {label}
        <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div
          role="menu"
          aria-label={label}
          className={cn(
            "absolute top-[calc(100%+6px)] z-30 min-w-[230px] overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-overlay animate-panel-down",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          {items.map((item, index) => (
            <button
              key={item.key}
              ref={(el) => {
                itemRefs.current[index] = el;
              }}
              role="menuitem"
              type="button"
              disabled={item.disabled}
              onKeyDown={(e) => onItemKeyDown(e, index)}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className="flex w-full items-start gap-2.5 px-3.5 py-2 text-left text-[13px] text-foreground hover:bg-surface-muted focus:bg-surface-muted focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            >
              {item.icon && <span className="mt-0.5 text-subtle">{item.icon}</span>}
              <span className="min-w-0">
                <span className="block font-medium">{item.label}</span>
                {item.description && <span className="block text-[12px] text-muted">{item.description}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
