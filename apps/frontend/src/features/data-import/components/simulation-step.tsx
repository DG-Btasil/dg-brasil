"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, CircleAlert, Download, OctagonAlert, Pencil, Save } from "lucide-react";
import { ActionErrorState } from "@/components/feedback/action-error";
import { Callout, SkeletonRows } from "@/components/feedback/states";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Stat } from "@/components/ui/display";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { cn } from "@/lib/cn";
import { callAction, type ActionResult } from "@/lib/actions/result";
import { useActionFeedback } from "@/lib/actions/use-action-feedback";
import { formatCNJ, formatDocument, formatNumber, pluralize } from "@/lib/formatting";
import { getImportConflictsAction, resolveImportConflictsAction } from "@/server/domain/imports/actions";
import type { ImportConflictDTO, ImportConflictKind, ImportConflictsDTO, ImportJobDTO, ImportPlanDTO, ImportResolution } from "@/server/domain/imports/dto";
import { CONFLICT_CHOICES, CONFLICT_KIND_LABEL } from "../labels";
import { RowsTable } from "./rows-table";

const PAGE = 100;

function ConflictCard({ c, busy, onChoose }: { c: ImportConflictDTO; busy: boolean; onChoose: (r: ImportResolution) => void }) {
  const choices = CONFLICT_CHOICES[c.kind];
  return (
    <fieldset className={cn("rounded-md border px-4 py-3", c.resolution ? "border-line" : "border-warning-line bg-warning-soft/40")}>
      <legend className="sr-only">{`${CONFLICT_KIND_LABEL[c.kind]}, linha ${c.rowNumber}`}</legend>
      <p className="text-[13px] font-medium text-foreground">
        {CONFLICT_KIND_LABEL[c.kind]} <span className="font-normal text-muted">· linha {c.rowNumber}</span>
        {c.rowsWithSameClient && c.rowsWithSameClient > 1 ? <span className="font-normal text-muted"> (vale para as {c.rowsWithSameClient} linhas deste cliente)</span> : null}
      </p>
      <div className="mt-1 grid grid-cols-2 gap-3 text-[12.5px]">
        <div>
          <span className="text-subtle">Na planilha: </span>
          {c.kind === "PROCESS_CNJ" ? (c.rowProcessCnj ? formatCNJ(c.rowProcessCnj) : "—") : c.rowClientName}
          {c.kind !== "PROCESS_CNJ" && c.rowClientDocument && <span className="tabular text-muted"> · {formatDocument(c.rowClientDocument)}</span>}
        </div>
        <div>
          <span className="text-subtle">Já no DG Brasil: </span>
          {c.existingLabel ?? "—"}
          {c.existingDocument && <span className="tabular text-muted"> · {formatDocument(c.existingDocument)}</span>}
          {c.existingClientName && <span className="text-muted"> · cliente {c.existingClientName}</span>}
        </div>
      </div>
      <div className="mt-2 space-y-1.5">
        {choices.map((o) => (
          <label key={o.value} className="flex cursor-pointer items-start gap-2 text-[12.5px]">
            <input type="radio" name={c.id} className="mt-0.5 accent-navy" checked={c.resolution === o.value} disabled={busy} onChange={() => onChoose(o.value)} />
            <span>
              <span className="font-medium text-foreground">{o.label}</span>
              <span className="block text-muted">{o.hint}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function ConflictsPanel({ job, onChanged }: { job: ImportJobDTO; onChanged: () => void }) {
  const failed = useActionFeedback();
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<ActionResult<ImportConflictsDTO> | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => callAction(() => getImportConflictsAction({ jobId: job.id, offset, limit: PAGE })).then(setData), [job.id, offset]);
  useEffect(() => {
    void load();
  }, [load]);

  async function resolve(items: Parameters<typeof resolveImportConflictsAction>[0]) {
    setBusy(true);
    const r = await callAction(() => resolveImportConflictsAction(items));
    setBusy(false);
    if (!r.ok) {
      failed(r, "Não foi possível registrar a decisão.");
      return;
    }
    await load();
    onChanged();
  }

  if (!data) return <SkeletonRows rows={3} />;
  if (!data.ok) return <ActionErrorState error={data} onRetry={() => void load()} title="Não foi possível carregar os conflitos." />;
  const d = data.data;
  if (d.total === 0) return null;
  const kinds = Object.keys(d.byKind) as ImportConflictKind[];

  return (
    <Panel>
      <PanelHeader
        title="Conflitos com o que já existe"
        description={`Nada é criado em duplicidade sem a sua decisão. ${d.open > 0 ? `${pluralize(d.open, "conflito pendente", "conflitos pendentes")}.` : "Todos decididos."}`}
      />
      <PanelBody className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {kinds.map((k) => (
            <div key={k} className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-[12px]">
              <span className="text-muted">
                {CONFLICT_KIND_LABEL[k]} ({d.byKind[k]}):
              </span>
              {CONFLICT_CHOICES[k].map((o) => (
                <Button key={o.value} size="sm" variant="ghost" disabled={busy} onClick={() => resolve({ jobId: job.id, items: [{ kind: k, resolution: o.value }] })}>
                  {o.label} (todos)
                </Button>
              ))}
            </div>
          ))}
        </div>
        {d.items.map((c) => (
          <ConflictCard key={c.id} c={c} busy={busy} onChoose={(r) => resolve({ jobId: job.id, items: [{ conflictId: c.id, resolution: r }] })} />
        ))}
        {d.total > PAGE && (
          <div className="flex items-center justify-between text-[12.5px] text-muted">
            <span>
              {offset + 1}–{Math.min(offset + PAGE, d.total)} de {d.total}
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" disabled={offset === 0} onClick={() => setOffset((o) => Math.max(0, o - PAGE))}>
                Anteriores
              </Button>
              <Button size="sm" variant="secondary" disabled={offset + PAGE >= d.total} onClick={() => setOffset((o) => o + PAGE)}>
                Próximos
              </Button>
            </div>
          </div>
        )}
      </PanelBody>
    </Panel>
  );
}

export function PlanGrid({ plan }: { plan: ImportPlanDTO }) {
  const items: [string, number][] = [
    ["Clientes novos", plan.clientsCreate],
    ["Clientes atualizados", plan.clientsUpdate],
    ["Clientes mantidos (só vínculo)", plan.clientsKeep],
    ["Casos e processos novos", plan.processesCreate],
    ["Processos atualizados", plan.processesUpdate],
    ["Prazos criados (vencimento)", plan.deadlinesCreate],
    ["Linhas sem nada a gravar", plan.rowsToSkip],
    ["Linhas com erro (não gravadas)", plan.rowsError],
  ];
  return (
    <dl className="grid grid-cols-4 gap-3">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-md border border-line px-4 py-3">
          <dt className="text-[11.5px] text-muted">{label}</dt>
          <dd className="mt-1 font-serif text-[24px] leading-none tabular text-navy">{formatNumber(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

export function SimulationStep({
  job,
  busy,
  onRemap,
  onConfirm,
  onReport,
  onChanged,
}: {
  job: ImportJobDTO;
  busy: boolean;
  onRemap: () => void;
  onConfirm: () => void;
  onReport: (only: "all" | "problems") => void;
  onChanged: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [version, setVersion] = useState(0);
  const plan = job.plan;
  const pending = job.status === "CONFLICTS_PENDING";
  const nothing = !plan || plan.rowsToImport === 0;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Prontas" value={formatNumber(job.successfulRows)} icon={CheckCircle2} tone="success" hint="Linhas sem ressalvas" />
        <Stat label="Com aviso" value={formatNumber(job.warningRows)} icon={CircleAlert} tone="warning" hint="Gravadas, com a ressalva indicada" />
        <Stat label="Com erro" value={formatNumber(job.failedRows)} icon={OctagonAlert} tone={job.failedRows ? "danger" : "neutral"} hint="Nunca são gravadas" />
      </div>

      <ConflictsPanel
        job={job}
        onChanged={() => {
          setVersion((v) => v + 1);
          onChanged();
        }}
      />

      {plan && (
        <Panel>
          <PanelHeader title="O que será gravado ao confirmar" description="Prévia calculada pela mesma regra que grava. Nada foi gravado ainda." />
          <PanelBody>
            <PlanGrid plan={plan} />
          </PanelBody>
        </Panel>
      )}

      <Panel>
        <PanelHeader
          title="Linhas"
          actions={
            <>
              <Button size="sm" variant="secondary" icon={<Download className="size-3.5" aria-hidden />} onClick={() => onReport("problems")}>
                Baixar linhas com problema (CSV)
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onReport("all")}>
                Todas (CSV)
              </Button>
            </>
          }
        />
        <RowsTable jobId={job.id} filters={["problems", "all", "errors", "warnings"]} initial={job.failedRows + job.warningRows > 0 ? "problems" : "all"} version={version} />
      </Panel>

      <Panel>
        <div className="flex items-center justify-between gap-3 px-5 py-4">
          <div className="text-[12.5px] text-muted">
            {pending
              ? "Decida todos os conflitos para poder gravar."
              : nothing
                ? "Não há nada para gravar: todas as linhas têm erro ou foram ignoradas. Corrija a planilha e envie de novo."
                : "Linhas com erro ficam de fora. Você pode corrigir a planilha depois e importar só o que faltou."}
          </div>
          <div className="flex shrink-0 gap-2">
            <Button variant="secondary" icon={<Pencil className="size-4" aria-hidden />} disabled={busy} onClick={onRemap}>
              Refazer o mapeamento
            </Button>
            <Button icon={<Save className="size-4" aria-hidden />} disabled={pending || nothing || busy} onClick={() => setConfirming(true)}>
              Confirmar e gravar
            </Button>
          </div>
        </div>
      </Panel>

      <Dialog
        open={confirming}
        onOpenChange={setConfirming}
        size="lg"
        title="Confirmar a importação"
        description="Depois de confirmar, o mapeamento e as decisões não mudam mais. A gravação acontece em lotes e pode ser acompanhada nesta tela."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Voltar
            </Button>
            <Button
              loading={busy}
              onClick={() => {
                setConfirming(false);
                onConfirm();
              }}
            >
              Gravar {plan ? pluralize(plan.rowsToImport, "linha", "linhas") : ""}
            </Button>
          </>
        }
      >
        {plan && <PlanGrid plan={plan} />}
        <Callout tone="info" className="mt-4">
          Tudo o que for criado fica registrado na auditoria e na linha do tempo de cada processo (“Cadastro por importação”), com o nome do arquivo e a linha de origem.
        </Callout>
      </Dialog>
    </div>
  );
}
