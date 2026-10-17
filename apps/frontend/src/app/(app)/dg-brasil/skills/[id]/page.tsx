import { PageContainer } from "@/components/layout/guards";
import { DgNotFound } from "@/features/dg-brasil/components/shared/not-found";
import { SkillDetail } from "@/features/dg-brasil/components/skills/skill-detail";
import { dgRoutes } from "@/features/dg-brasil/utils";
import { getDgCatalogAction, getDgSkillAction } from "@/server/domain/dg/actions";

export default async function SkillPage({ params }: PageProps<"/dg-brasil/skills/[id]">) {
  const { id } = await params;
  const [skill, catalog] = await Promise.all([getDgSkillAction({ id }), getDgCatalogAction()]);
  if (!skill.ok || !catalog.ok) return <DgNotFound title="Skill não encontrada" backHref={dgRoutes.section("skills")} backLabel="Voltar para as skills" />;
  return (
    <PageContainer>
      <SkillDetail skill={skill.data} catalog={catalog.data} />
    </PageContainer>
  );
}
