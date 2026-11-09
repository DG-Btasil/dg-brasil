"use client";

import { useState } from "react";
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
  // Dois passos (QA E-11): editar e depois confirmar "atual → nova".
  const [pending, setPending] = useState<{ partner: number; owner: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const review = form.handleSubmit((v) => setPending({ partner: parsePercent(v.partnerPercentage), owner: parsePercent(v.ownerPercentage) }));
  async function confirm() {
    if (!pending) return;
    setSaving(true);
    const result = await actions.changeShare(partner.id, pending.partner, pending.owner);
    setSaving(false);
    if (result.ok) onOpenChange(false);
    else {
      setPending(null);
      if (result.error.fieldErrors) form.setError("ownerPercentage", { message: Object.values(result.error.fieldErrors)[0]?.[0] });
    }
  }
  const onSubmit = pending ? confirm : review;
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Alterar divisão da parceria"
      description={`${partner.name} · divisão atual: ${partner.partnershipPercentage}% parceiro / ${partner.ownerPercentage}% escritório.`}
      footer={
        <>
          <Button variant="secondary" onClick={() => (pending ? setPending(null) : onOpenChange(false))} disabled={saving}>
            {pending ? "Voltar" : "Cancelar"}
          </Button>
          <Button onClick={onSubmit} loading={saving}>
            {pending ? "Confirmar nova divisão" : "Revisar"}
          </Button>
        </>
      }
    >
      {pending ? (
        <div className="space-y-3">
          <dl className="grid grid-cols-2 gap-3 text-[13px]">
            <div className="rounded-md border border-line bg-surface-muted px-4 py-3">
              <dt className="text-[11.5px] font-medium uppercase tracking-[0.05em] text-subtle">Divisão atual</dt>
              <dd className="mt-1 font-semibold tabular text-foreground">
                Parceiro {partner.partnershipPercentage}% · Escritório {partner.ownerPercentage}%
              </dd>
            </div>
            <div className="rounded-md border border-navy-600/40 bg-surface px-4 py-3">
              <dt className="text-[11.5px] font-medium uppercase tracking-[0.05em] text-subtle">Nova divisão</dt>
              <dd className="mt-1 font-semibold tabular text-navy">
                Parceiro {pending.partner}% · Escritório {pending.owner}%
              </dd>
            </div>
          </dl>
          <Callout tone="warning" title="Vale para os casos criados a partir de agora">
            Casos que já existem continuam com a divisão de quando foram criados, mesmo que sejam aceitos depois. A alteração fica registrada na auditoria.
          </Callout>
        </div>
      ) : (
        <FormProvider {...form}>
          <form onSubmit={review} noValidate className="grid grid-cols-2 gap-x-5 gap-y-4">
            <ShareFields partnerField="partnerPercentage" ownerField="ownerPercentage" />
            <Callout tone="warning" className="col-span-full" title="Vale para os casos criados a partir de agora">
              Casos que já existem continuam com a divisão de quando foram criados. Você confere a mudança antes de salvar.
            </Callout>
          </form>
        </FormProvider>
      )}
    </Dialog>
  );
}
