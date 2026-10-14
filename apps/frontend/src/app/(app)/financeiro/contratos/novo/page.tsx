import { RequirePermission } from "@/components/layout/server-guards";
import { ActionErrorState } from "@/components/feedback/action-error";
import { NewAgreementView } from "@/features/finance/components/new-agreement-view";
import { getCaseAction } from "@/server/domain/cases/actions";
import { listFeeModelsAction } from "@/server/domain/finance/actions";

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** Modelos ativos do servidor; caso pré-selecionado (?caso=) só se o usuário o acessa. */
async function NewAgreement({ caseId }: { caseId?: string }) {
  const [models, found] = await Promise.all([listFeeModelsAction({ active: true, pageSize: 100 }), caseId ? getCaseAction({ id: caseId }) : Promise.resolve(null)]);
  if (!models.ok) return <ActionErrorState error={models} title="Não foi possível abrir o cadastro de contrato." />;
  const c = found?.ok && found.data.surface === "INTERNAL" ? found.data.legalCase : undefined;
  return <NewAgreementView feeModels={models.data.items} defaultCase={c ? { id: c.id, label: c.title, description: c.clientName } : undefined} />;
}

export default async function NewAgreementPage({ searchParams }: PageProps<"/financeiro/contratos/novo">) {
  const params = await searchParams;
  return (
    <RequirePermission permission="finance.manage">
      <NewAgreement caseId={first(params.caso)} />
    </RequirePermission>
  );
}
