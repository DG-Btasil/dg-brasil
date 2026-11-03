"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CalendarPlus, ExternalLink, FileCheck2, RotateCcw, XCircle } from "lucide-react";
import { ActionErrorState } from "@/components/feedback/action-error";
import { Callout, SkeletonRows } from "@/components/feedback/states";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { DefinitionGrid } from "@/components/ui/panel";
import { callAction, type ActionResult } from "@/lib/actions/result";
import { useActionFeedback } from "@/lib/actions/use-action-feedback";
import { formatCNJ, formatDate, formatEventTime } from "@/lib/formatting";
import { useCan } from "@/features/auth/hooks";
import { useDirectoryUser, useResponsibleUserOptions } from "@/features/directory/directory-context";
import {
  createDeadlineFromPublicationAction, decideJudicialPublicationAction, getJudicialPublicationAction, previewJudicialDeadlineAction,
} from "@/server/domain/judicial/actions";
import type { DeadlineCountDTO, JudicialPublicationDetailDTO } from "@/server/domain/judicial/dto";
import { useToast } from "@/store/ui-store";
import { DEADLINE_TYPE_OPTIONS, TRIAGE_LABEL, TRIAGE_TONE } from "../labels";

type Mode = "view" | "deadline" | "no-deadline" | "reopen";

/**
 * Uma publicação do DJEN: teor, contagem sugerida e a decisão humana — criar o
 * prazo (já com a contagem em dias úteis) ou registrar que não há prazo.
 * Proposta do agente, quando houver, é decidida em Revisões.
 */
export function PublicationDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const can = useCan();
  const [data, setData] = useState<ActionResult<JudicialPublicationDetailDTO> | null>(null);
  const [mode, setMode] = useState<Mode>("view");
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let alive = true;
    callAction(() => getJudicialPublicationAction({ id })).then((r) => alive && setData(r));
    return () => {
      alive = false;
    };
  }, [id, version]);

  const done = () => {
    setMode("view");
    setVersion((v) => v + 1);
    onChanged();
  };
  const p = data?.ok ? data.data : null;
  const canDecide = can("processes.edit");

  return (
    <Drawer open onOpenChange={(o) => !o && onClose()} width={680} title={p ? `Publicação — ${p.processTitle ?? formatCNJ(p.cnjNumber)}` : "Publicação"} description={p ? `${p.court ?? ""} · disponibilizada em ${formatDate(p.availableOn)}` : undefined}>
      {!data ? (
        <SkeletonRows rows={6} />
      ) : !data.ok ? (
        <ActionErrorState error={data} title="Não foi possível abrir a publicação." />
      ) : (
        p && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={p.triageStatus} labels={TRIAGE_LABEL} tones={TRIAGE_TONE} />
              {p.communicationType && <Badge tone="navy">{p.communicationType}</Badge>}
              {p.cancelledAt && <Badge tone="danger">Cancelada pelo tribunal</Badge>}
            </div>
            {p.cancelledAt && (
              <Callout tone="danger" title="O tribunal cancelou esta publicação">
                {p.cancelReason ?? "Sem motivo informado."} Confira se o prazo criado a partir dela ainda vale.
              </Callout>
            )}
            <DefinitionGrid
              items={[
                {
                  label: "Processo",
                  value: (
                    <Link href={`/processos/${p.legalProcessId}`} className="font-medium text-navy hover:underline underline-offset-2">
                      <span className="tabular">{formatCNJ(p.cnjNumber)}</span>
                    </Link>
                  ),
                },
                { label: "Cliente", value: p.clientName ?? "—" },
                { label: "Órgão", value: p.organ ?? "—" },
                { label: "Classe", value: p.className ?? "—" },
                { label: "Encontrada pela OAB", value: p.foundBy.join(", ") || "—" },
                { label: "Capturada em", value: formatEventTime(p.capturedAt) },
              ]}
            />
            <div className="flex flex-wrap gap-2">
              {p.link && (
                <a href={p.link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-navy hover:underline underline-offset-2">
                  <ExternalLink className="size-3.5" aria-hidden /> Íntegra no tribunal
                </a>
              )}
              {p.certificateUrl && (
                <a href={p.certificateUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-navy hover:underline underline-offset-2">
                  <FileCheck2 className="size-3.5" aria-hidden /> Certidão do DJEN
                </a>
              )}
            </div>

            <div>
              <p className="mb-1.5 text-[11.5px] font-medium uppercase tracking-[0.06em] text-subtle">Teor</p>
              <div className="max-h-[320px] overflow-y-auto whitespace-pre-line rounded-md border border-line bg-surface-muted p-3 text-[13px] leading-relaxed text-foreground">
                {p.content}
              </div>
            </div>

            <TriageBlock p={p} />

            {canDecide && mode === "view" && (
              <div className="flex flex-wrap gap-2 border-t border-line pt-4">
                {p.triageStatus !== "DONE" ? (
                  <>
                    <Button icon={<CalendarPlus className="size-4" aria-hidden />} onClick={() => setMode("deadline")}>
                      Criar prazo
                    </Button>
                    <Button variant="secondary" icon={<XCircle className="size-4" aria-hidden />} onClick={() => setMode("no-deadline")}>
                      Não há prazo
                    </Button>
                  </>
                ) : (
                  <Button variant="secondary" icon={<RotateCcw className="size-4" aria-hidden />} onClick={() => setMode("reopen")}>
                    Reabrir
                  </Button>
                )}
              </div>
            )}
            {mode === "deadline" && <DeadlineForm p={p} onCancel={() => setMode("view")} onDone={done} />}
            {(mode === "no-deadline" || mode === "reopen") && <DecideForm p={p} action={mode === "reopen" ? "REOPEN" : "NO_DEADLINE"} onCancel={() => setMode("view")} onDone={done} />}
          </div>
        )
      )}
    </Drawer>
  );
}

