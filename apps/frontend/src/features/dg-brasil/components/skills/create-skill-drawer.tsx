"use client";

import { useId } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { SKILL_STATUSES, SKILL_STATUS_LABEL } from "@/lib/constants/status";
import { useAgents, useDgActions } from "../../hooks";
import { skillFormSchema, type SkillFormValues } from "../../schemas";
import { CheckboxList } from "@/components/ui/checkbox-list";

const DEFAULTS: SkillFormValues = { name: "", description: "", purpose: "", instructions: "", agentIds: [], version: "1", status: "DRAFT" };

/**
 * Criação de Skill amigável para leigos: nada de SKILL.md. As instruções são
 * texto simples; a configuração técnica avançada continua separada.
 */
export function CreateSkillDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const formId = useId();
  const agents = useAgents();
  const { createSkill } = useDgActions();
  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<SkillFormValues>({ resolver: zodResolver(skillFormSchema), defaultValues: DEFAULTS });

  const close = () => {
    reset(DEFAULTS);
    onOpenChange(false);
  };

  const submit = handleSubmit(async (v) => {
    const id = await createSkill({
      name: v.name.trim(),
      description: v.description.trim(),
      purpose: v.purpose.trim(),
      instructions: v.instructions.trim(),
      agentIds: v.agentIds,
      version: Number(v.version),
      status: v.status,
    });
    if (id) close();
  });

  return (
    <Drawer
      open={open}
      onOpenChange={(o) => (o ? onOpenChange(true) : close())}
      width={640}
      title="Criar Skill"
      description="Uma capacidade reutilizável pelos agentes. Escreva como explicaria a um colega; não é preciso editar arquivos técnicos."
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} loading={isSubmitting}>
            Criar Skill
          </Button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={submit} className="space-y-4">
        <Field label="Nome" requirement="required" error={errors.name?.message}>
          {(a) => <Input {...a} {...register("name")} placeholder="Ex.: Conferência de extrato de benefício" autoFocus />}
        </Field>
        <Field label="Descrição" requirement="required" hint="Uma frase que resume a Skill." error={errors.description?.message}>
          {(a) => <Input {...a} {...register("description")} />}
        </Field>
        <Field label="Finalidade" requirement="required" hint="Para que ela serve no dia a dia do escritório." error={errors.purpose?.message}>
          {(a) => <Textarea {...a} {...register("purpose")} rows={2} />}
        </Field>
        <Field label="Instruções" requirement="required" hint="O passo a passo que o agente deve seguir, em linguagem simples." error={errors.instructions?.message}>
          {(a) => <Textarea {...a} {...register("instructions")} rows={6} />}
        </Field>
        <Controller
          control={control}
          name="agentIds"
          render={({ field }) => (
            <CheckboxList legend="Agentes relacionados" hint="Os agentes marcados passam a usar esta Skill." options={agents.map((ag) => ({ value: ag.id, label: ag.name }))} value={field.value} onChange={field.onChange} />
          )}
        />
        <div className="grid grid-cols-2 gap-4">
          <Field label="Versão inicial" requirement="required" error={errors.version?.message}>
            {(a) => <Input {...a} {...register("version")} inputMode="numeric" className="tabular" />}
          </Field>
          <Field label="Status" requirement="required">
            {(a) => <Select {...a} {...register("status")} options={SKILL_STATUSES.map((s) => ({ value: s, label: SKILL_STATUS_LABEL[s] }))} />}
          </Field>
        </div>
      </form>
    </Drawer>
  );
}
