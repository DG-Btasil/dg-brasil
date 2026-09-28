"use client";

import { useMemo, useState } from "react";
import { FileCheck2 } from "lucide-react";
import { DOCUMENT_CATEGORY_LABEL, type PartnerRequestType } from "@/lib/constants/status";
import { formatDate } from "@/lib/formatting";
import { cn } from "@/lib/cn";
import { Can, PageContainer } from "@/components/layout/guards";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/display";
import { Select } from "@/components/ui/form";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { EmptyState } from "@/components/feedback/states";
import { PartnerRequestList } from "@/features/partners/components/request-list";
import { clientDisplayName } from "@/features/processes/utils";
import type { ID } from "@/types";
import { useCurrentDocuments, usePortalClientMap, usePortalClients, usePortalProcesses, usePortalRequests } from "../hooks";
import { RespondRequestDialog, SendDocumentDialog } from "./portal-dialogs";

type View = "OPEN" | "DOCUMENTS" | "INFORMATION" | "RESOLVED";
const VIEWS: { key: View; label: string }[] = [
  { key: "OPEN", label: "Abertas" },
  { key: "DOCUMENTS", label: "Documentos" },
  { key: "INFORMATION", label: "Informações" },
  { key: "RESOLVED", label: "Resolvidas" },
];
const DOCUMENT_TYPES: PartnerRequestType[] = ["DOCUMENT_REQUEST", "CORRECTION_REQUEST"];

/** Documentos e Pendências: tudo o que o escritório parceiro precisa responder ou enviar. */
export function PortalPending() {
  const requests = usePortalRequests();
  const clients = usePortalClients();
  const clientMap = usePortalClientMap();
  const processes = usePortalProcesses();
  const processMap = useMemo(() => new Map(processes.map((p) => [p.id, p])), [processes]);
  const documents = useCurrentDocuments();
  const [view, setView] = useState<View>("OPEN");
  const [clientId, setClientId] = useState("");
  const [processId, setProcessId] = useState("");
  const [respond, setRespond] = useState<ID | null>(null);
  const [send, setSend] = useState<ID | null>(null);

  const filtered = useMemo(
    () =>
      requests.filter((r) => {
        if (clientId && r.clientId !== clientId) return false;
        if (processId && r.processId !== processId) return false;
        if (view === "OPEN") return r.status === "OPEN";
        if (view === "DOCUMENTS") return r.status === "OPEN" && DOCUMENT_TYPES.includes(r.type);
        if (view === "INFORMATION") return r.status === "OPEN" && !DOCUMENT_TYPES.includes(r.type);
        return r.status === "RESOLVED" || r.status === "ANSWERED" || r.status === "CANCELLED";
      }),
    [requests, view, clientId, processId],
  );
  const counts = useMemo(
    () => ({
      OPEN: requests.filter((r) => r.status === "OPEN").length,
      DOCUMENTS: requests.filter((r) => r.status === "OPEN" && DOCUMENT_TYPES.includes(r.type)).length,
      INFORMATION: requests.filter((r) => r.status === "OPEN" && !DOCUMENT_TYPES.includes(r.type)).length,
      RESOLVED: requests.filter((r) => r.status !== "OPEN").length,
    }),
    [requests],
  );
  const sent = documents.filter((d) => d.uploadedByPartnerOfficeId && (!clientId || d.clientId === clientId) && (!processId || d.processId === processId));
  const responding = requests.find((r) => r.id === respond);
  const sendingFor = requests.find((r) => r.id === send);

  return (
    <PageContainer>
      <PageHeader title="Documentos e Pendências" description="Solicitações da Bárbara Cardoso Advocacia, documentos faltantes e o que você já enviou." />
      <Panel>
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
          <div role="group" aria-label="Filtro de pendências" className="flex rounded-md border border-line p-0.5">
            {VIEWS.map((v) => (
              <button
                key={v.key}
                type="button"
                aria-pressed={view === v.key}
                onClick={() => setView(v.key)}
                className={cn("rounded-sm px-2.5 py-1 text-[12.5px]", view === v.key ? "bg-navy text-white" : "text-muted hover:text-foreground")}
              >
                {v.label} <span className="tabular opacity-70">{counts[v.key]}</span>
              </button>
            ))}
          </div>
          <Select
            aria-label="Cliente"
            placeholder="Todos os clientes"
            options={clients.map((c) => ({ value: c.id, label: clientDisplayName(c) }))}
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            className="h-8 w-[220px] text-[12.5px]"
          />
          <Select
            aria-label="Processo"
            placeholder="Todos os processos"
            options={processes.filter((p) => !clientId || p.clientId === clientId).map((p) => ({ value: p.id, label: p.title }))}
            value={processId}
            onChange={(e) => setProcessId(e.target.value)}
            className="h-8 w-[260px] text-[12.5px]"
          />
        </div>
        <PartnerRequestList
          requests={filtered}
          clientMap={clientMap}
          processMap={processMap}
          emptyText={view === "RESOLVED" ? "Nenhuma pendência concluída." : "Nenhuma pendência em aberto."}
          actions={(r) =>
            r.status === "OPEN" && (
              <Can permission="partnerPortal.requests.respond">
                <div className="flex gap-2">
                  {DOCUMENT_TYPES.includes(r.type) && r.clientId && (
                    <Button size="sm" onClick={() => setSend(r.id)}>
                      Enviar documento
                    </Button>
                  )}
                  <Button size="sm" variant={DOCUMENT_TYPES.includes(r.type) ? "secondary" : "primary"} onClick={() => setRespond(r.id)}>
                    Responder
                  </Button>
                </div>
              </Can>
            )
          }
        />
      </Panel>

      <Panel className="mt-5">
        <PanelHeader title="Documentos enviados" description="Enviados oficialmente: não podem ser editados nem apagados. Correções são enviadas como nova versão." />
        {sent.length === 0 ? (
          <EmptyState compact icon={FileCheck2} title="Nenhum documento enviado." />
        ) : (
          <Table caption="Documentos enviados">
            <THead>
              <tr>
                <Th>Documento</Th>
                <Th>Cliente</Th>
                <Th>Processo</Th>
                <Th>Versão</Th>
                <Th>Enviado em</Th>
                <Th>Situação</Th>
              </tr>
            </THead>
            <TBody>
              {sent.map((d) => (
                <Tr key={d.id}>
                  <Td>
                    <div className="font-medium text-foreground">{d.name}</div>
                    <div className="text-[12px] text-muted">{DOCUMENT_CATEGORY_LABEL[d.category]}</div>
                  </Td>
                  <Td className="text-[12.5px]">{clientDisplayName(clientMap.get(d.clientId))}</Td>
                  <Td className="text-[12.5px] text-muted">{d.processId ? processMap.get(d.processId)?.title : "—"}</Td>
                  <Td className="tabular text-[12.5px]">v{d.version ?? 1}</Td>
                  <Td className="text-[12.5px] text-muted">{d.submittedAt ? formatDate(d.submittedAt) : "—"}</Td>
                  <Td>{d.status === "RECEIVED" ? <Badge tone="success">Recebido</Badge> : <Badge tone="info">Em conferência</Badge>}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Panel>

      {responding && <RespondRequestDialog request={responding} open onOpenChange={(o) => !o && setRespond(null)} />}
      {sendingFor?.clientId && <SendDocumentDialog clientId={sendingFor.clientId} request={sendingFor} open onOpenChange={(o) => !o && setSend(null)} />}
    </PageContainer>
  );
}
