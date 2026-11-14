"use client";

import { useId, useState } from "react";
import { Ban, Bot, Check, CircleSlash, ExternalLink, MapPin, MoreHorizontal, Pencil, RotateCcw, ShieldCheck, Video } from "lucide-react";
import { DEADLINE_STATUS_LABEL, HEARING_MODE_LABEL } from "@/lib/constants/status";
import { formatDate, formatDateTime } from "@/lib/formatting";
import { Callout } from "@/components/feedback/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/form";
import { MenuButton, type MenuItem } from "@/components/ui/menu";
import type { DeadlineDTO } from "@/server/domain/processes/deadlines/dto";
import { useDirectoryUserMap } from "@/features/directory/directory-context";
import { useProcessActions } from "../use-process-actions";

/**
 * Ações de um prazo, iguais na aba Prazos do processo e na agenda (/prazos):
 * cumprir, cancelar (com motivo), marcar como perdido e reabrir (com motivo)
 * sempre passam por um diálogo de confirmação. A regra e a auditoria ficam no
 * servidor e no banco; aqui é só a conversa com a pessoa.
 */

export type DeadlineActionKind = "complete" | "cancel" | "miss" | "reopen";
export interface DeadlineActionRequest {
  kind: DeadlineActionKind;
  deadline: DeadlineDTO;
}

const REASON_MAX = 1000;

const COPY: Record<
  DeadlineActionKind,
  { title: string; confirm: string; reason: "required" | "optional" | "none"; reasonLabel: string; reasonError: string; body: string }
> = {
  complete: {
    title: "Marcar prazo como cumprido",
    confirm: "Marcar como cumprido",
    reason: "none",
    reasonLabel: "",
    reasonError: "",
    body: "O prazo sai da lista de pendentes e para de gerar lembretes. Se for engano, dá para reabrir depois, com o motivo.",
  },
  cancel: {
    title: "Cancelar prazo",
    confirm: "Cancelar prazo",
    reason: "required",
    reasonLabel: "Motivo do cancelamento",
    reasonError: "Informe o motivo do cancelamento.",
    body: "O prazo deixa de ser cobrado e para de gerar lembretes. O motivo fica registrado na auditoria.",
  },
  miss: {
    title: "Marcar prazo como perdido",
    confirm: "Marcar como perdido",
    reason: "optional",
    reasonLabel: "O que aconteceu",
    reasonError: "",
    body: "Use quando o prazo venceu sem o ato ter sido praticado. O prazo fica registrado como perdido e para de gerar lembretes.",
  },
  reopen: {
    title: "Reabrir prazo",
    confirm: "Reabrir prazo",
    reason: "required",
    reasonLabel: "Motivo da reabertura",
    reasonError: "Informe o motivo para reabrir o prazo.",
    body: "O prazo volta a ficar em aberto, com os lembretes. O motivo fica registrado na auditoria.",
  },
};

/** Confirmação de uma ação de prazo. Fecha sozinho no sucesso; erro de campo volta para o campo. */
export function DeadlineActionDialog({ request, onClose }: { request: DeadlineActionRequest; onClose: () => void }) {
  const { kind, deadline } = request;
  const copy = COPY[kind];
  const formId = useId();
  const { completeDeadline, cancelDeadline, missDeadline, reopenDeadline } = useProcessActions();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  async function confirm() {
    if (saving) return;
    const text = reason.trim();
    if (copy.reason === "required" && !text) {
      setError(copy.reasonError);
      return;
    }
    setSaving(true);
    const result =
      kind === "complete"
        ? await completeDeadline(deadline.id, deadline.title)
        : kind === "cancel"
          ? await cancelDeadline(deadline.id, deadline.title, text)
          : kind === "miss"
            ? await missDeadline(deadline.id, deadline.title, text || undefined)
            : await reopenDeadline(deadline.id, deadline.title, text);
    setSaving(false);
    if (result.ok) onClose();
    else if (result.error.fieldErrors?.reason) setError(result.error.fieldErrors.reason[0]);
  }

  const overdue = deadline.effectiveStatus === "OVERDUE";
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !saving && onClose()}
      title={copy.title}
      description={`“${deadline.title}”, com vencimento em ${formatDate(deadline.dueDateLocal)}.`}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Voltar
          </Button>
          <Button type="submit" form={formId} variant={kind === "cancel" || kind === "miss" ? "danger" : "primary"} loading={saving}>
            {copy.confirm}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        className="space-y-3 text-[13px]"
        onSubmit={(e) => {
          e.preventDefault();
          void confirm();
        }}
      >
        {kind === "reopen" && (
          <p className="text-muted">
            Situação atual: <strong className="text-foreground">{DEADLINE_STATUS_LABEL[deadline.status]}</strong>
            {deadline.statusReason ? `. Motivo registrado: ${deadline.statusReason}` : ""}
          </p>
        )}
        <p className="text-muted">{copy.body}</p>
        {kind === "complete" && overdue && <Callout tone="warning">Este prazo já venceu. Confirme que o ato foi praticado dentro do prazo antes de marcar como cumprido.</Callout>}
        {kind === "miss" && !overdue && (
          <Callout tone="danger" title="Este prazo ainda não venceu.">
            O vencimento é {formatDate(deadline.dueDateLocal)}
            {deadlineHasTime(deadline) ? ` às ${deadline.dueTimeLocal}` : ""}. Só marque como perdido se já não houver como praticar o ato. Se o prazo deixou de existir, use “Cancelar prazo”.
          </Callout>
        )}
        {copy.reason !== "none" && (
          <Field label={copy.reasonLabel} requirement={copy.reason === "required" ? "required" : "optional"} error={error}>
            {(a) => (
              <Textarea
                {...a}
                rows={3}
                maxLength={REASON_MAX}
                value={reason}
                autoFocus
                onChange={(e) => {
                  setReason(e.target.value);
                  if (error) setError(undefined);
                }}
              />
            )}
          </Field>
        )}
      </form>
    </Dialog>
  );
}

