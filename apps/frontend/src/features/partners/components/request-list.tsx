"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { MessageSquareText } from "lucide-react";
import { PARTNER_REQUEST_STATUS_LABEL, PARTNER_REQUEST_STATUS_TONE, PARTNER_REQUEST_TYPE_LABEL } from "@/lib/constants/status";
import { formatDate, formatEventTime } from "@/lib/formatting";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { DeadlineBadge } from "@/components/ui/display";
import { EmptyState } from "@/components/feedback/states";
import type { Client, ID, PartnerRequest, Process } from "@/types";
import { clientDisplayName } from "@/features/processes/utils";

/**
 * Lista de solicitações (PartnerRequest). Usada no ambiente interno e no
 * portal do parceiro — o conteúdo já chega recortado pelo escopo.
 */
export function PartnerRequestList({
  requests,
  clientMap,
  processMap,
  partnerNames,
  actions,
  emptyText = "Nenhuma solicitação.",
  hrefForProcess = (id) => `/processos/${id}`,
}: {
  requests: PartnerRequest[];
  clientMap: Map<ID, Client>;
  processMap: Map<ID, Process>;
  /** Exibe o parceiro de cada solicitação (visão interna consolidada). */
  partnerNames?: Map<ID, string>;
  actions?: (request: PartnerRequest) => ReactNode;
  emptyText?: string;
  hrefForProcess?: (id: ID) => string;
}) {
  if (requests.length === 0) return <EmptyState compact icon={MessageSquareText} title={emptyText} />;
  return (
    <ul className="divide-y divide-line">
      {requests.map((r) => {
        const client = r.clientId ? clientMap.get(r.clientId) : undefined;
        const process = r.processId ? processMap.get(r.processId) : undefined;
        const lastMessage = r.messages[r.messages.length - 1];
        return (
          <li key={r.id} className="px-5 py-3.5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={r.status} labels={PARTNER_REQUEST_STATUS_LABEL} tones={PARTNER_REQUEST_STATUS_TONE} />
                  <Badge tone="neutral">{PARTNER_REQUEST_TYPE_LABEL[r.type]}</Badge>
                  {partnerNames && <span className="text-[12px] font-medium text-navy-700">{partnerNames.get(r.partnerOfficeId)}</span>}
                </div>
                <p className="mt-1.5 text-[13.5px] font-semibold text-foreground">{r.title}</p>
                <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{r.description}</p>
                <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-muted">
                  {client && <span>Cliente: {clientDisplayName(client)}</span>}
                  {process && (
                    <Link href={hrefForProcess(process.id)} className="text-navy-700 hover:underline underline-offset-2">
                      Processo: {process.title}
                    </Link>
                  )}
                  <span>
                    Criado por {r.createdBy.name} em {formatDate(r.createdAt)}
                  </span>
                </p>
                {lastMessage && (
                  <p className="mt-2 rounded-md border border-line bg-surface-muted px-3 py-2 text-[12.5px] text-foreground/80">
                    <span className="font-medium">{lastMessage.side === "PARTNER" ? "Resposta do parceiro" : "Bárbara Cardoso Advocacia"}</span> ·{" "}
                    {formatEventTime(lastMessage.at)}: {lastMessage.message}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2">
                {r.dueDate && r.status === "OPEN" && (
                  <span className="flex items-center gap-1.5 text-[11.5px] text-muted">
                    Prazo recomendado <DeadlineBadge dueDate={r.dueDate} />
                  </span>
                )}
                {actions?.(r)}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
