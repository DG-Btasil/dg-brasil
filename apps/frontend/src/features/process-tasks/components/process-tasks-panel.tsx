"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { Bot, CheckCircle2, ChevronDown, Circle, CircleDashed, ClipboardList, Loader2, Plus, RotateCcw, Send, XCircle } from "lucide-react";
import { EmptyState } from "@/components/feedback/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { callAction, type ActionResult } from "@/lib/actions/result";
import { useActionFeedback } from "@/lib/actions/use-action-feedback";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/formatting";
import type { Tone } from "@/lib/constants/status";
import { usePermission } from "@/features/auth/hooks";
import { useDirectoryUser } from "@/features/directory/directory-context";
import {
  cancelProcessTaskAction,
  completeProcessTaskAction,
  createProcessTaskAction,
  listProcessTasksAction,
  listTaskAgentsAction,
  sendProcessTaskAction,
} from "@/server/domain/process-tasks/actions";
import type { ProcessTaskDTO, ProcessTaskStatus, TaskAgentDTO } from "@/server/domain/process-tasks/dto";
import { useToast } from "@/store/ui-store";

export const TASK_STATUS_LABEL: Record<ProcessTaskStatus, string> = {
  OPEN: "Aberta",
  QUEUED: "Na fila do orquestrador",
  IN_PROGRESS: "Agente trabalhando",
  IN_REVIEW: "Para revisar",
  DONE: "Concluída",
  CANCELLED: "Cancelada",
};
const TASK_STATUS_TONE: Record<ProcessTaskStatus, Tone> = {
  OPEN: "neutral",
  QUEUED: "info",
  IN_PROGRESS: "navy",
  IN_REVIEW: "warning",
  DONE: "success",
  CANCELLED: "neutral",
};
const PRIORITY_OPTIONS = [
  { value: "LOW", label: "Baixa" },
  { value: "NORMAL", label: "Normal" },
  { value: "HIGH", label: "Alta" },
  { value: "URGENT", label: "Urgente" },
];

/**
 * Lista de afazeres do processo para os agentes (Roadmap 2.0, 047). A equipe
 * escreve o que precisa ser feito; o orquestrador (no computador do
 * escritório) distribui; o agente entrega para revisão humana; a pessoa dá o
 * check. A situação de cada tarefa vem do banco e acompanha a execução.
 */
export function ProcessTasksPanel({ processId, initial }: { processId: string; initial: ActionResult<ProcessTaskDTO[]> }) {
  const canWork = usePermission("analyses.start");
  const canSeeRuns = usePermission("dgbrasil.activity.view");
  const failed = useActionFeedback();
  const toast = useToast();
  const [result, setResult] = useState(initial);
  const [creating, setCreating] = useState(false);
  const [acting, setActing] = useState<{ kind: "send" | "complete" | "cancel"; task: ProcessTaskDTO } | null>(null);
  const tasks = result.ok ? result.data : [];
  const pending = tasks.filter((t) => t.status !== "DONE" && t.status !== "CANCELLED").length;

  const reload = useCallback(async () => {
    const next = await callAction(() => listProcessTasksAction({ processId }));
    setResult(next);
  }, [processId]);

  // Enquanto houver tarefa com os agentes, confere de tempos em tempos (a situação muda no computador do escritório).
  const busy = tasks.some((t) => t.status === "QUEUED" || t.status === "IN_PROGRESS");
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(reload, 20_000);
    return () => clearInterval(timer);
  }, [busy, reload]);

  async function done(message: string) {
    toast({ tone: "success", title: message });
    setActing(null);
    await reload();
  }

  return (
    <Panel>
      <PanelHeader
        title="Tarefas para os agentes"
        description="Escreva o que precisa ser feito. O orquestrador entrega ao agente certo, o agente devolve para revisão e você dá o check de concluída."
        actions={
          canWork ? (
            <Button size="sm" icon={<Plus className="size-4" aria-hidden />} onClick={() => setCreating(true)}>
              Nova tarefa
            </Button>
          ) : undefined
        }
      />
      {!result.ok ? (
        <div className="px-5 py-4 text-[13px] text-danger">Não foi possível carregar as tarefas.</div>
      ) : tasks.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          compact
          title="Nenhuma tarefa ainda"
          description={canWork ? "Ex.: “Redigir a réplica à contestação do Banco Pan”, “Atualizar o cálculo com o extrato novo”." : undefined}
        />
      ) : (
        <>
          <p className="border-b border-line px-5 py-2 text-[12px] text-muted" aria-live="polite">
            {pending === 0 ? "Tudo concluído." : `${pending} ${pending === 1 ? "tarefa em aberto" : "tarefas em aberto"}.`}
          </p>
          <ul className="divide-y divide-line">
            {tasks.map((t) => (
              <TaskRow key={t.id} task={t} canWork={canWork} canSeeRuns={canSeeRuns} onAct={(kind) => setActing({ kind, task: t })} />
            ))}
          </ul>
        </>
      )}
      {creating && (
        <NewTaskDialog
          processId={processId}
          onClose={() => setCreating(false)}
          onCreated={(queued) => {
            setCreating(false);
            void done(queued ? "Tarefa enviada para a fila dos agentes" : "Tarefa registrada");
          }}
          failed={failed}
        />
      )}
      {acting && <ActDialog {...acting} onClose={() => setActing(null)} onDone={done} failed={failed} />}
    </Panel>
  );
}

