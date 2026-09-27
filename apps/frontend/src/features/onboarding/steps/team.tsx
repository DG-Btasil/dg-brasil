"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { Info, Plus, Trash2 } from "lucide-react";
import { LEGAL_AREAS, LEGAL_AREA_LABEL } from "@/lib/constants/legal";
import { USER_STATUS_LABEL, USER_STATUS_TONE } from "@/lib/constants/status";
import { ROLES, ROLE_DESCRIPTION, ROLE_LABEL } from "@/lib/permissions";
import { Button, IconButton } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/display";
import { Field, Input, Select } from "@/components/ui/form";
import { ToggleChips } from "../components/choice-controls";
import { StepForm, StepSection } from "../components/step-section";
import { useOfficeMembers, useOnboardingActions, useRegisterStepForm, useToast } from "../hooks";
import { teamSchema, withDefaults, type TeamValues } from "../schemas";
import type { StepProps } from "../types";

const ROLE_OPTIONS = ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }));
const AREA_OPTIONS = LEGAL_AREAS.map((a) => ({ value: a, label: LEGAL_AREA_LABEL[a] }));
const EMPTY_MEMBER: TeamValues["members"][number] = { name: "", email: "", role: "LAWYER", title: "", areas: [] };

export function TeamStep({ formId, answers, onSave, registerForm }: StepProps) {
  const members = useOfficeMembers();
  const toast = useToast();
  const { inviteMembers } = useOnboardingActions();
  const form = useForm<TeamValues>({ resolver: zodResolver(teamSchema), defaultValues: withDefaults({ members: [] }, answers) });
  const { register, control, handleSubmit, formState } = form;
  const watched = useWatch({ control, name: "members" });
  const { errors } = formState;
  const list = useFieldArray({ control, name: "members" });
  useRegisterStepForm(form, registerForm);
  const knownEmails = new Set(members.map((m) => m.email.toLowerCase()));

  const submit = handleSubmit(async (values) => {
    const invited = await inviteMembers(values.members);
    if (invited > 0)
      toast({
        tone: "success",
        title: invited === 1 ? "1 convite registrado" : `${invited} convites registrados`,
        description: "Convites simulados: nenhum e-mail é enviado nesta demonstração.",
      });
    await onSave(values);
  });

  return (
    <StepForm id={formId} onSubmit={submit}>
      <StepSection title="Já cadastrados" description="Pessoas que já têm acesso ao escritório no DG Brasil." columns={1}>
        <ul className="divide-y divide-line rounded-md border border-line">
          {members.map((u) => (
            <li key={u.id} className="flex items-center gap-3 px-3.5 py-2.5">
              <Avatar name={u.name} size="sm" tone="neutral" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-foreground">{u.name}</p>
                <p className="truncate text-[12px] text-muted">
                  {u.email}
                  {u.title ? ` · ${u.title}` : ""}
                </p>
              </div>
              <span className="text-[12px] text-muted">{ROLE_LABEL[u.role]}</span>
              <StatusBadge status={u.status} labels={USER_STATUS_LABEL} tones={USER_STATUS_TONE} />
            </li>
          ))}
        </ul>
      </StepSection>

      <StepSection title="Convidar pessoas" description="Inclua quem ainda não tem acesso. O papel define o que cada pessoa enxerga." columns={1}>
        <p className="flex items-start gap-2 rounded-md border border-line bg-surface-muted px-3 py-2 text-[12px] text-muted">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Os convites são simulados nesta demonstração: nenhum e-mail é enviado.
        </p>

        {list.fields.length === 0 && (
          <p className="text-[12.5px] text-muted">Nenhum convite adicionado. Você também pode usar &quot;Convidar depois&quot;.</p>
        )}

        <ol className="space-y-4">
          {list.fields.map((f, i) => {
            const e = errors.members?.[i];
            const email = watched?.[i]?.email ?? "";
            const role = watched?.[i]?.role;
            const already = knownEmails.has(email.trim().toLowerCase());
            return (
              <li key={f.id} className="rounded-md border border-line p-4">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-[12.5px] font-semibold text-foreground">Pessoa {i + 1}</p>
                  <IconButton label={`Remover pessoa ${i + 1}`} size="sm" onClick={() => list.remove(i)}>
                    <Trash2 className="size-4" aria-hidden />
                  </IconButton>
                </div>
                <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
                  <Field label="Nome" requirement="required" error={e?.name?.message}>
                    {(p) => <Input {...p} {...register(`members.${i}.name`)} />}
                  </Field>
                  <Field
                    label="E-mail"
                    requirement="required"
                    error={e?.email?.message}
                    hint={already ? "Já cadastrado — não será convidado novamente." : undefined}
                  >
                    {(p) => <Input {...p} type="email" {...register(`members.${i}.email`)} />}
                  </Field>
                  <Field label="Papel" requirement="required" hint={role ? ROLE_DESCRIPTION[role] : undefined} error={e?.role?.message}>
                    {(p) => <Select {...p} options={ROLE_OPTIONS} {...register(`members.${i}.role`)} />}
                  </Field>
                  <Field label="Função" requirement="optional" error={e?.title?.message}>
                    {(p) => <Input {...p} placeholder="Ex.: Advogada — Previdenciário" {...register(`members.${i}.title`)} />}
                  </Field>
                  <div className="sm:col-span-2">
                    <Controller
                      control={control}
                      name={`members.${i}.areas`}
                      render={({ field }) => (
                        <ToggleChips
                          legend="Áreas sob responsabilidade"
                          requirement="optional"
                          options={AREA_OPTIONS}
                          value={field.value}
                          onChange={field.onChange}
                          inputRef={field.ref}
                          size="sm"
                        />
                      )}
                    />
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
        <div>
          <Button variant="secondary" size="sm" onClick={() => list.append(EMPTY_MEMBER)} icon={<Plus className="size-4" aria-hidden />}>
            Adicionar pessoa
          </Button>
        </div>
      </StepSection>
    </StepForm>
  );
}
