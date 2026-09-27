import { RequirePermission } from "@/components/layout/guards";
import { NewAgreementView } from "@/features/finance/components/new-agreement-view";

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function NewAgreementPage({ searchParams }: PageProps<"/financeiro/contratos/novo">) {
  const params = await searchParams;
  return (
    <RequirePermission permission="finance.view">
      <NewAgreementView clientId={first(params.cliente)} processId={first(params.processo)} />
    </RequirePermission>
  );
}
