"use client";

import { useState, type FormEvent } from "react";
import { Callout } from "@/components/feedback/states";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { passwordProblem } from "@/lib/auth/password-policy";
import { completeInvitation } from "@/server/auth/actions";
import { AuthLayout } from "./auth-layout";
import { hardNavigate } from "./navigation";
import { OnboardingSteps } from "./onboarding-steps";
import { PasswordFields } from "./password-fields";

/**
 * Primeiro acesso por convite: nome + senha. Em seguida o servidor leva aos
 * termos e ao cadastro obrigatório do MFA — só então o sistema abre.
 */
export function FirstAccessScreen({ inviteRef, email, defaultName }: { inviteRef: string; email?: string; defaultName?: string }) {
  const [fullName, setFullName] = useState(defaultName ?? "");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (fullName.trim().length < 3) return setError("Informe seu nome completo.");
    const problem = passwordProblem(password, { email, name: fullName });
    if (problem) return setError(problem);
    if (password !== confirm) return setError("As senhas não coincidem.");
    setError(null);
    setSubmitting(true);
    const result = await completeInvitation({ ref: inviteRef, fullName, password });
    if (!result.ok) {
      setSubmitting(false);
      return setError(result.error);
    }
    hardNavigate("/");
  }

  return (
    <AuthLayout title="Primeiro acesso" description={email ? `Convite para ${email}` : "Conclua seu cadastro para acessar o DG Brasil."}>
      <OnboardingSteps current="password" />
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {error && <Callout tone="danger" title={error} />}
        <Field label="Nome completo" requirement="required">
          {(p) => <Input {...p} autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} />}
        </Field>
        <PasswordFields password={password} confirm={confirm} onPassword={setPassword} onConfirm={setConfirm} />
        <Button type="submit" size="lg" className="w-full" loading={submitting}>
          Continuar
        </Button>
      </form>
    </AuthLayout>
  );
}
