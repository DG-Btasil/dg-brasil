import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { NewPasswordScreen } from "@/features/auth/components/new-password-screen";
import { AUTH_ROUTES } from "@/lib/auth/redirects";
import { requireAuthenticatedUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "Nova senha" };

/** Com MFA cadastrado, a troca de senha exige a sessão verificada (aal2). */
export default async function NewPasswordPage() {
  const result = await requireAuthenticatedUser();
  if (result.state === "MFA_VERIFY") redirect(`${AUTH_ROUTES.mfaVerify}?retorno=senha`);
  return <NewPasswordScreen email={result.email} />;
}
