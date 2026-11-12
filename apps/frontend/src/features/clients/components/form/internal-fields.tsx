"use client";

import { useFormContext, useWatch } from "react-hook-form";
import { Field, FormSection, Input, Select, Textarea } from "@/components/ui/form";
import { ACQUISITION_CHANNEL_OPTIONS, CONTRACT_PAYMENT_METHOD_OPTIONS } from "@/lib/constants/legal";
import { useOriginOptions } from "@/features/directory/directory-context";

interface InternalValues {
  originOfficeId: string;
  acquisitionChannel: string;
  acquisitionDetail: string;
  contractPaymentMethod: string;
  legalSummary: string;
  notes: string;
}

/**
 * De onde o cliente veio (duas informações diferentes, Roadmap 2.0):
 * - escritório de origem: escritório principal ou parceiro A/B;
 * - canal: como ele chegou (indicação, Google Ads, Meta Ads, ...).
 * Advogado não é responsável por cliente (só por caso e processo).
 */
export function OriginFields() {
  const {
    register,
    control,
    formState: { errors },
  } = useFormContext<InternalValues>();
  const origin = useWatch({ control, name: "originOfficeId" });
  const originOptions = useOriginOptions(origin);
  return (
    <FormSection title="De onde o cliente veio" description="Escritório que trouxe o cliente e o canal pelo qual ele chegou. Alimenta os indicadores de origem.">
      <Field
        label="Escritório de origem"
        requirement="required"
        error={errors.originOfficeId?.message}
        hint="Escritório principal ou o parceiro que trouxe o cliente."
      >
        {(p) => <Select placeholder="Selecione" options={originOptions} {...p} {...register("originOfficeId")} />}
      </Field>
      <Field label="Canal (como chegou)" requirement="recommended" error={errors.acquisitionChannel?.message} hint="Indicação, Google Ads, Meta Ads, redes sociais...">
        {(p) => <Select placeholder="Não informado" options={ACQUISITION_CHANNEL_OPTIONS} {...p} {...register("acquisitionChannel")} />}
      </Field>
      <Field label="Detalhe do canal" requirement="optional" error={errors.acquisitionDetail?.message} hint="Quem indicou, nome da campanha, evento." className="col-span-2">
        {(p) => <Input maxLength={300} {...p} {...register("acquisitionDetail")} />}
      </Field>
    </FormSection>
  );
}

/**
 * Observações internas (comum a PF e PJ). A forma de pagamento do contrato de
 * honorários só entra no cadastro de pessoa física (`withContractPayment`).
 */
export function InternalFields({ withContractPayment = false }: { withContractPayment?: boolean }) {
  const {
    register,
    formState: { errors },
  } = useFormContext<InternalValues>();
  return (
    <FormSection title="Informações adicionais" description="Uso interno do escritório. Não aparecem para o cliente.">
      {withContractPayment && (
        <Field label="Forma de pagamento do contrato" requirement="optional" error={errors.contractPaymentMethod?.message} hint="Usada pelo agente que gera o contrato de honorários.">
          {(p) => <Select placeholder="Não definida" options={CONTRACT_PAYMENT_METHOD_OPTIONS} {...p} {...register("contractPaymentMethod")} />}
        </Field>
      )}
      <Field label="Resumo jurídico" requirement="optional" hint="Síntese curta do relacionamento com o cliente." className="col-span-2">
        {(p) => <Textarea rows={3} {...p} {...register("legalSummary")} />}
      </Field>
      <Field label="Observações internas" requirement="optional" className="col-span-2">
        {(p) => <Textarea rows={3} {...p} {...register("notes")} />}
      </Field>
    </FormSection>
  );
}
