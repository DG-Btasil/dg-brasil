"use client";

import { useRouter } from "next/navigation";
import { useId } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { CheckboxList } from "@/components/ui/checkbox-list";
import { Drawer } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { callAction } from "@/lib/actions/result";
import { useActionFeedback } from "@/lib/actions/use-action-feedback";
import { THESIS_STATUSES, THESIS_STATUS_LABEL } from "@/lib/constants/status";
import { useIdempotencyKey } from "@/lib/hooks/use-idempotency-key";
import { saveDgThesisAction } from "@/server/domain/dg/actions";
import type { DgCatalogDTO, ThesisDetailDTO } from "@/server/domain/dg/dto";
import { useToast } from "@/store/ui-store";
import { dgRoutes } from "../../utils";

const schema = z.object({
  title: z.string().trim().min(1, "Informe o título da tese.").max(200),
  description: z.string().max(2000).optional(),
  legalAreaId: z.string().min(1, "Escolha a área."),
  status: z.enum(THESIS_STATUSES),
  foundations: z.string().max(50_000).optional(),
  applicationCriteria: z.string().max(50_000).optional(),
  exclusionCriteria: z.string().max(50_000).optional(),
  notes: z.string().max(20_000).optional(),
  agentIds: z.array(z.string()),
  skillIds: z.array(z.string()),
  referenceIds: z.array(z.string()),
});
type Values = z.infer<typeof schema>;

/**
 * Tese jurídica: o agente só usa as ATIVAS vinculadas a ele (ou ao modelo de
 * análise). Mudar fundamentos/critérios cria versão nova. Nada aqui é
 * jurisprudência verificada automaticamente: é o texto que o escritório aprova.
 */
export function ThesisFormDrawer({ open, onOpenChange, thesis, catalog }: { open: boolean; onOpenChange: (o: boolean) => void; thesis?: ThesisDetailDTO; catalog: DgCatalogDTO }) {
  const formId = useId();
  const router = useRouter();
  const toast = useToast();
  const failed = useActionFeedback();
  const idempotency = useIdempotencyKey();
  const initial: Values = {
    title: thesis?.title ?? "", description: thesis?.description ?? "", legalAreaId: thesis?.legalAreaId ?? "",
    status: thesis?.status ?? "DRAFT", foundations: thesis?.foundations ?? "", applicationCriteria: thesis?.applicationCriteria ?? "",
    exclusionCriteria: thesis?.exclusionCriteria ?? "", notes: thesis?.notes ?? "",
    agentIds: thesis?.agentIds ?? [], skillIds: thesis?.skillIds ?? [], referenceIds: thesis?.referenceIds ?? [],
  };
  const { register, control, handleSubmit, formState: { errors, isSubmitting } } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: initial });

  const submit = handleSubmit(async (v) => {
    const payload = {
      ...(thesis ? { id: thesis.id } : {}),
      title: v.title, description: v.description || undefined, legalAreaId: v.legalAreaId, status: v.status,
      foundations: v.foundations || undefined, applicationCriteria: v.applicationCriteria || undefined,
      exclusionCriteria: v.exclusionCriteria || undefined, notes: v.notes || undefined,
      agentIds: v.agentIds, skillIds: v.skillIds, referenceIds: v.referenceIds,
    };
    const r = await callAction(() => saveDgThesisAction({ ...payload, key: idempotency.keyFor(payload) }));
    if (!r.ok) {
      failed(r, "Não foi possível salvar a tese.");
      return;
    }
    idempotency.reset();
    toast({ tone: "success", title: thesis ? "Tese salva" : "Tese criada", description: r.data.versionCreated ? `Versão ${r.data.versionNumber}.` : undefined });
    onOpenChange(false);
    if (!thesis) router.push(dgRoutes.thesis(r.data.id));
    else router.refresh();
  });

  const opts = (l: { id: string; name: string }[]) => l.map((x) => ({ value: x.id, label: x.name }));
  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      width={680}
      title={thesis ? `Editar ${thesis.title}` : "Criar tese"}
      description="Fundamentos e critérios que o agente consulta. O agente só cita a tese que consultou na execução."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} loading={isSubmitting}>
            {thesis ? "Salvar" : "Criar tese"}
          </Button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={submit} className="space-y-4">
        <Field label="Título" requirement="required" error={errors.title?.message}>
          {(a) => <Input {...a} {...register("title")} />}
        </Field>
        <Field label="Resumo" requirement="recommended">
          {(a) => <Textarea {...a} {...register("description")} rows={2} />}
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Área" requirement="required" error={errors.legalAreaId?.message}>
            {(a) => <Select {...a} {...register("legalAreaId")} placeholder="Escolha" options={catalog.legalAreas.map((x) => ({ value: x.id, label: x.name }))} />}
          </Field>
          <Field label="Situação" requirement="required" hint="Só tese Ativa chega ao agente.">
            {(a) => <Select {...a} {...register("status")} options={THESIS_STATUSES.map((s) => ({ value: s, label: THESIS_STATUS_LABEL[s] }))} />}
          </Field>
        </div>
        <Field label="Fundamentos" requirement="recommended" hint="Base legal e argumentos.">
          {(a) => <Textarea {...a} {...register("foundations")} rows={6} />}
        </Field>
        <Field label="Quando se aplica" requirement="recommended">
          {(a) => <Textarea {...a} {...register("applicationCriteria")} rows={4} />}
        </Field>
        <Field label="Quando NÃO se aplica" requirement="optional">
          {(a) => <Textarea {...a} {...register("exclusionCriteria")} rows={4} />}
        </Field>
        <Field label="Observações internas" requirement="optional">
          {(a) => <Textarea {...a} {...register("notes")} rows={3} />}
        </Field>
        <Controller control={control} name="agentIds" render={({ field }) => (
          <CheckboxList legend="Agentes autorizados" options={opts(catalog.agents)} value={field.value} onChange={field.onChange} />
        )} />
        <Controller control={control} name="skillIds" render={({ field }) => (
          <CheckboxList legend="Skills que operacionalizam a tese" options={opts(catalog.skills)} value={field.value} onChange={field.onChange} />
        )} />
        <Controller control={control} name="referenceIds" render={({ field }) => (
          <CheckboxList legend="Referências" options={opts(catalog.references)} value={field.value} onChange={field.onChange} />
        )} />
      </form>
    </Drawer>
  );
}
