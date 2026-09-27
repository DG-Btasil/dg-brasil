import type { Metadata } from "next";
import { InvitationScreen } from "@/features/auth/components/invitation-screen";

export const metadata: Metadata = { title: "Convite" };

export default async function InvitationPage({ params }: PageProps<"/convite/[token]">) {
  const { token } = await params;
  return <InvitationScreen token={token} />;
}
