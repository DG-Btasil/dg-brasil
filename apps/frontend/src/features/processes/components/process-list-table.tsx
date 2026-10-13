"use client";

import Link from "next/link";
import { PROCESS_PHASE_LABEL, PROCESS_STATUS_LABEL, PROCESS_STATUS_TONE } from "@/lib/constants/status";
import { formatCurrency, formatEventTime } from "@/lib/formatting";
import { StatusBadge } from "@/components/ui/badge";
import { DeadlineBadge } from "@/components/ui/display";
import { SortableTh, Table, TBody, Td, Th, THead, Tr, type SortDirection } from "@/components/ui/table";
import type { ProcessListItem } from "@/server/domain/processes/dto";
import { usePermission } from "@/features/auth/hooks";
import { useDirectoryUserMap, useOrganizationNames, useOrgDirectory } from "@/features/directory/directory-context";
import { CnjText } from "./cnj-text";
import { ProcessOriginBadge } from "./process-origin-badge";

export type ProcessSortField = "updatedAt" | "createdAt" | "title" | "cnj" | "distributionDate";

/** "TJSP · Ribeirão Preto/SP" */
function courtLocation(p: Pick<ProcessListItem, "court" | "state">): string {
  return [p.court, p.state].filter(Boolean).join(" · ");
}

/** Tabela de processos ligada ao backend (ordem, quando houver, feita no servidor). */
export function ProcessListTable({
  rows,
  showClient = true,
  sortKey,
  direction,
  onSort,
}: {
  rows: ProcessListItem[];
  showClient?: boolean;
  sortKey?: ProcessSortField;
  direction?: SortDirection;
  onSort?: (key: ProcessSortField) => void;
}) {
  const showCaseValue = usePermission("processes.caseValue.view");
  // Portal do Parceiro: o DTO não traz responsável nem prazos internos — as colunas nem aparecem.
  const internal = !usePermission("partnerPortal.view");
  const canPartners = usePermission("partners.view");
  const users = useDirectoryUserMap();
  const names = useOrganizationNames();
  const { owner } = useOrgDirectory();
  const th = (key: ProcessSortField, label: string, className?: string) =>
    onSort ? (
      <SortableTh label={label} sortKey={key} currentKey={sortKey ?? null} direction={direction ?? "desc"} onSort={onSort} className={className} />
    ) : (
      <Th className={className}>{label}</Th>
    );

  return (
    <Table caption="Processos">
      <THead>
        <tr>
          {th("cnj", "Número CNJ")}
          {showClient && <Th>Cliente</Th>}
          {th("title", "Tipo / ação")}
          <Th>Tribunal</Th>
          {internal && <Th>Responsável</Th>}
          <Th>Fase</Th>
          <Th>Status</Th>
          {internal && <Th>Próximo prazo</Th>}
          {showCaseValue && <Th className="text-right">Valor da causa</Th>}
          {internal && <Th>Origem</Th>}
          {th("updatedAt", "Atualização")}
        </tr>
      </THead>
      <TBody>
        {rows.map((p) => {
          const partnerOrigin = p.caseOriginOrganizationId && p.caseOriginOrganizationId !== owner.id ? p.caseOriginOrganizationId : undefined;
          return (
            <Tr key={p.id} className="hover:bg-navy-50/40">
              <Td className="whitespace-nowrap">
                <Link href={`/processos/${p.id}`} className="font-medium text-navy hover:underline underline-offset-2">
                  <CnjText cnj={p.cnj} />
                </Link>
              </Td>
              {showClient && (
                <Td className="max-w-[200px]">
                  {p.clientName ? (
                    <Link href={`/clientes/${p.clientId}`} className="block truncate text-foreground hover:text-navy hover:underline underline-offset-2">
                      {p.clientName}
                    </Link>
                  ) : (
                    <span className="text-subtle">—</span>
                  )}
                </Td>
              )}
              <Td className="max-w-[260px]">
                <div className="truncate text-foreground">{p.actionType ?? p.title}</div>
                <div className="truncate text-[12px] text-muted">{p.actionType ? p.title : p.caseTitle}</div>
              </Td>
              <Td className="whitespace-nowrap text-[12.5px]">{courtLocation(p) || <span className="text-subtle">—</span>}</Td>
              {internal && <Td className="whitespace-nowrap text-[12.5px]">{(p.responsibleUserId && users.get(p.responsibleUserId)?.name) || "—"}</Td>}
              <Td className="whitespace-nowrap text-[12.5px] text-muted">{p.phase ? PROCESS_PHASE_LABEL[p.phase] : "—"}</Td>
              <Td>
                <StatusBadge status={p.status} labels={PROCESS_STATUS_LABEL} tones={PROCESS_STATUS_TONE} />
              </Td>
              {internal && <Td>
                {p.nextDeadline ? (
                  <div className="min-w-0">
                    <DeadlineBadge dueDate={p.nextDeadline.dueDateLocal} />
                    <div className="mt-0.5 max-w-[180px] truncate text-[11.5px] text-muted">{p.nextDeadline.title}</div>
                  </div>
                ) : (
                  <span className="text-[12px] text-subtle">Sem prazo</span>
                )}
              </Td>}
              {showCaseValue && <Td className="whitespace-nowrap text-right tabular">{formatCurrency(p.caseValue)}</Td>}
              {internal && <Td>
                <ProcessOriginBadge origin={p.origin} />
                {canPartners && partnerOrigin && (
                  <div className="mt-1 max-w-[160px] truncate text-[11.5px] font-medium text-navy-700" title="Origem do caso">
                    {names.get(partnerOrigin) ?? "Parceiro"}
                  </div>
                )}
              </Td>}
              <Td className="whitespace-nowrap text-[12px] text-muted tabular">{formatEventTime(p.updatedAt)}</Td>
            </Tr>
          );
        })}
      </TBody>
    </Table>
  );
}
