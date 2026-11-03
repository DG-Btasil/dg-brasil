"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Play } from "lucide-react";
import { Callout } from "@/components/feedback/states";
import { Button, ButtonLink } from "@/components/ui/button";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { callAction, referenceCode, type ActionError } from "@/lib/actions/result";
import { formatDateTime, formatNumber, pluralize } from "@/lib/formatting";
import { processImportBatchAction } from "@/server/domain/imports/actions";
import type { ImportBatchDTO, ImportJobDTO } from "@/server/domain/imports/dto";
import { RowsTable } from "./rows-table";

/**
 * Chama o servidor lote a lote até terminar ou falhar. Sem estado de React:
 * quem chama recebe cada lote por callback.
 */
async function runBatches(jobId: string, onBatch: (b: ImportBatchDTO) => void, isAlive: () => boolean): Promise<ActionError | "done" | "stopped"> {
  for (;;) {
    const r = await callAction(() => processImportBatchAction({ jobId }));
    if (!isAlive()) return "stopped";
    if (!r.ok) return r;
    onBatch(r.data);
    if (r.data.status === "COMPLETED") return "done";
  }
}

/**
 * Grava em lotes: chama o servidor até não sobrar linha. Fechar a página não
 * perde nada — ao voltar, "Continuar a gravação" retoma de onde parou (o banco
 * nunca grava a mesma linha duas vezes).
 */
export function ProcessingStep({ job, onDone }: { job: ImportJobDTO; onDone: () => void }) {
  const total = job.plan ? job.plan.rowsToImport + job.plan.rowsToSkip : (job.totalRows ?? 0);
  const [last, setLast] = useState<ImportBatchDTO | null>(null);
  const [error, setError] = useState<ActionError | null>(null);
  const [running, setRunning] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  // Começa sozinho ao abrir (confirmada ou gravação interrompida) e a cada "Continuar".
  useEffect(() => {
    let alive = true;
    runBatches(job.id, (b) => setLast(b), () => alive).then((end) => {
      if (!alive || end === "stopped") return;
      setRunning(false);
      if (end === "done") onDoneRef.current();
      else setError(end);
    });
    return () => {
      alive = false;
    };
  }, [job.id, attempt]);

  function resume() {
    setError(null);
    setRunning(true);
    setAttempt((n) => n + 1);
  }

  const done = last ? last.imported + last.skipped + last.failedOnSave : 0;
  const pct = total ? Math.min(100, Math.round((done / total) * 100)) : 0;

  return (
    <Panel>
      <PanelHeader title="Gravando" description="Não é preciso ficar nesta tela: se sair, ao voltar a gravação continua de onde parou." />
      <PanelBody className="space-y-3">
        <div className="h-2 w-full overflow-hidden rounded-full bg-surface-sunken" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Progresso da gravação">
          <div className="h-full bg-navy transition-[width]" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-[12.5px] text-muted" aria-live="polite">
          {last ? `${formatNumber(done)} de ${formatNumber(total)} linhas processadas · ${formatNumber(last.imported)} importadas · ${formatNumber(last.failedOnSave)} com falha` : "Começando…"}
        </p>
        {error && (
          <Callout
            tone="danger"
            title="A gravação parou"
            action={
              <Button size="sm" icon={<Play className="size-3.5" aria-hidden />} onClick={resume} loading={running}>
                Continuar a gravação
              </Button>
            }
          >
            {error.error.message}
            {referenceCode(error.requestId) && ` (ref. ${referenceCode(error.requestId)})`} O que já foi gravado continua gravado; continuar não duplica nada.
          </Callout>
        )}
      </PanelBody>
    </Panel>
  );
}

export function ResultStep({ job, onReport }: { job: ImportJobDTO; onReport: (only: "all" | "problems") => void }) {
  const r = job.result;
  if (!r) return null;
  const validationErrors = r.failed - r.failedOnSave;
  const items: [string, number][] = [
    ["Linhas importadas", r.imported],
    ["Clientes criados", r.clientsCreated],
    ["Clientes atualizados", r.clientsUpdated],
    ["Casos e processos criados", r.processesCreated],
    ["Processos atualizados", r.processesUpdated],
    ["Prazos criados", r.deadlinesCreated],
    ["Linhas ignoradas", r.skipped],
    ["Linhas não importadas", r.failed],
  ];
  return (
    <div className="space-y-5">
      <Callout tone={r.failed ? "warning" : "success"} title={r.failed ? "Importação concluída, com linhas de fora" : "Importação concluída"}>
        {job.completedAt && `Terminou em ${formatDateTime(job.completedAt)}. `}
        {r.failed > 0 && (
          <>
            {validationErrors > 0 && `${pluralize(validationErrors, "linha tinha erro", "linhas tinham erro")} na simulação. `}
            {r.failedOnSave > 0 && `${pluralize(r.failedOnSave, "linha foi recusada", "linhas foram recusadas")} na gravação (o motivo está em cada linha). `}
            Baixe as linhas com problema, corrija e importe só elas de novo.
          </>
        )}
        {r.failed === 0 && "Tudo ficou registrado na auditoria e na linha do tempo de cada processo."}
      </Callout>
      <Panel>
        <PanelBody>
          <dl className="grid grid-cols-4 gap-3">
            {items.map(([label, value]) => (
              <div key={label} className="rounded-md border border-line px-4 py-3">
                <dt className="text-[11.5px] text-muted">{label}</dt>
                <dd className="mt-1 font-serif text-[24px] leading-none tabular text-navy">{formatNumber(value)}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" icon={<Download className="size-3.5" aria-hidden />} onClick={() => onReport("problems")}>
              Baixar linhas com problema (CSV)
            </Button>
            <Button size="sm" variant="secondary" icon={<Download className="size-3.5" aria-hidden />} onClick={() => onReport("all")}>
              Relatório completo (CSV)
            </Button>
            <ButtonLink href="/clientes" size="sm" variant="ghost">
              Ver clientes
            </ButtonLink>
            <ButtonLink href="/processos" size="sm" variant="ghost">
              Ver processos
            </ButtonLink>
          </div>
        </PanelBody>
      </Panel>
      <Panel>
        <PanelHeader title="Relatório por linha" description="O que cada linha criou ou atualizou, e por que as outras ficaram de fora." />
        <RowsTable jobId={job.id} filters={["all", "imported", "errors", "skipped", "warnings"]} initial={r.failed ? "errors" : "all"} />
      </Panel>
    </div>
  );
}
