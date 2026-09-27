"use client";

import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import { EmptyState } from "@/components/feedback/states";
import { StatusBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/table";
import { PRIORITY_LABEL, PRIORITY_TONE, REVIEW_TYPE_LABEL } from "@/lib/constants/status";
import { formatWaitingTime } from "@/lib/formatting";
import { usePendingReviews } from "../hooks";

/** Revisões abertas mais antigas/urgentes. Montar somente com "reviews.view". */
export function PendingReviews() {
  const { rows, total } = usePendingReviews();
  return (
    <Panel data-tour="home-reviews" className="flex h-full flex-col">
      <PanelHeader
        title="Revisões pendentes"
        description={total > 0 ? `${total} aguardando decisão humana — mais urgentes e antigas primeiro` : "Materiais dos agentes aguardando decisão"}
        actions={
          <ButtonLink href="/revisoes" variant="secondary" size="sm">
            Ver todas
          </ButtonLink>
        }
      />
      {rows.length === 0 ? (
        <EmptyState
          compact
          icon={ClipboardCheck}
          title="Nenhuma revisão pendente"
          description="Quando um agente concluir um material, ele aparecerá aqui para sua decisão."
        />
      ) : (
        <Table caption="Revisões pendentes">
          <THead>
            <tr>
              <Th>Revisão</Th>
              <Th>Cliente</Th>
              <Th>Aguardando há</Th>
              <Th>Prioridade</Th>
            </tr>
          </THead>
          <TBody>
            {rows.map(({ review, clientName, agentName }) => (
              <Tr key={review.id}>
                <Td className="max-w-[360px]">
                  <Link href={`/revisoes/${review.id}`} className="block truncate font-medium text-foreground hover:text-navy-700 hover:underline underline-offset-2">
                    {review.title}
                  </Link>
                  <span className="block truncate text-[11.5px] text-muted">
                    {REVIEW_TYPE_LABEL[review.type]} · {agentName}
                  </span>
                </Td>
                <Td className="max-w-[180px] truncate text-muted">{clientName}</Td>
                <Td className="whitespace-nowrap tabular text-muted">{formatWaitingTime(review.createdAt)}</Td>
                <Td>
                  <StatusBadge status={review.priority} labels={PRIORITY_LABEL} tones={PRIORITY_TONE} />
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </Panel>
  );
}
