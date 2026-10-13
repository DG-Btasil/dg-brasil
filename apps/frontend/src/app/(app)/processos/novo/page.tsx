import { Suspense } from "react";
import { PageContainer } from "@/components/layout/guards";
import { AudienceSwitch, RequirePermission } from "@/components/layout/server-guards";
import { SkeletonRows } from "@/components/feedback/states";
import { NewProcessPage } from "@/features/processes/components/new-process-page";
import { PortalProcessForm } from "@/features/partner-portal/components/portal-processes";
import { getCaseAction } from "@/server/domain/cases/actions";

const fallback = (
  <PageContainer>
    <SkeletonRows rows={8} />
  </PageContainer>
);

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const BLOCKED = new Set(["DRAFT", "REJECTED", "ARCHIVED"]);

/** Caso pré-selecionado (?caso=) só se o usuário o acessa e o caso aceita processo. */
async function InternalNewProcess({ caseId }: { caseId?: string }) {
  const found = caseId ? await getCaseAction({ id: caseId }) : null;
  const c = found?.ok && found.data.surface === "INTERNAL" && !BLOCKED.has(found.data.legalCase.status) ? found.data.legalCase : undefined;
  return <NewProcessPage initialCase={c ? { id: c.id, label: c.title, description: c.clientName, lawyerId: c.assignedLawyerId ?? undefined } : undefined} />;
}

export default async function NewProcessRoute({ searchParams }: PageProps<"/processos/novo">) {
  const caseId = first((await searchParams).caso);
  return (
    <AudienceSwitch
      owner={
        <RequirePermission permission="processes.edit">
          <InternalNewProcess caseId={caseId} />
        </RequirePermission>
      }
      partner={
        <RequirePermission permission="partnerPortal.processes.create">
          <Suspense fallback={fallback}>
            <PortalProcessForm />
          </Suspense>
        </RequirePermission>
      }
    />
  );
}
