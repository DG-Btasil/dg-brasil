"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { LEGAL_AREA_LABEL } from "@/lib/constants/legal";
import { AGENT_AUTONOMY_LABEL, AGENT_AUTONOMY_LEVELS, THESIS_STATUS_LABEL, THESIS_STATUS_TONE } from "@/lib/constants/status";
import { cn } from "@/lib/cn";
import { StatusBadge } from "@/components/ui/badge";
import { DemoContentNotice } from "@/components/ui/display";
import { Select } from "@/components/ui/form";
import { EditableList, cleanList } from "../components/list-controls";
import { StepForm, StepSection } from "../components/step-section";
import { useOnboardingAgents, useOnboardingSkills, useOnboardingState, useOnboardingTheses, useRegisterStepForm } from "../hooks";
import { defaultProposal, proposedSkills, proposedTheses, readInputs } from "../proposal";
import { agentsSkillsSchema, withDefaults, type AgentsSkillsValues } from "../schemas";
import type { StepProps } from "../types";

const AUTONOMY_OPTIONS = AGENT_AUTONOMY_LEVELS.map((v) => ({ value: v, label: AGENT_AUTONOMY_LABEL[v] }));

export function AgentsSkillsStep({ formId, answers, onSave, registerForm }: StepProps) {
  const { answers: all } = useOnboardingState();
  const agents = useOnboardingAgents();
  const skills = useOnboardingSkills();
  const theses = useOnboardingTheses();
  const inputs = readInputs(all);
  const areas = inputs.practice?.areas ?? [];

  const form = useForm<AgentsSkillsValues>({
    resolver: zodResolver(agentsSkillsSchema),
    defaultValues: withDefaults(defaultProposal(agents, inputs), answers),
  });
  const { register, control, handleSubmit } = form;
  const { fields } = useFieldArray({ control, name: "agents" });
  const watched = useWatch({ control, name: "agents" }) ?? [];
  useRegisterStepForm(form, registerForm);
  const agentById = new Map(agents.map((a) => [a.id, a]));
  const skillProposals = proposedSkills(skills, inputs);
  const thesisList = proposedTheses(theses, inputs);

  return (
    <StepForm id={formId} onSubmit={handleSubmit((v) => onSave({ ...v, rules: cleanList(v.rules) }))}>
      <p className="text-[12.5px] leading-relaxed text-muted">
        {areas.length > 0 ? (
          <>
            Proposta montada para <span className="font-medium text-foreground">{areas.map((a) => LEGAL_AREA_LABEL[a]).join(", ")}</span>. Nada é
            aplicado até você finalizar a implantação.
          </>
        ) : (
          "As áreas de atuação ainda não foram informadas; a proposta usa a configuração padrão. Nada é aplicado até você finalizar a implantação."
        )}
      </p>

      <StepSection title="Agentes" description="Ative ou desative cada agente e escolha o limite de autonomia." columns={1}>
        <ul className="divide-y divide-line rounded-md border border-line">
          {fields.map((f, i) => {
            const agent = agentById.get(f.agentId);
            const enabled = watched[i]?.enabled ?? f.enabled;
            return (
              <li key={f.id} className={cn("grid gap-3 px-4 py-3.5 sm:grid-cols-[minmax(0,1fr)_230px]", !enabled && "bg-surface-muted")}>
                <label className="flex cursor-pointer items-start gap-3">
                  <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-navy" {...register(`agents.${i}.enabled`)} />
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2 text-[13px] font-semibold text-foreground">
                      {f.name}
                      <span className="text-[11.5px] font-normal text-muted">{enabled ? "Será ativado" : "Ficará pausado"}</span>
                    </span>
                    {agent && <span className="mt-0.5 block text-[12px] leading-relaxed text-muted">{agent.role}</span>}
                  </span>
                </label>
                <div>
                  <label htmlFor={`autonomy-${f.id}`} className="sr-only">
                    Autonomia de {f.name}
                  </label>
                  <Select id={`autonomy-${f.id}`} options={AUTONOMY_OPTIONS} {...register(`agents.${i}.autonomy`)} />
                </div>
              </li>
            );
          })}
        </ul>
        <p className="text-[11.5px] text-muted">Ações externas continuam exigindo confirmação humana em qualquer nível de autonomia.</p>
      </StepSection>

      <StepSection title="Skills" description="Capacidades que os agentes usarão. Ajustes finos ficam na Central do DG Brasil." columns={1}>
        <ul className="grid gap-2 sm:grid-cols-2">
          {skillProposals.map(({ skill, note }) => (
            <li key={skill.id} className="rounded-md border border-line px-3.5 py-2.5">
              <p className="text-[12.5px] font-semibold text-foreground">{skill.name}</p>
              <p className="mt-0.5 text-[12px] text-muted">{note ?? skill.purpose}</p>
              {note && <p className="mt-1 text-[11px] font-medium text-gold-600">Ajustado pelas suas respostas</p>}
            </li>
          ))}
        </ul>
      </StepSection>

      <StepSection title="Teses" description="Teses do escritório compatíveis com as áreas escolhidas." columns={1}>
        {thesisList.length === 0 ? (
          <p className="text-[12.5px] text-muted">Nenhuma tese cadastrada para as áreas escolhidas. Elas podem ser criadas depois na Central do DG Brasil.</p>
        ) : (
          <ul className="divide-y divide-line rounded-md border border-line">
            {thesisList.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                <span className="min-w-0">
                  <span className="block truncate text-[12.5px] text-foreground">{t.name}</span>
                  <span className="text-[11.5px] text-muted">{LEGAL_AREA_LABEL[t.area]}</span>
                </span>
                <StatusBadge status={t.status} labels={THESIS_STATUS_LABEL} tones={THESIS_STATUS_TONE} />
              </li>
            ))}
          </ul>
        )}
        <DemoContentNotice />
      </StepSection>

      <StepSection title="Regras" description="Inclui as regras escritas na etapa de critérios jurídicos. Edite livremente." columns={1}>
        <Controller
          control={control}
          name="rules"
          render={({ field }) => (
            <EditableList legend="Regras gerais dos agentes" requirement="recommended" itemLabel="Regra" addLabel="Adicionar regra" value={field.value} onChange={field.onChange} />
          )}
        />
      </StepSection>
    </StepForm>
  );
}
