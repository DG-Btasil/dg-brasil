import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { MfaVerifyScreen } from "@/features/auth/components/mfa-screens";
import { param } from "@/lib/auth/params";
import { destinationFor, mfaReturnPath, safeNextPath } from "@/lib/auth/redirects";
import { requireAuthenticatedUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "Verificação em duas etapas" };

export default async function MfaVerifyPage({ searchParams }: PageProps<"/seguranca/verificar">) {
  const sp = await searchParams;
  const next = param(sp.next);
  // Retornos especiais (lista fechada): troca de senha e primeiro acesso por convite.
  const returnTo = mfaReturnPath(param(sp.retorno), param(sp.ref));
  const result = await requireAuthenticatedUser();
  // Pede o código a quem TEM fator e ainda está em aal1 — inclusive conta sem
  // vínculo (reconvidada), que o estado MFA_VERIFY não cobre.
  const needsCode = result.mfa?.hasVerifiedFactor && result.mfa.currentLevel !== "aal2";
  if (!needsCode) redirect(returnTo ?? destinationFor(result, next));
  return <MfaVerifyScreen next={safeNextPath(next, "") || undefined} returnTo={returnTo ?? undefined} />;
}
