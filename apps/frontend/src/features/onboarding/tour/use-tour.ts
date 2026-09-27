"use client";

import { useUiStore } from "@/store/ui-store";

/** Estado efêmero do tour guiado (ui-store). */
export function useTourState() {
  const active = useUiStore((s) => s.tourActive);
  const step = useUiStore((s) => s.tourStep);
  const promptDismissed = useUiStore((s) => s.tourPromptDismissed);
  const startTour = useUiStore((s) => s.startTour);
  const setStep = useUiStore((s) => s.setTourStep);
  const endTour = useUiStore((s) => s.endTour);
  const dismissPrompt = useUiStore((s) => s.dismissTourPrompt);
  const setMenuOpen = useUiStore((s) => s.setTourMenuOpen);
  return { active, step, promptDismissed, startTour, setStep, endTour, dismissPrompt, setMenuOpen };
}
