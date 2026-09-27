"use client";

import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface TabItem<K extends string> {
  key: K;
  label: string;
  count?: number;
  /** Marcador discreto de atenção (ex.: pendências). */
  attention?: boolean;
}

interface TabsProps<K extends string> {
  items: TabItem<K>[];
  value: K;
  onChange: (key: K) => void;
  label: string;
  className?: string;
}

/**
 * Abas horizontais (padrão WAI-ARIA: setas, Home, End).
 * O painel correspondente deve usar <TabPanel>.
 */
export function Tabs<K extends string>({ items, value, onChange, label, className }: TabsProps<K>) {
  const baseId = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % items.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else return;
    event.preventDefault();
    const item = items[next];
    if (item) {
      onChange(item.key);
      refs.current[next]?.focus();
    }
  }

  return (
    <div role="tablist" aria-label={label} className={cn("flex gap-6 border-b border-line", className)}>
      {items.map((item, index) => {
        const selected = item.key === value;
        return (
          <button
            key={item.key}
            ref={(el) => {
              refs.current[index] = el;
            }}
            role="tab"
            type="button"
            id={`${baseId}-tab-${item.key}`}
            aria-selected={selected}
            aria-controls={`tabpanel-${item.key}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.key)}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={cn(
              "relative -mb-px flex items-center gap-2 border-b-2 pb-2.5 pt-1 text-[13px] font-medium transition-colors",
              selected ? "border-gold text-navy" : "border-transparent text-muted hover:text-foreground",
            )}
          >
            {item.label}
            {item.count !== undefined && (
              <span className={cn("rounded-xs px-1.5 text-[11px] tabular", selected ? "bg-navy-50 text-navy-800" : "bg-surface-sunken text-muted")}>
                {item.count}
              </span>
            )}
            {item.attention && <span className="size-1.5 rounded-full bg-orange" aria-label="requer atenção" />}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({ tabKey, children, className }: { tabKey: string; children: ReactNode; className?: string }) {
  return (
    <div role="tabpanel" id={`tabpanel-${tabKey}`} tabIndex={-1} className={cn("focus:outline-none", className)}>
      {children}
    </div>
  );
}
