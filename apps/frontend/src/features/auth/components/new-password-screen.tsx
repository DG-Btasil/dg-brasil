"use client";

import { useState, type FormEvent } from "react";
import { Callout } from "@/components/feedback/states";
import { Button } from "@/components/ui/button";
import { passwordProblem } from "@/lib/auth/password-policy";
import { updatePassword } from "@/server/auth/actions";
import { AuthLayout } from "./auth-layout";
import { hardNavigate } from "./navigation";
import { PasswordFields } from "./password-fields";

/** Nova senha depois do link de recuperação (a sessão veio do link). */
export function NewPasswordScreen({ email }: { email?: string }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const problem = passwordProblem(password, { email });
    if (problem) return setError(problem);
    if (password !== confirm) return setError("As senhas não coincidem.");
    setError(null);
    setSubmitting(true);
    const result = await updatePassword({ password });
    if (!result.ok) {
      setSubmitting(false);
      return setError(result.error);
    }
    hardNavigate("/");
  }

  return (
    <AuthLayout title="Definir nova senha" description={email ? `Conta: ${email}` : undefined}>
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {error && <Callout tone="danger" title={error} />}
        <PasswordFields password={password} confirm={confirm} onPassword={setPassword} onConfirm={setConfirm} />
        <Button type="submit" size="lg" className="w-full" loading={submitting}>
          Salvar nova senha
        </Button>
      </form>
    </AuthLayout>
  );
}
