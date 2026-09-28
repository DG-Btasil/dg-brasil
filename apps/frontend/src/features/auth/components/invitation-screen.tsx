"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { MailX } from "lucide-react";
import { HydrationGate } from "@/components/layout/guards";
import { Callout, EmptyState } from "@/components/feedback/states";
import { Button, ButtonLink } from "@/components/ui/button";
import { DefinitionGrid } from "@/components/ui/panel";
import { Field, Input } from "@/components/ui/form";
import { ROLE_DESCRIPTION, ROLE_LABEL } from "@/lib/permissions";
import { zRequired } from "@/lib/validation";
import { repositories } from "@/repositories";
import type { Invitation } from "@/types";
import { AuthLayout, AuthLoading } from "./auth-layout";
import { useInvitationLookup } from "@/features/auth/hooks";

const schema = z
  .object({
    name: zRequired("Informe seu nome completo."),
    password: z.string().min(8, "A senha deve ter pelo menos 8 caracteres."),
    confirm: z.string().min(1, "Confirme a senha."),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "As senhas não coincidem." });
type Values = z.infer<typeof schema>;

function AcceptForm({ token, invitation, officeName, inviterName }: { token: string; invitation: Invitation; officeName: string; inviterName: string }) {
  const router = useRouter();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { name: invitation.name ?? "", password: "", confirm: "" } });

  const onSubmit = handleSubmit(async ({ name }) => {
    const ok = await repositories.users.acceptInvitation(token, name);
    if (ok) router.push("/home");
    else setError("root", { message: "Este convite não pôde ser aceito. Ele pode ter sido usado ou cancelado." });
  });

  return (
    <AuthLayout title={`Convite para ${officeName}`} description="Confirme seus dados para acessar o ambiente do escritório.">
      <div className="mb-6 rounded-md border border-line bg-surface-muted px-4 py-3.5">
        <DefinitionGrid
          items={[
            { label: "Escritório", value: officeName },
            { label: "Perfil", value: ROLE_LABEL[invitation.role] },
            { label: "Convidado por", value: inviterName },
            { label: "E-mail", value: invitation.email },
          ]}
        />
        <p className="mt-3 text-[12px] leading-relaxed text-muted">{ROLE_DESCRIPTION[invitation.role]}</p>
      </div>
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {errors.root?.message && <Callout tone="danger">{errors.root.message}</Callout>}
        <Field label="Nome completo" requirement="required" error={errors.name?.message}>
          {(p) => <Input {...p} autoComplete="name" {...register("name")} />}
        </Field>
        <Field label="Senha" requirement="required" error={errors.password?.message} hint="Protótipo: a senha não é armazenada.">
          {(p) => <Input {...p} type="password" autoComplete="new-password" {...register("password")} />}
        </Field>
        <Field label="Confirmar senha" requirement="required" error={errors.confirm?.message}>
          {(p) => <Input {...p} type="password" autoComplete="new-password" {...register("confirm")} />}
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
          Aceitar convite e entrar
        </Button>
      </form>
    </AuthLayout>
  );
}

function InvitationContent({ token }: { token: string }) {
  const lookup = useInvitationLookup(token);
  if (lookup.state === "valid") {
    // Convite de parceiro: o escritório exibido é o parceiro; o convite parte da Bárbara Cardoso Advocacia.
    return (
      <AcceptForm
        token={token}
        invitation={lookup.invitation}
        officeName={lookup.partnerOfficeName ?? lookup.officeName}
        inviterName={lookup.partnerOfficeName ? `${lookup.inviterName} · ${lookup.officeName}` : lookup.inviterName}
      />
    );
  }
  const used = lookup.state === "used";
  return (
    <AuthLayout title={used ? "Convite já utilizado" : "Convite inválido"}>
      <EmptyState
        compact
        icon={MailX}
        className="rounded-lg border border-line"
        title={used ? "Este convite já foi aceito." : "Não encontramos este convite."}
        description={
          used
            ? "Se a conta já é sua, entre com seu e-mail. Caso contrário, peça um novo convite ao administrador do escritório."
            : "O link pode estar incompleto ou o convite pode ter sido cancelado. Peça um novo convite ao administrador do escritório."
        }
        action={
          <ButtonLink href="/login" variant="secondary">
            Ir para o login
          </ButtonLink>
        }
      />
    </AuthLayout>
  );
}

export function InvitationScreen({ token }: { token: string }) {
  return (
    <HydrationGate fallback={<AuthLoading />}>
      <InvitationContent token={token} />
    </HydrationGate>
  );
}
