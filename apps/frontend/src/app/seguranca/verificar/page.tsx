import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { MfaVerifyScreen } from "@/features/auth/components/mfa-screens";
import { param } from "@/lib/auth/params";
import { AUTH_ROUTES, destinationFor, safeNextPath } from "@/lib/auth/redirects";
import { requireAuthenticatedUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "Verificação em duas etapas" };

export default async function MfaVerifyPage({ searchParams }: PageProps<"/seguranca/verificar">) {
  const sp = await searchParams;
  const next = param(sp.next);
  // Único retorno especial permitido: voltar à troca de senha (rota de onboarding).
  const retorno = param(sp.retorno) === "senha" ? "senha" : undefined;
  const result = await requireAuthenticatedUser();
  if (result.state !== "MFA_VERIFY") redirect(retorno ? AUTH_ROUTES.newPassword : destinationFor(result, next));
  return <MfaVerifyScreen next={safeNextPath(next, "") || undefined} retorno={retorno} />;
}
