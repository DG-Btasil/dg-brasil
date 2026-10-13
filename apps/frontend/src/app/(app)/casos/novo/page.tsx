import { PageContainer } from "@/components/layout/guards";
import { AudienceSwitch, RequirePermission } from "@/components/layout/server-guards";
import { ActionErrorState } from "@/components/feedback/action-error";
import { CaseForm } from "@/features/cases/components/case-form";
import { NewCaseWizard } from "@/features/partner-portal/components/new-case-wizard";
import { getClientAction } from "@/server/domain/clients/actions";
import { getCaseCatalogAction } from "@/server/domain/cases/actions";

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Catálogo do servidor; cliente pré-selecionado (?cliente=) só se o usuário o acessa. */
async function InternalCaseForm({ clientId }: { clientId?: string }) {
  const [catalog, client] = await Promise.all([getCaseCatalogAction(), clientId ? getClientAction({ id: clientId }) : Promise.resolve(null)]);
  if (!catalog.ok) return <ActionErrorState error={catalog} title="Não foi possível abrir o cadastro de caso." />;
  const c = client?.ok && client.data.surface === "INTERNAL" ? client.data.client : undefined;
  const defaultClient =
    c && c.status !== "INACTIVE" ? { id: c.id, label: c.kind === "INDIVIDUAL" ? c.fullName : c.legalName } : undefined;
  return <CaseForm catalog={catalog.data} defaultClient={defaultClient} />;
}

/** Portal: catálogo + cliente pré-selecionado (?cliente=) só se for da carteira do parceiro (RLS). */
async function PartnerWizard({ clientId }: { clientId?: string }) {
  const [catalog, client] = await Promise.all([getCaseCatalogAction(), clientId ? getClientAction({ id: clientId }) : Promise.resolve(null)]);
  if (!catalog.ok) return <ActionErrorState error={catalog} title="Não foi possível abrir o envio de caso." />;
  const c = client?.ok && client.data.surface === "PARTNER" ? client.data.client : undefined;
  const preset = c
    ? { id: c.id, name: c.kind === "INDIVIDUAL" ? c.fullName : c.legalName, kind: c.kind, document: c.kind === "INDIVIDUAL" ? c.cpf : c.cnpj }
    : undefined;
  return <NewCaseWizard mode="case" catalog={catalog.data} presetClient={preset} />;
}

export default async function NewCasePage({ searchParams }: PageProps<"/casos/novo">) {
  const params = await searchParams;
  const clientId = first(params.cliente);
  return (
    <PageContainer>
      <AudienceSwitch
        owner={
          <RequirePermission permission="cases.edit">
            <InternalCaseForm clientId={clientId} />
          </RequirePermission>
        }
        partner={
          <RequirePermission permission="partnerPortal.cases.create">
            <PartnerWizard clientId={clientId} />
          </RequirePermission>
        }
      />
    </PageContainer>
  );
}
