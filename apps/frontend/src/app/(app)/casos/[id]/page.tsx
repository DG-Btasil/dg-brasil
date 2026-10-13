import { Suspense } from "react";
import { PageContainer } from "@/components/layout/guards";
import { AudienceSwitch, RequirePermission } from "@/components/layout/server-guards";
import { ActionErrorState } from "@/components/feedback/action-error";
import { SkeletonRows } from "@/components/feedback/states";
import { CaseDetail } from "@/features/cases/components/case-detail";
import { CaseNotFound } from "@/features/cases/components/case-not-found";
import { PortalCaseDetail } from "@/features/partner-portal/components/portal-cases";
import { getCaseAction, getCaseCatalogAction } from "@/server/domain/cases/actions";
import { listCaseProcessesAction } from "@/server/domain/processes/actions";
import { listDocumentsAction } from "@/server/domain/documents/actions";
import { listRequirementsAction } from "@/server/domain/documents/requirements/actions";
import { documentListInput } from "@/features/documents/constants";

/**
 * Ficha do caso, lida no servidor a cada acesso (rota direta, nova aba e
 * recarregar funcionam). Sem acesso, id inexistente ou malformado → "não
 * encontrado": nunca revela se o caso existe para outro escritório.
 */
async function InternalCase({ id }: { id: string }) {
  const result = await getCaseAction({ id });
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND" || result.error.code === "VALIDATION") return <CaseNotFound />;
    return <ActionErrorState error={result} title="Não foi possível abrir o caso." />;
  }
  if (result.data.surface !== "INTERNAL") return <CaseNotFound />;
  const [catalog, processes, documents, requirements] = await Promise.all([
    getCaseCatalogAction(),
    listCaseProcessesAction({ caseId: id, pageSize: 50 }),
    listDocumentsAction(documentListInput({ legalCaseId: id })),
    listRequirementsAction({ legalCaseId: id, pageSize: 50 }),
  ]);
  if (!catalog.ok) return <ActionErrorState error={catalog} title="Não foi possível abrir o caso." />;
  return (
    <Suspense fallback={<SkeletonRows rows={6} />}>
      <CaseDetail legalCase={result.data.legalCase} catalog={catalog.data} processes={processes} documents={documents} requirements={requirements} />
    </Suspense>
  );
}

export default async function CasePage({ params }: PageProps<"/casos/[id]">) {
  const { id } = await params;
  // Parceiro: caso de outro escritório não existe no estado recortado e aparece como "não encontrado".
  return (
    <AudienceSwitch
      owner={
        <PageContainer>
          <RequirePermission permission="cases.view">
            <InternalCase id={id} />
          </RequirePermission>
        </PageContainer>
      }
      partner={
        <RequirePermission permission="partnerPortal.view">
          <Suspense fallback={<SkeletonRows rows={6} />}>
            <PortalCaseDetail id={id} />
          </Suspense>
        </RequirePermission>
      }
    />
  );
}
