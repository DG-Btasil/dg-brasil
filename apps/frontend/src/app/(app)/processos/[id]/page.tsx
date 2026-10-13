import { Suspense } from "react";
import { FileSearch } from "lucide-react";
import { PageContainer } from "@/components/layout/guards";
import { AudienceSwitch, RequirePermission } from "@/components/layout/server-guards";
import { ActionErrorState } from "@/components/feedback/action-error";
import { EmptyState, SkeletonRows } from "@/components/feedback/states";
import { ButtonLink } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { ProcessDetail } from "@/features/processes/components/process-detail";
import { PortalProcessDetail } from "@/features/partner-portal/components/portal-processes";
import { getProcessAction, listProcessEventsAction, listProcessPartiesAction } from "@/server/domain/processes/actions";
import { listDeadlinesAction } from "@/server/domain/processes/deadlines/actions";
import { listDocumentsAction } from "@/server/domain/documents/actions";
import { documentListInput } from "@/features/documents/constants";

const fallback = (
  <PageContainer>
    <SkeletonRows rows={8} />
  </PageContainer>
);

function ProcessNotFound() {
  return (
    <PageContainer>
      <Panel className="mt-6">
        <EmptyState
          icon={FileSearch}
          title="Processo não encontrado."
          description="O processo pode ter sido removido ou o endereço está incorreto."
          action={
            <ButtonLink href="/processos" variant="secondary">
              Voltar para Processos
            </ButtonLink>
          }
        />
      </Panel>
    </PageContainer>
  );
}

/**
 * Ficha do processo lida no servidor (com o registro LGPD de acesso).
 * Sem acesso, id inexistente ou malformado → "não encontrado".
 */
async function InternalProcess({ id }: { id: string }) {
  const result = await getProcessAction({ id });
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND" || result.error.code === "VALIDATION") return <ProcessNotFound />;
    return (
      <PageContainer>
        <ActionErrorState error={result} title="Não foi possível abrir o processo." />
      </PageContainer>
    );
  }
  if (result.data.surface !== "INTERNAL") return <ProcessNotFound />;
  const [parties, events, deadlines, documents] = await Promise.all([
    listProcessPartiesAction({ processId: id, pageSize: 50 }),
    listProcessEventsAction({ processId: id, pageSize: 50 }),
    listDeadlinesAction({ processId: id, pageSize: 50 }),
    listDocumentsAction(documentListInput({ legalProcessId: id })),
  ]);
  return (
    <Suspense fallback={fallback}>
      <ProcessDetail process={result.data.process} parties={parties} events={events} deadlines={deadlines} documents={documents} />
    </Suspense>
  );
}

export default async function ProcessDetailPage({ params }: PageProps<"/processos/[id]">) {
  const { id } = await params;
  return (
    <AudienceSwitch
      owner={
        <RequirePermission permission="processes.view">
          <InternalProcess id={id} />
        </RequirePermission>
      }
      partner={
        <RequirePermission permission="partnerPortal.view">
          <Suspense fallback={fallback}>
            <PortalProcessDetail id={id} />
          </Suspense>
        </RequirePermission>
      }
    />
  );
}
