"use client";

import { useCallback, useEffect, useState } from "react";
import { FileSpreadsheet, X } from "lucide-react";
import { ActionErrorState } from "@/components/feedback/action-error";
import { Callout, SkeletonRows } from "@/components/feedback/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { PageHeader, Steps, type StepState } from "@/components/ui/display";
import { callAction, type ActionError, type ActionResult } from "@/lib/actions/result";
import { useActionFeedback } from "@/lib/actions/use-action-feedback";
import { formatDateTime, formatNumber } from "@/lib/formatting";
import {
  cancelImportAction,
  confirmImportAction,
  getImportJobAction,
  getImportReferenceAction,
  importReportAction,
  previewImportColumnsAction,
  readImportColumnsAction,
  simulateImportAction,
} from "@/server/domain/imports/actions";
import type { ColumnsDTO, ImportJobDTO, ImportJobStatus, ImportReferenceDTO } from "@/server/domain/imports/dto";
import { useToast } from "@/store/ui-store";
import { downloadText } from "../client";
import { JOB_STATUS_LABEL, JOB_STATUS_TONE } from "../labels";
import { IMPORTS_HREF, NewImportButton } from "./imports-page";
import { MappingStep, type MappingSubmit } from "./mapping-step";
import { ProcessingStep, ResultStep } from "./processing-step";
import { SimulationStep } from "./simulation-step";

const STEPS = [
  { key: "file", label: "Arquivo" },
  { key: "mapping", label: "Colunas" },
  { key: "simulation", label: "Simulação e conflitos" },
  { key: "save", label: "Gravação" },
  { key: "report", label: "Relatório" },
] as const;

const STEP_OF: Record<ImportJobStatus, number> = {
  UPLOADED: 0,
  COLUMNS_DETECTED: 1,
  MAPPED: 1,
  VALIDATED: 2,
  CONFLICTS_PENDING: 2,
  CONFIRMED: 3,
  PROCESSING: 3,
  COMPLETED: 4,
  FAILED: 0,
  CANCELLED: 0,
};

const CANCELLABLE: ImportJobStatus[] = ["UPLOADED", "COLUMNS_DETECTED", "MAPPED", "VALIDATED", "CONFLICTS_PENDING"];

