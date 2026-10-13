"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Send } from "lucide-react";
import { PARTNER_REQUEST_STATUS_LABEL, PARTNER_REQUEST_STATUS_TONE, PARTNER_REQUEST_TYPE_LABEL } from "@/lib/constants/status";
import { cn } from "@/lib/cn";
import { formatDate, formatEventTime } from "@/lib/formatting";
import { callAction, type ActionResult } from "@/lib/actions/result";
import { ActionErrorState } from "@/components/feedback/action-error";
import { Callout, SkeletonRows } from "@/components/feedback/states";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/form";
import { getPartnerRequestAction } from "@/server/domain/partner-requests/actions";
import type { PartnerRequestDetailDTO } from "@/server/domain/partner-requests/dto";
import { usePermission } from "@/features/auth/hooks";
import { useOrgDirectory } from "@/features/directory/directory-context";
import { useRequestActions } from "../use-request-actions";

/**
 * Conversa de uma solicitação, lida do servidor ao abrir. Parceiro responde
 * enquanto ela está aberta; a equipe comenta, pede nova resposta (reabre) ou
 * encerra. Solicitação encerrada não recebe mensagem (regra do banco).
 */
export function RequestThreadDialog({ requestId, onClose }: { requestId: string; onClose: () => void }) {
  const actions = useRequestActions();
  const canManage = usePermission("partnerRequests.manage");
  const { owner } = useOrgDirectory();
  const [detail, setDetail] = useState<ActionResult<PartnerRequestDetailDTO> | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let alive = true;
    void callAction(() => getPartnerRequestAction({ id: requestId })).then((r) => alive && setDetail(r));
    return () => {
      alive = false;
    };
  }, [requestId, version]);

  const request = detail?.ok ? detail.data.request : undefined;
  const surface = detail?.ok ? detail.data.surface : undefined;
  const closed = request ? request.status === "RESOLVED" || request.status === "CANCELLED" : true;
  // Parceiro responde só solicitação ABERTA; a equipe escreve em aberta ou respondida.
  const canWrite = !!request && !closed && (surface === "INTERNAL" ? canManage : request.status === "OPEN");

  async function send(reopen: boolean) {
    if (!text.trim()) {
      setError("Escreva a mensagem.");
      return;
    }
    setBusy(reopen ? "reopen" : "send");
    const r = await actions.message(requestId, text.trim(), reopen);
    setBusy(null);
    if (r.ok) {
      setText("");
      setError(undefined);
      setVersion((v) => v + 1);
    } else setError(r.error.fieldErrors?.message?.[0]);
  }

  async function close(resolution: "RESOLVED" | "CANCELLED") {
    setBusy(resolution);
    const r = await actions.close(requestId, resolution);
    setBusy(null);
    if (r.ok) onClose();
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !busy && onClose()}
      size="lg"
      title={request?.title ?? "Solicitação"}
      description={request ? `${PARTNER_REQUEST_TYPE_LABEL[request.type]} · aberta em ${formatDate(request.createdAt)}` : undefined}
      footer={
        surface === "INTERNAL" && canManage && !closed ? (
          <>
            <Button variant="ghost" onClick={() => close("CANCELLED")} loading={busy === "CANCELLED"} disabled={!!busy}>
              Cancelar solicitação
            </Button>
            <Button variant="secondary" onClick={() => close("RESOLVED")} loading={busy === "RESOLVED"} disabled={!!busy}>
              Marcar resolvida
            </Button>
          </>
        ) : undefined
      }
    >
      {!detail ? (
        <SkeletonRows rows={3} />
      ) : !detail.ok ? (
        <ActionErrorState error={detail} title="Não foi possível abrir a solicitação." />
      ) : (
        request && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
              <StatusBadge status={request.status} labels={PARTNER_REQUEST_STATUS_LABEL} tones={PARTNER_REQUEST_STATUS_TONE} />
              {request.dueDate && <span>Prazo recomendado: {formatDate(request.dueDate)}</span>}
              <Link href={`/casos/${request.legalCaseId}`} className="text-navy-700 hover:underline underline-offset-2">
                Caso: {request.caseTitle ?? "abrir"}
              </Link>
            </div>
            {request.description && <p className="whitespace-pre-line text-[13px] text-foreground">{request.description}</p>}
            <ol className="space-y-2.5" aria-label="Conversa">
              {request.messages.length === 0 && <li className="text-[12.5px] text-muted">Nenhuma mensagem ainda.</li>}
              {request.messages.map((m) => {
                const author = "author" in m ? m.author.name : m.authorName;
                return (
                  <li
                    key={m.id}
                    className={cn("rounded-md border px-3 py-2 text-[13px]", m.side === "PARTNER" ? "border-line bg-surface" : "border-navy-100 bg-navy-50/40")}
                  >
                    <p className="mb-1 flex flex-wrap items-center gap-2 text-[11.5px] text-muted">
                      <Badge tone={m.side === "PARTNER" ? "gold" : "navy"}>{m.side === "PARTNER" ? "Parceiro" : owner.name || "Escritório"}</Badge>
                      <span>{author}</span>
                      <span>{formatEventTime(m.at)}</span>
                    </p>
                    <p className="whitespace-pre-line text-foreground">{m.message}</p>
                  </li>
                );
              })}
            </ol>
            {closed ? (
              <Callout tone="neutral">Solicitação encerrada: não recebe novas mensagens.</Callout>
            ) : canWrite ? (
              <div className="space-y-2">
                <Field label={surface === "PARTNER" ? "Sua resposta" : "Mensagem ao parceiro"} requirement="required" error={error}>
                  {(p) => <Textarea {...p} rows={3} maxLength={5000} value={text} onChange={(e) => setText(e.target.value)} />}
                </Field>
                <div className="flex justify-end gap-2">
                  {surface === "INTERNAL" && request.status === "ANSWERED" && (
                    <Button variant="secondary" loading={busy === "reopen"} disabled={!!busy} onClick={() => send(true)}>
                      Pedir nova resposta
                    </Button>
                  )}
                  <Button icon={<Send className="size-4" aria-hidden />} loading={busy === "send"} disabled={!!busy} onClick={() => send(false)}>
                    {surface === "PARTNER" ? "Responder" : "Enviar mensagem"}
                  </Button>
                </div>
              </div>
            ) : (
              surface === "PARTNER" && <Callout tone="info">Resposta enviada. A equipe do escritório vai analisar.</Callout>
            )}
          </div>
        )
      )}
    </Dialog>
  );
}
