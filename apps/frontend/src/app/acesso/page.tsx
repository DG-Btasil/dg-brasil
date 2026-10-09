import type { Metadata } from "next";
import { BlockedScreen } from "@/features/auth/components/blocked-screen";
import { param } from "@/lib/auth/params";
import { getCurrentSession } from "@/server/auth/session";

export const metadata: Metadata = { title: "Acesso" };

export default async function BlockedPage({ searchParams }: PageProps<"/acesso">) {
  const reason = param((await searchParams).motivo);
  const result = await getCurrentSession();
  return <BlockedScreen reason={reason} signedIn={result.state !== "ANONYMOUS"} />;
}
