"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useCan, useCurrentUser, useSessionActions } from "@/features/auth/hooks";
import { TourOverlay } from "./tour-overlay";
import { TOUR_STEPS } from "./tour-steps";
import { useTourState } from "./use-tour";

/**
 * Tour inicial do produto (separado da implantação institucional).
 * - Primeiro acesso de cada usuário, na Home: convite "Deseja conhecer o DG Brasil?".
 * - "Agora não" apenas adia (nesta sessão do navegador); o tour pode ser aberto pelo menu do usuário.
 * - Concluir ou pular marca o tour como feito para o usuário.
 */
export function ProductTour() {
  const pathname = usePathname();
  const user = useCurrentUser();
  const can = useCan();
  const { completeTour } = useSessionActions();
  const tour = useTourState();
  const { endTour, setStep, setMenuOpen } = tour;
  const userId = user?.id;

  const steps = useMemo(() => TOUR_STEPS.filter((s) => !s.permission || can(s.permission)), [can]);

  // Passos sobre os módulos abrem o menu da casa para mostrar o item explicado.
  const currentStep = tour.active && steps.length > 0 ? steps[Math.min(tour.step, steps.length - 1)] : undefined;
  const wantsMenu = Boolean(currentStep?.openMenu);
  useEffect(() => {
    setMenuOpen(wantsMenu);
  }, [wantsMenu, setMenuOpen]);

  const finish = useCallback(() => {
    if (userId) completeTour(userId);
    endTour();
  }, [userId, completeTour, endTour]);

  const showPrompt = Boolean(user) && user?.hasCompletedTour === false && !tour.promptDismissed && !tour.active && pathname === "/home";

  return (
    <>
      <Dialog
        open={showPrompt}
        onOpenChange={(open) => {
          if (!open) tour.dismissPrompt();
        }}
        size="sm"
        title="Deseja conhecer o DG Brasil?"
        description="Uma introdução curta às principais áreas do sistema, com cerca de um minuto. Você pode refazê-la depois pelo menu do usuário."
        footer={
          <>
            <Button variant="ghost" onClick={tour.dismissPrompt}>
              Agora não
            </Button>
            <Button onClick={tour.startTour}>Fazer introdução</Button>
          </>
        }
      />
      {tour.active && steps.length > 0 && <TourOverlay steps={steps} index={Math.min(tour.step, steps.length - 1)} onIndexChange={setStep} onFinish={finish} />}
    </>
  );
}
