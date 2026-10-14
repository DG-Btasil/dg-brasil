import { AppShell } from "@/components/layout/app-shell";
import { AuthProvider } from "@/features/auth/session-context";
import { OrgDirectoryProvider } from "@/features/directory/directory-context";
import { NavCountsProvider } from "@/features/navigation/hooks";
import { loadNavCounts } from "@/features/navigation/load";
import { ProductTourStateProvider } from "@/features/tour/product-tour-state";
import { requireAppSession, toClientSession } from "@/server/auth/session";
import { loadOrgDirectory } from "@/server/directory";
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
  const [tourCompletedAt, directory, navCounts] = await Promise.all([getProductTourCompletedAt(), loadOrgDirectory(), loadNavCounts()]);
  return (
    <AuthProvider session={toClientSession(session)}>
      <OrgDirectoryProvider directory={directory}>
        <NavCountsProvider counts={navCounts}>
          <ProductTourStateProvider initialCompletedAt={tourCompletedAt}>
            <AppShell>{children}</AppShell>
          </ProductTourStateProvider>
        </NavCountsProvider>
      </OrgDirectoryProvider>
    </AuthProvider>
  );
}
