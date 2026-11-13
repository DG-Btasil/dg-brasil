import type { Metadata } from "next";
import { loadAllPages } from "@/lib/actions/all-pages";
import { RequirePermission } from "@/components/layout/server-guards";
import { ActionErrorState } from "@/components/feedback/action-error";
import { NewAgreementView } from "@/features/finance/components/new-agreement-view";
import { processPickerOption } from "@/features/finance/process-label";
import { getCaseAction } from "@/server/domain/cases/actions";
import { getProcessFinanceAction, listFeeModelsAction, listProcessFinanceAction } from "@/server/domain/finance/actions";

export const metadata: Metadata = { title: "Novo contrato" };

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * Contrato do PROCESSO (046). `?processo=` já escolhe o processo (se o usuário
 * o acessa); `?caso=` (links antigos, aba Financeiro do caso) pergunta qual
 * processo do caso. Modelos ativos do servidor.
 */
async function NewAgreement({ processId, caseId }: { processId?: string; caseId?: string }) {
  const [models, process, legalCase, caseProcesses] = await Promise.all([
    loadAllPages((page, pageSize) => listFeeModelsAction({ active: true, page, pageSize })),
    processId ? getProcessFinanceAction({ processId }) : Promise.resolve(null),
    !processId && caseId ? getCaseAction({ id: caseId }) : Promise.resolve(null),
    !processId && caseId ? loadAllPages((page, pageSize) => listProcessFinanceAction({ legalCaseId: caseId, page, pageSize, sortBy: "title", sortDirection: "asc" })) : Promise.resolve(null),
  ]);
  if (!models.ok) return <ActionErrorState error={models} title="Não foi possível abrir o cadastro de contrato." />;
  const defaultProcess = process?.ok ? processPickerOption(process.data.process) : undefined;
  const c = legalCase?.ok && legalCase.data.surface === "INTERNAL" ? legalCase.data.legalCase : undefined;
  const caseContext = c && caseProcesses?.ok ? { id: c.id, title: c.title, processes: caseProcesses.data.items.map(processPickerOption) } : undefined;
  return <NewAgreementView feeModels={models.data.items} defaultProcess={defaultProcess} caseContext={caseContext} />;
}

export default async function NewAgreementPage({ searchParams }: PageProps<"/financeiro/contratos/novo">) {
  const params = await searchParams;
  return (
    <RequirePermission permission="finance.manage">
      <NewAgreement processId={first(params.processo)} caseId={first(params.caso)} />
    </RequirePermission>
  );
}
