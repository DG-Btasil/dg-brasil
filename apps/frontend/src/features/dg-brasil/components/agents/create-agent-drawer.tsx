"use client";

import { useId } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import {
  AGENT_AUTONOMY_DESCRIPTION,
  AGENT_AUTONOMY_LABEL,
  AGENT_AUTONOMY_LEVELS,
  AGENT_STATUSES,
  AGENT_STATUS_LABEL,
} from "@/lib/constants/status";
import { useDgActions, useSkills, useTheses } from "../../hooks";
import { agentFormSchema, linesToList, type AgentFormValues } from "../../schemas";
import { CheckboxList } from "@/components/ui/checkbox-list";

const DEFAULTS: AgentFormValues = {
  name: "",
  role: "",
  description: "",
  objective: "",
  skillIds: [],
  thesisIds: [],
  status: "DRAFT",
  autonomy: "REVIEW_REQUIRED",
  rules: "",
};

/** Criação de agente. Tudo em linguagem de negócio; a configuração técnica fica para depois. */
export function CreateAgentDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const formId = useId();
  const skills = useSkills();
  const theses = useTheses();
  const { createAgent } = useDgActions();
  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<AgentFormValues>({ resolver: zodResolver(agentFormSchema), defaultValues: DEFAULTS });
  const autonomy = useWatch({ control, name: "autonomy" });

  const close = () => {
    reset(DEFAULTS);
    onOpenChange(false);
  };

  const submit = handleSubmit(async (v) => {
    const id = await createAgent({
      name: v.name.trim(),
      role: v.role.trim(),
      description: v.description.trim(),
      objective: v.objective?.trim() || undefined,
      skillIds: v.skillIds,
      thesisIds: v.thesisIds,
      status: v.status,
      autonomy: v.autonomy,
      rules: linesToList(v.rules),
    });
    if (id) close();
  });

  return (
    <Drawer
      open={open}
      onOpenChange={(o) => (o ? onOpenChange(true) : close())}
      width={640}
      title="Criar agente"
      description="Um novo integrante da equipe digital. Toda ação externa continua passando por Revisões."
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} loading={isSubmitting}>
            Criar agente
          </Button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={submit} className="space-y-4">
        <Field label="Nome" requirement="required" error={errors.name?.message}>
          {(a) => <Input {...a} {...register("name")} placeholder="Ex.: Agente de Análise Bancária" autoFocus />}
        </Field>
        <Field label="Função" requirement="required" error={errors.role?.message}>
          {(a) => <Input {...a} {...register("role")} placeholder="Ex.: Análise inicial de documentos e possíveis teses." />}
        </Field>
        <Field label="Descrição" requirement="required" error={errors.description?.message}>
          {(a) => <Textarea {...a} {...register("description")} rows={3} />}
        </Field>
        <Field label="Objetivo" requirement="recommended" hint="O resultado que o escritório espera deste agente.">
          {(a) => <Textarea {...a} {...register("objective")} rows={2} />}
        </Field>
        <Controller
          control={control}
          name="skillIds"
          render={({ field }) => (
            <CheckboxList legend="Skills associadas" options={skills.map((s) => ({ value: s.id, label: s.name }))} value={field.value} onChange={field.onChange} />
          )}
        />
        <Controller
          control={control}
          name="thesisIds"
          render={({ field }) => (
            <CheckboxList
              legend="Teses permitidas"
              hint="O agente só poderá sugerir as teses marcadas."
              options={theses.map((t) => ({ value: t.id, label: t.name }))}
              value={field.value}
              onChange={field.onChange}
            />
          )}
        />
        <div className="grid grid-cols-2 gap-4">
          <Field label="Status" requirement="required" hint="“Em configuração” não executa tarefas.">
            {(a) => <Select {...a} {...register("status")} options={AGENT_STATUSES.map((s) => ({ value: s, label: AGENT_STATUS_LABEL[s] }))} />}
          </Field>
          <Field label="Nível de autonomia" requirement="required" hint={AGENT_AUTONOMY_DESCRIPTION[autonomy]}>
            {(a) => <Select {...a} {...register("autonomy")} options={AGENT_AUTONOMY_LEVELS.map((s) => ({ value: s, label: AGENT_AUTONOMY_LABEL[s] }))} />}
          </Field>
        </div>
        <Field label="Regras adicionais" requirement="optional" hint="Uma regra por linha.">
          {(a) => <Textarea {...a} {...register("rules")} rows={4} placeholder={"Ex.: Nunca enviar mensagem ao cliente sem aprovação.\nSinalizar contratos com mais de 5 anos."} />}
        </Field>
      </form>
    </Drawer>
  );
}
