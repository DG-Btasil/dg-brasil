"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { FileText, Library, Pencil, Plus } from "lucide-react";
import { Can } from "@/components/layout/guards";
import { Callout, EmptyState } from "@/components/feedback/states";
import { StatusBadge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { CheckboxList } from "@/components/ui/checkbox-list";
import { Drawer } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/table";
import { callAction } from "@/lib/actions/result";
import { useActionFeedback } from "@/lib/actions/use-action-feedback";
import { REFERENCE_FILE_MAX_BYTES, REFERENCE_FILE_TYPES } from "@/lib/constants/ai";
import {
  REFERENCE_MATERIAL_STATUSES, REFERENCE_MATERIAL_STATUS_LABEL, REFERENCE_MATERIAL_STATUS_TONE, REFERENCE_MATERIAL_TYPES,
  REFERENCE_MATERIAL_TYPE_LABEL, type ReferenceMaterialStatus, type ReferenceMaterialType,
} from "@/lib/constants/status";
import { formatFileSize } from "@/lib/formatting";
import { useIdempotencyKey } from "@/lib/hooks/use-idempotency-key";
import { prepareDgReferenceFileAction, saveDgReferenceAction } from "@/server/domain/dg/actions";
import type { DgCatalogDTO, ReferenceItemDTO } from "@/server/domain/dg/dto";
import { useToast } from "@/store/ui-store";
import { putSigned } from "../../upload";
import { formatVersion } from "../../utils";

export function ReferenceTable({ references, catalog }: { references: ReferenceItemDTO[]; catalog: DgCatalogDTO }) {
  const [editing, setEditing] = useState<ReferenceItemDTO | "new" | null>(null);
  const agents = new Map(catalog.agents.map((a) => [a.id, a.name]));
  return (
    <Panel>
      <PanelHeader
        title="Referências"
        description="Petições aprovadas, modelos de escrita e orientações. O agente abre só as vinculadas a ele, e só cita o que abriu."
        actions={
          <Can permission="dgbrasil.manage">
            <Button icon={<Plus className="size-4" aria-hidden />} onClick={() => setEditing("new")}>
              Nova referência
            </Button>
          </Can>
        }
      />
      {references.length === 0 ? (
        <EmptyState icon={Library} title="Nenhuma referência cadastrada." />
      ) : (
        <Table caption="Referências">
          <THead>
            <tr>
              <Th>Referência</Th>
              <Th>Tipo</Th>
              <Th>Conteúdo</Th>
              <Th>Agentes</Th>
              <Th>Versão</Th>
              <Th>Situação</Th>
              <Th>
                <span className="sr-only">Ações</span>
              </Th>
            </tr>
          </THead>
          <TBody>
            {references.map((r) => (
              <Tr key={r.id}>
                <Td>
                  <span className="block font-medium text-foreground">{r.title}</span>
                  {r.tags.length > 0 && <span className="block text-[11.5px] text-subtle">{r.tags.join(" · ")}</span>}
                </Td>
                <Td className="text-[12.5px] text-muted">{REFERENCE_MATERIAL_TYPE_LABEL[r.type]}</Td>
                <Td className="text-[12.5px] text-muted">
                  {r.file ? (
                    <span className="inline-flex items-center gap-1">
                      <FileText className="size-3.5" aria-hidden /> {r.file.name}
                      {r.file.size ? ` · ${formatFileSize(r.file.size)}` : ""}
                    </span>
                  ) : r.hasText ? "Texto" : "—"}
                </Td>
                <Td className="text-[12.5px] text-muted">{r.agentIds.map((id) => agents.get(id)).filter(Boolean).join(", ") || "—"}</Td>
                <Td className="tabular">{formatVersion(r.version)}</Td>
                <Td>
                  <StatusBadge status={r.status} labels={REFERENCE_MATERIAL_STATUS_LABEL} tones={REFERENCE_MATERIAL_STATUS_TONE} />
                </Td>
                <Td className="text-right">
                  <Can permission="dgbrasil.manage">
                    <IconButton size="sm" label={`Editar ${r.title}`} onClick={() => setEditing(r)}>
                      <Pencil className="size-3.5" aria-hidden />
                    </IconButton>
                  </Can>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
      {editing && <ReferenceFormDrawer reference={editing === "new" ? undefined : editing} catalog={catalog} onClose={() => setEditing(null)} />}
    </Panel>
  );
}

/** Referência = texto colado OU arquivo (PDF, DOCX, TXT, MD). Conteúdo novo = versão nova. */
function ReferenceFormDrawer({ reference, catalog, onClose }: { reference?: ReferenceItemDTO; catalog: DgCatalogDTO; onClose: () => void }) {
  const formId = useId();
  const router = useRouter();
  const toast = useToast();
  const failed = useActionFeedback();
  const idempotency = useIdempotencyKey();
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(reference?.title ?? "");
  const [type, setType] = useState<ReferenceMaterialType>(reference?.type ?? "INTERNAL_GUIDELINE");
  const [status, setStatus] = useState<ReferenceMaterialStatus>(reference?.status ?? "ACTIVE");
  const [description, setDescription] = useState(reference?.description ?? "");
  const [tags, setTags] = useState(reference?.tags.join(", ") ?? "");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [agentIds, setAgentIds] = useState<string[]>(reference?.agentIds ?? []);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (saving) return;
    if (!title.trim()) return setError("Informe o título.");
    if (!reference && !text.trim() && !file) return setError("Cole o texto ou escolha um arquivo.");
    if (file) {
      const dot = file.name.lastIndexOf(".");
      if (dot < 0 || !REFERENCE_FILE_TYPES[file.name.slice(dot).toLowerCase()]) return setError("Envie PDF, Word (.docx), texto (.txt) ou Markdown (.md).");
      if (file.size > REFERENCE_FILE_MAX_BYTES) return setError("Arquivo maior que 50 MB.");
    }
    setError(null);
    setSaving(true);
    let id = reference?.id;
    let versionId: string | undefined;
    let fileMeta: { storageObjectName: string; originalFilename: string; mimeType: string; size: number } | undefined;
    if (file) {
      const prepared = await callAction(() => prepareDgReferenceFileAction({ referenceId: id, fileName: file.name, size: file.size }));
      if (!prepared.ok) {
        setSaving(false);
        failed(prepared, "Não foi possível preparar o envio.");
        return;
      }
      const problem = await putSigned(prepared.data.file, file);
      if (problem) {
        setSaving(false);
        toast({ tone: "danger", title: "Falha ao enviar o arquivo", description: problem });
        return;
      }
      id = prepared.data.referenceId;
      versionId = prepared.data.versionId;
      fileMeta = { storageObjectName: prepared.data.file.storageObjectName, originalFilename: file.name, mimeType: prepared.data.file.mimeType, size: file.size };
    } else if (text.trim()) {
      id = id ?? crypto.randomUUID();
      versionId = crypto.randomUUID();
    }
    id = id ?? crypto.randomUUID();
    const payload = {
      id, create: !reference, versionId, type, title: title.trim(), description: description || undefined, status,
      tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      ...(fileMeta ? { file: fileMeta } : text.trim() ? { contentText: text } : {}),
      agentIds,
    };
    const r = await callAction(() => saveDgReferenceAction({ ...payload, key: idempotency.keyFor(payload) }));
    setSaving(false);
    if (!r.ok) {
      failed(r, "Não foi possível salvar a referência.");
      return;
    }
    idempotency.reset();
    toast({ tone: "success", title: reference ? "Referência salva" : "Referência criada" });
    onClose();
    router.refresh();
  }

  return (
    <Drawer
      open
      onOpenChange={(o) => !o && onClose()}
      width={640}
      title={reference ? `Editar ${reference.title}` : "Nova referência"}
      description="Material que o agente pode abrir. Nada aqui é publicado: só os agentes vinculados leem."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} loading={saving}>
            Salvar
          </Button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={submit} className="space-y-4">
        {error && <Callout tone="danger">{error}</Callout>}
        <Field label="Título" requirement="required">
          {(a) => <Input {...a} value={title} onChange={(e) => setTitle(e.target.value)} />}
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Tipo" requirement="required">
            {(a) => <Select {...a} value={type} onChange={(e) => setType(e.target.value as ReferenceMaterialType)} options={REFERENCE_MATERIAL_TYPES.map((t) => ({ value: t, label: REFERENCE_MATERIAL_TYPE_LABEL[t] }))} />}
          </Field>
          <Field label="Situação" requirement="required" hint="Só Ativa chega ao agente.">
            {(a) => <Select {...a} value={status} onChange={(e) => setStatus(e.target.value as ReferenceMaterialStatus)} options={REFERENCE_MATERIAL_STATUSES.map((s) => ({ value: s, label: REFERENCE_MATERIAL_STATUS_LABEL[s] }))} />}
          </Field>
        </div>
        <Field label="Descrição" requirement="optional">
          {(a) => <Textarea {...a} value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />}
        </Field>
        <Field label="Etiquetas" requirement="optional" hint="Separadas por vírgula.">
          {(a) => <Input {...a} value={tags} onChange={(e) => setTags(e.target.value)} />}
        </Field>
        <Field label={reference ? "Novo texto (substitui o conteúdo; cria versão nova)" : "Texto"} requirement="optional">
          {(a) => <Textarea {...a} value={text} onChange={(e) => setText(e.target.value)} rows={8} disabled={!!file} />}
        </Field>
        <div className="flex items-center gap-3">
          <input ref={fileRef} type="file" accept={Object.keys(REFERENCE_FILE_TYPES).join(",")} className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <Button type="button" size="sm" variant="secondary" onClick={() => fileRef.current?.click()} disabled={!!text.trim()}>
            {file ? "Trocar arquivo" : "Ou enviar arquivo"}
          </Button>
          {file && <span className="text-[12.5px] text-muted">{file.name} · {formatFileSize(file.size)}</span>}
        </div>
        <CheckboxList legend="Agentes que podem abrir" options={catalog.agents.map((a) => ({ value: a.id, label: a.name }))} value={agentIds} onChange={setAgentIds} />
      </form>
    </Drawer>
  );
}
