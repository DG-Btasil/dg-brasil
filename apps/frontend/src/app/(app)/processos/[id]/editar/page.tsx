import { FileSearch } from "lucide-react";
import { PageContainer } from "@/components/layout/guards";
import { RequirePermission } from "@/components/layout/server-guards";
import { ActionErrorState } from "@/components/feedback/action-error";
import { EmptyState } from "@/components/feedback/states";
import { ButtonLink } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { EditProcessPage } from "@/features/processes/components/edit-process-page";
import { getProcessAction } from "@/server/domain/processes/actions";

async function EditProcess({ id }: { id: string }) {
  const result = await getProcessAction({ id });
  if (!result.ok && result.error.code !== "NOT_FOUND" && result.error.code !== "VALIDATION") {
    return (
      <PageContainer>
        <ActionErrorState error={result} title="Não foi possível abrir o processo." />
      </PageContainer>
    );
  }
  if (!result.ok || result.data.surface !== "INTERNAL") {
    return (
      <PageContainer>
        <Panel className="mt-6">
          <EmptyState
            icon={FileSearch}
            title="Processo não encontrado."
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
  return <EditProcessPage process={result.data.process} />;
}

export default async function EditProcessRoute({ params }: PageProps<"/processos/[id]/editar">) {
  const { id } = await params;
  return (
    <RequirePermission permission="processes.edit">
      <EditProcess id={id} />
    </RequirePermission>
  );
}
