import { AppShell } from "@/components/layout/app-shell";
import { AuthProvider } from "@/features/auth/session-context";
import { requireAppSession, toClientSession } from "@/server/auth/session";

/**
 * Área autenticada. O servidor decide o acesso ANTES de qualquer render:
 * sessão válida no Auth, conta e vínculo ativos, escritório liberado, termos
 * aceitos e MFA (aal2). Senão, redireciona para o passo que falta.
 */
export default async function AuthenticatedLayout({ children }: LayoutProps<"/">) {
  const session = await requireAppSession();
  return (
    <AuthProvider session={toClientSession(session)}>
      <AppShell>{children}</AppShell>
    </AuthProvider>
  );
}
