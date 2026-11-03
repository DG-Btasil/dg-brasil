import { PageContainer } from "@/components/layout/guards";
import { RequirePermission } from "@/components/layout/server-guards";
import { ImportsPage } from "@/features/data-import/components/imports-page";

/** Importação de planilhas (Etapa 7): só ADMIN. */
export const maxDuration = 60;

export default function ImportacoesPage() {
  return (
    <RequirePermission permission="imports.manage">
      <PageContainer>
        <ImportsPage />
      </PageContainer>
    </RequirePermission>
  );
}
