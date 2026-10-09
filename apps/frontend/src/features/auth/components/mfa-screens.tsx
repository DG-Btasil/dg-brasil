"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Callout } from "@/components/feedback/states";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { mfaErrorMessage } from "@/lib/auth/errors";
import { AUTH_ROUTES } from "@/lib/auth/redirects";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { AuthLayout, AuthLoading } from "./auth-layout";
import { hardNavigate } from "./navigation";
import { OnboardingSteps } from "./onboarding-steps";
import { SignOutButton } from "./sign-out-button";

/**
 * MFA TOTP obrigatório para todos os papéis. O segredo TOTP fica só no
 * Supabase Auth: aparece UMA vez aqui, para o app autenticador, e nunca é
 * gravado no nosso banco, enviado ao nosso servidor nem registrado em log.
 */

function afterMfa(next?: string, retorno?: string) {
  if (retorno === "senha") return hardNavigate(AUTH_ROUTES.newPassword);
  hardNavigate(next ? `/?next=${encodeURIComponent(next)}` : "/");
}

function CodeField({ code, onCode }: { code: string; onCode: (v: string) => void }) {
  return (
    <Field label="Código de 6 dígitos" requirement="required">
      {(p) => (
        <Input
          {...p}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          className="font-mono tracking-[0.3em]"
          value={code}
          onChange={(e) => onCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
        />
      )}
    </Field>
  );
}

type Enrollment = { factorId: string; qrCode: string; secret: string };

export function MfaEnrollScreen({ next }: { next?: string }) {
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fatal, setFatal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      const supabase = getSupabaseBrowserClient();
      // Cadastros abandonados (QR gerado e não confirmado) atrapalham um novo.
      const { data: factors } = await supabase.auth.mfa.listFactors();
      for (const f of factors?.all ?? []) {
        if (f.factor_type === "totp" && f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
      const { data, error: enrollError } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `DG Brasil ${new Date().toISOString().slice(0, 10)}`,
      });
      if (enrollError || !data) {
        setFatal(true);
        setError(mfaErrorMessage(enrollError));
        return;
      }
      setEnrollment({ factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret });
    })();
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!enrollment) return;
    if (code.length !== 6) return setError("Digite os 6 dígitos do aplicativo.");
    setSubmitting(true);
    setError(null);
    const { error: verifyError } = await getSupabaseBrowserClient().auth.mfa.challengeAndVerify({ factorId: enrollment.factorId, code });
    if (verifyError) {
      setSubmitting(false);
      setCode("");
      return setError(mfaErrorMessage(verifyError));
    }
    afterMfa(next);
  }

  if (!enrollment && !fatal) return <AuthLoading />;

  return (
    <AuthLayout
      title="Verificação em duas etapas"
      description="Obrigatória para todos os acessos. Use um aplicativo autenticador (Google Authenticator, Microsoft Authenticator, 1Password…)."
    >
      <OnboardingSteps current="mfa" withPassword={false} />
      {fatal || !enrollment ? (
        <Callout tone="danger" title={error ?? "Não foi possível iniciar o cadastro."} action={<SignOutButton />}>
          Recarregue a página para tentar de novo.
        </Callout>
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <ol className="list-decimal space-y-1 pl-5 text-[13px] text-foreground/80">
            <li>Abra o aplicativo autenticador e escaneie o QR code.</li>
            <li>Digite o código de 6 dígitos que aparecer.</li>
          </ol>
          <div className="flex justify-center rounded-md border border-line bg-white p-4">
            {/* eslint-disable-next-line @next/next/no-img-element -- QR em data URL gerado pelo Supabase Auth */}
            <img src={enrollment.qrCode} alt="QR code para o aplicativo autenticador" width={176} height={176} />
          </div>
          <details className="text-[12.5px] text-muted">
            <summary className="cursor-pointer">Não consegue escanear? Digite a chave manualmente</summary>
            <code className="mt-2 block break-all rounded-sm bg-surface-sunken px-2 py-1.5 font-mono text-[12px] text-foreground">{enrollment.secret}</code>
          </details>
          {error && <Callout tone="danger" title={error} />}
          <CodeField code={code} onCode={setCode} />
          <Button type="submit" size="lg" className="w-full" loading={submitting}>
            Confirmar e ativar
          </Button>
          <div className="text-center">
            <SignOutButton />
          </div>
        </form>
      )}
    </AuthLayout>
  );
}

export function MfaVerifyScreen({ next, retorno }: { next?: string; retorno?: string }) {
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    getSupabaseBrowserClient()
      .auth.mfa.listFactors()
      .then(({ data }) => {
        const factor = data?.totp.find((f) => f.status === "verified");
        // Sem fator verificado: o servidor manda para o cadastro.
        if (factor) setFactorId(factor.id);
        else hardNavigate(AUTH_ROUTES.mfaEnroll);
      });
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!factorId) return;
    if (code.length !== 6) return setError("Digite os 6 dígitos do aplicativo.");
    setSubmitting(true);
    setError(null);
    const { error: verifyError } = await getSupabaseBrowserClient().auth.mfa.challengeAndVerify({ factorId, code });
    if (verifyError) {
      setSubmitting(false);
      setCode("");
      return setError(mfaErrorMessage(verifyError));
    }
    afterMfa(next, retorno);
  }

  if (!factorId) return <AuthLoading />;

  return (
    <AuthLayout title="Verificação em duas etapas" description="Digite o código atual do seu aplicativo autenticador.">
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {error && <Callout tone="danger" title={error} />}
        <CodeField code={code} onCode={setCode} />
        <Button type="submit" size="lg" className="w-full" loading={submitting}>
          Verificar
        </Button>
      </form>
      <p className="mt-6 text-[12.5px] leading-relaxed text-muted">
        Perdeu acesso ao aplicativo? Peça a um administrador do escritório Bárbara Cardoso para redefinir sua verificação em duas etapas.
        Por segurança, não é possível desativá-la por aqui.
      </p>
      <div className="mt-4 text-center">
        <SignOutButton />
      </div>
    </AuthLayout>
  );
}
