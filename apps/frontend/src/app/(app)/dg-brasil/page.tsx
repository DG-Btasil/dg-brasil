import { PageContainer } from "@/components/layout/guards";
import { ActionErrorState } from "@/components/feedback/action-error";
import { AgentList } from "@/features/dg-brasil/components/agents/agent-list";
import { DgHeader } from "@/features/dg-brasil/components/shared/dg-header";
import { ThesisTable } from "@/features/dg-brasil/components/theses/thesis-views";
import { getDgCatalogAction, getDgOverviewAction, listDgAgentsAction, listDgThesesAction } from "@/server/domain/dg/actions";
import type { DgCatalogDTO } from "@/server/domain/dg/dto";

type Section = "agentes" | "teses";

/** /dg-brasil — seção na URL (?secao=agentes|teses), dados do banco. */
export default async function DgBrasilPage({ searchParams }: PageProps<"/dg-brasil">) {
  const raw = (await searchParams).secao;
  const section: Section = raw === "teses" ? raw : "agentes";
  const [overview, catalog] = await Promise.all([getDgOverviewAction(), getDgCatalogAction()]);
  return (
    <PageContainer>
      <DgHeader active={section} overview={overview.ok ? overview.data : undefined} />
      {!catalog.ok ? <ActionErrorState error={catalog} title="Não foi possível abrir o DG Brasil." /> : <Section section={section} catalog={catalog.data} />}
    </PageContainer>
  );
}

async function Section({ section, catalog }: { section: Section; catalog: DgCatalogDTO }) {
  if (section === "teses") {
    const r = await listDgThesesAction();
    return r.ok ? <ThesisTable theses={r.data} catalog={catalog} /> : <ActionErrorState error={r} title="Não foi possível carregar as teses." />;
  }
  const r = await listDgAgentsAction();
  return r.ok ? <AgentList agents={r.data} catalog={catalog} /> : <ActionErrorState error={r} title="Não foi possível carregar os agentes." />;
}
