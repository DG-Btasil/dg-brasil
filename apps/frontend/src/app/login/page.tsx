import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginScreen } from "@/features/auth/components/login-screen";
import { param } from "@/lib/auth/params";
import { destinationFor, safeNextPath } from "@/lib/auth/redirects";
import { getCurrentSession } from "@/server/auth/session";

export const metadata: Metadata = { title: "Entrar" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const next = param(sp.next);
  const result = await getCurrentSession();
  if (result.state !== "ANONYMOUS") redirect(destinationFor(result, next));
  return <LoginScreen next={safeNextPath(next, "") || undefined} notice={param(sp.aviso)} />;
}