function TriageBlock({ p }: { p: JudicialPublicationDetailDTO }) {
  const by = useDirectoryUser(p.triagedBy);
  if (p.triageStatus === "WITH_AGENT") {
    return (
      <Callout tone="info" title="O agente está propondo o prazo">
        A publicação virou um trabalho do agente no computador do escritório.
        {p.pendingReviewId ? (
          <>
            {" "}
            A proposta já chegou:{" "}
            <Link href={`/revisoes/${p.pendingReviewId}`} className="font-medium underline underline-offset-2">
              decidir em Revisões
            </Link>
            .
          </>
        ) : (
          " Quando a proposta chegar, ela aparece em Revisões; você também pode criar o prazo aqui mesmo."
        )}
      </Callout>
    );
  }
  if (p.triageStatus === "DONE") {
    return (
      <Callout tone={p.triageOutcome === "DEADLINE" ? "success" : "neutral"} title={p.triageOutcome === "DEADLINE" ? "Prazo criado" : "Sem prazo"}>
        {p.deadline && (
          <>
            <Link href={`/processos/${p.legalProcessId}?aba=prazos`} className="font-medium underline underline-offset-2">
              {p.deadline.title}
            </Link>{" "}
            — vence em {formatEventTime(p.deadline.dueAt)}.{" "}
          </>
        )}
        {p.triageNotes && <span className="block">{p.triageNotes}</span>}
        <span className="mt-1 block text-[12px] text-muted">
          {by?.name ?? "—"} · {p.triagedAt ? formatEventTime(p.triagedAt) : ""}
        </span>
      </Callout>
    );
  }
  return p.agentError ? <Callout tone="warning">{p.agentError}</Callout> : null;
}

