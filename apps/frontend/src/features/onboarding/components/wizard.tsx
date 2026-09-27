"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LAST_STEP_INDEX, ONBOARDING_STEPS, TOTAL_STEPS, clampStep } from "../config";
import { useOnboardingActions, useOnboardingState, useToast } from "../hooks";
import type { AgentsSkillsValues } from "../schemas";
import { STEP_COMPONENTS } from "../steps";
import type { StepAnswers, StepFormApi } from "../types";
import { AgentPanel } from "./agent-panel";
import { CompletedNotice } from "./completed-notice";
import { StepIndex, type IndexState } from "./step-index";
import { WizardTopBar } from "./wizard-top-bar";

export function OnboardingWizard() {
  const router = useRouter();
  const toast = useToast();
  const onboarding = useOnboardingState();
  const actions = useOnboardingActions();
  const index = clampStep(onboarding.currentStep);
  const step = ONBOARDING_STEPS[index]!;
  const formId = `onboarding-form-${step.key}`;
  const StepBody = STEP_COMPONENTS[step.key];
  const isLast = index === LAST_STEP_INDEX;

  const formApi = useRef<StepFormApi | null>(null);
  const registerForm = useCallback((api: StepFormApi | null) => {
    formApi.current = api;
  }, []);
  const mode = useRef<"continue" | "stay">("continue");
  const [busy, setBusy] = useState(false);

  // Foco no título da etapa a cada troca (não no carregamento inicial).
  const headingRef = useRef<HTMLHeadingElement>(null);
  const lastIndex = useRef(index);
  useEffect(() => {
    if (lastIndex.current === index) return;
    lastIndex.current = index;
    window.scrollTo({ top: 0 });
    headingRef.current?.focus();
  }, [index]);

  const goToStep = useCallback((i: number) => void actions.goToStep(clampStep(i)), [actions]);

  const onSave = useCallback(
    async (answers: StepAnswers) => {
      const stay = mode.current === "stay";
      mode.current = "continue";
      setBusy(true);
      try {
        if (isLast && !stay) {
          await actions.saveStep(step.key, answers, index);
          await actions.finalize(onboarding.answers["agents-skills"] as AgentsSkillsValues | undefined);
          toast({ tone: "success", title: "Implantação concluída", description: "As configurações iniciais foram aplicadas ao escritório." });
          router.push("/home");
          return;
        }
        await actions.saveStep(step.key, answers, stay ? index : Math.min(index + 1, LAST_STEP_INDEX));
        if (stay) toast({ tone: "success", title: "Etapa salva", description: "Você pode continuar depois exatamente deste ponto." });
      } catch {
        toast({ tone: "danger", title: "Não foi possível salvar a etapa.", description: "Tente novamente." });
      } finally {
        setBusy(false);
      }
    },
    [actions, index, isLast, onboarding.answers, router, step.key, toast],
  );

  const skip = async () => {
    await actions.saveStep(step.key, onboarding.answers[step.key] ?? {}, Math.min(index + 1, LAST_STEP_INDEX), true);
    toast({ tone: "info", title: "Etapa pulada", description: "Ela pode ser configurada depois, na revisão ou em Configurações." });
  };

  const stateOf = (i: number): IndexState => {
    const key = ONBOARDING_STEPS[i]!.key;
    if (i === index) return "current";
    if (onboarding.completedSteps.includes(key)) return "done";
    if (onboarding.skippedSteps.includes(key)) return "skipped";
    return "pending";
  };
  const canOpen = (i: number) => onboarding.completed || i < index || stateOf(i) !== "pending";

  return (
    <div className="min-h-screen bg-background">
      <WizardTopBar
        index={index}
        total={TOTAL_STEPS}
        completed={onboarding.completed}
        formId={formId}
        busy={busy}
        onSaveLater={() => {
          mode.current = "stay";
        }}
      />

      <div className="mx-auto grid max-w-[1480px] gap-8 px-6 py-8 lg:grid-cols-[232px_minmax(0,1fr)] xl:grid-cols-[232px_minmax(0,1fr)_340px]">
        <div className="lg:sticky lg:top-6 lg:self-start">
          <StepIndex steps={ONBOARDING_STEPS} stateOf={stateOf} canOpen={canOpen} onOpen={goToStep} />
        </div>

        <main className="mx-auto w-full max-w-[720px] min-w-0">
          {onboarding.completed && <CompletedNotice completedAt={onboarding.completedAt} onRestart={() => goToStep(0)} />}

          <header className="mb-6">
            <div className="mb-2 flex items-center gap-2">
              <span className="eyebrow">
                Etapa {index + 1} de {TOTAL_STEPS}
              </span>
              {step.skippable && <Badge tone="neutral">Pode ser pulada</Badge>}
            </div>
            <h1 ref={headingRef} tabIndex={-1} className="font-serif text-[28px] font-medium leading-tight tracking-[-0.01em] text-navy focus:outline-none">
              {step.title}
            </h1>
            <p className="mt-2 max-w-[640px] text-[13.5px] leading-relaxed text-muted">
              <span className="font-medium text-foreground">Por que isso importa: </span>
              {step.why}
            </p>
          </header>

          <div className="rounded-lg border border-line bg-surface px-6 py-6 shadow-hairline sm:px-8">
            <StepBody
              key={step.key}
              formId={formId}
              answers={onboarding.answers[step.key]}
              onSave={onSave}
              registerForm={registerForm}
              goToStep={goToStep}
            />
          </div>

          <footer className="mt-5 flex flex-wrap items-center gap-2">
            <Button variant="ghost" disabled={index === 0 || busy} onClick={() => goToStep(index - 1)} icon={<ArrowLeft className="size-4" aria-hidden />}>
              Voltar
            </Button>
            <div className="ml-auto flex items-center gap-2">
              {step.skippable && (
                <Button variant="secondary" disabled={busy} onClick={() => void skip()} icon={<SkipForward className="size-4" aria-hidden />}>
                  {step.key === "team" ? "Convidar depois" : "Pular esta etapa"}
                </Button>
              )}
              <Button
                type="submit"
                form={formId}
                variant={isLast ? "accent" : "primary"}
                loading={busy}
                onClick={() => {
                  mode.current = "continue";
                }}
                icon={isLast ? <CheckCircle2 className="size-4" aria-hidden /> : undefined}
              >
                {isLast ? "Finalizar implantação" : "Salvar e continuar"}
                {!isLast && <ArrowRight className="size-4" aria-hidden />}
              </Button>
            </div>
          </footer>
        </main>

        <div className="lg:col-span-2 xl:col-span-1 xl:sticky xl:top-6 xl:self-start">
          <AgentPanel
            key={step.key}
            script={step.agent}
            stepLabel={step.label}
            onApplySuggestion={step.agent.suggestion ? () => formApi.current?.apply(step.agent.suggestion!.values) : undefined}
          />
        </div>
      </div>
    </div>
  );
}
