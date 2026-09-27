"use client";

import { useMemo } from "react";
import { TabPanel, Tabs, type TabItem } from "@/components/ui/tabs";
import { useUrlTab } from "@/lib/hooks/use-url-tab";
import { AnalysisTab } from "@/features/analyses/components/analysis-tab";
import { useClientAnalyses } from "@/features/analyses/hooks";
import { isActiveAnalysis } from "@/features/analyses/utils";
import { useClient, useClientDocuments, useClientProcesses } from "../../hooks";
import { documentProgress } from "../../utils";
import { ActivityTab } from "./activity-tab";
import { ClientHeader } from "./client-header";
import { ClientNotFound } from "./client-not-found";
import { DocumentsTab } from "./documents/documents-tab";
import { OverviewTab } from "./overview/overview-tab";
import { ProcessesTab } from "./processes-tab";

const TAB_KEYS = ["visao-geral", "documentos", "analise", "processos", "atividade"] as const;
type TabKey = (typeof TAB_KEYS)[number];

/** Página do cliente. Precisa estar dentro de <Suspense> (useUrlTab). */
export function ClientDetail({ id }: { id: string }) {
  const client = useClient(id);
  const documents = useClientDocuments(id);
  const analyses = useClientAnalyses(id);
  const processes = useClientProcesses(id);
  const [tab, setTab] = useUrlTab<TabKey>(TAB_KEYS, "visao-geral");

  const hasActive = analyses.some(isActiveAnalysis);
  const progress = documentProgress(documents);
  const items = useMemo<TabItem<TabKey>[]>(
    () => [
      { key: "visao-geral", label: "Visão geral" },
      { key: "documentos", label: "Documentos", count: documents.length, attention: progress.pending > 0 },
      { key: "analise", label: "Análise jurídica", attention: analyses[0]?.status === "WAITING_DOCUMENTS" || analyses[0]?.status === "READY" },
      { key: "processos", label: "Processos", count: processes.length },
      { key: "atividade", label: "Atividade" },
    ],
    [documents.length, progress.pending, analyses, processes.length],
  );

  if (!client) return <ClientNotFound />;

  return (
    <>
      <ClientHeader client={client} hasActiveAnalysis={hasActive} />
      <Tabs items={items} value={tab} onChange={setTab} label="Seções do cliente" className="mb-5" />
      <TabPanel tabKey={tab}>
        {tab === "visao-geral" && <OverviewTab client={client} />}
        {tab === "documentos" && <DocumentsTab client={client} documents={documents} analyses={analyses} />}
        {tab === "analise" && <AnalysisTab client={client} analyses={analyses} onGoToDocuments={() => setTab("documentos")} />}
        {tab === "processos" && <ProcessesTab client={client} processes={processes} />}
        {tab === "atividade" && <ActivityTab clientId={client.id} />}
      </TabPanel>
    </>
  );
}
