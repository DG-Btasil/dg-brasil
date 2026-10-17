import { PageContainer } from "@/components/layout/guards";
import { RequirePermission } from "@/components/layout/server-guards";
import { ActionErrorState } from "@/components/feedback/action-error";
import { ReferenceTable } from "@/features/dg-brasil/components/references/reference-views";
import { DgHeader } from "@/features/dg-brasil/components/shared/dg-header";
import { getDgCatalogAction, getDgOverviewAction, listDgReferencesAction } from "@/server/domain/dg/actions";

/** Referências: somente Administrador (o layout já exige "dgbrasil.view"). */
export default async function DgReferencesRoute() {
  const [overview, catalog, references] = await Promise.all([getDgOverviewAction(), getDgCatalogAction(), listDgReferencesAction()]);
  return (
    <RequirePermission permission="dgbrasil.manage">
      <PageContainer>
        <DgHeader active="referencias" overview={overview.ok ? overview.data : undefined} />
        {!references.ok ? (
          <ActionErrorState error={references} title="Não foi possível carregar as referências." />
        ) : !catalog.ok ? (
          <ActionErrorState error={catalog} title="Não foi possível carregar os vínculos." />
        ) : (
          <ReferenceTable references={references.data} catalog={catalog.data} />
        )}
      </PageContainer>
    </RequirePermission>
  );
}
