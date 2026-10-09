import Link from "next/link";
import { Callout } from "@/components/feedback/states";
import { AUTH_ROUTES, BLOCKED_MESSAGES } from "@/lib/auth/redirects";
import { AuthLayout } from "./auth-layout";
import { SignOutButton } from "./sign-out-button";

/** Acesso bloqueado. O parâmetro `motivo` só escolhe um texto fixo. */
export function BlockedScreen({ reason, signedIn }: { reason?: string; signedIn: boolean }) {
  const message = (reason && BLOCKED_MESSAGES[reason]) || BLOCKED_MESSAGES["sem-acesso"];
  return (
    <AuthLayout title={message.title}>
      <Callout tone="warning" title={message.title}>
        {message.body}
      </Callout>
      <div className="mt-6 text-center text-[13px]">
        {signedIn ? (
          <SignOutButton label="Sair e voltar ao login" />
        ) : (
          <Link href={AUTH_ROUTES.login} className="text-navy-700 underline-offset-4 hover:underline">
            Voltar para o login
          </Link>
        )}
      </div>
    </AuthLayout>
  );
}
