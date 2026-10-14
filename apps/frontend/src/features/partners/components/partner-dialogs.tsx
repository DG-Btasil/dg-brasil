"use client";

import { FormProvider, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Callout } from "@/components/feedback/states";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { PartnerOfficeAdminDTO } from "@/server/domain/organizations/dto";
import { usePartnerOfficeActions } from "../use-partner-office-actions";
import {
  parsePercent,
  shareSchema,
  type ShareFormValues,
} from "../schemas";
import { ShareFields } from "./share-fields";

/* ------------------------------------------------------------------ */

/** Alteração da divisão padrão: explícita, auditada e só para novos casos. */
export function ChangeShareDialog({ partner, open, onOpenChange }: { partner: PartnerOfficeAdminDTO; open: boolean; onOpenChange: (o: boolean) => void }) {
  const actions = usePartnerOfficeActions();
  const form = useForm<ShareFormValues>({
    resolver: zodResolver(shareSchema),
    defaultValues: { partnerPercentage: String(partner.partnershipPercentage), ownerPercentage: String(partner.ownerPercentage) },
  });
  const onSubmit = form.handleSubmit(async (v) => {
    const result = await actions.changeShare(partner.id, parsePercent(v.partnerPercentage), parsePercent(v.ownerPercentage));
    if (result.ok) onOpenChange(false);
    else if (result.error.fieldErrors) form.setError("ownerPercentage", { message: Object.values(result.error.fieldErrors)[0]?.[0] });
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Alterar divisão da parceria"
      description={`${partner.name} · divisão atual: ${partner.partnershipPercentage}% parceiro / ${partner.ownerPercentage}% escritório.`}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={form.formState.isSubmitting}>
            Cancelar
          </Button>
          <Button onClick={onSubmit} loading={form.formState.isSubmitting}>
            Salvar nova divisão
          </Button>
        </>
      }
    >
      <FormProvider {...form}>
        <form onSubmit={onSubmit} noValidate className="grid grid-cols-2 gap-x-5 gap-y-4">
          <ShareFields partnerField="partnerPercentage" ownerField="ownerPercentage" />
          <Callout tone="warning" className="col-span-full" title="Vale apenas para novos casos">
            Casos que já têm acordo continuam com a divisão registrada neles. A alteração fica registrada na auditoria.
          </Callout>
        </form>
      </FormProvider>
    </Dialog>
  );
}