function StatusIcon({ status }: { status: ProcessTaskStatus }) {
  const cls = "size-5 shrink-0";
  if (status === "DONE") return <CheckCircle2 className={cn(cls, "text-success")} aria-hidden />;
  if (status === "CANCELLED") return <XCircle className={cn(cls, "text-subtle")} aria-hidden />;
  if (status === "IN_PROGRESS") return <Loader2 className={cn(cls, "animate-spin text-navy-700")} aria-hidden />;
  if (status === "QUEUED") return <CircleDashed className={cn(cls, "text-info")} aria-hidden />;
  if (status === "IN_REVIEW") return <Circle className={cn(cls, "text-warning")} aria-hidden />;
  return <Circle className={cn(cls, "text-subtle")} aria-hidden />;
}

function TaskRow({ task, canWork, canSeeRuns, onAct }: { task: ProcessTaskDTO; canWork: boolean; canSeeRuns: boolean; onAct: (kind: "send" | "complete" | "cancel") => void }) {
  const [open, setOpen] = useState(task.status === "IN_REVIEW" || task.status === "OPEN");
  const author = useDirectoryUser(task.createdBy);
  const closer = useDirectoryUser(task.completedBy);
  const finished = task.status === "DONE" || task.status === "CANCELLED";
  return (
    <li className={cn("px-5 py-3.5", finished && "bg-surface-muted/50")}>
      <div className="flex items-start gap-3">
        <StatusIcon status={task.status} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className={cn("inline-flex items-center gap-1 text-left text-[13.5px] font-semibold", finished ? "text-muted line-through decoration-1" : "text-foreground")}>
              {task.title}
              <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} aria-hidden />
            </button>
            <Badge tone={TASK_STATUS_TONE[task.status]}>{TASK_STATUS_LABEL[task.status]}</Badge>
            {(task.priority === "HIGH" || task.priority === "URGENT") && <Badge tone={task.priority === "URGENT" ? "danger" : "orange"}>{task.priority === "URGENT" ? "Urgente" : "Alta"}</Badge>}
            {task.attempts > 1 && <span className="text-[11.5px] text-muted">{task.attempts}ª tentativa</span>}
          </div>
          <p className="mt-0.5 text-[12px] text-muted">
            Criada {formatDateTime(task.createdAt)}
            {author ? ` por ${author.name}` : ""}
            {task.dueAt ? ` · prazo interno ${formatDateTime(task.dueAt)}` : ""}
          </p>
          {open && (
            <div className="mt-2 space-y-2">
              <p className="whitespace-pre-line rounded-md border border-line bg-surface-muted px-3 py-2 text-[13px] text-foreground">{task.instructions}</p>
              {task.lastError && task.status === "OPEN" && <p className="text-[12.5px] text-danger">{task.lastError}</p>}
              {task.status === "IN_REVIEW" && (
                <p className="text-[12.5px] text-muted">
                  O agente entregou. Confira o que ele fez em{" "}
                  <Link href={`/revisoes?processo=${task.processId}`} className="font-medium text-navy-700 underline-offset-2 hover:underline">
                    Revisões
                  </Link>{" "}
                  e, se estiver certo, dê o check. Se não, devolva ao agente com uma observação.
                </p>
              )}
              {task.status === "DONE" && (
                <p className="text-[12.5px] text-success">
                  Concluída {task.completedAt ? formatDateTime(task.completedAt) : ""}
                  {closer ? ` por ${closer.name}` : ""}
                  {task.completionNote ? ` — ${task.completionNote}` : ""}
                </p>
              )}
              {task.status === "CANCELLED" && task.cancelReason && <p className="text-[12.5px] text-muted">Cancelada: {task.cancelReason}</p>}
              {task.agentRunId && canSeeRuns && (
                <Link href={`/execucoes/${task.agentRunId}`} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-navy-700 hover:underline">
                  <Bot className="size-3.5" aria-hidden /> Ver a execução do agente
                </Link>
              )}
            </div>
          )}
        </div>
        {canWork && !finished && (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
            {task.status === "IN_REVIEW" && (
              <Button size="sm" icon={<CheckCircle2 className="size-4" aria-hidden />} onClick={() => onAct("complete")}>
                Concluir
              </Button>
            )}
            {(task.status === "OPEN" || task.status === "IN_REVIEW") && (
              <Button size="sm" variant="secondary" icon={task.status === "OPEN" ? <Send className="size-4" aria-hidden /> : <RotateCcw className="size-4" aria-hidden />} onClick={() => onAct("send")}>
                {task.status === "OPEN" ? "Enviar aos agentes" : "Devolver ao agente"}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => onAct("cancel")}>
              Cancelar
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}

function NewTaskDialog({
  processId,
  onClose,
  onCreated,
  failed,
}: {
  processId: string;
  onClose: () => void;
  onCreated: (queued: boolean) => void;
  failed: ReturnType<typeof useActionFeedback>;
}) {
  const formId = useId();
  const [agents, setAgents] = useState<TaskAgentDTO[] | null>(null);
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [agentId, setAgentId] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [priority, setPriority] = useState("NORMAL");
  const [send, setSend] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    void callAction(() => listTaskAgentsAction()).then((r) => alive && setAgents(r.ok ? r.data : []));
    return () => {
      alive = false;
    };
  }, []);

  const orchestrator = agents?.find((a) => a.isOrchestrator);
  const agentOptions = useMemo(
    () => [
      { value: "", label: orchestrator ? `Orquestrador decide (${orchestrator.name})` : "Orquestrador decide" },
      ...(agents ?? []).filter((a) => !a.isOrchestrator).map((a) => ({ value: a.id, label: a.name })),
    ],
    [agents, orchestrator],
  );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const found: Record<string, string> = {};
    if (!title.trim()) found.title = "Informe o título da tarefa.";
    if (!instructions.trim()) found.instructions = "Diga o que o agente precisa fazer.";
    setErrors(found);
    if (Object.keys(found).length || saving) return;
    setSaving(true);
    const result = await callAction(() =>
      createProcessTaskAction({
        processId,
        title: title.trim(),
        instructions: instructions.trim(),
        agentId: agentId || undefined,
        dueAt: dueAt ? new Date(dueAt).toISOString() : undefined,
        priority,
        send,
      }),
    );
    setSaving(false);
    if (!result.ok) {
      if (result.error.fieldErrors) setErrors(Object.fromEntries(Object.entries(result.error.fieldErrors).map(([k, v]) => [k, v[0]])));
      else failed(result, "Não foi possível criar a tarefa.");
      return;
    }
    onCreated(result.data.status === "QUEUED");
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => !next && onClose()}
      size="lg"
      title="Nova tarefa para os agentes"
      description="A tarefa entra na lista do processo e, se enviada, na fila do orquestrador do computador do escritório."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} loading={saving} icon={send ? <Send className="size-4" aria-hidden /> : undefined}>
            {send ? "Criar e enviar" : "Criar tarefa"}
          </Button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={submit} className="grid grid-cols-2 gap-4">
        <Field label="Título" requirement="required" error={errors.title} className="col-span-2">
          {(a) => <Input {...a} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="Ex.: Redigir a réplica" autoFocus />}
        </Field>
        <Field label="O que fazer" requirement="required" error={errors.instructions} hint="Seja específico: o que entregar, o que observar, quais documentos usar." className="col-span-2">
          {(a) => <Textarea {...a} rows={6} maxLength={10_000} value={instructions} onChange={(e) => setInstructions(e.target.value)} />}
        </Field>
        <Field label="Agente" requirement="optional" hint={agents && !orchestrator ? "Nenhum orquestrador configurado: escolha um agente ou peça ao ADMIN para configurar (DG Brasil)." : undefined}>
          {(a) => <Select {...a} value={agentId} onChange={(e) => setAgentId(e.target.value)} options={agentOptions} disabled={!agents} />}
        </Field>
        <Field label="Prioridade" requirement="optional">
          {(a) => <Select {...a} value={priority} onChange={(e) => setPriority(e.target.value)} options={PRIORITY_OPTIONS} />}
        </Field>
        <Field label="Prazo interno" requirement="optional" error={errors.dueAt}>
          {(a) => <Input {...a} type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />}
        </Field>
        <div className="flex items-end pb-1.5">
          <Checkbox checked={send} onChange={(e) => setSend(e.target.checked)} label="Enviar agora para a fila" description="Desmarque para só registrar." />
        </div>
      </form>
    </Dialog>
  );
}

