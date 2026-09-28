"use client";

import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, CircleAlert, FileSpreadsheet, OctagonAlert, Sparkles, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Select } from "@/components/ui/form";
import { Stat, Steps, type StepState } from "@/components/ui/display";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/table";
import { Callout } from "@/components/feedback/states";
import { cn } from "@/lib/cn";
import type { ImportConflictAction } from "@/lib/constants/status";
import { pluralize } from "@/lib/formatting";
import type { ImportPlan, ImportResult } from "@/store/types";
import { analyzeImport, buildImportPlan, unresolvedConflicts, type ConflictResolutions, type ImportAnalysis, type ImportConflict, type RowStatus } from "../analyze";
import { FIELD_BY_KEY, IMPORT_ENTITY_LABEL, IMPORT_FIELDS, fieldLabel, suggestMapping, type ImportFieldKey } from "../fields";
import { useImportContext, useRunImport } from "../hooks";
import { buildDemoSheet, isAcceptedFile, parseCsv, type ParsedSheet } from "../parse";

const STEPS = [
  { key: "file", label: "Arquivo" },
  { key: "content", label: "Conteúdo" },
  { key: "mapping", label: "Colunas" },
  { key: "validation", label: "Validação" },
  { key: "preview", label: "Prévia" },
  { key: "result", label: "Resultado" },
] as const;
type StepKey = (typeof STEPS)[number]["key"];

const ROW_STATUS_LABEL: Record<RowStatus, string> = { OK: "Importável", WARNING: "Com alerta", ERROR: "Com erro" };
const ROW_STATUS_TONE = { OK: "success", WARNING: "warning", ERROR: "danger" } as const;

const fieldOptions = IMPORT_FIELDS.map((f) => ({ value: f.key, label: `${IMPORT_ENTITY_LABEL[f.entity]} → ${f.label}` }));

/* ------------------------------------------------------------------ */
/* Etapas                                                              */
/* ------------------------------------------------------------------ */

function FileStep({ onSheet }: { onSheet: (sheet: ParsedSheet, note?: string) => void }) {
  const ctx = useImportContext();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string>();

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!isAcceptedFile(file.name)) return setError("Formato não suportado. Envie um arquivo Excel (.xlsx) ou CSV.");
    setError(undefined);
    if (file.name.toLowerCase().endsWith(".csv")) {
      const reader = new FileReader();
      reader.onload = () => {
        const { headers, rows } = parseCsv(String(reader.result ?? ""));
        if (headers.length === 0 || rows.length === 0) return setError("Não encontramos cabeçalho e linhas de dados neste CSV.");
        onSheet({ fileName: file.name, source: "csv", headers, rows });
      };
      reader.readAsText(file, "utf-8");
      return;
    }
    // XLSX: a leitura real será feita no backend. Nesta demonstração, usamos a planilha de exemplo.
    onSheet(
      { ...buildDemoSheet(ctx.clients, ctx.processes), fileName: file.name },
      "A leitura de arquivos Excel será feita no servidor do DG Brasil. Nesta demonstração, o conteúdo exibido é o da planilha de exemplo (dados fictícios).",
    );
  }

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="flex w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line-strong bg-surface-muted px-6 py-10 text-center transition-colors hover:border-navy-600/40 hover:bg-navy-50/40"
      >
        <Upload className="size-6 text-navy-700" aria-hidden />
        <span className="text-[14px] font-medium text-foreground">Selecionar arquivo</span>
        <span className="text-[12.5px] text-muted">Excel (.xlsx) ou CSV. Uma linha por cliente ou por processo; o mesmo cliente pode aparecer em várias linhas.</span>
      </button>
      <input ref={inputRef} type="file" accept=".xlsx,.csv" className="sr-only" onChange={onFile} aria-label="Arquivo para importação" />
      {error && (
        <p role="alert" className="text-[12.5px] font-medium text-danger">
          {error}
        </p>
      )}
      <div className="flex items-center justify-between rounded-md border border-line px-4 py-3">
        <p className="text-[12.5px] text-muted">Quer ver o fluxo sem um arquivo seu? Use a planilha de exemplo, com dados fictícios e casos de erro e conflito.</p>
        <Button variant="secondary" size="sm" icon={<FileSpreadsheet className="size-3.5" aria-hidden />} onClick={() => onSheet(buildDemoSheet(ctx.clients, ctx.processes))}>
          Usar planilha de exemplo
        </Button>
      </div>
    </div>
  );
}

