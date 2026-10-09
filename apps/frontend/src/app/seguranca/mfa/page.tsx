import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { MfaEnrollScreen } from "@/features/auth/components/mfa-screens";
import { param } from "@/lib/auth/params";
import { destinationFor, safeNextPath } from "@/lib/auth/redirects";
import { requireAuthenticatedUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "Verificação em duas etapas" };

/** Cadastro do MFA: só para quem ainda não tem fator (redefinição é do ADMIN). */
export default async function MfaEnrollPage({ searchParams }: PageProps<"/seguranca/mfa">) {
  const next = param((await searchParams).next);
  const result = await requireAuthenticatedUser();
  if (result.state !== "MFA_ENROLL") redirect(destinationFor(result, next));
  return <MfaEnrollScreen next={safeNextPath(next, "") || undefined} />;
}
