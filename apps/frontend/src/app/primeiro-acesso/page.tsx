import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { FirstAccessScreen } from "@/features/auth/components/first-access-screen";
import { param } from "@/lib/auth/params";
import { AUTH_ROUTES, isInviteRef } from "@/lib/auth/redirects";
import { requireAuthenticatedUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "Primeiro acesso" };

/** Chega aqui pelo link do convite (/auth/confirm), já com sessão do e-mail convidado. */
export default async function FirstAccessPage({ searchParams }: PageProps<"/primeiro-acesso">) {
  const ref = param((await searchParams).ref);
  if (!isInviteRef(ref)) redirect(`${AUTH_ROUTES.blocked}?motivo=convite-invalido`);
  const result = await requireAuthenticatedUser();
  if (result.state === "READY") redirect(AUTH_ROUTES.home);
  // Reconvite de conta que já tem autenticador: o Auth só troca a senha em aal2.
  if (result.mfa?.hasVerifiedFactor && result.mfa.currentLevel !== "aal2") {
    redirect(`${AUTH_ROUTES.mfaVerify}?retorno=convite&ref=${ref}`);
  }
  return <FirstAccessScreen inviteRef={ref} email={result.email} defaultName={result.fullName} />;
}
