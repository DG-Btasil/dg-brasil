"use client";

import { useMemo } from "react";
import { CalendarCheck, CalendarPlus, Check, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  DEADLINE_STATUS_LABEL,
  DEADLINE_STATUS_TONE,
  DEADLINE_TYPE_LABEL,
  DEADLINE_URGENCY_LABEL,
  DEADLINE_URGENCY_TONE,
} from "@/lib/constants/status";
import { deadlineUrgency, formatDate, formatDateTime } from "@/lib/formatting";
import { Can } from "@/components/layout/guards";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DeadlineBadge } from "@/components/ui/display";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { TONE_BORDER_LEFT, TONE_TEXT } from "@/components/ui/tone";
import { EmptyState } from "@/components/feedback/states";
import { useUserMap } from "@/features/offices/hooks";
import type { Deadline } from "@/types";
import { useProcessActions } from "../../hooks";

export function DeadlinesTab({ deadlines, onAdd }: { deadlines: Deadline[]; onAdd: () => void }) {
  const userMap = useUserMap();
  const { completeDeadline } = useProcessActions();

  const { open, done } = useMemo(
    () => ({
      open: deadlines.filter((d) => d.status !== "COMPLETED").sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
      done: deadlines.filter((d) => d.status === "COMPLETED").sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? "")),
    }),
    [deadlines],
  );

  return (
    <div className="space-y-5">
      <Panel>
        <PanelHeader
          title="Prazos em aberto"
          as="h3"
          description="Ordenados pelo vencimento. Hoje e vencidos em vermelho, amanhã em laranja, até 5 dias em amarelo."
          actions={
            <Can permission="processes.edit">
              <Button size="sm" icon={<CalendarPlus className="size-3.5" aria-hidden />} onClick={onAdd}>
                Adicionar prazo
              </Button>
            </Can>
          }
        />
        {open.length === 0 ? (
          <EmptyState compact icon={CalendarCheck} title="Nenhum prazo em aberto." description="Prazos adicionados pela equipe ou confirmados em Revisões aparecem aqui." />
        ) : (
          <Table caption="Prazos em aberto do processo">
            <THead>
              <tr>
                <Th>Prazo</Th>
                <Th>Tipo</Th>
                <Th>Vencimento</Th>
                <Th>Responsável</Th>
                <Th>Urgência</Th>
                <Th>Status</Th>
                <Th className="text-right">
                  <span className="sr-only">Ações</span>
                </Th>
              </tr>
            </THead>
            <TBody>
              {open.map((d) => {
                const urgency = deadlineUrgency(d.dueDate);
                const tone = DEADLINE_URGENCY_TONE[urgency];
                return (
                  <Tr key={d.id}>
                    <Td className={cn("border-l-2", tone === "neutral" ? "border-l-transparent" : TONE_BORDER_LEFT[tone])}>
                      <div className="font-medium text-foreground">{d.title}</div>
                      {d.notes && <div className="mt-0.5 max-w-[360px] truncate text-[12px] text-muted">{d.notes}</div>}
                    </Td>
                    <Td className="text-[12.5px] text-muted">{DEADLINE_TYPE_LABEL[d.type]}</Td>
                    <Td>
                      <div className="flex items-center gap-2 whitespace-nowrap">
                        <span className="tabular">{formatDate(d.dueDate)}</span>
                        <DeadlineBadge dueDate={d.dueDate} />
                      </div>
                    </Td>
                    <Td className="text-[12.5px]">{userMap.get(d.responsibleUserId)?.name ?? "—"}</Td>
                    <Td className={cn("whitespace-nowrap text-[12.5px] font-medium", TONE_TEXT[tone])}>{DEADLINE_URGENCY_LABEL[urgency]}</Td>
                    <Td>
                      <StatusBadge status={d.status} labels={DEADLINE_STATUS_LABEL} tones={DEADLINE_STATUS_TONE} />
                    </Td>
                    <Td className="text-right">
                      {d.status === "OPEN" && (
                        <Can permission="processes.edit">
                          <Button size="sm" variant="secondary" icon={<Check className="size-3.5" aria-hidden />} onClick={() => completeDeadline(d)}>
                            Marcar como cumprido
                          </Button>
                        </Can>
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        )}
      </Panel>

      {done.length > 0 && (
        <details className="group rounded-lg border border-line bg-surface shadow-hairline">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3 text-[13px] font-semibold text-foreground [&::-webkit-details-marker]:hidden">
            <ChevronRight className="size-4 text-subtle transition-transform group-open:rotate-90" aria-hidden />
            Cumpridos
            <span className="rounded-xs bg-surface-sunken px-1.5 text-[11px] font-medium text-muted tabular">{done.length}</span>
          </summary>
          <div className="border-t border-line">
            <Table caption="Prazos cumpridos">
              <THead>
                <tr>
                  <Th>Prazo</Th>
                  <Th>Tipo</Th>
                  <Th>Vencimento</Th>
                  <Th>Responsável</Th>
                  <Th>Cumprido em</Th>
                </tr>
              </THead>
              <TBody>
                {done.map((d) => (
                  <Tr key={d.id} className="text-muted">
                    <Td>{d.title}</Td>
                    <Td className="text-[12.5px]">{DEADLINE_TYPE_LABEL[d.type]}</Td>
                    <Td className="tabular">{formatDate(d.dueDate)}</Td>
                    <Td className="text-[12.5px]">{userMap.get(d.responsibleUserId)?.name ?? "—"}</Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <DeadlineBadge dueDate={d.dueDate} done />
                        <span className="text-[12px] tabular">{formatDateTime(d.completedAt)}</span>
                      </div>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </div>
        </details>
      )}
    </div>
  );
}
