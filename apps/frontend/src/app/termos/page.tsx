import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { TermsScreen } from "@/features/auth/components/terms-screen";
import { param } from "@/lib/auth/params";
import { destinationFor, safeNextPath } from "@/lib/auth/redirects";
import { requireAuthenticatedUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "Termos" };

export default async function TermsPage({ searchParams }: PageProps<"/termos">) {
  const next = param((await searchParams).next);
  const result = await requireAuthenticatedUser();
  if (result.state !== "LEGAL_PENDING" || !result.session) redirect(destinationFor(result, next));
  return <TermsScreen pending={result.session.pendingLegalDocuments} next={safeNextPath(next, "") || undefined} />;
}
