"use client";

import Link from "next/link";
import { Hourglass } from "lucide-react";
import { daysSince } from "@/lib/clock";
import { REVIEW_STATUS_LABEL, REVIEW_STATUS_TONE } from "@/lib/constants/status";
import { formatDateTime, formatWaitingTime } from "@/lib/formatting";
import { StatusBadge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/form";
import { TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import type { DbReviewStatus } from "@/repositories/api/db-mappings";
import type { ReviewListItem } from "@/server/domain/reviews/dto";
import { useDirectoryUserMap } from "@/features/directory/directory-context";
import type { ReviewKind } from "../list-query";
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

/** Rótulo curto do tipo, para a coluna estreita da tabela (o filtro usa o rótulo completo). */
const KIND_SHORT_LABEL: Record<ReviewKind, string> = { ANALYSIS: "Análise", DOCUMENT_VERSION: "Documento", AGENT_PROPOSAL: "Proposta" };

export const isOpen = (r: Pick<ReviewListItem, "dbStatus">) => r.dbStatus === "PENDING" || r.dbStatus === "REOPENED";

/** Há quanto tempo espera (com a data embaixo) ou, se já decidida, quando foi. */
function Waiting({ review }: { review: ReviewListItem }) {
  if (!isOpen(review)) {
    return (
      <>
        <span className="block text-[12.5px] text-muted">Decidida</span>
        {review.decidedAt && <span className="block text-[11.5px] text-subtle tabular">{formatDateTime(review.decidedAt)}</span>}
      </>
    );
  }
  const long = daysSince(review.createdAt) >= LONG_WAIT_DAYS;
  return (
    <>
      <span className={long ? "inline-flex items-center gap-1 text-[12.5px] font-semibold text-orange" : "text-[12.5px] text-muted"}>
        {long && <Hourglass className="size-3.5" aria-hidden />}
        {formatWaitingTime(review.createdAt)}
        {long && <span className="sr-only"> — aguardando há muito tempo</span>}
      </span>
      <span className="block text-[11.5px] text-subtle tabular">desde {formatDateTime(review.createdAt)}</span>
    </>
  );
}

/** Marcação de itens para a decisão em conjunto (só dentro de um grupo). */
export interface ReviewSelection {
  selected: ReadonlySet<string>;
  /** Por que o item não pode ser marcado; `undefined` = pode. */
  blocked: (review: ReviewListItem) => string | undefined;
  onToggle: (id: string, checked: boolean) => void;
  onToggleAll: (ids: string[], checked: boolean) => void;
}

/**
 * Fila de revisões (linhas do servidor; nenhum conteúdo revisado aqui, só
 * rótulos). Colunas de largura fixa: a tabela cabe inteira numa tela de
 * 1366 px (sobram 1.285 px dentro do painel) e o texto longo é cortado com
 * reticências, em vez de empurrar a última coluna para fora. Em tela mais
 * estreita que a largura mínima, a tabela rola de lado dentro do painel.
 * As larguras fixas somam 720 px (764 com a caixa de marcar); "Status" tem
 * 200 px porque o maior rótulo ("Alterações solicitadas") não quebra.
 */
export function ReviewTable({
  rows,
  showCase = true,
  selection,
  caption = "Fila de revisões",
}: {
  rows: ReviewListItem[];
  /** Dentro de um grupo o caso já está no cabeçalho: a coluna some. */
  showCase?: boolean;
  selection?: ReviewSelection;
  caption?: string;
}) {
  const users = useDirectoryUserMap();
  const selectable = selection ? rows.filter((r) => isOpen(r) && !selection.blocked(r)).map((r) => r.id) : [];
  const selectedCount = selectable.filter((id) => selection?.selected.has(id)).length;
  const allSelected = selectable.length > 0 && selectedCount === selectable.length;
  return (
    <div className="overflow-x-auto">
      <table className={`w-full table-fixed border-collapse text-left text-[13px] ${showCase ? "min-w-[1200px]" : "min-w-[1024px]"}`}>
        <caption className="sr-only">{caption}</caption>
        <colgroup>
          {selection && <col className="w-[44px]" />}
          <col />
          <col className="w-[100px]" />
          {showCase && <col className="w-[20%]" />}
          <col className="w-[140px]" />
          <col className="w-[172px]" />
          <col className="w-[108px]" />
          <col className="w-[200px]" />
        </colgroup>
        <THead>
          <tr>
            {selection && (
              <Th className="pr-0">
                {selectable.length > 0 && (
                  <Checkbox
                    label={<span className="sr-only">Marcar todos os itens que podem ser decididos em conjunto</span>}
                    checked={allSelected}
                    indeterminate={selectedCount > 0 && !allSelected}
                    // Com alguns marcados, o clique marca todos (como nas listas de e-mail).
                    onChange={() => selection.onToggleAll(selectable, !allSelected)}
                  />
                )}
              </Th>
            )}
            <Th>Revisão</Th>
            <Th>Tipo</Th>
            {showCase && <Th>Caso / cliente</Th>}
            <Th>Responsável</Th>
            <Th>Aguardando há</Th>
            <Th>Prioridade</Th>
            <Th>Status</Th>
          </tr>
        </THead>
        <TBody>
          {rows.map((r) => {
            const reason = selection && isOpen(r) ? selection.blocked(r) : undefined;
            const responsible = r.assignedReviewerId ? users.get(r.assignedReviewerId)?.name : undefined;
            return (
              <Tr key={r.id} className="hover:bg-navy-50/40">
                {selection && (
                  <Td className="pr-0">
                    {isOpen(r) && !reason && (
                      <Checkbox
                        label={<span className="sr-only">Marcar {r.detail ? `${r.subject}: ${r.detail}` : r.subject}</span>}
                        checked={selection.selected.has(r.id)}
                        onChange={(e) => selection.onToggle(r.id, e.target.checked)}
                      />
                    )}
                  </Td>
                )}
                <Td>
                  <Link href={`/revisoes/${r.id}`} title={r.subject} className="block truncate font-medium text-navy hover:underline underline-offset-2">
                    {r.subject}
                  </Link>
                  {r.detail && (
                    <p className="mt-0.5 truncate text-[12.5px] text-foreground" title={r.detail}>
                      {r.detail}
                    </p>
                  )}
                  {r.agentName && <p className="mt-0.5 truncate text-[12px] text-muted">Gerado por {r.agentName}</p>}
                  {reason && <p className="mt-0.5 truncate text-[12px] text-subtle">{reason}</p>}
                </Td>
                <Td className="truncate text-[12.5px] text-muted">{KIND_SHORT_LABEL[r.targetKind]}</Td>
                {showCase && (
                  <Td>
                    <div className="truncate text-[12.5px] text-foreground" title={r.caseTitle}>
                      {r.caseTitle ?? "—"}
                    </div>
                    {r.clientName && (
                      <div className="truncate text-[12px] text-muted" title={r.clientName}>
                        {r.clientName}
                      </div>
                    )}
                  </Td>
                )}
                <Td className="truncate text-[12.5px]" title={responsible}>
                  {responsible || <span className="text-subtle">Sem responsável</span>}
                </Td>
                <Td>
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
      </table>
    </div>
  );
}
