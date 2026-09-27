"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/form";
import { Callout } from "@/components/feedback/states";
import { ROLES, ROLE_DESCRIPTION, ROLE_LABEL } from "@/lib/permissions";
import { useToast } from "@/store/ui-store";
import { useSettingsActions } from "../../hooks";
import { inviteSchema, type InviteFormValues } from "../../schemas";

const FORM_ID = "invite-user-form";

export function inviteUrl(token: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/convite/${token}`;
}

/** Botão que copia o link de convite para a área de transferência. */
export function CopyInviteButton({ token, size = "md" }: { token: string; size?: "sm" | "md" }) {
  const toast = useToast();
  async function copy() {
    try {
      await navigator.clipboard.writeText(inviteUrl(token));
      toast({ tone: "success", title: "Link de convite copiado" });
    } catch {
      toast({ tone: "warning", title: "Não foi possível copiar", description: "Selecione o link e copie manualmente." });
    }
  }
  return (
    <Button variant="secondary" size={size} icon={<Copy className="size-3.5" aria-hidden />} onClick={copy}>
      Copiar link
    </Button>
  );
}

export function InviteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { invite } = useSettingsActions();
  const [token, setToken] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<InviteFormValues>({ resolver: zodResolver(inviteSchema), defaultValues: { name: "", email: "", role: "LAWYER" } });

  function close(next: boolean) {
    if (!next) {
      setToken(null);
      reset();
    }
    onOpenChange(next);
  }

  async function onSubmit(values: InviteFormValues) {
    const created = await invite(values);
    if (created) setToken(created);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title={token ? "Convite criado" : "Convidar usuário"}
      description={token ? "Envie o link abaixo para a pessoa convidada." : "A pessoa recebe um link para criar o acesso com o papel definido."}
      footer={
        token ? (
          <Button onClick={() => close(false)}>Concluir</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={() => close(false)}>
              Cancelar
            </Button>
            <Button type="submit" form={FORM_ID} loading={isSubmitting}>
              Criar convite
            </Button>
          </>
        )
      }
    >
      {token ? (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <label className="min-w-0 flex-1">
              <span className="sr-only">Link de convite</span>
              <Input readOnly value={inviteUrl(token)} onFocus={(e) => e.target.select()} className="tabular" />
            </label>
            <CopyInviteButton token={token} />
          </div>
          <Callout tone="info">Nesta demonstração nenhum e-mail é enviado. Compartilhe o link diretamente.</Callout>
        </div>
      ) : (
        <form id={FORM_ID} onSubmit={handleSubmit(onSubmit)} noValidate className="grid grid-cols-2 gap-x-5 gap-y-4">
          <Field label="Nome" requirement="required" error={errors.name?.message}>
            {(p) => <Input {...p} autoComplete="off" {...register("name")} />}
          </Field>
          <Field label="E-mail" requirement="required" error={errors.email?.message}>
            {(p) => <Input {...p} type="email" autoComplete="off" {...register("email")} />}
          </Field>
          <Field label="Papel" requirement="required" className="col-span-2" hint={<RoleHints />}>
            {(p) => <Select {...p} options={ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }))} {...register("role")} />}
          </Field>
        </form>
      )}
    </Dialog>
  );
}

function RoleHints() {
  return (
    <span className="mt-1 block space-y-0.5">
      {ROLES.map((r) => (
        <span key={r} className="block">
          <strong className="font-medium text-foreground">{ROLE_LABEL[r]}:</strong> {ROLE_DESCRIPTION[r]}
        </span>
      ))}
    </span>
  );
}
