"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Briefcase, Handshake, ShieldCheck, UserRound, UsersRound } from "lucide-react";
import { HydrationGate } from "@/components/layout/guards";
import { Callout } from "@/components/feedback/states";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { isPartnerRole, ROLE_LABEL, type Role } from "@/lib/permissions";
import { msg, zEmail, zRequired } from "@/lib/validation";
import { useDemoAccounts, useSessionActions } from "@/features/auth/hooks";
import { AuthLayout, AuthLoading } from "./auth-layout";

const schema = z.object({
  email: zEmail(),
  password: zRequired(msg.required),
});
type LoginValues = z.infer<typeof schema>;

const DEMO_ROLES: { role: Role; icon: typeof ShieldCheck }[] = [
  { role: "ADMIN", icon: ShieldCheck },
  { role: "LAWYER", icon: Briefcase },
  { role: "ASSISTANT", icon: UserRound },
  { role: "PARTNER_ADMIN", icon: Handshake },
  { role: "PARTNER_USER", icon: UsersRound },
];

function LoginForm() {
  const router = useRouter();
  const { login, simulateRole } = useSessionActions();
  const demoUsers = useDemoAccounts();
  const [notFound, setNotFound] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({ resolver: zodResolver(schema), defaultValues: { email: "", password: "" } });

  const onSubmit = handleSubmit(({ email }) => {
    const ok = login(email);
    setNotFound(!ok);
    if (ok) router.push("/");
  });

  function enterAs(role: Role) {
    simulateRole(role);
    router.push("/home");
  }

  return (
    <AuthLayout title="Entrar no DG Brasil" description="Acesse o ambiente do seu escritório.">
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {notFound && (
          <Callout tone="danger" title="Não encontramos um usuário ativo com este e-mail.">
            Confira o endereço ou use um dos e-mails de demonstração abaixo.
          </Callout>
        )}
        <Field label="E-mail" requirement="required" error={errors.email?.message}>
          {(p) => <Input {...p} type="email" autoComplete="email" placeholder="nome@escritorio.com.br" {...register("email")} />}
        </Field>
        <Field
          label="Senha"
          requirement="required"
          error={errors.password?.message}
          hint="Protótipo: a senha não é verificada. Qualquer valor é aceito."
        >
          {(p) => <Input {...p} type="password" autoComplete="current-password" {...register("password")} />}
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
          Entrar
        </Button>
      </form>

      <section aria-labelledby="demo-access-title" className="mt-8 border-t border-line pt-6">
        <h2 id="demo-access-title" className="eyebrow">
          Acesso de demonstração
        </h2>
        <div className="mt-3 grid gap-2">
          {DEMO_ROLES.map(({ role, icon: Icon }) => (
            <Button key={role} variant="secondary" className="justify-start" icon={<Icon className="size-4 text-navy-600" aria-hidden />} onClick={() => enterAs(role)}>
              Entrar como {ROLE_LABEL[role]}
              {isPartnerRole(role) && <span className="text-muted">· Almeida Advocacia</span>}
            </Button>
          ))}
        </div>
        {demoUsers.length > 0 && (
          <div className="mt-4 rounded-md border border-line bg-surface-muted px-4 py-3">
            <p className="text-[12px] font-medium text-foreground">E-mails de demonstração</p>
            <ul className="mt-1.5 space-y-1">
              {demoUsers.map((u) => (
                <li key={u.id} className="flex justify-between gap-3 text-[12px]">
                  <span className="font-mono text-navy-700">{u.email}</span>
                  <span className="text-muted">{ROLE_LABEL[u.role]}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <p className="mt-8 text-[13px] text-muted">
        Seu escritório ainda não usa o DG Brasil?{" "}
        <Link href="/criar-escritorio" className="font-medium text-navy-700 underline-offset-4 hover:underline">
          Criar escritório
        </Link>
      </p>
    </AuthLayout>
  );
}

export function LoginScreen() {
  return (
    <HydrationGate fallback={<AuthLoading />}>
      <LoginForm />
    </HydrationGate>
  );
}
