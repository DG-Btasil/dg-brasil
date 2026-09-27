"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm, useWatch } from "react-hook-form";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Segmented, ToggleChips } from "../components/choice-controls";
import { EditableList, cleanList } from "../components/list-controls";
import { StepForm, StepSection, Wide } from "../components/step-section";
import { useRegisterStepForm } from "../hooks";
import { CONTACT_CHANNELS, TONE_LABEL } from "../labels";
import { TONES, communicationSchema, withDefaults, type CommunicationValues } from "../schemas";
import type { StepProps } from "../types";

const TONE_OPTIONS = TONES.map((v) => ({ value: v, label: TONE_LABEL[v] }));
const YES_NO = [
  { value: "YES" as const, label: "Sim" },
  { value: "NO" as const, label: "Não" },
];
const CHANNEL_OPTIONS = CONTACT_CHANNELS.map((c) => ({ value: c, label: c }));

const DEFAULTS: CommunicationValues = {
  clientTreatment: "",
  tone: "FORMAL_CORDIAL",
  whatsappEnabled: "YES",
  whatsappHours: "",
  emailUsage: "",
  frequentMessages: [""],
  signature: "",
  preferredChannels: [],
  contactEmail: "",
};

export function CommunicationStep({ formId, answers, onSave, registerForm }: StepProps) {
  const form = useForm<CommunicationValues>({ resolver: zodResolver(communicationSchema), defaultValues: withDefaults(DEFAULTS, answers) });
  const { register, control, handleSubmit, formState } = form;
  const { errors } = formState;
  useRegisterStepForm(form, registerForm);
  const whatsapp = useWatch({ control, name: "whatsappEnabled" });

  return (
    <StepForm id={formId} onSubmit={handleSubmit((v) => onSave({ ...v, frequentMessages: cleanList(v.frequentMessages) }))}>
      <StepSection title="Tom com o cliente">
        <Field label="Como tratar os clientes" requirement="required" hint="Ex.: Sr. / Sra. seguido do primeiro nome." error={errors.clientTreatment?.message}>
          {(p) => <Input {...p} {...register("clientTreatment")} />}
        </Field>
        <Field label="Tom das mensagens" requirement="required" error={errors.tone?.message}>
          {(p) => <Select {...p} options={TONE_OPTIONS} {...register("tone")} />}
        </Field>
        <Wide>
          <Controller
            control={control}
            name="preferredChannels"
            render={({ field }) => (
              <ToggleChips legend="Canais preferidos" requirement="recommended" options={CHANNEL_OPTIONS} value={field.value} onChange={field.onChange} inputRef={field.ref} />
            )}
          />
        </Wide>
      </StepSection>

      <StepSection title="WhatsApp e e-mail">
        <Controller
          control={control}
          name="whatsappEnabled"
          render={({ field }) => (
            <Segmented legend="Atende clientes pelo WhatsApp?" requirement="required" options={YES_NO} value={field.value} onChange={field.onChange} inputRef={field.ref} />
          )}
        />
        {whatsapp === "YES" ? (
          <Field label="Horário de atendimento no WhatsApp" requirement="required" error={errors.whatsappHours?.message}>
            {(p) => <Input {...p} placeholder="Ex.: dias úteis, das 9h às 18h" {...register("whatsappHours")} />}
          </Field>
        ) : (
          <div className="hidden sm:block" />
        )}
        <Field label="Uso do e-mail" requirement="optional" error={errors.emailUsage?.message}>
          {(p) => <Input {...p} placeholder="Ex.: envio de documentos e contratos" {...register("emailUsage")} />}
        </Field>
        <Field label="E-mail de contato com clientes" requirement="optional" error={errors.contactEmail?.message}>
          {(p) => <Input {...p} type="email" {...register("contactEmail")} />}
        </Field>
      </StepSection>

      <StepSection title="Modelos e assinatura" columns={1}>
        <Controller
          control={control}
          name="frequentMessages"
          render={({ field }) => (
            <EditableList
              legend="Mensagens frequentes"
              requirement="recommended"
              itemLabel="Mensagem"
              addLabel="Adicionar mensagem"
              placeholder="Ex.: Pedido de documento pendente"
              value={field.value}
              onChange={field.onChange}
            />
          )}
        />
        <Field label="Assinatura" requirement="optional" error={errors.signature?.message}>
          {(p) => <Textarea {...p} rows={3} placeholder={"Nome\nEscritório\nTelefone"} {...register("signature")} />}
        </Field>
      </StepSection>
    </StepForm>
  );
}
