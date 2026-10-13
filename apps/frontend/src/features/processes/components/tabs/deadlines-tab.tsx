"use client";

import { useMemo, useState } from "react";
import { Ban, CalendarCheck, CalendarPlus, Check, ChevronRight, Pencil } from "lucide-react";
import { cn } from "@/lib/cn";
import { DEADLINE_STATUS_LABEL, DEADLINE_STATUS_TONE, DEADLINE_TYPE_LABEL, DEADLINE_URGENCY_LABEL, DEADLINE_URGENCY_TONE } from "@/lib/constants/status";
import { deadlineUrgency, formatDate, formatDateTime } from "@/lib/formatting";
import type { ActionResult } from "@/lib/actions/result";
import { Can } from "@/components/layout/guards";
import { ActionErrorState } from "@/components/feedback/action-error";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { DeadlineBadge } from "@/components/ui/display";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { TONE_BORDER_LEFT, TONE_TEXT } from "@/components/ui/tone";
import { EmptyState } from "@/components/feedback/states";
import type { Page } from "@/server/core/pagination";
import type { DeadlineDTO } from "@/server/domain/processes/deadlines/dto";
import { useDirectoryUserMap } from "@/features/directory/directory-context";
import { useProcessActions } from "../../use-process-actions";

/**
 * Prazos do processo. A situação vem do banco (`effectiveStatus`: "Vencido"
 * é derivado na view, nunca gravado); a urgência é só apresentação.
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
  const { completeDeadline, cancelDeadline } = useProcessActions();
  const [busy, setBusy] = useState<string | null>(null);
  const items = useMemo(() => (deadlines.ok ? deadlines.data.items : []), [deadlines]);
  const { open, done } = useMemo(
    () => ({
      open: items.filter((d) => d.status === "OPEN").sort((a, b) => a.dueAt.localeCompare(b.dueAt)),
      done: items.filter((d) => d.status !== "OPEN").sort((a, b) => (b.completedAt ?? b.updatedAt).localeCompare(a.completedAt ?? a.updatedAt)),
    }),
    [items],
  );

  async function act(id: string, run: () => Promise<unknown>) {
    setBusy(id);
    await run();
    setBusy(null);
  }

  if (!deadlines.ok) return <ActionErrorState error={deadlines} title="Não foi possível carregar os prazos." />;

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
                      <div className="font-medium text-foreground">{d.title}</div>
                      {d.description && <div className="mt-0.5 max-w-[360px] truncate text-[12px] text-muted">{d.description}</div>}
                    </Td>
                    <Td className="text-[12.5px] text-muted">{DEADLINE_TYPE_LABEL[d.type]}</Td>
                    <Td>
                      <div className="flex items-center gap-2 whitespace-nowrap">
                        <span className="tabular">{formatDate(d.dueDateLocal)}</span>
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
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="sm"
                            variant="secondary"
                            icon={<Check className="size-3.5" aria-hidden />}
                            loading={busy === d.id}
                            disabled={!!busy}
                            onClick={() => act(d.id, () => completeDeadline(d.id, d.title))}
                          >
                            Marcar como cumprido
                          </Button>
                          <IconButton label={`Editar prazo ${d.title}`} size="sm" disabled={!!busy} onClick={() => onEdit(d)}>
                            <Pencil className="size-3.5" aria-hidden />
                          </IconButton>
                          <IconButton label={`Cancelar prazo ${d.title}`} size="sm" disabled={!!busy} onClick={() => act(d.id, () => cancelDeadline(d.id, d.title))}>
                            <Ban className="size-3.5" aria-hidden />
                          </IconButton>
                        </div>
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
                  <Th>Vencimento</Th>
                  <Th>Responsável</Th>
                  <Th>Situação</Th>
                </tr>
              </THead>
              <TBody>
                {done.map((d) => (
                  <Tr key={d.id} className="text-muted">
                    <Td>{d.title}</Td>
                    <Td className="text-[12.5px]">{DEADLINE_TYPE_LABEL[d.type]}</Td>
                    <Td className="tabular">{formatDate(d.dueDateLocal)}</Td>
                    <Td className="text-[12.5px]">{(d.responsibleUserId && users.get(d.responsibleUserId)?.name) || "—"}</Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <StatusBadge status={d.status} labels={DEADLINE_STATUS_LABEL} tones={DEADLINE_STATUS_TONE} />
                        {d.completedAt && <span className="text-[12px] tabular">{formatDateTime(d.completedAt)}</span>}
                      </div>
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
          Mostrando {items.length} de {deadlines.data.total} prazos.
        </p>
      )}
    </div>
  );
}
