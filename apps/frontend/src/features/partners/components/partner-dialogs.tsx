"use client";

import { FormProvider, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { formatCurrency } from "@/lib/formatting";
import { parseCurrencyInput, zCurrencyOptional } from "@/lib/validation";
import { Callout } from "@/components/feedback/states";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/form";
import type { PartnershipAgreementView } from "@/types";
import type { PartnerOfficeAdminDTO } from "@/server/domain/organizations/dto";
import { usePartnerOfficeActions } from "../use-partner-office-actions";
import { usePartnerActions } from "../hooks";
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

/* ------------------------------------------------------------------ */
/* Financeiro da parceria (demonstração até a Fase F)                  */
/* ------------------------------------------------------------------ */

const valuesSchema = z.object({ revenueBase: zCurrencyOptional(), realizedRevenue: zCurrencyOptional() });
type ValuesForm = z.infer<typeof valuesSchema>;

const toInputValue = (n?: number) => (n === undefined ? "" : String(n).replace(".", ","));

/** Honorários estimados e realizados do caso (base da divisão). */
export function PartnershipValuesDialog({ agreement, open, onOpenChange }: { agreement: PartnershipAgreementView; open: boolean; onOpenChange: (o: boolean) => void }) {
  const actions = usePartnerActions();
  const form = useForm<ValuesForm>({
    resolver: zodResolver(valuesSchema),
    defaultValues: { revenueBase: toInputValue(agreement.revenueBase), realizedRevenue: toInputValue(agreement.realizedRevenue) },
  });
  const {
    register,
    formState: { errors },
  } = form;
  const onSubmit = form.handleSubmit(async (v) => {
    const ok = await actions.updateValues(agreement.id, {
      revenueBase: parseCurrencyInput(v.revenueBase),
      realizedRevenue: parseCurrencyInput(v.realizedRevenue),
    });
    if (ok !== null) onOpenChange(false);
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Honorários do caso"
      description={`Divisão deste caso: ${agreement.partnerPercentage}% parceiro / ${agreement.ownerPercentage}% Bárbara Cardoso Advocacia (registrada em ${new Date(agreement.effectiveAt).toLocaleDateString("pt-BR")}).`}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={onSubmit} loading={form.formState.isSubmitting}>
            Salvar valores
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="grid grid-cols-2 gap-x-5 gap-y-4">
        <Field label="Honorários estimados (R$)" requirement="optional" error={errors.revenueBase?.message} hint="Estimativa — não é garantia de recebimento.">
          {(p) => <Input {...p} inputMode="decimal" placeholder="0,00" {...register("revenueBase")} />}
        </Field>
        <Field label="Honorários realizados (R$)" requirement="optional" error={errors.realizedRevenue?.message} hint="Valor efetivamente recebido pelo escritório.">
          {(p) => <Input {...p} inputMode="decimal" placeholder="0,00" {...register("realizedRevenue")} />}
        </Field>
        <p className="col-span-full text-[12px] text-muted">O valor da causa é dado jurídico e não entra nesta divisão.</p>
      </form>
    </Dialog>
  );
}

const payoutSchema = z.object({
  amount: z.string().trim().min(1, "Informe o valor.").refine((v) => (parseCurrencyInput(v) ?? 0) > 0, "Informe um valor maior que zero."),
  note: z.string().trim(),
});
type PayoutForm = z.infer<typeof payoutSchema>;

/** Registro de repasse ao parceiro (fato interno; não movimenta dinheiro). */
export function PayoutDialog({ agreement, open, onOpenChange }: { agreement: PartnershipAgreementView; open: boolean; onOpenChange: (o: boolean) => void }) {
  const actions = usePartnerActions();
  const form = useForm<PayoutForm>({ resolver: zodResolver(payoutSchema), defaultValues: { amount: toInputValue(agreement.pendingPartnerAmount), note: "" } });
  const {
    register,
    setError,
    formState: { errors },
  } = form;
  const onSubmit = form.handleSubmit(async (v) => {
    const amount = parseCurrencyInput(v.amount) ?? 0;
    if (amount > agreement.pendingPartnerAmount + 0.001) {
      setError("amount", { message: `O repasse não pode passar do saldo a repassar (${formatCurrency(agreement.pendingPartnerAmount)}).` });
      return;
    }
    const ok = await actions.registerPayout(agreement.id, amount, v.note || undefined);
    if (ok !== null) onOpenChange(false);
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title="Registrar repasse ao parceiro"
      description={`Saldo a repassar: ${formatCurrency(agreement.pendingPartnerAmount)}. O sistema apenas registra o repasse; nenhuma transferência é feita.`}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={onSubmit} loading={form.formState.isSubmitting}>
            Registrar repasse
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <Field label="Valor (R$)" requirement="required" error={errors.amount?.message}>
          {(p) => <Input {...p} inputMode="decimal" {...register("amount")} />}
        </Field>
        <Field label="Observação" requirement="optional">
          {(p) => <Input {...p} {...register("note")} />}
        </Field>
      </form>
    </Dialog>
  );
}
