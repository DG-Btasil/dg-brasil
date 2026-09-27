"use client";

import { useSearchParams } from "next/navigation";
import { PageContainer } from "@/components/layout/guards";
import { AgentList } from "../agents/agent-list";
import { HistoryView } from "../history/history-view";
import { SkillTable } from "../skills/skill-table";
import { ThesisTable } from "../theses/thesis-table";
import { DG_SECTIONS, type DgSection } from "../../utils";
import { DgHeader } from "./dg-header";

/** /dg-brasil — seção ativa sincronizada com ?secao=. Precisa de <Suspense>. */
export function DgHome() {
  const raw = useSearchParams().get("secao");
  const section: DgSection = (DG_SECTIONS as readonly string[]).includes(raw ?? "") ? (raw as DgSection) : "agentes";
  return (
    <PageContainer>
      <DgHeader active={section} />
      {section === "agentes" && <AgentList />}
      {section === "skills" && <SkillTable />}
      {section === "teses" && <ThesisTable />}
      {section === "historico" && <HistoryView />}
    </PageContainer>
  );
}

export function DgHistoryPage() {
  return (
    <PageContainer>
      <DgHeader active="historico" />
      <HistoryView />
    </PageContainer>
  );
}
