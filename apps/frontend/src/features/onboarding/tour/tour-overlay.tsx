"use client";

import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TourStep } from "./tour-steps";

interface Measure {
  top: number;
  left: number;
  width: number;
  height: number;
  vw: number;
  vh: number;
}

const PAD = 6;
const CARD_W = 360;
const CARD_EST_H = 210;
const GAP = 12;

function findAnchor(anchors: string[]): HTMLElement | null {
  for (const name of anchors) {
    const el = document.querySelector<HTMLElement>(`[data-tour="${name}"]`);
    if (el && el.getClientRects().length > 0) return el;
  }
  return null;
}

interface TourOverlayProps {
  steps: TourStep[];
  index: number;
  onIndexChange: (index: number) => void;
  onFinish: () => void;
}

/** Coach mark ancorado em elementos com `data-tour`. */
export function TourOverlay({ steps, index, onIndexChange, onFinish }: TourOverlayProps) {
  const [measure, setMeasure] = useState<Measure | null>(null);
  const directionRef = useRef<1 | -1>(1);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const textId = useId();
  const step = steps[index];

  // Posição: medida em callbacks de rAF / resize / scroll (nunca de forma síncrona no efeito).
  useEffect(() => {
    if (!step) return;
    let frame = 0;
    let first = true;
    let attempts = 0;
    const measureNow = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const el = findAnchor(step.anchors);
        // O menu da casa leva um quadro para abrir: aguarda antes de pular o passo.
        if (!el && step.openMenu && attempts < 20) {
          attempts += 1;
          measureNow();
          return;
        }
        if (!el) {
          let next = index + directionRef.current;
          if (next < 0) {
            directionRef.current = 1;
            next = index + 1;
          }
          if (next >= steps.length) onFinish();
          else onIndexChange(next);
          return;
        }
        if (first) {
          first = false;
          // O header é fixo: itens do menu já estão visíveis, sem rolar a página.
          if (!step.openMenu) el.scrollIntoView({ block: "center", behavior: "smooth" });
          primaryRef.current?.focus({ preventScroll: true });
        }
        const r = el.getBoundingClientRect();
        setMeasure({ top: r.top, left: r.left, width: r.width, height: r.height, vw: window.innerWidth, vh: window.innerHeight });
      });
    };
    measureNow();
    window.addEventListener("resize", measureNow);
    window.addEventListener("scroll", measureNow, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", measureNow);
      window.removeEventListener("scroll", measureNow, true);
    };
  }, [step, index, steps.length, onIndexChange, onFinish]);

  const isLast = index === steps.length - 1;

  function go(delta: 1 | -1) {
    directionRef.current = delta;
    if (delta === 1 && isLast) onFinish();
    else if (index + delta >= 0) onIndexChange(index + delta);
  }

  // Teclado: ESC encerra; setas navegam.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onFinish();
      } else if (event.key === "ArrowRight") {
        directionRef.current = 1;
        if (index >= steps.length - 1) onFinish();
        else onIndexChange(index + 1);
      } else if (event.key === "ArrowLeft" && index > 0) {
        directionRef.current = -1;
        onIndexChange(index - 1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, steps.length, onIndexChange, onFinish]);

  if (!step) return null;

  const hole = measure && {
    top: measure.top - PAD,
    left: measure.left - PAD,
    width: measure.width + PAD * 2,
    height: measure.height + PAD * 2,
  };

  let cardStyle: CSSProperties = { visibility: "hidden" };
  if (measure && hole) {
    const below = measure.vh - (hole.top + hole.height) > CARD_EST_H + GAP;
    const left = Math.min(Math.max(16, hole.left), Math.max(16, measure.vw - CARD_W - 16));
    cardStyle = below
      ? { top: hole.top + hole.height + GAP, left }
      : { bottom: Math.max(16, measure.vh - hole.top + GAP), left };
  }

  return (
    <div className="fixed inset-0 z-[65]">
      {/* Captura cliques fora do alvo; o escurecimento vem do recorte abaixo. */}
      <div className="absolute inset-0" aria-hidden />
      {hole && (
        <div
          aria-hidden
          className="pointer-events-none fixed rounded-lg ring-2 ring-gold transition-all duration-200"
          style={{ ...hole, boxShadow: "0 0 0 9999px rgba(8,23,38,0.45)" }}
        />
      )}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={textId}
        style={{ ...cardStyle, width: CARD_W }}
        className="fixed rounded-lg border border-line bg-surface shadow-overlay animate-fade-in"
      >
        <div className="flex items-start justify-between gap-3 px-5 pt-4">
          <div>
            <p className="eyebrow" aria-live="polite">
              {index + 1} de {steps.length}
            </p>
            <h2 id={titleId} className="mt-1 text-[14.5px] font-semibold text-foreground">
              {step.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onFinish}
            aria-label="Encerrar introdução"
            className="-mr-1.5 rounded-md p-1.5 text-subtle hover:bg-surface-sunken hover:text-foreground"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
        <p id={textId} className="px-5 pb-4 pt-1.5 text-[13px] leading-relaxed text-muted">
          {step.text}
        </p>
        <div className="flex items-center justify-between gap-2 border-t border-line bg-surface-muted px-5 py-3 rounded-b-lg">
          <Button variant="ghost" size="sm" onClick={onFinish}>
            Pular
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => go(-1)} disabled={index === 0}>
              Voltar
            </Button>
            <Button ref={primaryRef} size="sm" onClick={() => go(1)}>
              {isLast ? "Concluir" : "Próximo"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
