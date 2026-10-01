"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { PROCESS_PHASE_LABEL, PROCESS_STATUS_LABEL, PROCESS_STATUS_TONE } from "@/lib/constants/status";
import { formatCurrency, formatEventTime } from "@/lib/formatting";
import { StatusBadge } from "@/components/ui/badge";
import { DeadlineBadge } from "@/components/ui/display";
import { SortableTh, sortBy, Table, TBody, Td, Th, THead, Tr, type SortDirection } from "@/components/ui/table";
import { courtLocation, hasPendingClientLink, type ProcessRow } from "../utils";
import { CnjText } from "./cnj-text";
import { ProcessOriginBadge } from "./process-origin-badge";

type SortKey = "cnj" | "client" | "action" | "court" | "responsible" | "status" | "deadline" | "value" | "updated";

const GETTERS: Record<SortKey, (r: ProcessRow) => string | number | undefined> = {
  cnj: (r) => r.process.cnj,
  client: (r) => r.clientName,
  action: (r) => r.process.actionType,
  court: (r) => r.process.court,
  responsible: (r) => r.responsibleName,
  status: (r) => PROCESS_STATUS_LABEL[r.process.status],
  deadline: (r) => r.nextDeadline?.dueDate,
  value: (r) => r.process.caseValue,
  updated: (r) => r.process.lastMovementAt ?? r.process.updatedAt,
};

export function ProcessTable({
  rows,
  showCaseValue,
  partnerMap,
}: {
  rows: ProcessRow[];
  showCaseValue: boolean;
  /** Nomes dos parceiros, para indicar a origem do caso. */
  partnerMap?: Map<string, { name: string }>;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("deadline");
  const [direction, setDirection] = useState<SortDirection>("asc");

  const sorted = useMemo(() => sortBy(rows, GETTERS[sortKey], direction), [rows, sortKey, direction]);

  function onSort(key: SortKey) {
    if (key === sortKey) setDirection((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setDirection(key === "updated" || key === "value" ? "desc" : "asc");
    }
  }

  const th = { currentKey: sortKey, direction, onSort };

  return (
    <Table caption="Processos do escritório">
      <THead>
        <tr>
          <SortableTh label="Número CNJ" sortKey="cnj" {...th} />
          <SortableTh label="Cliente" sortKey="client" {...th} />
          <SortableTh label="Tipo / ação" sortKey="action" {...th} />
          <SortableTh label="Tribunal" sortKey="court" {...th} />
          <SortableTh label="Responsável" sortKey="responsible" {...th} />
          <Th>Fase</Th>
          <SortableTh label="Status" sortKey="status" {...th} />
          <SortableTh label="Próximo prazo" sortKey="deadline" {...th} />
          {showCaseValue && <SortableTh label="Valor da causa" sortKey="value" {...th} className="text-right" />}
          <Th>Origem</Th>
          <SortableTh label="Atualização" sortKey="updated" {...th} />
        </tr>
      </THead>
      <TBody>
        {sorted.map(({ process: p, clientName, responsibleName, nextDeadline, casePartnerId }) => (
          <Tr key={p.id} className="hover:bg-navy-50/40">
            <Td className="whitespace-nowrap">
              <Link href={`/processos/${p.id}`} className="font-medium text-navy hover:underline underline-offset-2">
                <CnjText cnj={p.cnj} />
              </Link>
            </Td>
            <Td className="max-w-[200px]">
              {hasPendingClientLink(p) ? (
                <span className="flex items-center gap-1 text-[12.5px] text-warning" title={clientName}>
                  <ShieldAlert className="size-3.5 shrink-0" aria-hidden />
                  <span className="truncate">{clientName}</span>
                </span>
              ) : (
                <Link href={`/clientes/${p.clientId}`} className="block truncate text-foreground hover:text-navy hover:underline underline-offset-2">
                  {clientName}
                </Link>
              )}
            </Td>
            <Td className="max-w-[260px]">
              <div className="truncate text-foreground">{p.actionType}</div>
              <div className="truncate text-[12px] text-muted">{p.title}</div>
            </Td>
            <Td className="whitespace-nowrap text-[12.5px]">{courtLocation(p) || <span className="text-subtle">—</span>}</Td>
            <Td className="whitespace-nowrap text-[12.5px]">{responsibleName}</Td>
            <Td className="whitespace-nowrap text-[12.5px] text-muted">{PROCESS_PHASE_LABEL[p.phase]}</Td>
            <Td>
              <StatusBadge status={p.status} labels={PROCESS_STATUS_LABEL} tones={PROCESS_STATUS_TONE} />
            </Td>
            <Td>
              {nextDeadline ? (
                <div className="min-w-0">
                  <DeadlineBadge dueDate={nextDeadline.dueDate} />
                  <div className="mt-0.5 max-w-[180px] truncate text-[11.5px] text-muted">{nextDeadline.title}</div>
                </div>
              ) : (
                <span className="text-[12px] text-subtle">Sem prazo</span>
              )}
            </Td>
            {showCaseValue && <Td className="whitespace-nowrap text-right tabular">{formatCurrency(p.caseValue)}</Td>}
            <Td>
              <ProcessOriginBadge origin={p.origin} />
              {partnerMap && casePartnerId && (
                <div className="mt-1 max-w-[160px] truncate text-[11.5px] font-medium text-navy-700" title="Origem do caso">
                  {partnerMap.get(casePartnerId)?.name ?? "Parceiro"}
                </div>
              )}
            </Td>
            <Td className="whitespace-nowrap text-[12px] text-muted tabular">{formatEventTime(p.lastMovementAt ?? p.updatedAt)}</Td>
          </Tr>
        ))}
      </TBody>
    </Table>
  );
}
