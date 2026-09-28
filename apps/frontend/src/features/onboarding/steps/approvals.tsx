"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { Lock } from "lucide-react";
import { AGENT_AUTONOMY_DESCRIPTION, AGENT_AUTONOMY_LABEL, AGENT_AUTONOMY_LEVELS } from "@/lib/constants/status";
import { can } from "@/lib/permissions";
import { Checkbox, Field, Textarea } from "@/components/ui/form";
import { RadioCards, ToggleChips } from "../components/choice-controls";
import { StepForm, StepSection } from "../components/step-section";
import { useOfficeMembers, useRegisterStepForm } from "../hooks";
import { APPROVAL_ITEM_LABEL, LOCKED_APPROVAL_TEXT } from "../labels";
import { APPROVAL_ITEMS, approvalsSchema, withDefaults, type ApprovalsValues } from "../schemas";
import type { StepProps } from "../types";

const AUTONOMY_OPTIONS = AGENT_AUTONOMY_LEVELS.map((v) => ({
  value: v,
  label: AGENT_AUTONOMY_LABEL[v],
  description: AGENT_AUTONOMY_DESCRIPTION[v],
}));

export function ApprovalsStep({ formId, answers, onSave, registerForm }: StepProps) {
  const members = useOfficeMembers();
  const reviewers = members.filter((u) => u.status === "ACTIVE" && can(u.role, "reviews.decide"));
  const reviewerOptions = reviewers.map((u) => ({ value: u.id, label: u.name }));
  const defaults: ApprovalsValues = {
    reviewerIds: reviewers.slice(0, 1).map((u) => u.id),
    requiresApproval: ["PETITIONS", "CLIENT_MESSAGES", "DEADLINES", "SKILL_CHANGES", "THIRD_PARTY_DOCUMENTS"],
    responsibles: "",
    changeFlow: "",
    autonomy: "REVIEW_REQUIRED",
  };
  const form = useForm<ApprovalsValues>({ resolver: zodResolver(approvalsSchema), defaultValues: withDefaults(defaults, answers) });
  const { register, control, handleSubmit, formState } = form;
  const { errors } = formState;
  useRegisterStepForm(form, registerForm);

  return (
    <StepForm id={formId} onSubmit={handleSubmit((v) => onSave(v))}>
      <StepSection title="Quem revisa" columns={1}>
        <Controller
          control={control}
          name="reviewerIds"
          render={({ field }) => (
            <ToggleChips
              legend="Pessoas revisoras"
              requirement="required"
              hint="Somente perfis que podem decidir revisões aparecem aqui."
              options={reviewerOptions}
              value={field.value}
              onChange={field.onChange}
              inputRef={field.ref}
              error={errors.reviewerIds?.message}
            />
          )}
        />
        <Field label="Responsáveis por área ou tipo de revisão" requirement="optional" error={errors.responsibles?.message}>
          {(p) => <Textarea {...p} rows={2} placeholder="Ex.: petições bancárias — Dr. Cláudio; mensagens a clientes — Dra. Bárbara." {...register("responsibles")} />}
        </Field>
      </StepSection>

      <StepSection title="O que exige aprovação" columns={1}>
        <div className="rounded-md border border-navy/20 bg-navy-50 px-3.5 py-3">
          <div className="flex items-start gap-2.5">
            <input type="checkbox" checked disabled aria-describedby="locked-approval-desc" id="locked-approval" className="mt-0.5 size-4 shrink-0 accent-navy" />
            <div>
              <label htmlFor="locked-approval" className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
                {LOCKED_APPROVAL_TEXT}
                <Lock className="size-3.5 text-navy-600" aria-hidden />
                <span className="sr-only">(fixo, não pode ser desmarcado)</span>
              </label>
              <p id="locked-approval-desc" className="mt-0.5 text-[12px] leading-relaxed text-muted">
                Protocolos, envios a clientes e envios a terceiros têm efeito fora do escritório. No DG Brasil, a IA executa e uma pessoa decide — esta regra não pode ser desativada.
              </p>
            </div>
          </div>
        </div>
        <Controller
          control={control}
          name="requiresApproval"
          render={({ field }) => (
            <fieldset>
              <legend className="mb-2 text-[12.5px] font-medium text-foreground">Itens adicionais com aprovação obrigatória</legend>
              <div className="grid gap-2.5 sm:grid-cols-2">
                {APPROVAL_ITEMS.map((item, i) => (
                  <Checkbox
                    key={item}
                    ref={i === 0 ? field.ref : undefined}
                    label={APPROVAL_ITEM_LABEL[item]}
                    checked={field.value.includes(item)}
                    onChange={(e) => field.onChange(e.target.checked ? [...field.value, item] : field.value.filter((v) => v !== item))}
                  />
                ))}
              </div>
            </fieldset>
          )}
        />
        <Field label="Fluxo de mudanças" requirement="optional" hint="Como uma alteração em Skills, regras ou teses é proposta e aprovada." error={errors.changeFlow?.message}>
          {(p) => <Textarea {...p} rows={2} {...register("changeFlow")} />}
        </Field>
      </StepSection>

      <StepSection title="Limite de autonomia dos agentes" columns={1}>
        <Controller
          control={control}
          name="autonomy"
          render={({ field }) => (
            <RadioCards
              legend="Autonomia padrão"
              hint="Pode ser ajustada por agente na etapa de Agentes e Skills."
              options={AUTONOMY_OPTIONS}
              value={field.value}
              onChange={field.onChange}
              inputRef={field.ref}
            />
          )}
        />
      </StepSection>
    </StepForm>
  );
}
