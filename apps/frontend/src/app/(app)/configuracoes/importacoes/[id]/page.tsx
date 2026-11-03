import { PageContainer } from "@/components/layout/guards";
import { RequirePermission } from "@/components/layout/server-guards";
import { ImportJobView } from "@/features/data-import/components/import-job-view";

/**
 * Uma importação: colunas → simulação e conflitos → gravação → relatório.
 * A leitura do arquivo e a simulação podem levar alguns segundos em planilhas
 * grandes (até 5.000 linhas): limite de 60 s por chamada.
 */
export const maxDuration = 60;

export default async function ImportacaoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <RequirePermission permission="imports.manage">
      <PageContainer>
        <ImportJobView jobId={id} />
      </PageContainer>
    </RequirePermission>
  );
}
