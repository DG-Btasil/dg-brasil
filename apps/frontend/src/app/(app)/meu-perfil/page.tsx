import type { Metadata } from "next";
import { MyProfilePage } from "@/features/account/components/my-profile-page";
import { requireAppSession } from "@/server/auth/session";
import { getMyProfileAction } from "@/server/domain/account/actions";

export const metadata: Metadata = { title: "Meu perfil" };

/**
 * Dados pessoais da PRÓPRIA conta (079). Todo papel, nas duas superfícies: não
 * depende de permissão da matriz, só de sessão liberada. O perfil é o da
 * sessão; nenhum id vem da URL.
 */
export default async function MyProfileRoute() {
  await requireAppSession();
  return <MyProfilePage initialResult={await getMyProfileAction()} />;
}
