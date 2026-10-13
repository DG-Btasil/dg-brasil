"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Paperclip, RotateCcw, UploadCloud } from "lucide-react";
import { DOCUMENT_CATEGORIES, DOCUMENT_CATEGORY_LABEL, type DocumentCategory } from "@/lib/constants/status";
import { referenceCode, type ActionError } from "@/lib/actions/result";
import { Callout } from "@/components/feedback/states";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Steps, type StepState } from "@/components/ui/display";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { useToast } from "@/store/ui-store";
import { FILE_ACCEPT, formatBytes } from "../constants";
import { checkFile, createAndUpload, uploadVersion, type UploadOutcome, type UploadResume, type UploadStep } from "../upload";

const CATEGORY_OPTIONS = DOCUMENT_CATEGORIES.map((c) => ({ value: c, label: DOCUMENT_CATEGORY_LABEL[c] }));
const STEP_ORDER: Exclude<UploadStep, "done">[] = ["create", "prepare", "upload", "confirm"];
const STEP_LABEL: Record<Exclude<UploadStep, "done">, string> = {
  create: "Registrar o documento",
  prepare: "Autorizar o envio",
  upload: "Enviar o arquivo",
  confirm: "Confirmar a nova versão",
};

export type UploadTarget =
  | { kind: "new"; clientId?: string; legalCaseId?: string; legalProcessId?: string; defaultCategory?: DocumentCategory; defaultTitle?: string }
  | { kind: "version"; documentId: string; title: string };

const nameFromFile = (fileName: string) => fileName.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();

/**
 * Envio de arquivo (novo documento ou nova versão). Mostra cada etapa; em
 * falha, diz em qual parou e retoma dali (confirmação repetida não cria
 * versão duplicada). Nunca mostra sucesso que o banco não confirmou.
 */
