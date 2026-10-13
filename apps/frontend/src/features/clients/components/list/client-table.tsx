"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/display";
import { SortableTh, Table, TBody, Td, Th, THead, Tr, type SortDirection } from "@/components/ui/table";
import { CLIENT_KIND_LABEL, CLIENT_KIND_SHORT, CLIENT_STATUS_LABEL, CLIENT_STATUS_TONE } from "@/lib/constants/status";
import { cn } from "@/lib/cn";
import type { DirectoryUser } from "@/lib/directory/types";
import { formatEventTime, maskCNPJ, maskCPF } from "@/lib/formatting";
import type { ClientListItem } from "@/server/domain/clients/dto";
import type { ID } from "@/types";
import type { ClientSortField } from "../../list-query";

export function ClientTable({
  rows,
  userMap,
  sortKey,
  direction,
  onSort,
  originNames,
}: {
  rows: ClientListItem[];
  userMap: Map<ID, DirectoryUser>;
  /** Nomes dos escritórios de origem; ausente = coluna oculta. */
  originNames?: Map<ID, string>;
  sortKey: ClientSortField;
  direction: SortDirection;
  onSort: (key: ClientSortField) => void;
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
          <Th>Status</Th>
          <SortableTh label="Cadastrado" sortKey="createdAt" {...sortProps} />
          <SortableTh label="Atualizado" sortKey="updatedAt" {...sortProps} />
        </tr>
      </THead>
      <TBody>
        {rows.map((client) => {
          const href = `/clientes/${client.id}`;
          const responsible = client.responsibleUserId ? userMap.get(client.responsibleUserId) : undefined;
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
                  {client.name}
                </Link>
                {client.tradeName && <span className="block truncate text-[12px] text-muted">{client.tradeName}</span>}
              </Td>
              <Td>
                <abbr title={CLIENT_KIND_LABEL[client.kind]} className="no-underline">
                  <Badge tone="neutral">{CLIENT_KIND_SHORT[client.kind]}</Badge>
                </abbr>
              </Td>
              <Td className="whitespace-nowrap tabular text-muted">{client.kind === "INDIVIDUAL" ? maskCPF(client.document) : maskCNPJ(client.document)}</Td>
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
                  {(client.originOrganizationId && originNames.get(client.originOrganizationId)) ?? "—"}
                </Td>
              )}
              <Td>
                <StatusBadge status={client.status} labels={CLIENT_STATUS_LABEL} tones={CLIENT_STATUS_TONE} />
              </Td>
              <Td className="whitespace-nowrap text-[12.5px] text-muted">{formatEventTime(client.createdAt)}</Td>
              <Td className="whitespace-nowrap text-[12.5px] text-muted">{formatEventTime(client.updatedAt)}</Td>
            </Tr>
          );
        })}
      </TBody>
    </Table>
  );
}
