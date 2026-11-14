import type { Metadata } from "next";
import { PageContainer } from "@/components/layout/guards";
import { ActionErrorState } from "@/components/feedback/action-error";
import { AgentList } from "@/features/dg-brasil/components/agents/agent-list";
import { ConnectionsBoard } from "@/features/dg-brasil/components/connections/connections-board";
import { DgHeader } from "@/features/dg-brasil/components/shared/dg-header";
import { ThesisTable } from "@/features/dg-brasil/components/theses/thesis-views";
import { getDgCatalogAction, getDgOverviewAction, getOfficeStatusAction, listDgAgentsAction, listDgThesesAction } from "@/server/domain/dg/actions";
import type { DgCatalogDTO, DgOverviewDTO } from "@/server/domain/dg/dto";
import { getDriveStatusAction } from "@/server/domain/drive/actions";
import { getJudicialOverviewAction } from "@/server/domain/judicial/actions";
import { listTaskAgentsAction } from "@/server/domain/process-tasks/actions";
import type { ActionResult } from "@/lib/actions/result";

type Section = "conexoes" | "agentes" | "teses";

const SECTION_TITLE: Record<Section, string> = { conexoes: "Conexões", agentes: "Agentes", teses: "Teses" };
const sectionOf = (raw: unknown): Section => (raw === "teses" || raw === "agentes" ? raw : "conexoes");

/** Título da aba: "DG Brasil" na entrada (Conexões); nas outras seções, a seção (vem da URL, sem consulta ao servidor). */
export async function generateMetadata({ searchParams }: PageProps<"/dg-brasil">): Promise<Metadata> {
  const section = sectionOf((await searchParams).secao);
  return { title: section === "conexoes" ? { absolute: "DG Brasil" } : SECTION_TITLE[section] };
}

/** /dg-brasil — Conexões (padrão), Agentes ou Teses (?secao=), dados do banco. */
export default async function DgBrasilPage({ searchParams }: PageProps<"/dg-brasil">) {
  const section = sectionOf((await searchParams).secao);
  const overview = await getDgOverviewAction();
  return (
    <PageContainer>
      <DgHeader active={section} overview={overview.ok ? overview.data : undefined} />
      <Section section={section} overview={overview} />
    </PageContainer>
  );
}

async function Section({ section, overview }: { section: Section; overview: ActionResult<DgOverviewDTO> }) {
  if (section === "conexoes") {
    const [office, judicial, drive, agents] = await Promise.all([getOfficeStatusAction(), getJudicialOverviewAction(), getDriveStatusAction(), listTaskAgentsAction()]);
    return <ConnectionsBoard data={{ office, judicial, drive, overview, agents }} />;
  }
  const catalog = await getDgCatalogAction();
  if (!catalog.ok) return <ActionErrorState error={catalog} title="Não foi possível abrir o DG Brasil." />;
  return section === "teses" ? <Theses catalog={catalog.data} /> : <Agents catalog={catalog.data} />;
}

async function Theses({ catalog }: { catalog: DgCatalogDTO }) {
  const r = await listDgThesesAction();
  return r.ok ? <ThesisTable theses={r.data} catalog={catalog} /> : <ActionErrorState error={r} title="Não foi possível carregar as teses." />;
}

async function Agents({ catalog }: { catalog: DgCatalogDTO }) {
  const r = await listDgAgentsAction();
  return r.ok ? <AgentList agents={r.data} catalog={catalog} /> : <ActionErrorState error={r} title="Não foi possível carregar os agentes." />;
}
