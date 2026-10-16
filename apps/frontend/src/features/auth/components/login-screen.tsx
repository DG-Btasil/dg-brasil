"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Callout } from "@/components/feedback/states";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input } from "@/components/ui/form";
import { loginErrorMessage } from "@/lib/auth/errors";
import { AUTH_ROUTES, safeNextPath } from "@/lib/auth/redirects";
import { rememberPreferenceCookie } from "@/lib/auth/session-cookies";
import { HOSTS } from "@/lib/hosts";
import { useHostAudience } from "@/lib/use-host-audience";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { AuthLayout } from "./auth-layout";
import { hardNavigate } from "./navigation";

const NOTICES: Record<string, { tone: "success" | "info"; text: string }> = {
  saiu: { tone: "info", text: "Você saiu da sua conta." },
  "saiu-todos": { tone: "info", text: "Você saiu de todos os dispositivos. Entre de novo com senha e código." },
  "senha-alterada": { tone: "success", text: "Senha alterada. Entre com a nova senha." },
};

/**
 * Login real (Supabase Auth, e-mail + senha). Acontece no navegador para o
 * Auth ver o IP de quem tenta (limite de tentativas). Depois do login, quem
 * decide o próximo passo (MFA, termos, bloqueio) é o servidor, em "/".
 * Não há cadastro público: acesso só por convite.
 */
export function LoginScreen({ next, notice }: { next?: string; notice?: string }) {
  const hostAudience = useHostAudience();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const info = notice ? NOTICES[notice] : undefined;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!email.trim() || !password) {
      setError("Informe e-mail e senha.");
      return;
    }
    setSubmitting(true);
    // Só a DURAÇÃO dos cookies da sessão (ver session-cookies.ts). Login novo
    // continua exigindo senha + TOTP: a preferência não eleva nada para aal2.
    document.cookie = rememberPreferenceCookie(remember, window.location.protocol === "https:");
    const { error: authError } = await getSupabaseBrowserClient().auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (authError) {
      setSubmitting(false);
      setPassword("");
      setError(loginErrorMessage(authError));
      return;
    }
    const safe = safeNextPath(next, "");
    hardNavigate(safe ? `/?next=${encodeURIComponent(safe)}` : "/");
  }

  return (
    <AuthLayout
      title={hostAudience === "PARTNER" ? "Portal do Parceiro" : "Entrar no DG Brasil"}
      description={hostAudience === "PARTNER" ? "Acesse os casos do seu escritório com a Bárbara Cardoso Advocacia." : "Acesse o ambiente do seu escritório."}
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {info && !error && <Callout tone={info.tone} title={info.text} />}
        {error && <Callout tone="danger" title={error} />}
        <Field label="E-mail" requirement="required">
          {(p) => (
            <Input
              {...p}
              type="email"
              autoComplete="username"
              placeholder="nome@escritorio.com.br"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          )}
        </Field>
        <Field label="Senha" requirement="required">
          {(p) => (
            <Input {...p} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          )}
        </Field>
        <Checkbox
          label="Lembrar de mim neste dispositivo"
          description="Você continua conectado ao fechar o navegador. Não use em computador compartilhado."
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
        />
        <Button type="submit" size="lg" className="w-full" loading={submitting}>
          Entrar
        </Button>
        <p className="text-center text-[13px]">
          <Link href={AUTH_ROUTES.forgotPassword} className="text-navy-700 underline-offset-4 hover:underline">
            Esqueci minha senha
          </Link>
        </p>
      </form>

      <p className="mt-8 border-t border-line pt-6 text-[13px] text-muted">
        Acesso somente por convite, com verificação em duas etapas. Equipe interna: {HOSTS.OWNER}. Escritórios parceiros:{" "}
        {HOSTS.PARTNER}.
      </p>
    </AuthLayout>
  );
}