function ContentStep({ sheet, mapping }: { sheet: ParsedSheet; mapping: Record<string, ImportFieldKey | ""> }) {
  const entities = new Set(Object.values(mapping).filter(Boolean).map((k) => FIELD_BY_KEY.get(k as ImportFieldKey)?.entity));
  const detected = [
    { on: entities.has("client"), label: "Clientes (pessoas físicas e jurídicas)" },
    { on: entities.has("process"), label: "Processos" },
    { on: entities.has("client") && entities.has("process"), label: "Vínculos cliente ↔ processo" },
    { on: entities.has("finance"), label: "Informações financeiras (somente referência nesta etapa)" },
  ];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Arquivo" value={<span className="text-[16px]">{sheet.fileName}</span>} icon={FileSpreadsheet} />
        <Stat label="Linhas de dados" value={sheet.rows.length} />
        <Stat label="Colunas" value={sheet.headers.length} />
      </div>
      <div>
        <h3 className="mb-2 text-[13px] font-semibold text-foreground">O que identificamos</h3>
        <ul className="grid grid-cols-2 gap-2">
          {detected.map((d) => (
            <li key={d.label} className={cn("flex items-center gap-2 rounded-md border px-3 py-2 text-[12.5px]", d.on ? "border-success-line bg-success-soft text-foreground" : "border-line text-subtle")}>
              {d.on ? <CheckCircle2 className="size-4 text-success" aria-hidden /> : <span className="size-4" aria-hidden />}
              {d.label}
              {!d.on && <span className="ml-auto text-[11.5px]">não encontrado</span>}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="mb-2 text-[13px] font-semibold text-foreground">Primeiras linhas</h3>
        <div className="overflow-x-auto rounded-md border border-line">
          <Table caption="Primeiras linhas do arquivo">
            <THead>
              <tr>
                {sheet.headers.map((h) => (
                  <Th key={h} className="whitespace-nowrap">
                    {h}
                  </Th>
                ))}
              </tr>
            </THead>
            <TBody>
              {sheet.rows.slice(0, 4).map((r, i) => (
                <Tr key={i}>
                  {r.map((v, j) => (
                    <Td key={j} className="whitespace-nowrap text-[12px]">
                      {v || <span className="text-subtle">—</span>}
                    </Td>
                  ))}
                </Tr>
              ))}
            </TBody>
          </Table>
        </div>
      </div>
    </div>
  );
}

function MappingStep({
  sheet,
  mapping,
  suggested,
  onChange,
}: {
  sheet: ParsedSheet;
  mapping: Record<string, ImportFieldKey | "">;
  suggested: Record<string, ImportFieldKey | "">;
  onChange: (header: string, field: ImportFieldKey | "") => void;
}) {
  const counts = new Map<string, number>();
  Object.values(mapping).forEach((f) => f && counts.set(f, (counts.get(f) ?? 0) + 1));
  return (
    <div className="space-y-3">
      <Callout tone="info" title="Confira o mapeamento">
        Sugerimos o campo de cada coluna pelo cabeçalho. No produto final, a sugestão também poderá considerar o conteúdo das colunas. Colunas sem campo são ignoradas.
      </Callout>
      <div className="rounded-md border border-line">
        <Table caption="Mapeamento de colunas">
          <THead>
            <tr>
              <Th>Coluna do arquivo</Th>
              <Th>Exemplo</Th>
              <Th>Campo DG Brasil</Th>
            </tr>
          </THead>
          <TBody>
            {sheet.headers.map((h, i) => {
              const example = sheet.rows.find((r) => r[i])?.[i];
              const field = mapping[h] ?? "";
              const duplicate = field && (counts.get(field) ?? 0) > 1;
              return (
                <Tr key={h}>
                  <Td className="font-medium text-foreground">{h}</Td>
                  <Td className="max-w-[200px] truncate text-[12px] text-muted">{example ?? "—"}</Td>
                  <Td className="w-[340px]">
                    <div className="flex items-center gap-2">
                      <Select
                        aria-label={`Campo DG Brasil para a coluna ${h}`}
                        value={field}
                        onChange={(e) => onChange(h, e.target.value as ImportFieldKey | "")}
                        options={fieldOptions}
                        placeholder="Não importar"
                      />
                      {field && field === suggested[h] && (
                        <Badge tone="gold" icon={<Sparkles className="size-3" aria-hidden />} title="Sugestão automática pelo cabeçalho">
                          Sugerido
                        </Badge>
                      )}
                    </div>
                    {duplicate && (
                      <p role="alert" className="mt-1 text-[11.5px] font-medium text-danger">
                        {fieldLabel(field)} está mapeado em mais de uma coluna.
                      </p>
                    )}
                  </Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      </div>
    </div>
  );
}

function ConflictCard({ conflict, value, onChange }: { conflict: ImportConflict; value?: ImportConflictAction; onChange: (a: ImportConflictAction) => void }) {
  const actions: ImportConflictAction[] = ["UPDATE", "IGNORE", "CREATE_NEW"];
  const label = (a: ImportConflictAction) =>
    conflict.kind === "CLIENT_DOCUMENT"
      ? { UPDATE: "Atualizar cliente existente", IGNORE: "Ignorar (manter cadastro atual)", CREATE_NEW: "Criar novo cliente" }[a]
      : { UPDATE: "Atualizar processo existente", IGNORE: "Ignorar esta linha", CREATE_NEW: "Criar outro processo" }[a];
  return (
    <fieldset className="rounded-md border border-warning-line bg-warning-soft/40 px-4 py-3">
      <legend className="sr-only">{`${conflict.label}, linha ${conflict.line}`}</legend>
      <p className="text-[13px] font-medium text-foreground">
        {conflict.label} <span className="font-normal text-muted">· linha {conflict.line}</span>
      </p>
      <p className="text-[12.5px] text-muted">Já existe: {conflict.existingLabel}</p>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5">
        {actions.map((a) => {
          const blocked = conflict.blocked[a];
          if (!conflict.allowed.includes(a) && !blocked) return null;
          return (
            <label key={a} className={cn("inline-flex items-center gap-1.5 text-[12.5px]", blocked ? "cursor-not-allowed text-subtle" : "cursor-pointer text-foreground")} title={blocked}>
              <input type="radio" name={conflict.id} value={a} checked={value === a} disabled={Boolean(blocked)} onChange={() => onChange(a)} className="accent-navy" />
              {label(a)}
              {blocked && <span className="text-[11.5px]">({blocked.replace(/^Não permitido: /, "não permitido: ")})</span>}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function ValidationStep({
  analysis,
  resolutions,
  onResolve,
}: {
  analysis: ImportAnalysis;
  resolutions: ConflictResolutions;
  onResolve: (next: ConflictResolutions) => void;
}) {
  const [onlyProblems, setOnlyProblems] = useState(true);
  const rows = onlyProblems ? analysis.rows.filter((r) => r.status !== "OK") : analysis.rows;
  const pending = unresolvedConflicts(analysis, resolutions).length;
  const setAll = (a: ImportConflictAction) => onResolve(Object.fromEntries(analysis.conflicts.map((c) => [c.id, c.allowed.includes(a) ? a : resolutions[c.id]])));

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Importáveis" value={analysis.counts.ok} icon={CheckCircle2} tone="success" hint={pluralize(analysis.counts.ok, "registro sem ressalvas", "registros sem ressalvas")} />
        <Stat label="Com alerta" value={analysis.counts.warning} icon={CircleAlert} tone="warning" hint="Importáveis após sua revisão" />
        <Stat label="Com erro" value={analysis.counts.error} icon={OctagonAlert} tone={analysis.counts.error ? "danger" : "neutral"} hint="Não serão importados" />
      </div>

      {analysis.conflicts.length > 0 && (
        <section aria-labelledby="conflicts-title" className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 id="conflicts-title" className="text-[13px] font-semibold text-foreground">
                Conflitos com dados existentes
              </h3>
              <p className="text-[12px] text-muted">Nada é criado em duplicidade sem a sua decisão. {pending > 0 ? `${pending} pendente(s).` : "Todos resolvidos."}</p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setAll("UPDATE")}>
                Atualizar todos
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setAll("IGNORE")}>
                Ignorar todos
              </Button>
            </div>
          </div>
          {analysis.conflicts.map((c) => (
            <ConflictCard key={c.id} conflict={c} value={resolutions[c.id]} onChange={(a) => onResolve({ ...resolutions, [c.id]: a })} />
          ))}
        </section>
      )}

      <section aria-labelledby="rows-title">
        <div className="mb-2 flex items-center justify-between">
          <h3 id="rows-title" className="text-[13px] font-semibold text-foreground">
            Linhas
          </h3>
          <label className="inline-flex items-center gap-1.5 text-[12.5px] text-muted">
            <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} className="accent-navy" />
            Mostrar só linhas com alerta ou erro
          </label>
        </div>
        <div className="rounded-md border border-line">
          <Table caption="Resultado da validação por linha">
            <THead>
              <tr>
                <Th className="w-16">Linha</Th>
                <Th>Cliente</Th>
                <Th>Processo</Th>
                <Th>Situação</Th>
                <Th>Ocorrências</Th>
              </tr>
            </THead>
            <TBody>
              {rows.map((r) => (
                <Tr key={r.line}>
                  <Td className="tabular text-muted">{r.line}</Td>
                  <Td className="max-w-[180px] truncate">{r.clientName ?? <span className="text-subtle">—</span>}</Td>
                  <Td className="max-w-[180px] truncate tabular text-[12px]">{r.values["process.cnj"] ?? r.values["process.actionType"] ?? <span className="text-subtle">—</span>}</Td>
                  <Td>
                    <Badge tone={ROW_STATUS_TONE[r.status]} dot>
                      {ROW_STATUS_LABEL[r.status]}
                    </Badge>
                  </Td>
                  <Td className="text-[12px]">
                    {r.issues.length === 0 && r.conflicts.length === 0 ? (
                      <span className="text-subtle">—</span>
                    ) : (
                      <ul className="space-y-0.5">
                        {r.issues.map((x, i) => (
                          <li key={i} className={x.severity === "ERROR" ? "text-danger" : "text-foreground"}>
                            {x.message}
                          </li>
                        ))}
                        {r.conflicts.map((c) => (
                          <li key={c.id} className="text-warning">
                            {c.label}: {c.existingLabel}
                          </li>
                        ))}
                      </ul>
                    )}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </div>
      </section>
    </div>
  );
}

function PreviewStep({ plan }: { plan: ImportPlan }) {
  const created = plan.clients.filter((c) => c.action === "CREATE");
  const updated = plan.clients.filter((c) => c.action === "UPDATE");
  const newProcesses = plan.processes.filter((p) => p.action === "CREATE");
  const updatedProcesses = plan.processes.filter((p) => p.action === "UPDATE");
  const links = plan.processes.filter((p) => p.clientRef || p.clientId).length;
  const items = [
    { label: "Clientes novos", value: created.length },
    { label: "Clientes atualizados", value: updated.length },
    { label: "Processos novos", value: newProcesses.length },
    { label: "Processos atualizados", value: updatedProcesses.length },
    { label: "Vínculos cliente ↔ processo", value: links },
    { label: "Linhas ignoradas", value: plan.ignoredRows },
    { label: "Linhas com erro (não importadas)", value: plan.errorRows },
  ];
  return (
    <div className="space-y-4">
      <Callout tone="info" title="Nada foi gravado ainda">
        Esta é a prévia do que acontecerá ao confirmar. Processos sem cliente ou sem responsável serão criados com alerta de integridade no sino.
      </Callout>
      <dl className="grid grid-cols-4 gap-3">
        {items.map((i) => (
          <div key={i.label} className="rounded-md border border-line px-4 py-3">
            <dt className="text-[11.5px] text-muted">{i.label}</dt>
            <dd className="mt-1 font-serif text-[24px] leading-none tabular text-navy">{i.value}</dd>
          </div>
        ))}
      </dl>
      <div className="rounded-md border border-line">
        <Table caption="Clientes que serão criados ou atualizados">
          <THead>
            <tr>
              <Th>Cliente</Th>
              <Th>Tipo</Th>
              <Th>Ação</Th>
              <Th>Processos vinculados</Th>
            </tr>
          </THead>
          <TBody>
            {plan.clients.slice(0, 12).map((c) => (
              <Tr key={c.ref}>
                <Td className="font-medium text-foreground">{c.input.kind === "INDIVIDUAL" ? c.input.fullName : c.input.legalName}</Td>
                <Td>{c.input.kind === "INDIVIDUAL" ? "PF" : "PJ"}</Td>
                <Td>
                  <Badge tone={c.action === "CREATE" ? "success" : "info"}>{c.action === "CREATE" ? "Criar" : "Atualizar"}</Badge>
                </Td>
                <Td className="tabular">{plan.processes.filter((p) => p.clientRef === c.ref).length}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </div>
    </div>
  );
}

function ResultStep({ result }: { result: ImportResult }) {
  const lines = [
    ["Clientes criados", result.clientsCreated],
    ["Clientes atualizados", result.clientsUpdated],
    ["Processos criados", result.processesCreated],
    ["Processos atualizados", result.processesUpdated],
    ["Vínculos cliente ↔ processo", result.linksCreated],
    ["Linhas ignoradas", result.ignoredRows],
    ["Linhas com erro (não importadas)", result.errorRows],
  ] as const;
  const alerts = result.processesWithoutResponsible > 0 || result.errorRows > 0;
  return (
    <div className="space-y-4">
      <Callout tone="success" title="Importação concluída">
        O resultado ficou registrado na auditoria do escritório.
      </Callout>
      <dl className="grid grid-cols-4 gap-3">
        {lines.map(([label, value]) => (
          <div key={label} className="rounded-md border border-line px-4 py-3">
            <dt className="text-[11.5px] text-muted">{label}</dt>
            <dd className="mt-1 font-serif text-[24px] leading-none tabular text-navy">{value}</dd>
          </div>
        ))}
      </dl>
      {alerts && (
        <Callout tone="warning" title="Pendências enviadas para o sino">
          {result.processesWithoutResponsible > 0 && <p>{pluralize(result.processesWithoutResponsible, "processo importado sem responsável", "processos importados sem responsável")}.</p>}
          {result.errorRows > 0 && <p>{pluralize(result.errorRows, "linha não foi importada", "linhas não foram importadas")} por erro: importação incompleta.</p>}
        </Callout>
      )}
      <div className="flex gap-2">
        <ButtonLink href="/clientes" variant="secondary" size="sm">
          Ver clientes
        </ButtonLink>
        <ButtonLink href="/processos" variant="secondary" size="sm">
          Ver processos
        </ButtonLink>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Assistente                                                          */
/* ------------------------------------------------------------------ */

/** Selecionar → identificar → mapear → validar → prévia → confirmar → resultado. */
export function ImportWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ctx = useImportContext();
  const runImport = useRunImport();
  const [step, setStep] = useState<StepKey>("file");
  const [sheet, setSheet] = useState<ParsedSheet | null>(null);
  const [note, setNote] = useState<string>();
  const [suggested, setSuggested] = useState<Record<string, ImportFieldKey | "">>({});
  const [mapping, setMapping] = useState<Record<string, ImportFieldKey | "">>({});
  const [resolutions, setResolutions] = useState<ConflictResolutions>({});
  const [result, setResult] = useState<ImportResult | null>(null);
  const [running, setRunning] = useState(false);

  // A análise usa os dados atuais do escritório para detectar CPF/CNJ já cadastrados.
  const analysis = useMemo(() => (sheet ? analyzeImport(sheet.headers, sheet.rows, mapping, ctx) : null), [sheet, mapping, ctx]);
  const plan = useMemo(
    () => (sheet && analysis ? buildImportPlan(sheet.fileName, analysis, resolutions, { users: ctx.users, defaultResponsibleId: ctx.currentUserId }) : null),
    [sheet, analysis, resolutions, ctx],
  );

  const mapped = Object.values(mapping).filter(Boolean) as ImportFieldKey[];
  const duplicateMapping = mapped.length !== new Set(mapped).size;
  const mappingOk = mapped.includes("client.name") || mapped.includes("process.cnj") || mapped.includes("process.actionType");
  const pendingConflicts = analysis ? unresolvedConflicts(analysis, resolutions).length : 0;
  const importable = analysis ? analysis.counts.ok + analysis.counts.warning : 0;

  function reset() {
    setStep("file");
    setSheet(null);
    setNote(undefined);
    setMapping({});
    setSuggested({});
    setResolutions({});
    setResult(null);
  }

  function close() {
    reset();
    onClose();
  }

  function loadSheet(next: ParsedSheet, message?: string) {
    const suggestion = suggestMapping(next.headers);
    setSheet(next);
    setNote(message);
    setSuggested(suggestion);
    setMapping(suggestion);
    setResolutions({});
    setStep("content");
  }

  async function confirm() {
    if (!plan) return;
    setRunning(true);
    const res = await runImport(plan);
    setRunning(false);
    if (res) {
      setResult(res);
      setStep("result");
    }
  }

  const index = STEPS.findIndex((s) => s.key === step);
  const steps = STEPS.map((s, i) => ({ key: s.key, label: s.label, state: (i < index ? "done" : i === index ? "current" : "pending") as StepState }));
  const go = (key: StepKey) => setStep(key);

  let back: StepKey | null = null;
  let next: { label: string; onClick: () => void; disabled?: boolean; hint?: string } | null = null;
  if (step === "content") {
    back = "file";
    next = { label: "Mapear colunas", onClick: () => go("mapping") };
  } else if (step === "mapping") {
    back = "content";
    next = {
      label: "Validar dados",
      onClick: () => go("validation"),
      disabled: !mappingOk || duplicateMapping,
      hint: !mappingOk ? "Mapeie ao menos o nome do cliente ou o número/tipo do processo." : duplicateMapping ? "Cada campo só pode receber uma coluna." : undefined,
    };
  } else if (step === "validation") {
    back = "mapping";
    next = {
      label: "Ver prévia",
      onClick: () => go("preview"),
      disabled: pendingConflicts > 0 || importable === 0,
      hint: pendingConflicts > 0 ? `Resolva ${pluralize(pendingConflicts, "conflito", "conflitos")} para continuar.` : importable === 0 ? "Nenhuma linha importável." : undefined,
    };
  } else if (step === "preview") {
    back = "validation";
    next = { label: "Confirmar importação", onClick: confirm, disabled: !plan };
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && close()}
      size="xl"
      title="Importar dados"
      description="Migre clientes e processos de planilhas ou de outros sistemas. Nada é gravado antes da sua confirmação."
      footer={
        step === "result" ? (
          <Button onClick={close}>Concluir</Button>
        ) : (
          <>
            {next?.hint && <span className="mr-auto text-[12px] text-muted">{next.hint}</span>}
            <Button variant="ghost" onClick={close}>
              Cancelar
            </Button>
            {back && (
              <Button variant="secondary" icon={<ArrowLeft className="size-4" aria-hidden />} onClick={() => go(back)}>
                Voltar
              </Button>
            )}
            {next && (
              <Button onClick={next.onClick} disabled={next.disabled} loading={step === "preview" && running}>
                {next.label}
                {step !== "preview" && <ArrowRight className="size-4" aria-hidden />}
              </Button>
            )}
          </>
        )
      }
    >
      <div className="space-y-5">
        <Steps steps={steps} />
        {note && step !== "result" && (
          <Callout tone="neutral" title="Demonstração">
            {note}
          </Callout>
        )}
        {step === "file" && <FileStep onSheet={loadSheet} />}
        {step === "content" && sheet && <ContentStep sheet={sheet} mapping={mapping} />}
        {step === "mapping" && sheet && <MappingStep sheet={sheet} mapping={mapping} suggested={suggested} onChange={(h, f) => setMapping((m) => ({ ...m, [h]: f }))} />}
        {step === "validation" && analysis && <ValidationStep analysis={analysis} resolutions={resolutions} onResolve={setResolutions} />}
        {step === "preview" && plan && <PreviewStep plan={plan} />}
        {step === "result" && result && <ResultStep result={result} />}
      </div>
    </Dialog>
  );
}
