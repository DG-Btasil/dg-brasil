import type { Metadata } from "next";
import { Suspense } from "react";
import { PageContainer } from "@/components/layout/guards";
import { AudienceSwitch, RequirePermission } from "@/components/layout/server-guards";
import { SkeletonRows } from "@/components/feedback/states";
import { NewProcessPage } from "@/features/processes/components/new-process-page";
import { PortalProcessForm } from "@/features/partner-portal/components/portal-processes";
import { processBlockedReason } from "@/lib/domain/legal-case";
import { getCaseAction } from "@/server/domain/cases/actions";

export const metadata: Metadata = { title: "Novo processo" };

const fallback = (
  <PageContainer>
    <SkeletonRows rows={8} />
  </PageContainer>
);

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Caso pré-selecionado (?caso=) só se o usuário o acessa e o caso aceita
 * processo. Caso que ainda não aceita (rascunho, rejeitado, arquivado) não é
 * ignorado em silêncio: a tela diz por quê.
 */
async function InternalNewProcess({ caseId }: { caseId?: string }) {
  const found = caseId ? await getCaseAction({ id: caseId }) : null;
  const c = found?.ok && found.data.surface === "INTERNAL" ? found.data.legalCase : undefined;
  const blocked = c ? processBlockedReason(c.status) : null;
  return (
    <NewProcessPage
      initialCase={c && !blocked ? { id: c.id, label: c.title, description: c.clientName, lawyerId: c.assignedLawyerId ?? undefined } : undefined}
      blockedCase={c && blocked ? { id: c.id, title: c.title, reason: blocked } : undefined}
    />
  );
}

/** Portal: caso pré-selecionado (?caso=) só se for do próprio escritório (RLS) e aceitar processo. */
async function PartnerNewProcess({ caseId }: { caseId?: string }) {
  const found = caseId ? await getCaseAction({ id: caseId }) : null;
  const c = found?.ok && found.data.surface === "PARTNER" && !processBlockedReason(found.data.legalCase.status) ? found.data.legalCase : undefined;
  return <PortalProcessForm initialCase={c ? { id: c.id, label: c.title, description: c.clientName } : undefined} />;
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
            <PartnerNewProcess caseId={caseId} />
          </Suspense>
        </RequirePermission>
      }
    />
  );
}