export function ImportJobView({ jobId }: { jobId: string }) {
  const toast = useToast();
  const failed = useActionFeedback();
  const [job, setJob] = useState<ActionResult<ImportJobDTO> | null>(null);
  const [columns, setColumns] = useState<ColumnsDTO | null>(null);
  const [reference, setReference] = useState<ImportReferenceDTO | null>(null);
  const [columnsError, setColumnsError] = useState<ActionError | null>(null);
  const [remap, setRemap] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const reload = useCallback(async () => {
    const r = await callAction(() => getImportJobAction({ jobId }));
    setJob(r);
    return r;
  }, [jobId]);

  useEffect(() => {
    let alive = true;
    callAction(() => getImportJobAction({ jobId })).then((r) => alive && setJob(r));
    return () => {
      alive = false;
    };
  }, [jobId]);

  const status = job?.ok ? job.data.status : undefined;
  const mappingNeeded = status === "UPLOADED" || status === "COLUMNS_DETECTED" || status === "MAPPED" || (remap && (status === "VALIDATED" || status === "CONFLICTS_PENDING"));

  // Áreas e equipe (opções do mapeamento): uma vez por importação.
  useEffect(() => {
    let alive = true;
    callAction(() => getImportReferenceAction()).then((r) => {
      if (!alive) return;
      if (r.ok) setReference(r.data);
      else setColumnsError(r);
    });
    return () => {
      alive = false;
    };
  }, [jobId]);

  // Colunas: primeira leitura (registra) ou prévia (só leitura) ao reabrir o
  // mapeamento. Uma vez por situação; depois de erro, só com "Tentar novamente".
  // (Antes dependia também da referência e rodava duas vezes: QA 7, IMP-04.)
  useEffect(() => {
    if (!mappingNeeded || columns || columnsError) return;
    let alive = true;
    const first = status === "UPLOADED";
    callAction(() => (first ? readImportColumnsAction({ jobId }) : previewImportColumnsAction({ jobId }))).then(async (c) => {
      // A primeira leitura muda a situação (colunas lidas, ou falhou): relê a importação.
      if (first) setJob(await callAction(() => getImportJobAction({ jobId })));
      if (!alive) return;
      if (c.ok) setColumns(c.data);
      else setColumnsError(c);
    });
    return () => {
      alive = false;
    };
  }, [mappingNeeded, columns, columnsError, status, jobId]);

  async function changeSheet(sheet: string) {
    setBusy(true);
    const r = await callAction(() => readImportColumnsAction({ jobId, sheetName: sheet }));
    setBusy(false);
    if (!r.ok) {
      failed(r, "Não foi possível ler esta aba.");
      return;
    }
    setColumns(r.data);
    await reload();
  }

  async function simulate(value: MappingSubmit) {
    setBusy(true);
    const r = await callAction(() => simulateImportAction({ jobId, ...value }));
    setBusy(false);
    if (!r.ok) {
      failed(r, "A simulação não foi concluída.");
      return;
    }
    setRemap(false);
    setJob(r);
  }

  async function confirm() {
    setBusy(true);
    const r = await callAction(() => confirmImportAction({ jobId }));
    setBusy(false);
    if (!r.ok) {
      failed(r, "Não foi possível confirmar.");
      await reload();
      return;
    }
    setJob(r);
  }

  async function cancel() {
    setBusy(true);
    const r = await callAction(() => cancelImportAction({ jobId }));
    setBusy(false);
    setCancelling(false);
    if (!r.ok) {
      failed(r, "Não foi possível cancelar.");
      return;
    }
    toast({ tone: "success", title: "Importação cancelada", description: "Nada foi gravado em clientes ou processos." });
    await reload();
  }

  async function report(only: "all" | "problems") {
    const r = await callAction(() => importReportAction({ jobId, only }));
    if (!r.ok) {
      failed(r, "Não foi possível gerar o relatório.");
      return;
    }
    if (r.data.rows === 0) {
      toast({ tone: "info", title: "Nenhuma linha para o relatório", description: "Não há linhas com problema." });
      return;
    }
    downloadText(r.data.fileName, r.data.csv);
  }

  if (!job) return <SkeletonRows rows={6} />;
  if (!job.ok) return <ActionErrorState error={job} title="Não foi possível abrir a importação." />;
  const j = job.data;
  const current = STEP_OF[j.status];
  const steps = STEPS.map((s, i) => ({
    key: s.key,
    label: s.label,
    state: (j.status === "COMPLETED" ? "done" : i < current ? "done" : i === current ? (j.status === "CONFLICTS_PENDING" ? "blocked" : "current") : "pending") as StepState,
  }));

  return (
    <div className="space-y-5">
      <PageHeader
        breadcrumbs={[{ label: "Configurações", href: "/configuracoes?secao=integracoes" }, { label: "Importações", href: IMPORTS_HREF }, { label: j.fileName }]}
        title={
          <span className="inline-flex items-center gap-2">
            <FileSpreadsheet className="size-5 text-navy-700" aria-hidden />
            {j.fileName}
          </span>
        }
        meta={
          <>
            <Badge tone={JOB_STATUS_TONE[j.status]} dot>
              {JOB_STATUS_LABEL[j.status]}
            </Badge>
            {j.totalRows !== undefined && <span>{formatNumber(j.totalRows)} linhas</span>}
            {j.sheetName && <span>aba “{j.sheetName}”</span>}
            <span>
              enviada {formatDateTime(j.createdAt)}
              {j.createdByName ? ` por ${j.createdByName}` : ""}
            </span>
            {j.confirmedAt && (
              <span>
                confirmada {formatDateTime(j.confirmedAt)}
                {j.confirmedByName ? ` por ${j.confirmedByName}` : ""}
              </span>
            )}
          </>
        }
        actions={
          CANCELLABLE.includes(j.status) ? (
            <Button variant="ghost" icon={<X className="size-4" aria-hidden />} disabled={busy} onClick={() => setCancelling(true)}>
              Cancelar importação
            </Button>
          ) : undefined
        }
      />
      {j.status !== "FAILED" && j.status !== "CANCELLED" && <Steps steps={steps} />}

      {j.status === "FAILED" && (
        <Callout tone="danger" title="Não foi possível ler o arquivo" action={<NewImportButton size="sm" />}>
          {j.errorMessage ?? "O arquivo não pôde ser lido."} Nada foi gravado.
        </Callout>
      )}
      {j.status === "CANCELLED" && (
        <Callout tone="neutral" title="Importação cancelada" action={<NewImportButton size="sm" />}>
          {j.errorMessage ?? "Nada foi gravado em clientes ou processos."}
        </Callout>
      )}

      {remap && mappingNeeded && (
        <Callout
          tone="neutral"
          title="Refazendo o mapeamento"
          action={
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => setRemap(false)}>
              Voltar à simulação sem mudar nada
            </Button>
          }
        >
          Ao simular de novo, a simulação anterior e as decisões de conflito são descartadas.
        </Callout>
      )}

      {mappingNeeded &&
        (columnsError ? (
          <ActionErrorState error={columnsError} title="Não foi possível ler o arquivo." onRetry={() => setColumnsError(null)} />
        ) : !columns || !reference || j.status === "UPLOADED" ? (
          <Callout tone="info" title="Lendo o arquivo…">
            Conferindo o cabeçalho e as linhas. Planilhas grandes levam alguns segundos.
          </Callout>
        ) : (
          <MappingStep key={`${columns.sheetName ?? ""}|${columns.headers.join("|")}`} job={j} columns={columns} reference={reference} busy={busy} onChangeSheet={changeSheet} onSubmit={simulate} />
        ))}

      {!mappingNeeded && (j.status === "VALIDATED" || j.status === "CONFLICTS_PENDING") && (
        <SimulationStep job={j} busy={busy} onRemap={() => {
            setColumnsError(null);
            setRemap(true);
          }} onConfirm={confirm} onReport={report} onChanged={() => void reload()} />
      )}

      {(j.status === "CONFIRMED" || j.status === "PROCESSING") && <ProcessingStep job={j} onDone={() => void reload()} />}

      {j.status === "COMPLETED" && <ResultStep job={j} onReport={report} />}

      <Dialog
        open={cancelling}
        onOpenChange={setCancelling}
        size="sm"
        title="Cancelar esta importação?"
        description="Nada foi gravado em clientes ou processos. O arquivo enviado é apagado."
        footer={
          <>
            <Button variant="ghost" onClick={() => setCancelling(false)}>
              Voltar
            </Button>
            <Button variant="danger" loading={busy} onClick={() => void cancel()}>
              Cancelar importação
            </Button>
          </>
        }
      />
    </div>
  );
}
