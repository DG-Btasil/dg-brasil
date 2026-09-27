"use client";

import Link from "next/link";
import { FileText } from "lucide-react";
import { DOCUMENT_CATEGORY_LABEL, DOCUMENT_STATUS_LABEL, DOCUMENT_STATUS_TONE } from "@/lib/constants/status";
import { formatDate } from "@/lib/formatting";
import { StatusBadge } from "@/components/ui/badge";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { EmptyState } from "@/components/feedback/states";
import type { ClientDocument } from "@/types";
import { useProcessDocuments } from "../../hooks";

function DocumentTable({ documents, caption }: { documents: ClientDocument[]; caption: string }) {
  return (
    <Table caption={caption}>
      <THead>
        <tr>
          <Th>Documento</Th>
          <Th>Categoria</Th>
          <Th>Situação</Th>
          <Th>Arquivo</Th>
          <Th>Recebido em</Th>
        </tr>
      </THead>
      <TBody>
        {documents.map((d) => (
          <Tr key={d.id}>
            <Td>
              <div className="flex items-center gap-2">
                <FileText className="size-4 shrink-0 text-subtle" aria-hidden />
                <span className="text-foreground">{d.name}</span>
              </div>
            </Td>
            <Td className="text-[12.5px] text-muted">{DOCUMENT_CATEGORY_LABEL[d.category]}</Td>
            <Td>
              <StatusBadge status={d.status} labels={DOCUMENT_STATUS_LABEL} tones={DOCUMENT_STATUS_TONE} />
            </Td>
            <Td className="text-[12.5px] text-muted">{d.fileName ?? "—"}</Td>
            <Td className="text-[12.5px] text-muted tabular">{formatDate(d.uploadedAt)}</Td>
          </Tr>
        ))}
      </TBody>
    </Table>
  );
}

export function DocumentsTab({ processId, clientId }: { processId: string; clientId: string }) {
  const { linked, client } = useProcessDocuments(processId, clientId);

  return (
    <div className="space-y-5">
      <Panel>
        <PanelHeader title="Peças e documentos do processo" as="h3" description="Documentos vinculados diretamente a este processo." />
        {linked.length === 0 ? (
          <EmptyState compact icon={FileText} title="Nenhum documento vinculado a este processo." description="Peças e decisões vinculadas ao processo aparecerão aqui." />
        ) : (
          <DocumentTable documents={linked} caption="Documentos vinculados ao processo" />
        )}
      </Panel>
      <Panel>
        <PanelHeader
          title="Documentos do cliente"
          as="h3"
          description="Demais documentos do cadastro do cliente, para consulta."
          actions={
            <Link href={`/clientes/${clientId}?aba=documentos`} className="text-[12.5px] font-medium text-navy hover:underline underline-offset-2">
              Gerenciar no cadastro do cliente
            </Link>
          }
        />
        {client.length === 0 ? (
          <EmptyState compact title="O cliente ainda não tem outros documentos." />
        ) : (
          <DocumentTable documents={client} caption="Documentos do cliente" />
        )}
      </Panel>
    </div>
  );
}