export function UploadDialog({ target, initialFile, onClose }: { target: UploadTarget; initialFile?: File; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | undefined>(initialFile);
  const [category, setCategory] = useState<string>(target.kind === "new" ? (target.defaultCategory ?? "") : "");
  const [title, setTitle] = useState(target.kind === "new" ? (target.defaultTitle ?? (initialFile ? nameFromFile(initialFile.name) : "")) : "");
  const [description, setDescription] = useState("");
  const [step, setStep] = useState<UploadStep | null>(null);
  const [failure, setFailure] = useState<{ step: Exclude<UploadStep, "done">; error: ActionError } | null>(null);
  const [resume, setResume] = useState<UploadResume | undefined>();
  const [errors, setErrors] = useState<{ file?: string; category?: string; title?: string }>({});
  const busy = step !== null && step !== "done" && !failure;
  const steps = target.kind === "new" && !resume ? STEP_ORDER : STEP_ORDER.slice(1);

  function pick(f: File | undefined) {
    if (!f) return;
    setFile(f);
    setErrors((e) => ({ ...e, file: checkFile(f) }));
    if (target.kind === "new" && !title.trim()) setTitle(nameFromFile(f.name));
  }

  function stateOf(s: Exclude<UploadStep, "done">): StepState {
    const current = failure?.step ?? step;
    if (!current) return "pending";
    if (current === "done") return "done";
    const i = STEP_ORDER.indexOf(s);
    const c = STEP_ORDER.indexOf(current);
    if (i < c) return "done";
    if (i === c) return failure ? "blocked" : "current";
    return "pending";
  }

  async function finish(outcome: UploadOutcome) {
    if (outcome.ok) {
      toast({ tone: "success", title: target.kind === "new" ? "Documento enviado" : "Nova versão enviada", description: "O arquivo entra como não verificado." });
      router.refresh();
      onClose();
      return;
    }
    setFailure({ step: outcome.step, error: outcome.error });
    setResume(outcome.resume);
  }

  async function submit() {
    if (busy) return;
    const found = {
      file: !file && resume?.step !== "confirm" ? "Escolha o arquivo." : file ? checkFile(file) : undefined,
      category: target.kind === "new" && !resume && !category ? "Selecione a categoria." : undefined,
      title: target.kind === "new" && !resume && !title.trim() ? "Informe o título." : undefined,
    };
    setErrors(found);
    if (found.file || found.category || found.title) return;
    setFailure(null);
    setStep(null);
    let outcome: UploadOutcome;
    if (resume?.step === "confirm") outcome = await uploadVersion(resume.documentId, file as File, setStep, resume);
    else if (resume?.step === "upload") outcome = await uploadVersion(resume.documentId, file as File, setStep);
    else if (target.kind === "version") outcome = await uploadVersion(target.documentId, file as File, setStep);
    else
      outcome = await createAndUpload(
        { clientId: target.clientId, legalCaseId: target.legalCaseId, legalProcessId: target.legalProcessId, category, title: title.trim(), description: description.trim() || undefined },
        file as File,
        setStep,
      );
    await finish(outcome);
  }

  const code = failure ? referenceCode(failure.error.requestId) : undefined;
  const lockedFields = busy || !!resume;

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !busy && onClose()}
      size="lg"
      title={target.kind === "new" ? "Enviar documento" : `Nova versão de “${target.title}”`}
      description="O arquivo vai direto para o armazenamento privado do escritório, por um endereço temporário autorizado pelo servidor."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {resume ? "Fechar" : "Cancelar"}
          </Button>
          <Button onClick={submit} loading={busy} icon={failure ? <RotateCcw className="size-4" aria-hidden /> : <UploadCloud className="size-4" aria-hidden />}>
            {failure ? (resume?.step === "confirm" ? "Confirmar de novo" : "Tentar novamente") : "Enviar"}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-4">
        <Field label="Arquivo" requirement="required" className="col-span-2" error={errors.file} hint="PDF, Word, Excel, texto, CSV ou imagem. Até 50 MB.">
          {(p) => (
            <div className="flex items-center gap-3">
              <Button variant="secondary" size="sm" icon={<Paperclip className="size-4" aria-hidden />} onClick={() => inputRef.current?.click()} disabled={lockedFields} aria-describedby={p["aria-describedby"]}>
                {file ? "Trocar arquivo" : "Escolher arquivo"}
              </Button>
              <span className="min-w-0 truncate text-[12.5px] text-muted" id={p.id}>
                {file ? `${file.name} · ${formatBytes(file.size)}` : "Nenhum arquivo escolhido"}
              </span>
              <input ref={inputRef} type="file" accept={FILE_ACCEPT} className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => pick(e.target.files?.[0] ?? undefined)} />
            </div>
          )}
        </Field>
        {target.kind === "new" && (
          <>
            <Field label="Categoria" requirement="required" error={errors.category}>
              {(p) => <Select {...p} value={category} onChange={(e) => setCategory(e.target.value)} options={CATEGORY_OPTIONS} placeholder="Selecione" disabled={lockedFields} />}
            </Field>
            <Field label="Título" requirement="required" error={errors.title}>
              {(p) => <Input {...p} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} disabled={lockedFields} />}
            </Field>
            <Field label="Descrição" requirement="optional" className="col-span-2">
              {(p) => <Textarea {...p} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} disabled={lockedFields} />}
            </Field>
          </>
        )}
      </div>
      {(step || failure) && (
        <div className="mt-5 space-y-3" aria-live="polite">
          <Steps steps={steps.map((s) => ({ key: s, label: STEP_LABEL[s], state: stateOf(s) }))} />
          {failure && (
            <Callout tone="danger" title={`Parou em: ${STEP_LABEL[failure.step].toLowerCase()}.`}>
              {failure.error.error.message}
              {failure.step === "confirm" && " O arquivo já foi enviado; confirmar de novo não duplica a versão."}
              {code && <span className="mt-1 block text-[12px]">Código de referência: {code}</span>}
            </Callout>
          )}
        </div>
      )}
    </Dialog>
  );
}
