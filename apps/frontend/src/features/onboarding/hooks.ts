"use client";

import { useCallback, useEffect, useMemo } from "react";
import type { FieldValues, UseFormReturn } from "react-hook-form";
import { parseCurrencyInput } from "@/lib/validation";
import { repositories } from "@/repositories";
import { useAppStore } from "@/store/app-store";
import type { Agent, Integration, LegalThesis, OnboardingState, Skill, User } from "@/types";
import type { AgentsSkillsValues, FeeModelsValues, IdentityValues, TeamValues } from "./schemas";
import type { StepAnswers, StepFormApi, StepKey } from "./types";

/* ------------------------------------------------------------------ */
/* Leitura                                                             */
/* ------------------------------------------------------------------ */

export function useOnboardingState(): OnboardingState {
  return useAppStore((s) => s.office.onboarding);
}

export function useStepAnswers(key: StepKey): StepAnswers | undefined {
  return useAppStore((s) => s.office.onboarding.answers[key]);
}

export function useOnboardingIntegrations(): Integration[] {
  return useAppStore((s) => s.integrations);
}

export function useOnboardingAgents(): Agent[] {
  return useAppStore((s) => s.agents);
}

export function useOnboardingSkills(): Skill[] {
  return useAppStore((s) => s.skills);
}

export function useOnboardingTheses(): LegalThesis[] {
  return useAppStore((s) => s.theses);
}

/** Usuários já cadastrados no escritório (ativos ou convidados). */
export function useOfficeMembers(): User[] {
  const users = useAppStore((s) => s.users);
  return useMemo(() => users.filter((u) => u.status !== "DISABLED"), [users]);
}

/* ------------------------------------------------------------------ */
/* Integração formulário ↔ assistente                                  */
/* ------------------------------------------------------------------ */

/** Expõe ao wizard a aplicação de sugestões do assistente neste formulário. */
export function useRegisterStepForm<T extends FieldValues>(form: UseFormReturn<T>, registerForm: (api: StepFormApi | null) => void) {
  const { reset, getValues } = form;
  useEffect(() => {
    registerForm({
      apply: (values) => reset({ ...getValues(), ...values } as T, { keepDefaultValues: true }),
    });
    return () => registerForm(null);
  }, [reset, getValues, registerForm]);
}

/* ------------------------------------------------------------------ */
/* Ações                                                               */
/* ------------------------------------------------------------------ */

function blankToUndefined(v: string): string | undefined {
  const t = v.trim();
  return t ? t : undefined;
}

export function useOnboardingActions() {
  const users = useAppStore((s) => s.users);

  const saveStep = useCallback(
    (key: StepKey, answers: StepAnswers, nextStep: number, skipped = false) =>
      repositories.office.saveOnboardingStep(key, answers, nextStep, skipped),
    [],
  );

  const goToStep = useCallback((index: number) => repositories.office.setOnboardingStep(index), []);

  /** Etapa 1: também atualiza o cadastro do escritório. */
  const updateOfficeIdentity = useCallback(async (v: IdentityValues) => {
    await repositories.office.update({
      name: v.name,
      legalName: blankToUndefined(v.legalName),
      tradeName: blankToUndefined(v.tradeName),
      cnpj: blankToUndefined(v.cnpj),
      phone: v.phone,
      email: v.email,
      website: blankToUndefined(v.website),
      principalLawyer: v.principalLawyer,
      oab: v.oab,
      statesOfPractice: v.statesOfPractice,
      units: v.units.map((u) => u.value.trim()).filter(Boolean),
      address: {
        zipCode: v.zipCode,
        street: v.street,
        number: v.number,
        complement: blankToUndefined(v.complement),
        district: v.district,
        city: v.city,
        state: v.state,
        country: "Brasil",
      },
    });
  }, []);

  /** Etapa 2: convida somente quem ainda não está cadastrado (simulado). */
  const inviteMembers = useCallback(
    async (members: TeamValues["members"]): Promise<number> => {
      const known = new Set(users.map((u) => u.email.toLowerCase()));
      let invited = 0;
      for (const m of members) {
        const email = m.email.trim().toLowerCase();
        if (known.has(email)) continue;
        await repositories.users.invite({ name: m.name.trim(), email, role: m.role });
        known.add(email);
        invited += 1;
      }
      return invited;
    },
    [users],
  );

  /** Etapa 10: cria os modelos novos e devolve a lista com os ids gerados. */
  const createFeeModels = useCallback(async (models: FeeModelsValues["models"]) => {
    const out: FeeModelsValues["models"] = [];
    let created = 0;
    for (const m of models) {
      if (m.createdId) {
        out.push(m);
        continue;
      }
      const id = await repositories.finance.createFeeModel({
        name: m.name.trim(),
        description: blankToUndefined(m.description),
        upfrontFee: parseCurrencyInput(m.upfrontFee),
        fixedFee: parseCurrencyInput(m.fixedFee),
        installments: m.installments ? Number(m.installments) : undefined,
        monthlyFee: parseCurrencyInput(m.monthlyFee),
        successFeePercent: m.successFeePercent ? Number(m.successFeePercent.replace(",", ".")) : undefined,
        billingMoment: m.billingMoment,
        active: true,
      });
      created += 1;
      out.push({ ...m, createdId: id });
    }
    return { models: out, created };
  }, []);

  /** Etapa 13: aplica as escolhas de agentes e conclui a implantação. */
  const finalize = useCallback(async (proposal: AgentsSkillsValues | undefined) => {
    for (const a of proposal?.agents ?? []) {
      await repositories.dg.updateAgent(a.agentId, { status: a.enabled ? "ACTIVE" : "PAUSED", autonomy: a.autonomy });
    }
    await repositories.office.completeOnboarding();
  }, []);

  return { saveStep, goToStep, updateOfficeIdentity, inviteMembers, createFeeModels, finalize };
}

export { useToast } from "@/store/ui-store";
