import { PageContainer } from "@/components/layout/guards";
import { AudienceSwitch, RequirePermission } from "@/components/layout/server-guards";
import { CaseForm } from "@/features/cases/components/case-form";
import { NewCaseWizard } from "@/features/partner-portal/components/new-case-wizard";

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function NewCasePage({ searchParams }: PageProps<"/casos/novo">) {
  const params = await searchParams;
  const clientId = first(params.cliente);
  return (
    <PageContainer>
      <AudienceSwitch
        owner={
          <RequirePermission permission="cases.edit">
            <CaseForm defaultClientId={clientId} />
          </RequirePermission>
        }
        partner={
          <RequirePermission permission="partnerPortal.cases.create">
            <NewCaseWizard mode="case" initialClientId={clientId} />
          </RequirePermission>
        }
      />
    </PageContainer>
  );
}
