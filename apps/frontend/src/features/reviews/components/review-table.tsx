"use client";

import Link from "next/link";
import { Hourglass } from "lucide-react";
import { daysSince } from "@/lib/clock";
import { REVIEW_STATUS_LABEL, REVIEW_STATUS_TONE, REVIEW_TYPE_LABEL } from "@/lib/constants/status";
import { formatDateTime, formatWaitingTime } from "@/lib/formatting";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import type { Agent, Client, ID, Process, Review } from "@/types";
import { clientDisplayName } from "@/features/processes/utils";
import { isOpenReview, LONG_WAIT_DAYS } from "../utils";
import { PriorityBadge } from "./priority-badge";

function Waiting({ review }: { review: Review }) {
  if (!isOpenReview(review)) return <span className="text-[12px] text-subtle">Decidida</span>;
  const long = daysSince(review.createdAt) >= LONG_WAIT_DAYS;
  return (
    <span className={long ? "inline-flex items-center gap-1 text-[12.5px] font-semibold text-orange" : "text-[12.5px] text-muted"}>
      {long && <Hourglass className="size-3.5" aria-hidden />}
      {formatWaitingTime(review.createdAt)}
      {long && <span className="sr-only"> — aguardando há muito tempo</span>}
    </span>
  );
}

export function ReviewTable({
  reviews,
  agents,
  clients,
  processes,
}: {
  reviews: Review[];
  agents: Map<ID, Agent>;
  clients: Map<ID, Client>;
  processes: Map<ID, Process>;
}) {
  return (
    <Table caption="Fila de revisões">
      <THead>
        <tr>
          <Th>Revisão</Th>
          <Th>Tipo</Th>
          <Th>Cliente / processo</Th>
          <Th>Agente</Th>
          <Th>Criada em</Th>
          <Th>Aguardando há</Th>
          <Th>Prioridade</Th>
          <Th>Status</Th>
        </tr>
      </THead>
      <TBody>
        {reviews.map((r) => {
          const process = r.processId ? processes.get(r.processId) : undefined;
          return (
            <Tr key={r.id} className="hover:bg-navy-50/40">
              <Td className="max-w-[420px]">
                <Link href={`/revisoes/${r.id}`} className="block truncate font-medium text-navy hover:underline underline-offset-2">
                  {r.title}
                </Link>
                <p className="mt-0.5 truncate text-[12px] text-muted">{r.summary}</p>
              </Td>
              <Td className="whitespace-nowrap text-[12.5px] text-muted">{REVIEW_TYPE_LABEL[r.type]}</Td>
              <Td className="max-w-[220px]">
                <div className="truncate text-[12.5px] text-foreground">{r.clientId ? clientDisplayName(clients.get(r.clientId)) : "—"}</div>
                {process && <div className="truncate text-[12px] text-muted">{process.title}</div>}
              </Td>
              <Td className="whitespace-nowrap text-[12.5px]">{agents.get(r.agentId)?.name ?? "—"}</Td>
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
          );
        })}
      </TBody>
    </Table>
  );
}
