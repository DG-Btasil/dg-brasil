import { SearchX } from "lucide-react";
import { PageContainer } from "@/components/layout/guards";
import { RequirePermission } from "@/components/layout/server-guards";
import { ActionErrorState } from "@/components/feedback/action-error";
import { EmptyState } from "@/components/feedback/states";
import { ButtonLink } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { PartnerDetail } from "@/features/partners/components/partner-detail";
import { requestListInput } from "@/features/partner-requests/query";
import { listCasesAction } from "@/server/domain/cases/actions";
import { listRelatedClientsAction } from "@/server/domain/clients/actions";
import { getPartnerAction, getPartnerStatsAction, listOrganizationUsersAction } from "@/server/domain/organizations/actions";
import { listPartnerRequestsAction } from "@/server/domain/partner-requests/actions";
import { listProcessesAction } from "@/server/domain/processes/actions";

function PartnerNotFound() {
  return (
    <PageContainer>
      <Panel className="mt-6">
        <EmptyState
          icon={SearchX}
          title="Parceiro não encontrado."
          description="O endereço pode estar incorreto ou você não tem acesso a este escritório."
          action={
            <ButtonLink href="/parceiros" variant="secondary">
              Voltar para Parceiros
            </ButtonLink>
          }
        />
      </Panel>
    </PageContainer>
  );
}

/** Ficha do parceiro lida no servidor; cada aba já vem com a primeira página. */
async function Partner({ id }: { id: string }) {
  const detail = await getPartnerAction({ id });
  if (!detail.ok) {
    if (detail.error.code === "NOT_FOUND" || detail.error.code === "VALIDATION") return <PartnerNotFound />;
    return (
      <PageContainer>
        <ActionErrorState error={detail} title="Não foi possível abrir o parceiro." />
      </PageContainer>
    );
  }
  if (detail.data.access === "PARTNER") return <PartnerNotFound />;
  const [stats, users, clients, cases, processes, requests] = await Promise.all([
    getPartnerStatsAction({ id }),
    listOrganizationUsersAction({ organizationId: id, pageSize: 50 }),
    listRelatedClientsAction({ organizationId: id, pageSize: 50 }),
    listCasesAction({ relatedOrganizationId: id, pageSize: 50 }),
    listProcessesAction({ caseOriginOrganizationId: id, pageSize: 50 }),
    listPartnerRequestsAction(requestListInput({ partnerOrganizationId: id })),
  ]);
  return <PartnerDetail detail={detail.data} stats={stats} users={users} clients={clients} cases={cases} processes={processes} requests={requests} />;
}

export default async function PartnerDetailPage({ params }: PageProps<"/parceiros/[id]">) {
  const { id } = await params;
  // Parceiros não têm "partners.view": /parceiros/<qualquer-id> é bloqueado para eles.
  return (
    <RequirePermission permission="partners.view">
      <Partner id={id} />
    </RequirePermission>
  );
}
