"use client";

import Link from "next/link";
import { Hourglass } from "lucide-react";
import { daysSince } from "@/lib/clock";
import { REVIEW_STATUS_LABEL, REVIEW_STATUS_TONE } from "@/lib/constants/status";
import { formatDateTime, formatWaitingTime } from "@/lib/formatting";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import type { DbReviewStatus } from "@/repositories/api/db-mappings";
import type { ReviewListItem } from "@/server/domain/reviews/dto";
import { useDirectoryUserMap } from "@/features/directory/directory-context";
import { REVIEW_KIND_LABEL } from "../list-query";
import { PriorityBadge } from "./priority-badge";

/** Revisão aguardando há mais que isto aparece destacada. */
export const LONG_WAIT_DAYS = 3;

export const DB_STATUS_LABEL: Record<DbReviewStatus, string> = {
  PENDING: "Pendente",
  REOPENED: "Reaberta",
  CHANGES_REQUESTED: "Alterações solicitadas",
  APPROVED: "Aprovada",
  REJECTED: "Rejeitada",
};

export const isOpen = (r: Pick<ReviewListItem, "dbStatus">) => r.dbStatus === "PENDING" || r.dbStatus === "REOPENED";

function Waiting({ review }: { review: ReviewListItem }) {
  if (!isOpen(review)) return <span className="text-[12px] text-subtle">{review.decidedAt ? `Decidida ${formatDateTime(review.decidedAt)}` : "Decidida"}</span>;
  const long = daysSince(review.createdAt) >= LONG_WAIT_DAYS;
  return (
    <span className={long ? "inline-flex items-center gap-1 text-[12.5px] font-semibold text-orange" : "text-[12.5px] text-muted"}>
      {long && <Hourglass className="size-3.5" aria-hidden />}
      {formatWaitingTime(review.createdAt)}
      {long && <span className="sr-only"> — aguardando há muito tempo</span>}
    </span>
  );
}

/** Fila de revisões (linhas do servidor; nenhum conteúdo revisado aqui, só rótulos). */
export function ReviewTable({ rows }: { rows: ReviewListItem[] }) {
  const users = useDirectoryUserMap();
  return (
    <Table caption="Fila de revisões">
      <THead>
        <tr>
          <Th>Revisão</Th>
          <Th>Tipo</Th>
          <Th>Caso / cliente</Th>
          <Th>Responsável</Th>
          <Th>Criada em</Th>
          <Th>Aguardando há</Th>
          <Th>Prioridade</Th>
          <Th>Status</Th>
        </tr>
      </THead>
      <TBody>
        {rows.map((r) => (
          <Tr key={r.id} className="hover:bg-navy-50/40">
            <Td className="max-w-[380px]">
              <Link href={`/revisoes/${r.id}`} className="block truncate font-medium text-navy hover:underline underline-offset-2">
                {r.subject}
              </Link>
              {r.agentName && <p className="mt-0.5 truncate text-[12px] text-muted">Gerado por {r.agentName}</p>}
            </Td>
            <Td className="whitespace-nowrap text-[12.5px] text-muted">{REVIEW_KIND_LABEL[r.targetKind]}</Td>
            <Td className="max-w-[240px]">
              <div className="truncate text-[12.5px] text-foreground">{r.caseTitle ?? "—"}</div>
              {r.clientName && <div className="truncate text-[12px] text-muted">{r.clientName}</div>}
            </Td>
            <Td className="whitespace-nowrap text-[12.5px]">{(r.assignedReviewerId && users.get(r.assignedReviewerId)?.name) || <span className="text-subtle">Sem responsável</span>}</Td>
            <Td className="whitespace-nowrap text-[12px] text-muted tabular">{formatDateTime(r.createdAt)}</Td>
            <Td className="whitespace-nowrap">
              <Waiting review={r} />
            </Td>
            <Td>
              <PriorityBadge priority={r.priority} />
            </Td>
            <Td>
              <StatusBadge status={r.status} labels={REVIEW_STATUS_LABEL} tones={REVIEW_STATUS_TONE} />
            </Td>
          </Tr>
        ))}
      </TBody>
    </Table>
  );
}
