"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Callout } from "@/components/feedback/states";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { AUTH_ROUTES } from "@/lib/auth/redirects";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { AuthLayout } from "./auth-layout";

/**
 * Recuperação de senha. A resposta é SEMPRE a mesma, exista ou não a conta
 * (não revela quem tem acesso). O link do e-mail volta por /auth/confirm, que
 * só aceita destinos da lista de Redirect URLs do Supabase.
 */
export function ForgotPasswordScreen() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Informe um e-mail válido.");
      return;
    }
    setSubmitting(true);
    const { error: authError } = await getSupabaseBrowserClient().auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${window.location.origin}${AUTH_ROUTES.confirm}?fluxo=recuperacao`,
    });
    setSubmitting(false);
    if (authError?.status === 429) {
      setError("Muitas solicitações. Aguarde alguns minutos antes de tentar de novo.");
      return;
    }
    setSent(true);
  }

  return (
    <AuthLayout title="Recuperar senha" description="Enviaremos um link para você definir uma nova senha.">
      {sent ? (
        <Callout tone="success" title="Verifique seu e-mail.">
          Se houver uma conta ativa com este endereço, você receberá um link em alguns minutos. O link vale por pouco tempo e só pode ser
          usado uma vez.
        </Callout>
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          {error && <Callout tone="danger" title={error} />}
          <Field label="E-mail" requirement="required">
            {(p) => <Input {...p} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />}
          </Field>
          <Button type="submit" size="lg" className="w-full" loading={submitting}>
            Enviar link
          </Button>
        </form>
      )}
      <p className="mt-6 text-center text-[13px]">
        <Link href={AUTH_ROUTES.login} className="text-navy-700 underline-offset-4 hover:underline">
          Voltar para o login
        </Link>
      </p>
    </AuthLayout>
  );
}
