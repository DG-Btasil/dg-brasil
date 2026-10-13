"use client";

import { useMemo } from "react";
import { TabPanel, Tabs, type TabItem } from "@/components/ui/tabs";
import { useUrlTab } from "@/lib/hooks/use-url-tab";
import { useClientAnalyses } from "@/features/analyses/hooks";
import { useClientCases } from "@/features/cases/hooks";
import type { Client } from "@/types";
import { useClientDocuments, useClientProcesses } from "../../hooks";
import { documentProgress } from "../../utils";
import { ActivityTab } from "./activity-tab";
import { CasesTab } from "./cases-tab";
import { ClientHeader } from "./client-header";
import { DocumentsTab } from "./documents/documents-tab";
import { OverviewTab } from "./overview/overview-tab";
import { ProcessesTab } from "./processes-tab";

const TAB_KEYS = ["visao-geral", "documentos", "casos", "processos", "atividade"] as const;
type TabKey = (typeof TAB_KEYS)[number];

/**
 * Página do cliente. O cadastro vem do servidor (getClientAction, com o
 * registro LGPD de acesso); as abas de documentos, casos, processos e
 * atividade ainda leem os módulos de demonstração até as fases C/B/H.
 * Precisa estar dentro de <Suspense> (useUrlTab).
 */
export function ClientDetail({ client }: { client: Client }) {
  const id = client.id;
  const documents = useClientDocuments(id);
  const analyses = useClientAnalyses(id);
  const processes = useClientProcesses(id);
  const cases = useClientCases(id);
  const [tab, setTab] = useUrlTab<TabKey>(TAB_KEYS, "visao-geral");

  const progress = documentProgress(documents);
  const items = useMemo<TabItem<TabKey>[]>(
    () => [
      { key: "visao-geral", label: "Visão geral" },
      { key: "documentos", label: "Documentos", count: documents.length, attention: progress.pending > 0 },
      { key: "casos", label: "Casos", count: cases.length },
      { key: "processos", label: "Processos", count: processes.length },
      { key: "atividade", label: "Atividade" },
    ],
    [documents.length, progress.pending, cases.length, processes.length],
  );

  return (
    <>
      <ClientHeader client={client} />
      <Tabs items={items} value={tab} onChange={setTab} label="Seções do cliente" className="mb-5" />
      <TabPanel tabKey={tab}>
        {tab === "visao-geral" && <OverviewTab client={client} />}
        {tab === "documentos" && <DocumentsTab client={client} documents={documents} analyses={analyses} />}
        {tab === "casos" && <CasesTab client={client} />}
        {tab === "processos" && <ProcessesTab client={client} processes={processes} />}
        {tab === "atividade" && <ActivityTab clientId={client.id} />}
      </TabPanel>
    </>
  );
}
