"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { MailX } from "lucide-react";
import { HydrationGate } from "@/components/layout/guards";
import { Callout, EmptyState } from "@/components/feedback/states";
import { Button, ButtonLink } from "@/components/ui/button";
import { DefinitionGrid } from "@/components/ui/panel";
import { Checkbox, Field, Input } from "@/components/ui/form";
import { Steps, type StepState } from "@/components/ui/display";
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

type InviteStep = "senha" | "documentos" | "2fa";
const STEPS: { key: InviteStep; label: string }[] = [
  { key: "senha", label: "Criar senha" },
  { key: "documentos", label: "Documentos legais" },
  { key: "2fa", label: "Verificação em duas etapas" },
];
const LEGAL_DOCUMENTS = [
  { key: "termos", label: "Termos de Uso do DG Brasil" },
  { key: "privacidade", label: "Política de Privacidade e tratamento de dados (LGPD)" },
  { key: "sigilo", label: "Termo de Confidencialidade e Sigilo Profissional" },
] as const;

/**
 * Aceite do convite (simulado): Convite → criar senha → aceitar documentos
 * legais → configurar 2FA (placeholder) → acessar. Senha, aceite e TOTP reais
 * ficam no backend (Supabase Auth); aqui nada é armazenado.
 */
function AcceptForm({ token, invitation, officeName, inviterName }: { token: string; invitation: Invitation; officeName: string; inviterName: string }) {
  const router = useRouter();
  const [step, setStep] = useState<InviteStep>("senha");
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});
  const [legalError, setLegalError] = useState<string>();
  const [finishing, setFinishing] = useState(false);
  const [finalError, setFinalError] = useState<string>();
  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { name: invitation.name ?? "", password: "", confirm: "" } });

  const onPassword = handleSubmit(() => setStep("documentos"));

  function onLegal() {
    if (!LEGAL_DOCUMENTS.every((d) => accepted[d.key])) {
      setLegalError("Aceite todos os documentos para continuar.");
      return;
    }
    setLegalError(undefined);
    setStep("2fa");
  }

  async function finish() {
    setFinishing(true);
    const ok = await repositories.users.acceptInvitation(token, getValues("name"));
    setFinishing(false);
    if (ok) router.push("/home");
    else setFinalError("Este convite não pôde ser aceito. Ele pode ter sido usado ou cancelado.");
  }

  const current = STEPS.findIndex((s) => s.key === step);

  return (
    <AuthLayout title={`Convite para ${officeName}`} description="Crie seu acesso em três etapas.">
      <div className="mb-5 rounded-md border border-line bg-surface-muted px-4 py-3.5">
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
      <Steps
        className="mb-5"
        steps={STEPS.map((s, i) => ({ key: s.key, label: s.label, state: (i < current ? "done" : i === current ? "current" : "pending") as StepState }))}
      />

      {step === "senha" && (
        <form onSubmit={onPassword} noValidate className="space-y-4">
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
            Continuar
          </Button>
        </form>
      )}

      {step === "documentos" && (
        <div className="space-y-4">
          {legalError && <Callout tone="danger">{legalError}</Callout>}
          <div className="space-y-3 rounded-md border border-line px-4 py-3.5">
            {LEGAL_DOCUMENTS.map((d) => (
              <Checkbox
                key={d.key}
                label={d.label}
                description="Leia o documento completo antes de aceitar. Versão de demonstração."
                checked={!!accepted[d.key]}
                onChange={(e) => setAccepted((a) => ({ ...a, [d.key]: e.target.checked }))}
              />
            ))}
          </div>
          <p className="text-[12px] text-muted">O aceite fica registrado com data e versão do documento (no backend).</p>
          <div className="flex gap-2">
            <Button variant="secondary" size="lg" onClick={() => setStep("senha")}>
              Voltar
            </Button>
            <Button size="lg" className="flex-1" onClick={onLegal}>
              Aceitar e continuar
            </Button>
          </div>
        </div>
      )}

      {step === "2fa" && (
        <div className="space-y-4">
          {finalError && <Callout tone="danger">{finalError}</Callout>}
          <Callout tone="info" title="Verificação em duas etapas">
            O acesso exigirá um código de aplicativo autenticador (TOTP). A configuração real — QR Code e códigos de recuperação — será feita após a
            configuração do backend.
          </Callout>
          <div className="flex items-center gap-4 rounded-md border border-dashed border-line-strong px-4 py-4">
            <div className="flex size-20 shrink-0 items-center justify-center rounded-md bg-surface-sunken text-[11px] text-subtle" aria-hidden>
              QR Code
            </div>
            <p className="text-[12.5px] text-muted">Escaneie o QR Code com Google Authenticator, Microsoft Authenticator ou similar. Disponível após configuração do backend.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" size="lg" onClick={() => setStep("documentos")}>
              Voltar
            </Button>
            <Button size="lg" className="flex-1" loading={finishing} onClick={finish}>
              Acessar o DG Brasil
            </Button>
          </div>
        </div>
      )}
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
