"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useCan } from "@/features/auth/hooks";
import { shouldOfferProductTour } from "@/lib/onboarding";
import { useProductTourCompletion } from "./product-tour-state";
import { TourOverlay } from "./tour-overlay";
import { TOUR_STEPS } from "./tour-steps";
import { useTourState } from "./use-tour";

/**
 * Introdução do produto (tour) — separada do onboarding de SEGURANÇA.
 * - Aparece UMA vez por usuário, na Home, depois de senha/termos/MFA.
 * - Concluir ou "Pular introdução" grava `tour_completed_at` no banco: não
 *   volta em nenhum navegador. Rever pelo menu do usuário não altera a data.
 */
export function ProductTour() {
  const pathname = usePathname();
  const can = useCan();
  const { completedAt, markCompleted } = useProductTourCompletion();
  const tour = useTourState();
  const { endTour, setStep, setMenuOpen } = tour;

  const steps = useMemo(() => TOUR_STEPS.filter((s) => !s.permission || can(s.permission)), [can]);

  // Passos sobre os módulos abrem o menu da casa para mostrar o item explicado.
  const currentStep = tour.active && steps.length > 0 ? steps[Math.min(tour.step, steps.length - 1)] : undefined;
  const wantsMenu = Boolean(currentStep?.openMenu);
  useEffect(() => {
    setMenuOpen(wantsMenu);
  }, [wantsMenu, setMenuOpen]);

  const finish = useCallback(() => {
    markCompleted();
    endTour();
  }, [markCompleted, endTour]);

  const skip = useCallback(() => {
    markCompleted();
    tour.dismissPrompt();
  }, [markCompleted, tour]);

  const showPrompt = shouldOfferProductTour({ completedAt, pathname, promptDismissed: tour.promptDismissed, active: tour.active });

  return (
    <>
      <Dialog
        open={showPrompt}
        onOpenChange={(open) => {
          // Fechar (Esc/fora) só adia nesta visita; "Pular introdução" grava.
          if (!open) tour.dismissPrompt();
        }}
        size="sm"
        title="Deseja conhecer o DG Brasil?"
        description="Uma introdução curta às principais áreas do sistema, com cerca de um minuto. Ela aparece só desta vez; depois, você pode revê-la pelo menu do usuário (Conhecer o DG Brasil)."
        footer={
          <>
            <Button variant="ghost" onClick={skip}>
              Pular introdução
            </Button>
            <Button onClick={tour.startTour}>Fazer introdução</Button>
          </>
        }
      />
      {tour.active && steps.length > 0 && <TourOverlay steps={steps} index={Math.min(tour.step, steps.length - 1)} onIndexChange={setStep} onFinish={finish} />}
    </>
  );
}