function DeadlineForm({ p, onCancel, onDone }: { p: JudicialPublicationDetailDTO; onCancel: () => void; onDone: () => void }) {
  const failed = useActionFeedback();
  const toast = useToast();
  const responsibleOptions = useResponsibleUserOptions();
  const [days, setDays] = useState("15");
  const [count, setCount] = useState<DeadlineCountDTO>(p.suggestion);
  const [dueOn, setDueOn] = useState(p.suggestion.dueOn);
  const [title, setTitle] = useState(`${p.communicationType ?? "Manifestação"} — ${formatDate(p.availableOn)}`);
  const [type, setType] = useState("MANIFESTATION");
  const [responsible, setResponsible] = useState(p.responsibleUserId ?? "");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  async function recount(value: string) {
    setDays(value);
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > 120) return;
    const r = await callAction(() => previewJudicialDeadlineAction({ availableOn: p.availableOn, court: p.court, businessDays: n }));
    if (r.ok) {
      setCount(r.data);
      setDueOn(r.data.dueOn);
    }
  }

  async function save() {
    setSaving(true);
    const r = await callAction(() =>
      createDeadlineFromPublicationAction({
        id: p.id, title, dueOn, deadlineType: type, priority: "HIGH", responsibleUserId: responsible || undefined,
        description: `Publicação do DJEN disponibilizada em ${formatDate(p.availableOn)} (${p.court ?? "tribunal"}), publicada em ${formatDate(count.publishedOn)}. Contagem: ${count.businessDays} dias úteis a partir do dia seguinte à publicação.`,
        notes: notes || undefined,
      }),
    );
    setSaving(false);
    if (!r.ok) return failed(r, "Não foi possível criar o prazo.");
    toast({ tone: "success", title: "Prazo criado", description: `Vence em ${formatDate(dueOn)}.` });
    onDone();
  }

  return (
    <div className="space-y-4 rounded-md border border-line p-4">
      <p className="text-[13px] font-semibold text-foreground">Criar prazo a partir desta publicação</p>
      <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-4">
        <Field label="Dias úteis" hint="15, 5…">
          {(a) => <Input {...a} type="number" min={1} max={120} value={days} onChange={(e) => recount(e.target.value)} />}
        </Field>
        <Field label="Vencimento" requirement="required" hint="Calculado; ajuste se o tribunal tiver feriado local não cadastrado.">
          {(a) => <Input {...a} type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />}
        </Field>
      </div>
      <p className="text-[12px] text-muted">
        Publicada em {formatDate(count.publishedOn)} (1º dia útil após a disponibilização); a contagem começa no dia útil seguinte.
        {count.skipped.length > 0 && ` Dias não contados: ${count.skipped.map((s) => `${formatDate(s.day)} (${s.reason})`).join("; ")}.`}
      </p>
      <Field label="Título" requirement="required">
        {(a) => <Input {...a} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />}
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Tipo">{(a) => <Select {...a} value={type} onChange={(e) => setType(e.target.value)} options={DEADLINE_TYPE_OPTIONS} />}</Field>
        <Field label="Responsável">{(a) => <Select {...a} value={responsible} onChange={(e) => setResponsible(e.target.value)} options={responsibleOptions} placeholder="Do processo" />}</Field>
      </div>
      <Field label="Observação" requirement="optional">
        {(a) => <Textarea {...a} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />}
      </Field>
      {p.triageStatus === "WITH_AGENT" && <Callout tone="warning">O agente também está propondo um prazo para esta publicação. Se você criar aqui, rejeite a proposta dele em Revisões.</Callout>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
        <Button loading={saving} disabled={!title.trim() || !dueOn} onClick={save}>
          Criar prazo
        </Button>
      </div>
    </div>
  );
}

function DecideForm({ p, action, onCancel, onDone }: { p: JudicialPublicationDetailDTO; action: "NO_DEADLINE" | "REOPEN"; onCancel: () => void; onDone: () => void }) {
  const failed = useActionFeedback();
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    const r = await callAction(() => decideJudicialPublicationAction({ id: p.id, action, notes: notes || undefined }));
    setSaving(false);
    if (!r.ok) return failed(r, "Não foi possível registrar.");
    onDone();
  }
  return (
    <div className="space-y-3 rounded-md border border-line p-4">
      <Field label={action === "NO_DEADLINE" ? "Por que esta publicação não tem prazo?" : "Motivo para reabrir"} requirement={action === "NO_DEADLINE" ? "required" : "optional"}>
        {(a) => <Textarea {...a} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} placeholder={action === "NO_DEADLINE" ? "Ex.: mero expediente; prazo já controlado; só ciência." : ""} />}
      </Field>
      {action === "REOPEN" && p.deadline && <Callout tone="info">O prazo já criado continua existindo; cancele-o em Prazos se não valer mais.</Callout>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
        <Button loading={saving} disabled={action === "NO_DEADLINE" && !notes.trim()} onClick={save}>
          {action === "NO_DEADLINE" ? "Registrar sem prazo" : "Reabrir"}
        </Button>
      </div>
    </div>
  );
}
