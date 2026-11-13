import type { Metadata } from "next";
import { PageContainer } from "@/components/layout/guards";
import { RequirePermission } from "@/components/layout/server-guards";
import { ImportsPage } from "@/features/data-import/components/imports-page";

export const metadata: Metadata = { title: "Importação de dados" };

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
