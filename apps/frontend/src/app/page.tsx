import { redirect } from "next/navigation";
import { param } from "@/lib/auth/params";
import { destinationFor } from "@/lib/auth/redirects";
import { getCurrentSession } from "@/server/auth/session";

/** "/" decide o próximo passo NO SERVIDOR: login, MFA, termos, bloqueio ou o app. */
export default async function RootPage({ searchParams }: PageProps<"/">) {
  const next = param((await searchParams).next);
  redirect(destinationFor(await getCurrentSession(), next));
}
