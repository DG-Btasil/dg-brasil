"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { LEGAL_AREA_LABEL } from "@/lib/constants/legal";
import { LEGAL_CASE_STATUS_LABEL, LEGAL_CASE_STATUS_TONE, type LegalCaseStatus } from "@/lib/constants/status";
import { formatEventTime } from "@/lib/formatting";
import { StatusBadge } from "@/components/ui/badge";
import { SortableTh, sortBy, Table, TBody, Td, Th, THead, Tr, type SortDirection } from "@/components/ui/table";
import type { LegalCaseRow } from "@/types";

type SortKey = "case" | "client" | "origin" | "status" | "updated";

const GETTERS: Record<SortKey, (r: LegalCaseRow) => string | undefined> = {
  case: (r) => r.legalCase.title,
  client: (r) => r.clientName,
  origin: (r) => r.originName,
  status: (r) => LEGAL_CASE_STATUS_LABEL[r.legalCase.status],
  updated: (r) => r.legalCase.updatedAt,
};

/**
 * Tabela de casos. `statusLabels` permite a nomenclatura simplificada do
 * portal do parceiro (ex.: "Em análise", "Não aceito").
 */
export function CaseTable({
  rows,
  statusLabels = LEGAL_CASE_STATUS_LABEL,
  showLawyer = true,
  showOrigin = true,
}: {
  rows: LegalCaseRow[];
  statusLabels?: Record<LegalCaseStatus, string>;
  showLawyer?: boolean;
  showOrigin?: boolean;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("updated");
  const [direction, setDirection] = useState<SortDirection>("desc");
  const sorted = useMemo(() => sortBy(rows, GETTERS[sortKey], direction), [rows, sortKey, direction]);
  const sort = (key: SortKey) => {
    if (key === sortKey) setDirection((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setDirection(key === "updated" ? "desc" : "asc");
    }
  };
  const th = (key: SortKey, label: string) => <SortableTh label={label} sortKey={key} currentKey={sortKey} direction={direction} onSort={sort} />;

  return (
    <Table caption="Casos">
      <THead>
        <tr>
          {th("case", "Caso")}
          {th("client", "Cliente")}
          <Th>Área</Th>
          {showOrigin && th("origin", "Origem")}
          {showLawyer && <Th>Responsável</Th>}
          <Th className="text-right">Processos</Th>
          {th("status", "Situação")}
          {th("updated", "Atualizado")}
        </tr>
      </THead>
      <TBody>
        {sorted.map((r) => {
          const c = r.legalCase;
          return (
            <Tr key={c.id}>
              <Td className="max-w-[300px]">
                <Link href={`/casos/${c.id}`} className="block truncate font-medium text-navy-700 hover:underline underline-offset-2">
                  {c.title}
                </Link>
                <span className="block truncate text-[11.5px] text-muted">{c.caseType}</span>
              </Td>
              <Td className="max-w-[220px]">
                <span className="block truncate">{r.clientName}</span>
              </Td>
              <Td className="whitespace-nowrap text-[12.5px]">{LEGAL_AREA_LABEL[c.area]}</Td>
              {showOrigin && (
                <Td className="max-w-[200px]">
                  <span className={r.partnerName ? "block truncate text-[12.5px] font-medium text-navy-700" : "block truncate text-[12.5px] text-muted"}>{r.originName}</span>
                </Td>
              )}
              {showLawyer && (
                <Td className="whitespace-nowrap text-[12.5px]">
                  {r.lawyerName ?? <span className="text-subtle">Não definido</span>}
                </Td>
              )}
              <Td className="text-right tabular">{r.processCount}</Td>
              <Td>
                <StatusBadge status={c.status} labels={statusLabels} tones={LEGAL_CASE_STATUS_TONE} />
              </Td>
              <Td className="whitespace-nowrap text-[12px] text-muted tabular">{formatEventTime(c.updatedAt)}</Td>
            </Tr>
          );
        })}
      </TBody>
    </Table>
  );
}