/**
 * Botões da linha: em aberto → "Cumprir" + menu (editar, cancelar, perdido);
 * encerrado → "Reabrir". Só para quem pode editar (o chamador envolve em <Can>).
 */
export function DeadlineRowActions({
  deadline,
  onEdit,
  onAction,
  disabled,
}: {
  deadline: DeadlineDTO;
  onEdit: (deadline: DeadlineDTO) => void;
  onAction: (request: DeadlineActionRequest) => void;
  disabled?: boolean;
}) {
  if (deadline.status !== "OPEN") {
    return (
      <Button size="sm" variant="secondary" icon={<RotateCcw className="size-3.5" aria-hidden />} disabled={disabled} onClick={() => onAction({ kind: "reopen", deadline })}>
        Reabrir
      </Button>
    );
  }
  const items: MenuItem[] = [
    { key: "edit", label: "Editar prazo", icon: <Pencil className="size-4" aria-hidden />, onSelect: () => onEdit(deadline) },
    { key: "cancel", label: "Cancelar prazo", description: "Pede o motivo.", icon: <Ban className="size-4" aria-hidden />, onSelect: () => onAction({ kind: "cancel", deadline }) },
    {
      key: "miss",
      label: "Prazo perdido",
      description: "Venceu sem o ato ter sido praticado.",
      icon: <CircleSlash className="size-4" aria-hidden />,
      onSelect: () => onAction({ kind: "miss", deadline }),
    },
  ];
  return (
    <div className="flex items-center justify-end gap-1.5">
      <Button size="sm" variant="secondary" icon={<Check className="size-3.5" aria-hidden />} disabled={disabled} onClick={() => onAction({ kind: "complete", deadline })}>
        Cumprir
      </Button>
      <MenuButton label="Mais" icon={<MoreHorizontal className="size-3.5" aria-hidden />} items={items} disabled={disabled} />
    </div>
  );
}

/**
 * Marca do prazo que nasceu de proposta de agente (direto ou aprovado em
 * Revisões): "Agente, sem conferência" até alguém clicar em "Conferido"; depois,
 * quem conferiu e quando.
 */
export function DeadlineAgentMark({ deadline, canCheck }: { deadline: DeadlineDTO; canCheck: boolean }) {
  const users = useDirectoryUserMap();
  const { markDeadlineChecked } = useProcessActions();
  const [saving, setSaving] = useState(false);
  if (deadline.source !== "AGENT") return null;
  if (!deadline.agentUnchecked) {
    const who = deadline.checkedByUserId ? users.get(deadline.checkedByUserId)?.name : undefined;
    return (
      <Badge tone="success" icon={<ShieldCheck className="size-3" aria-hidden />} title={`Prazo lançado por agente. Conferido${who ? ` por ${who}` : ""}${deadline.checkedAt ? ` em ${formatDateTime(deadline.checkedAt)}` : ""}.`}>
        Agente, conferido
      </Badge>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Badge tone="warning" icon={<Bot className="size-3" aria-hidden />} title="Prazo lançado por agente. Ninguém conferiu a contagem ainda.">
        Agente, sem conferência
      </Badge>
      {canCheck && deadline.status === "OPEN" && (
        <Button
          size="sm"
          variant="ghost"
          className="h-[22px] px-1.5 text-[11.5px] text-navy-700"
          loading={saving}
          onClick={async () => {
            setSaving(true);
            await markDeadlineChecked(deadline.id, deadline.title);
            setSaving(false);
          }}
        >
          Conferido
        </Button>
      )}
    </span>
  );
}

/** Hora do vencimento quando não é o "fim do dia" (audiência e prazos com hora). */
export function deadlineHasTime(deadline: Pick<DeadlineDTO, "dueTimeLocal">): boolean {
  return deadline.dueTimeLocal !== "23:59";
}

/** Audiência: modalidade, local e link. Nada aparece nos outros tipos. */
export function HearingInfo({ deadline }: { deadline: DeadlineDTO }) {
  if (deadline.type !== "HEARING" || (!deadline.hearingMode && !deadline.hearingLocation && !deadline.hearingLink)) return null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
      {deadline.hearingMode && (
        <span className="inline-flex items-center gap-1">
          {deadline.hearingMode === "VIDEO" ? <Video className="size-3.5" aria-hidden /> : <MapPin className="size-3.5" aria-hidden />}
          {HEARING_MODE_LABEL[deadline.hearingMode]}
        </span>
      )}
      {deadline.hearingLocation && <span className="max-w-[320px] truncate" title={deadline.hearingLocation}>{deadline.hearingLocation}</span>}
      {deadline.hearingLink && (
        <a href={deadline.hearingLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-navy-700 hover:underline">
          Abrir a sala <ExternalLink className="size-3" aria-hidden />
        </a>
      )}
    </div>
  );
}
