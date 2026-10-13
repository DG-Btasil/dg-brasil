import { AppShell } from "@/components/layout/app-shell";
import { AuthProvider } from "@/features/auth/session-context";
import { ProductTourStateProvider } from "@/features/tour/product-tour-state";
import { requireAppSession, toClientSession } from "@/server/auth/session";
import { getProductTourCompletedAt } from "@/server/onboarding";

/**
 * Área autenticada. O servidor decide o acesso ANTES de qualquer render:
 * sessão válida no Auth, conta e vínculo ativos, escritório liberado, termos
 * aceitos e MFA (aal2). Senão, redireciona para o passo que falta.
 *
 * A introdução do produto (tour) vem do banco, por usuário: aparece uma vez,
 * em qualquer navegador, depois do onboarding de segurança.
 */
export default async function AuthenticatedLayout({ children }: LayoutProps<"/">) {
  const session = await requireAppSession();
  const tourCompletedAt = await getProductTourCompletedAt();
  return (
    <AuthProvider session={toClientSession(session)}>
      <ProductTourStateProvider initialCompletedAt={tourCompletedAt}>
        <AppShell>{children}</AppShell>
      </ProductTourStateProvider>
    </AuthProvider>
  );
}