function ActDialog({
  kind,
  task,
  onClose,
  onDone,
  failed,
}: {
  kind: "send" | "complete" | "cancel";
  task: ProcessTaskDTO;
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
  failed: ReturnType<typeof useActionFeedback>;
}) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const copy = {
    send: {
      title: task.status === "OPEN" ? "Enviar aos agentes" : "Devolver ao agente",
      description: "A tarefa volta para a fila do orquestrador com uma nova execução.",
      label: "Observação para o agente",
      hint: "Opcional. Ex.: o que corrigir, qual documento usar.",
      button: "Enviar",
      required: false,
    },
    complete: {
      title: "Concluir tarefa",
      description: "Confirma que o que o agente fez está correto. A tarefa fica concluída na lista e na linha do tempo.",
      label: "Nota da conferência",
      hint: "Opcional.",
      button: "Concluir ✓",
      required: false,
    },
    cancel: {
      title: "Cancelar tarefa",
      description: "Se a tarefa estiver na fila, o agente não começa.",
      label: "Motivo",
      hint: undefined,
      button: "Cancelar tarefa",
      required: true,
    },
  }[kind];

  async function confirm() {
    if (copy.required && !text.trim()) {
      setError("Informe o motivo.");
      return;
    }
    setSaving(true);
    const note = text.trim() || undefined;
    const result =
      kind === "send"
        ? await callAction(() => sendProcessTaskAction({ taskId: task.id, note }))
        : kind === "complete"
          ? await callAction(() => completeProcessTaskAction({ taskId: task.id, note }))
          : await callAction(() => cancelProcessTaskAction({ taskId: task.id, reason: text.trim() }));
    setSaving(false);
    if (!result.ok) {
      failed(result, "Não foi possível atualizar a tarefa.");
      return;
    }
    await onDone(kind === "send" ? "Tarefa enviada aos agentes" : kind === "complete" ? "Tarefa concluída" : "Tarefa cancelada");
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => !next && onClose()}
      title={copy.title}
      description={copy.description}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Voltar
          </Button>
          <Button onClick={confirm} loading={saving} variant={kind === "cancel" ? "danger" : "primary"}>
            {copy.button}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-[13px] font-medium text-foreground">{task.title}</p>
      <Field label={copy.label} requirement={copy.required ? "required" : "optional"} hint={copy.hint} error={error}>
        {(a) => <Textarea {...a} rows={3} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} />}
      </Field>
    </Dialog>
  );
}
