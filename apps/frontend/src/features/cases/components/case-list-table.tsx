"use client";

import Link from "next/link";
import { LEGAL_AREA_LABEL, type LegalArea } from "@/lib/constants/legal";
import { LEGAL_CASE_STATUS_LABEL, LEGAL_CASE_STATUS_TONE } from "@/lib/constants/status";
import { formatEventTime } from "@/lib/formatting";
import { StatusBadge } from "@/components/ui/badge";
import { SortableTh, Table, TBody, Td, Th, THead, Tr, type SortDirection } from "@/components/ui/table";
import type { CaseListItem } from "@/server/domain/cases/dto";
import type { ID } from "@/types";
import type { CaseSortField } from "../list-query";

/** Tabela de casos ligada ao backend (ordem feita no servidor). */
export function CaseListTable({
  rows,
  sortKey,
  direction,
  onSort,
  lawyerName,
  originName,
  ownerId,
  showClient = true,
}: {
  rows: CaseListItem[];
  sortKey?: CaseSortField;
  direction?: SortDirection;
  /** Sem `onSort`, os cabeçalhos não ordenam (ex.: aba de um cliente). */
  onSort?: (key: CaseSortField) => void;
  lawyerName: (id: ID | undefined) => string | undefined;
  originName: (id: ID) => string | undefined;
  ownerId: ID;
  showClient?: boolean;
}) {
  const th = (key: CaseSortField, label: string) =>
    onSort ? <SortableTh label={label} sortKey={key} currentKey={sortKey ?? null} direction={direction ?? "desc"} onSort={onSort} /> : <Th>{label}</Th>;
  return (
    <Table caption="Casos">
      <THead>
        <tr>
          {th("title", "Caso")}
          {showClient && <Th>Cliente</Th>}
          <Th>Área</Th>
          <Th>Origem</Th>
          <Th>Responsável</Th>
          <Th className="text-right">Processos</Th>
          {th("status", "Situação")}
          {th("updatedAt", "Atualizado")}
        </tr>
      </THead>
      <TBody>
        {rows.map((c) => {
          const partnerOrigin = c.originOrganizationId !== ownerId;
          return (
            <Tr key={c.id}>
              <Td className="max-w-[300px]">
                <Link href={`/casos/${c.id}`} className="block truncate font-medium text-navy-700 hover:underline underline-offset-2">
                  {c.title}
                </Link>
                {c.caseTypeName && <span className="block truncate text-[11.5px] text-muted">{c.caseTypeName}</span>}
              </Td>
              {showClient && (
                <Td className="max-w-[220px]">
                  {c.clientName ? (
                    <Link href={`/clientes/${c.clientId}`} className="block truncate hover:text-navy hover:underline underline-offset-2">
                      {c.clientName}
                    </Link>
                  ) : (
                    <span className="text-subtle">—</span>
                  )}
                </Td>
              )}
              <Td className="whitespace-nowrap text-[12.5px]">{LEGAL_AREA_LABEL[c.area as LegalArea] ?? c.area}</Td>
              <Td className="max-w-[200px]">
                <span className={partnerOrigin ? "block truncate text-[12.5px] font-medium text-navy-700" : "block truncate text-[12.5px] text-muted"}>
                  {originName(c.originOrganizationId) ?? (partnerOrigin ? "Escritório parceiro" : "—")}
                </span>
              </Td>
              <Td className="whitespace-nowrap text-[12.5px]">{lawyerName(c.assignedLawyerId) ?? <span className="text-subtle">Não definido</span>}</Td>
              <Td className="text-right tabular">{c.processCount ?? 0}</Td>
              <Td>
                <StatusBadge status={c.status} labels={LEGAL_CASE_STATUS_LABEL} tones={LEGAL_CASE_STATUS_TONE} />
              </Td>
              <Td className="whitespace-nowrap text-[12px] text-muted tabular">{formatEventTime(c.updatedAt)}</Td>
            </Tr>
          );
        })}
      </TBody>
    </Table>
  );
}
