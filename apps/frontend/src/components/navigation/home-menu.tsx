"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/cn";
import { useAudience, useCan } from "@/features/auth/hooks";
import { useNavCounts } from "@/features/navigation/hooks";
import { useDismiss } from "@/lib/hooks/use-dismiss";
import { useUiStore } from "@/store/ui-store";
import { isNavActive, navItemsFor } from "./nav-config";
import { resolveRouteArea } from "./route-areas";

const OPEN_DELAY = 90;
const CLOSE_DELAY = 220;

/**
 * Navegação principal: o ícone da casa abre um painel que desliza para
 * baixo. Não é uma sidebar. Hover abre; clique fixa/alterna; clique fora
 * ou ESC fecha; setas navegam entre os itens.
 */
export function HomeMenu() {
  const pathname = usePathname();
  const can = useCan();
  const counts = useNavCounts();
  const audience = useAudience();
  const items = useMemo(() => navItemsFor(audience).filter((item) => can(item.permission)), [can, audience]);
  const [openState, setOpen] = useState(false);
  // Durante o tour guiado, o painel fica aberto para mostrar os módulos.
  const tourMenuOpen = useUiStore((s) => s.tourMenuOpen);
  const open = openState || tourMenuOpen;
  const [pinned, setPinned] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const linkRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusFirstOnOpen = useRef(false);
  const panelId = useId();

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const close = useCallback((returnFocus = false) => {
    setOpen(false);
    setPinned(false);
    if (returnFocus) buttonRef.current?.focus();
  }, []);

  useDismiss(wrapperRef, open, (reason) => close(reason === "escape"));

  // Fecha ao navegar para outra rota.
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setOpen(false);
    setPinned(false);
  }

  useEffect(() => {
    if (open && focusFirstOnOpen.current) {
      focusFirstOnOpen.current = false;
      const activeIndex = items.findIndex((i) => isNavActive(pathname, i.href));
      linkRefs.current[Math.max(activeIndex, 0)]?.focus();
    }
  }, [open, items, pathname]);

  useEffect(() => clearTimer, []);

  function onMouseEnter() {
    clearTimer();
    if (!open) timer.current = setTimeout(() => setOpen(true), OPEN_DELAY);
  }

  function onMouseLeave() {
    clearTimer();
    if (!pinned) timer.current = setTimeout(() => setOpen(false), CLOSE_DELAY);
  }

  function onButtonClick() {
    clearTimer();
    if (open && pinned) close();
    else {
      setOpen(true);
      setPinned(true);
    }
  }

  function onButtonKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      focusFirstOnOpen.current = true;
      setOpen(true);
      setPinned(true);
    }
  }

  function onLinkKeyDown(event: KeyboardEvent<HTMLAnchorElement>, index: number) {
    const cols = 3;
    let next = index;
    if (event.key === "ArrowRight") next = Math.min(index + 1, items.length - 1);
    else if (event.key === "ArrowLeft") next = Math.max(index - 1, 0);
    else if (event.key === "ArrowDown") next = Math.min(index + cols, items.length - 1);
    else if (event.key === "ArrowUp") {
      if (index < cols) {
        event.preventDefault();
        buttonRef.current?.focus();
        return;
      }
      next = index - cols;
    } else if (event.key === "Tab" && !event.shiftKey && index === items.length - 1) {
      close();
      return;
    } else return;
    event.preventDefault();
    linkRefs.current[next]?.focus();
  }

  // O acionador mostra a área atual (ícone + rótulo), vinda do mapa central de rotas.
  const area = resolveRouteArea(pathname, audience);
  const AreaIcon = area.icon;

  return (
    <div ref={wrapperRef} className="relative flex h-full items-center" onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} data-tour="home-menu">
      <button
        ref={buttonRef}
        type="button"
        aria-label={`Navegação principal — área atual: ${area.label}`}
        aria-expanded={open}
        aria-controls={panelId}
        aria-haspopup="true"
        onClick={onButtonClick}
        onKeyDown={onButtonKeyDown}
        className={cn(
          "group flex h-10 items-center gap-2 rounded-md px-3 text-white/80 transition-colors hover:bg-white/10 hover:text-white",
          open && "bg-white/10 text-white",
        )}
      >
        <AreaIcon className="size-[18px]" aria-hidden />
        <span className="text-[13px] font-medium">{area.label}</span>
        <span aria-hidden className={cn("h-px w-3 bg-gold transition-all", open ? "w-5" : "w-3")} />
      </button>

      {open && (
        <div
          id={panelId}
          className="absolute left-1/2 top-full z-40 w-[760px] -translate-x-1/2 animate-panel-down"
        >
          <nav aria-label="Módulos" data-tour="nav-panel" className="mt-0 overflow-hidden rounded-b-lg border border-t-0 border-line bg-surface shadow-overlay">
            <div className="h-0.5 bg-gold" aria-hidden />
            <ul className="grid grid-cols-3 gap-px bg-line">
              {items.map((item, index) => {
                const active = isNavActive(pathname, item.href);
                const Icon = item.icon;
                return (
                  <li key={item.key} className="bg-surface">
                    <Link
                      ref={(el) => {
                        linkRefs.current[index] = el;
                      }}
                      href={item.href}
                      data-tour={`nav-${item.key}`}
                      aria-current={active ? "page" : undefined}
                      onKeyDown={(e) => onLinkKeyDown(e, index)}
                      onClick={() => close()}
                      className={cn(
                        "group/item relative flex h-full items-start gap-3 px-5 py-4 transition-colors focus:outline-none focus-visible:bg-navy-50",
                        active ? "bg-navy-50/70" : "hover:bg-surface-muted",
                      )}
                    >
                      {active && <span aria-hidden className="absolute inset-y-3 left-0 w-0.5 bg-gold" />}
                      <span
                        className={cn(
                          "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border",
                          active ? "border-navy bg-navy text-white" : "border-line bg-surface-muted text-navy-700 group-hover/item:border-navy-600/40",
                        )}
                      >
                        <Icon className="size-4" aria-hidden />
                      </span>
                      <span className="min-w-0">
                        <span className="flex items-center gap-2">
                          <span className="text-[13.5px] font-semibold text-foreground">{item.label}</span>
                        </span>
                        <span className="mt-0.5 block text-[12px] leading-snug text-muted">{item.description}</span>
                        {counts[item.key] && <span className="mt-1.5 block text-[11.5px] font-medium text-navy-600">{counts[item.key]}</span>}
                      </span>
                    </Link>
                  </li>
                );
              })}
              {Array.from({ length: (3 - (items.length % 3)) % 3 }, (_, i) => (
                <li key={`filler-${i}`} className="bg-surface" aria-hidden />
              ))}
            </ul>
          </nav>
        </div>
      )}
    </div>
  );
}
