"use client";

import { useMemo } from "react";
import { PendingIntegration } from "@/components/feedback/pending-integration";
import { TabPanel, Tabs, type TabItem } from "@/components/ui/tabs";
import { useUrlTab } from "@/lib/hooks/use-url-tab";
import type { ActionResult } from "@/lib/actions/result";
import type { Page } from "@/server/core/pagination";
import type { CaseListItem } from "@/server/domain/cases/dto";
import type { ProcessListItem } from "@/server/domain/processes/dto";
import type { DocumentListItem } from "@/server/domain/documents/dto";
import { DocumentsPanel } from "@/features/documents/components/documents-panel";
import type { Client } from "@/types";
import { CasesTab } from "./cases-tab";
import { ClientHeader } from "./client-header";
import { OverviewTab } from "./overview/overview-tab";
import { ProcessesTab } from "./processes-tab";

const TAB_KEYS = ["visao-geral", "documentos", "casos", "processos", "atividade"] as const;
type TabKey = (typeof TAB_KEYS)[number];

/**
 * Página do cliente, com dados do servidor: cadastro (getClientAction, com o
 * registro LGPD de acesso), documentos, casos e processos. A atividade é
 * conectada na fase H. Precisa estar dentro de <Suspense> (useUrlTab).
 */
export function ClientDetail({
  client,
  cases,
  processes,
  documents,
}: {
  client: Client;
  cases: ActionResult<Page<CaseListItem>>;
  processes: ActionResult<Page<ProcessListItem>>;
  documents: ActionResult<Page<DocumentListItem>>;
}) {
  const [tab, setTab] = useUrlTab<TabKey>(TAB_KEYS, "visao-geral");
  const items = useMemo<TabItem<TabKey>[]>(
    () => [
      { key: "visao-geral", label: "Visão geral" },
      { key: "documentos", label: "Documentos", count: documents.ok ? documents.data.total : undefined },
      { key: "casos", label: "Casos", count: cases.ok ? cases.data.total : undefined },
      { key: "processos", label: "Processos", count: processes.ok ? processes.data.total : undefined },
      { key: "atividade", label: "Atividade" },
    ],
    [cases, processes, documents],
  );

  return (
    <>
      <ClientHeader client={client} />
      <Tabs items={items} value={tab} onChange={setTab} label="Seções do cliente" className="mb-5" />
      <TabPanel tabKey={tab}>
        {tab === "visao-geral" && <OverviewTab client={client} />}
        {tab === "documentos" && (
          <DocumentsPanel
            scope={{ clientId: client.id }}
            initial={documents}
            title="Documentos do cliente"
            description="Todos os documentos do cliente, de qualquer caso ou processo, e os do cadastro."
          />
        )}
        {tab === "casos" && <CasesTab client={client} cases={cases} />}
        {tab === "processos" && <ProcessesTab clientId={client.id} processes={processes} />}
        {tab === "atividade" && <PendingIntegration description="A linha do tempo de auditoria do cliente será conectada em uma próxima fase." />}
      </TabPanel>
    </>
  );
}
