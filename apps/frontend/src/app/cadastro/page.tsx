import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ProfileScreen } from "@/features/auth/components/profile-screen";
import { nameCameFromEmail } from "@/lib/account/personal-profile";
import { param } from "@/lib/auth/params";
import { destinationFor, safeNextPath } from "@/lib/auth/redirects";
import { requireAuthenticatedUser } from "@/server/auth/session";
import { getMyProfileAction, listMyOabsAction } from "@/server/domain/account/actions";

export const metadata: Metadata = { title: "Complete seu cadastro" };

/**
 * Etapa obrigatória do cadastro pessoal (079). Só para quem está em
 * PROFILE_PENDING (tudo liberado, falta o cadastro); qualquer outro estado
 * segue para o passo certo. O estado vem do banco a cada requisição.
 */
export default async function ProfilePage({ searchParams }: PageProps<"/cadastro">) {
  const next = param((await searchParams).next);
  const result = await requireAuthenticatedUser();
  if (result.state !== "PROFILE_PENDING" || !result.session) redirect(destinationFor(result, next));

  const [profile, oabs] = await Promise.all([getMyProfileAction(), listMyOabsAction()]);
  if (!profile.ok) throw new Error("Não foi possível carregar o cadastro pessoal.");

  const initial = profile.data.profile;
  // Conta criada fora do convite nasce com o nome tirado do e-mail: a pessoa escreve o nome.
  if (nameCameFromEmail(initial.fullName, profile.data.email)) initial.fullName = "";
  return <ProfileScreen initial={initial} oabs={oabs.ok ? oabs.data : []} next={safeNextPath(next, "") || undefined} />;
}
