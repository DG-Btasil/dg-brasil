"use client";

import { useId } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/dialog";
import { DemoContentNotice } from "@/components/ui/display";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { LEGAL_AREAS, LEGAL_AREA_LABEL } from "@/lib/constants/legal";
import { THESIS_STATUSES, THESIS_STATUS_LABEL } from "@/lib/constants/status";
import { useAgents, useDgActions, useSkills } from "../../hooks";
import { linesToList, thesisFormSchema, type ThesisFormValues } from "../../schemas";
import { CheckboxList } from "@/components/ui/checkbox-list";

const DEFAULTS: ThesisFormValues = {
  name: "",
  area: "BANKING",
  summary: "",
  foundations: "",
  applicationCriteria: "",
  nonApplicationCriteria: "",
  requiredDocuments: "",
  references: "",
  notes: "",
  skillIds: [],
  agentIds: [],
  status: "DRAFT",
};

/** "Título — observação" por linha. Sem separador, a linha inteira vira o título. */
function parseReferences(value: string | undefined) {
  return linesToList(value).map((line) => {
    const [title, ...rest] = line.split(/\s+[—-]\s+/);
    return { title: (title ?? line).trim(), note: rest.join(" — ").trim() };
  });
}

/** Adicionar tese: conhecimento jurídico do escritório consultado pelos agentes. */
export function CreateThesisDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const formId = useId();
  const skills = useSkills();
  const agents = useAgents();
  const { createThesis } = useDgActions();
  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ThesisFormValues>({ resolver: zodResolver(thesisFormSchema), defaultValues: DEFAULTS });

  const close = () => {
    reset(DEFAULTS);
    onOpenChange(false);
  };

  const submit = handleSubmit(async (v) => {
    const id = await createThesis({
      name: v.name.trim(),
      area: v.area,
      summary: v.summary.trim(),
      foundations: linesToList(v.foundations),
      applicationCriteria: linesToList(v.applicationCriteria),
      nonApplicationCriteria: linesToList(v.nonApplicationCriteria),
      requiredDocuments: linesToList(v.requiredDocuments),
      references: parseReferences(v.references),
      notes: v.notes?.trim() || undefined,
      skillIds: v.skillIds,
      agentIds: v.agentIds,
      status: v.status,
    });
    if (id) close();
  });

  const lines = "Um item por linha.";

  return (
    <Drawer
      open={open}
      onOpenChange={(o) => (o ? onOpenChange(true) : close())}
      width={720}
      title="Adicionar tese"
      description="Descreva quando a tese se aplica e quando não se aplica. Os agentes autorizados passam a considerá-la."
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} loading={isSubmitting}>
            Adicionar tese
          </Button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={submit} className="space-y-4">
        <DemoContentNotice>
          Não cite jurisprudência sem conferir a fonte. Referências cadastradas aqui ficam marcadas como demonstração até a validação jurídica.
        </DemoContentNotice>
        <div className="grid grid-cols-[minmax(0,1fr)_220px] gap-4">
          <Field label="Nome da tese" requirement="required" error={errors.name?.message}>
            {(a) => <Input {...a} {...register("name")} autoFocus />}
          </Field>
          <Field label="Área jurídica" requirement="required" error={errors.area?.message}>
            {(a) => <Select {...a} {...register("area")} options={LEGAL_AREAS.map((x) => ({ value: x, label: LEGAL_AREA_LABEL[x] }))} />}
          </Field>
        </div>
        <Field label="Descrição" requirement="required" error={errors.summary?.message}>
          {(a) => <Textarea {...a} {...register("summary")} rows={3} />}
        </Field>
        <Field label="Fundamentos" requirement="recommended" hint={lines}>
          {(a) => <Textarea {...a} {...register("foundations")} rows={3} />}
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Critérios de aplicação" requirement="required" hint={lines} error={errors.applicationCriteria?.message}>
            {(a) => <Textarea {...a} {...register("applicationCriteria")} rows={4} />}
          </Field>
          <Field label="Critérios de não aplicação" requirement="recommended" hint={lines}>
            {(a) => <Textarea {...a} {...register("nonApplicationCriteria")} rows={4} />}
          </Field>
        </div>
        <Field label="Documentos necessários" requirement="optional" hint={lines}>
          {(a) => <Textarea {...a} {...register("requiredDocuments")} rows={3} />}
        </Field>
        <Field label="Referências" requirement="optional" hint="Uma por linha, no formato “Título — observação”. Marcadas como demonstração.">
          {(a) => <Textarea {...a} {...register("references")} rows={3} />}
        </Field>
        <Field label="Observações" requirement="optional">
          {(a) => <Textarea {...a} {...register("notes")} rows={2} />}
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Controller
            control={control}
            name="skillIds"
            render={({ field }) => <CheckboxList legend="Skills relacionadas" options={skills.map((s) => ({ value: s.id, label: s.name }))} value={field.value} onChange={field.onChange} />}
          />
          <Controller
            control={control}
            name="agentIds"
            render={({ field }) => (
              <CheckboxList legend="Agentes autorizados" options={agents.map((ag) => ({ value: ag.id, label: ag.name }))} value={field.value} onChange={field.onChange} />
            )}
          />
        </div>
        <Field label="Status" requirement="required" className="max-w-[240px]">
          {(a) => <Select {...a} {...register("status")} options={THESIS_STATUSES.map((s) => ({ value: s, label: THESIS_STATUS_LABEL[s] }))} />}
        </Field>
      </form>
    </Drawer>
  );
}
