"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleAlert } from "lucide-react";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/display";
import { SortableTh, Table, TBody, Td, Th, THead, Tr, type SortDirection } from "@/components/ui/table";
import {
  ANALYSIS_STATUS_LABEL,
  ANALYSIS_STATUS_TONE,
  CLIENT_KIND_LABEL,
  CLIENT_KIND_SHORT,
  CLIENT_STATUS_LABEL,
  CLIENT_STATUS_TONE,
} from "@/lib/constants/status";
import { cn } from "@/lib/cn";
import { formatEventTime } from "@/lib/formatting";
import type { ID, User } from "@/types";
import type { ClientRow } from "../../hooks";
import { clientDisplayName, clientSecondaryName, maskClientDocument } from "../../utils";

export type ClientSortKey = "name" | "status" | "updated" | "processes";

export function ClientTable({
  rows,
  userMap,
  sortKey,
  direction,
  onSort,
  originNames,
}: {
  rows: ClientRow[];
  userMap: Map<ID, User>;
  /** Nomes dos escritórios de origem; ausente = coluna oculta. */
  originNames?: Map<ID, string>;
  sortKey: ClientSortKey | null;
  direction: SortDirection;
  onSort: (key: ClientSortKey) => void;
}) {
  const router = useRouter();
  const sortProps = { currentKey: sortKey, direction, onSort };
  return (
    <Table caption="Clientes do escritório">
      <THead>
        <tr>
          <SortableTh label="Cliente" sortKey="name" {...sortProps} />
          <Th>Tipo</Th>
          <Th>CPF/CNPJ</Th>
          <Th>Responsável</Th>
          {originNames && <Th>Origem</Th>}
          <SortableTh label="Status" sortKey="status" {...sortProps} />
          <Th>Análise jurídica</Th>
          <SortableTh label="Processos ativos" sortKey="processes" {...sortProps} />
          <Th>Documentos</Th>
          <SortableTh label="Atualizado" sortKey="updated" {...sortProps} />
        </tr>
      </THead>
      <TBody>
        {rows.map(({ client, analysisStatus, activeProcesses, documents }) => {
          const href = `/clientes/${client.id}`;
          const secondary = clientSecondaryName(client);
          const responsible = userMap.get(client.responsibleUserId);
          return (
            <Tr key={client.id} interactive onClick={() => router.push(href)}>
              <Td className="max-w-[320px]">
                <Link
                  href={href}
                  onClick={(e) => e.stopPropagation()}
                  className={cn(
                    "block truncate font-medium hover:text-navy hover:underline underline-offset-2 focus-visible:underline",
                    client.status === "INACTIVE" ? "text-muted" : "text-foreground",
                  )}
                >
                  {clientDisplayName(client)}
                </Link>
                {secondary && <span className="block truncate text-[12px] text-muted">{secondary}</span>}
              </Td>
              <Td>
                <abbr title={CLIENT_KIND_LABEL[client.kind]} className="no-underline">
                  <Badge tone="neutral">{CLIENT_KIND_SHORT[client.kind]}</Badge>
                </abbr>
              </Td>
              <Td className="whitespace-nowrap tabular text-muted">{maskClientDocument(client)}</Td>
              <Td>
                {responsible ? (
                  <span className="inline-flex items-center gap-2 whitespace-nowrap">
                    <Avatar name={responsible.name} size="xs" tone="neutral" />
                    <span className="text-[12.5px]">{responsible.name}</span>
                  </span>
                ) : (
                  <span className="text-subtle">—</span>
                )}
              </Td>
              {originNames && (
                <Td className="max-w-[160px] truncate whitespace-nowrap text-[12.5px] text-muted">
                  {(client.originOfficeId && originNames.get(client.originOfficeId)) ?? "—"}
                </Td>
              )}
              <Td>
                <StatusBadge status={client.status} labels={CLIENT_STATUS_LABEL} tones={CLIENT_STATUS_TONE} />
              </Td>
              <Td>
                {analysisStatus ? (
                  <StatusBadge status={analysisStatus} labels={ANALYSIS_STATUS_LABEL} tones={ANALYSIS_STATUS_TONE} />
                ) : (
                  <span className="text-[12.5px] text-muted">{ANALYSIS_STATUS_LABEL.NOT_STARTED}</span>
                )}
              </Td>
              <Td className="tabular">{activeProcesses}</Td>
              <Td>
                {documents.total === 0 ? (
                  <span className="text-[12.5px] text-subtle">Nenhum</span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[12.5px]">
                    <span className="tabular font-medium">
                      {documents.received}/{documents.total}
                    </span>
                    {documents.pending > 0 ? (
                      <span className="inline-flex items-center gap-1 text-warning">
                        <CircleAlert className="size-3.5" aria-hidden />
                        {documents.pending === 1 ? "1 pendente" : `${documents.pending} pendentes`}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-success">
                        <CheckCircle2 className="size-3.5" aria-hidden />
                        Completo
                      </span>
                    )}
                  </span>
                )}
              </Td>
              <Td className="whitespace-nowrap text-[12.5px] text-muted">{formatEventTime(client.updatedAt)}</Td>
            </Tr>
          );
        })}
      </TBody>
    </Table>
  );
}
