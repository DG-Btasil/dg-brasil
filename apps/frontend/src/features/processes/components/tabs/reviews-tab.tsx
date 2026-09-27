"use client";

import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import { REVIEW_STATUS_LABEL, REVIEW_STATUS_TONE, REVIEW_TYPE_LABEL } from "@/lib/constants/status";
import { formatDateTime } from "@/lib/formatting";
import { StatusBadge } from "@/components/ui/badge";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { EmptyState } from "@/components/feedback/states";
import { PriorityBadge } from "@/features/reviews/components/priority-badge";
import { useAgentMap } from "@/features/reviews/hooks";
import type { Review } from "@/types";

/** Itens de Revisões gerados pelos agentes para este processo. */
export function ReviewsTab({ reviews }: { reviews: Review[] }) {
  const agents = useAgentMap();
  return (
    <Panel>
      <PanelHeader title="Revisões do processo" as="h3" description="Materiais produzidos pelos agentes que dependem — ou dependeram — de decisão humana." />
      {reviews.length === 0 ? (
        <EmptyState compact icon={ClipboardCheck} title="Nenhuma revisão relacionada a este processo." />
      ) : (
        <Table caption="Revisões relacionadas ao processo">
          <THead>
            <tr>
              <Th>Revisão</Th>
              <Th>Tipo</Th>
              <Th>Agente</Th>
              <Th>Criada em</Th>
              <Th>Prioridade</Th>
              <Th>Status</Th>
            </tr>
          </THead>
          <TBody>
            {reviews.map((r) => (
              <Tr key={r.id}>
                <Td>
                  <Link href={`/revisoes/${r.id}`} className="font-medium text-navy hover:underline underline-offset-2">
                    {r.title}
                  </Link>
                </Td>
                <Td className="text-[12.5px] text-muted">{REVIEW_TYPE_LABEL[r.type]}</Td>
                <Td className="text-[12.5px]">{agents.get(r.agentId)?.name ?? "—"}</Td>
                <Td className="whitespace-nowrap text-[12.5px] text-muted tabular">{formatDateTime(r.createdAt)}</Td>
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
      )}
    </Panel>
  );
}
