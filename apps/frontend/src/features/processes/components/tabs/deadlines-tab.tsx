"use client";

import { useMemo, useState } from "react";
import { CalendarCheck, CalendarPlus, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { DEADLINE_STATUS_LABEL, DEADLINE_STATUS_TONE, DEADLINE_TYPE_LABEL, DEADLINE_URGENCY_LABEL, DEADLINE_URGENCY_TONE } from "@/lib/constants/status";
import { deadlineUrgency, formatDate, formatDateTime } from "@/lib/formatting";
import type { ActionResult } from "@/lib/actions/result";
import { Can } from "@/components/layout/guards";
import { ActionErrorState } from "@/components/feedback/action-error";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { DeadlineBadge } from "@/components/ui/display";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { TONE_BORDER_LEFT, TONE_TEXT } from "@/components/ui/tone";
import { EmptyState } from "@/components/feedback/states";
import type { Page } from "@/server/core/pagination";
import type { DeadlineDTO } from "@/server/domain/processes/deadlines/dto";
import { usePermission } from "@/features/auth/hooks";
import { useDirectoryUserMap } from "@/features/directory/directory-context";
import { DeadlineActionDialog, DeadlineAgentMark, deadlineHasTime, DeadlineRowActions, HearingInfo, type DeadlineActionRequest } from "../deadline-actions";

/**
 * Prazos do processo. A situação vem do banco (`effectiveStatus`: "Vencido"
 * é derivado, nunca gravado); a urgência é só apresentação. Cumprir, cancelar,
 * marcar como perdido e reabrir pedem confirmação (deadline-actions).
 */
export function DeadlinesTab({
  deadlines,
  onAdd,
  onEdit,
}: {
  deadlines: ActionResult<Page<DeadlineDTO>>;
  onAdd: () => void;
  onEdit: (deadline: DeadlineDTO) => void;
}) {
  const users = useDirectoryUserMap();
  const canEdit = usePermission("processes.edit");
  const [action, setAction] = useState<DeadlineActionRequest | null>(null);
  const items = useMemo(() => (deadlines.ok ? deadlines.data.items : []), [deadlines]);
  const { open, done } = useMemo(
    () => ({
      open: items.filter((d) => d.status === "OPEN").sort((a, b) => a.dueAt.localeCompare(b.dueAt)),
      done: items.filter((d) => d.status !== "OPEN").sort((a, b) => (b.statusChangedAt ?? b.completedAt ?? b.updatedAt).localeCompare(a.statusChangedAt ?? a.completedAt ?? a.updatedAt)),
    }),
    [items],
  );

  if (!deadlines.ok) return <ActionErrorState error={deadlines} title="Não foi possível carregar os prazos." />;

  return (
    <div className="space-y-5">
      <Panel>
        <PanelHeader
          title="Prazos em aberto"
          as="h3"
          description="Ordenados pela data do prazo. Hoje e vencidos em vermelho, amanhã em laranja, até 5 dias em amarelo."
          actions={
            <div className="flex items-center gap-2">
              <ButtonLink href="/prazos" variant="ghost" size="sm">
                Ver a agenda do escritório
              </ButtonLink>
              <Can permission="processes.edit">
                <Button size="sm" icon={<CalendarPlus className="size-3.5" aria-hidden />} onClick={onAdd}>
                  Adicionar prazo
                </Button>
              </Can>
            </div>
          }
        />
        {open.length === 0 ? (
          <EmptyState compact icon={CalendarCheck} title="Nenhum prazo em aberto." description="Prazos adicionados pela equipe ou lançados pelos agentes aparecem aqui." />
        ) : (
          <Table caption="Prazos em aberto do processo">
            <THead>
              <tr>
                <Th>Prazo</Th>
                <Th>Tipo</Th>
                <Th>Data do prazo</Th>
                <Th>Responsável</Th>
                <Th>Urgência</Th>
                <Th>Situação</Th>
                <Th className="text-right">
                  <span className="sr-only">Ações</span>
                </Th>
              </tr>
            </THead>
            <TBody>
              {open.map((d) => {
                const urgency = deadlineUrgency(d.dueDateLocal);
                const tone = DEADLINE_URGENCY_TONE[urgency];
                return (
                  <Tr key={d.id}>
                    <Td className={cn("border-l-2", tone === "neutral" ? "border-l-transparent" : TONE_BORDER_LEFT[tone])}>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-foreground">{d.title}</span>
                        <DeadlineAgentMark deadline={d} canCheck={canEdit} />
                      </div>
                      {d.description && <div className="mt-0.5 max-w-[360px] truncate text-[12px] text-muted">{d.description}</div>}
                      <HearingInfo deadline={d} />
                    </Td>
                    <Td className="text-[12.5px] text-muted">{DEADLINE_TYPE_LABEL[d.type]}</Td>
                    <Td>
                      <div className="flex items-center gap-2 whitespace-nowrap">
                        <span className="tabular">
                          {formatDate(d.dueDateLocal)}
                          {deadlineHasTime(d) ? ` às ${d.dueTimeLocal}` : ""}
                        </span>
                        <DeadlineBadge dueDate={d.dueDateLocal} />
                      </div>
                    </Td>
                    <Td className="text-[12.5px]">{(d.responsibleUserId && users.get(d.responsibleUserId)?.name) || "—"}</Td>
                    <Td className={cn("whitespace-nowrap text-[12.5px] font-medium", TONE_TEXT[tone])}>{DEADLINE_URGENCY_LABEL[urgency]}</Td>
                    <Td>
                      {d.effectiveStatus === "OVERDUE" ? <Badge tone="danger">Vencido</Badge> : <StatusBadge status={d.status} labels={DEADLINE_STATUS_LABEL} tones={DEADLINE_STATUS_TONE} />}
                    </Td>
                    <Td className="text-right">
                      <Can permission="processes.edit">
                        <DeadlineRowActions deadline={d} onEdit={onEdit} onAction={setAction} />
                      </Can>
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
            Encerrados
            <span className="rounded-xs bg-surface-sunken px-1.5 text-[11px] font-medium text-muted tabular">{done.length}</span>
          </summary>
          <div className="border-t border-line">
            <Table caption="Prazos encerrados">
              <THead>
                <tr>
                  <Th>Prazo</Th>
                  <Th>Tipo</Th>
                  <Th>Data do prazo</Th>
                  <Th>Responsável</Th>
                  <Th>Situação</Th>
                  <Th className="text-right">
                    <span className="sr-only">Ações</span>
                  </Th>
                </tr>
              </THead>
              <TBody>
                {done.map((d) => (
                  <Tr key={d.id} className="text-muted">
                    <Td>
                      <div className="flex flex-wrap items-center gap-2">
                        <span>{d.title}</span>
                        <DeadlineAgentMark deadline={d} canCheck={false} />
                      </div>
                      {d.statusReason && <div className="mt-0.5 max-w-[420px] truncate text-[12px]" title={d.statusReason}>Motivo: {d.statusReason}</div>}
                    </Td>
                    <Td className="text-[12.5px]">{DEADLINE_TYPE_LABEL[d.type]}</Td>
                    <Td className="tabular">{formatDate(d.dueDateLocal)}</Td>
                    <Td className="text-[12.5px]">{(d.responsibleUserId && users.get(d.responsibleUserId)?.name) || "—"}</Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <StatusBadge status={d.status} labels={DEADLINE_STATUS_LABEL} tones={DEADLINE_STATUS_TONE} />
                        {(d.completedAt ?? d.statusChangedAt) && <span className="text-[12px] tabular">{formatDateTime(d.completedAt ?? d.statusChangedAt)}</span>}
                      </div>
                    </Td>
                    <Td className="text-right">
                      <Can permission="processes.edit">
                        <DeadlineRowActions deadline={d} onEdit={onEdit} onAction={setAction} />
                      </Can>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </div>
        </details>
      )}
      {deadlines.data.total > items.length && (
        <p className="px-1 text-[12px] text-muted">
          Mostrando {items.length} de {deadlines.data.total} prazos. Os demais estão na agenda do escritório.
        </p>
      )}
      {action && <DeadlineActionDialog key={`${action.kind}:${action.deadline.id}`} request={action} onClose={() => setAction(null)} />}
    </div>
  );
}
