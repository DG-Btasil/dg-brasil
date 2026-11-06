"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { buttonClasses, type ButtonSize, type ButtonVariant } from "./button";

const GAP = 6;
const MIN_WIDTH = 230;

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
 *
 * O menu flutua sobre a página (portal, posição fixa) para nunca ser cortado
 * por uma tabela com rolagem ou por um painel curto; abre para cima quando
 * não cabe embaixo e fecha ao rolar a página.
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
  const [position, setPosition] = useState<CSSProperties | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Dentro de um diálogo/painel modal, o menu vai para o próprio diálogo (fora dele
  // o modal bloqueia o clique); fora, vai para o body.
  const [host, setHost] = useState<HTMLElement | null>(null);

  const place = useCallback(() => {
    const button = buttonRef.current;
    if (!button) return;
    const container = button.closest<HTMLElement>('[role="dialog"]');
    setHost(container ?? document.body);
    const base = container ? container.getBoundingClientRect() : { top: 0, left: 0, bottom: window.innerHeight };
    const rect = button.getBoundingClientRect();
    const menuHeight = menuRef.current?.offsetHeight ?? 0;
    const below = window.innerHeight - rect.bottom;
    const openUp = menuHeight > 0 && below < menuHeight + GAP + 8 && rect.top > below;
    const width = Math.max(MIN_WIDTH, rect.width);
    const left = align === "right" ? Math.max(8, rect.right - width) : Math.min(rect.left, window.innerWidth - width - 8);
    setPosition({
      position: container ? "absolute" : "fixed",
      left: left - base.left,
      minWidth: width,
      maxHeight: Math.max(160, (openUp ? rect.top : below) - GAP - 8),
      ...(openUp ? { bottom: base.bottom - rect.top + GAP } : { top: rect.bottom - base.top + GAP }),
    });
  }, [align]);

  // Recalcula a cada abertura, antes de pintar (a posição anterior nunca aparece).
  useLayoutEffect(() => {
    if (open) place();
  }, [open, place, host]);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      const target = event.target as Node;
      if (ref.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    }
    const close = () => setOpen(false);
    // Rolar a página (ou o painel) fecha; rolar dentro do próprio menu, não.
    const onScroll = (event: Event) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

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
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={label}
            style={position ?? { position: "fixed", visibility: "hidden" }}
            className="z-[60] overflow-y-auto rounded-lg border border-line bg-surface py-1 shadow-overlay animate-panel-down"
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
          </div>,
          host ?? document.body,
        )}
    </div>
  );
}
