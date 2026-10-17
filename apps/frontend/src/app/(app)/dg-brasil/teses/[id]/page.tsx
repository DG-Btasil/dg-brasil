import { PageContainer } from "@/components/layout/guards";
import { DgNotFound } from "@/features/dg-brasil/components/shared/not-found";
import { ThesisDetail } from "@/features/dg-brasil/components/theses/thesis-views";
import { dgRoutes } from "@/features/dg-brasil/utils";
import { getDgCatalogAction, getDgThesisAction } from "@/server/domain/dg/actions";

export default async function ThesisPage({ params }: PageProps<"/dg-brasil/teses/[id]">) {
  const { id } = await params;
  const [thesis, catalog] = await Promise.all([getDgThesisAction({ id }), getDgCatalogAction()]);
  if (!thesis.ok || !catalog.ok) return <DgNotFound title="Tese não encontrada" backHref={dgRoutes.section("teses")} backLabel="Voltar para as teses" />;
  return (
    <PageContainer>
      <ThesisDetail thesis={thesis.data} catalog={catalog.data} />
    </PageContainer>
  );
}
