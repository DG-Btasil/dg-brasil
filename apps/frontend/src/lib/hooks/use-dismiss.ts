"use client";

import { useEffect, type RefObject } from "react";

/** Fecha um popover ao clicar fora ou pressionar ESC. */
export function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, onDismiss: (reason: "outside" | "escape") => void) {
  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) onDismiss("outside");
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onDismiss("escape");
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [ref, open, onDismiss]);
}
