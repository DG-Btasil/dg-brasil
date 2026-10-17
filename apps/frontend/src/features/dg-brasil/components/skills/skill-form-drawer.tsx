"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { FileUp, FolderUp, Trash2, Undo2 } from "lucide-react";
import { Callout } from "@/components/feedback/states";
import { Button, IconButton } from "@/components/ui/button";
import { Drawer } from "@/components/ui/dialog";
import { Field, FormSection, Input, Select, Textarea } from "@/components/ui/form";
import { callAction } from "@/lib/actions/result";
import { useActionFeedback } from "@/lib/actions/use-action-feedback";
import { SKILL_FILES_MAX_COUNT } from "@/lib/constants/ai";
import { SKILL_STATUSES, SKILL_STATUS_LABEL, type SkillStatus } from "@/lib/constants/status";
import { formatFileSize } from "@/lib/formatting";
import { useIdempotencyKey } from "@/lib/hooks/use-idempotency-key";
import { prepareDgSkillFilesAction, saveDgSkillAction } from "@/server/domain/dg/actions";
import type { SkillDetailDTO } from "@/server/domain/dg/dto";
import { useToast } from "@/store/ui-store";
import { nameFromSlug, parseMarkdownWithFrontmatter } from "../../import-md";
import { putSigned, sha256Hex, skillFileProblem, toSkillFiles, totalTooLarge, type PendingSkillFile } from "../../upload";
import { dgRoutes } from "../../utils";

const SLUG = /^[a-z0-9][a-z0-9-]{1,62}$/;
const slugFrom = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/(anthropic|claude)/g, "x").slice(0, 60);

/**
 * Criar/editar skill = texto (o SKILL.md) + arquivos (scripts, modelos,
 * referências), como no Claude Code. Mudar instruções ou arquivos cria uma
 * VERSÃO nova; os arquivos mantidos continuam apontando para o mesmo objeto.
 */
export function SkillFormDrawer({ open, onOpenChange, skill }: { open: boolean; onOpenChange: (o: boolean) => void; skill?: SkillDetailDTO }) {
  const formId = useId();
  const router = useRouter();
  const toast = useToast();
  const failed = useActionFeedback();
  const idempotency = useIdempotencyKey();
  const folderRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);
  const mdRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(skill?.name ?? "");
  const [slug, setSlug] = useState(skill?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState(skill?.description ?? "");
  const [status, setStatus] = useState<SkillStatus>(skill?.status ?? "DRAFT");
  const [instructions, setInstructions] = useState(skill?.instructions ?? "");
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<PendingSkillFile[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const existing = skill?.files ?? [];
  const pendingPaths = new Set(pending.map((p) => p.path));

  function close() {
    onOpenChange(false);
  }

  async function applySkillMd(file: File) {
    const md = parseMarkdownWithFrontmatter(await file.text());
    if (!skill && md.name && !slugTouched) setSlug(slugFrom(md.name));
    if (!name && md.name) setName(nameFromSlug(md.name));
    if (md.description) setDescription(md.description.slice(0, 1024));
    if (md.body) setInstructions(md.body);
    return md;
  }

  async function addFiles(list: FileList | null, origin: "pasta" | "arquivos") {
    if (!list?.length) return;
    const { files, skillMd, skipped } = toSkillFiles(list);
    const msgs: string[] = [];
    if (skillMd) {
      await applySkillMd(skillMd);
      msgs.push("SKILL.md lido: nome, descrição e instruções preenchidos.");
    }
    setPending((cur) => {
      const byPath = new Map(cur.map((p) => [p.path, p]));
      for (const f of files) byPath.set(f.path, f);
      return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
    });
    msgs.push(`${files.length} arquivo(s) da ${origin} adicionados.`);
    if (skipped.length) msgs.push(`Ignorados (ocultos ou cache): ${skipped.slice(0, 5).join(", ")}${skipped.length > 5 ? "…" : ""}.`);
    setNote(msgs.join(" "));
    if (folderRef.current) folderRef.current.value = "";
    if (filesRef.current) filesRef.current.value = "";
  }

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = "Informe o nome da skill.";
    if (!skill && !SLUG.test(slug)) e.slug = "Use letras minúsculas, números e hífen (2 a 63 caracteres).";
    if (!skill && /(anthropic|claude)/.test(slug)) e.slug = "Não pode conter “anthropic” nem “claude”.";
    if (!description.trim()) e.description = "Descreva quando o agente deve usar esta skill.";
    if (!instructions.trim()) e.instructions = "As instruções da skill são obrigatórias.";
    const problems = pending.map(skillFileProblem).filter(Boolean) as string[];
    if (problems.length) e.files = problems.slice(0, 4).join(" ");
    const kept = existing.filter((f) => !removed.has(f.path) && !pendingPaths.has(f.path));
    if (kept.length + pending.length > SKILL_FILES_MAX_COUNT) e.files = `No máximo ${SKILL_FILES_MAX_COUNT} arquivos.`;
    if (totalTooLarge([...kept.map((f) => f.size), ...pending.map((p) => p.file.size)])) e.files = "Os arquivos somam mais de 25 MB.";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (saving || !validate()) return;
    const keepPaths = existing.filter((f) => !removed.has(f.path) && !pendingPaths.has(f.path)).map((f) => f.path);
    const contentChanged =
      !skill || instructions.trim() !== skill.instructions.trim() || pending.length > 0 || keepPaths.length !== existing.length;

    let skillId = skill?.id;
    let versionId: string | undefined;
    const uploaded: { path: string; storageObjectName: string; mimeType: string; size: number; sha256: string }[] = [];

    if (contentChanged) {
      setSaving("Preparando o envio…");
      const prepared = await callAction(() => prepareDgSkillFilesAction({ skillId, files: pending.map((p) => ({ path: p.path, size: p.file.size })) }));
      if (!prepared.ok) {
        setSaving(null);
        failed(prepared, "Não foi possível preparar o envio dos arquivos.");
        return;
      }
      skillId = prepared.data.skillId;
      versionId = prepared.data.versionId;
      for (const [i, f] of prepared.data.files.entries()) {
        const p = pending.find((x) => x.path === f.path)!;
        setSaving(`Enviando ${i + 1} de ${prepared.data.files.length}: ${f.path}`);
        const problem = await putSigned(f, p.file);
        if (problem) {
          setSaving(null);
          toast({ tone: "danger", title: `Falha ao enviar ${f.path}`, description: problem });
          return;
        }
        uploaded.push({ path: f.path, storageObjectName: f.storageObjectName, mimeType: f.mimeType, size: p.file.size, sha256: await sha256Hex(p.file) });
      }
    }

    setSaving("Salvando…");
    const payload = {
      id: skillId!, create: !skill, versionId,
      ...(skill ? {} : { slug }),
      name: name.trim(), description: description.trim(), status, instructions,
      files: uploaded,
      ...(skill ? { keepPaths } : {}),
    };
    const r = await callAction(() => saveDgSkillAction({ ...payload, key: idempotency.keyFor(payload) }));
    setSaving(null);
    if (!r.ok) {
      failed(r, "Não foi possível salvar a skill.");
      return;
    }
    idempotency.reset();
    toast({
      tone: "success",
      title: skill ? "Skill salva" : "Skill criada",
      description: r.data.versionCreated ? `Versão ${r.data.versionNumber} criada. As próximas execuções usam esta versão.` : "Sem mudança de conteúdo: a versão continua a mesma.",
    });
    onOpenChange(false);
    if (!skill) router.push(dgRoutes.skill(r.data.id));
    else router.refresh();
  }

  return (
    <Drawer
      open={open}
      onOpenChange={(o) => (o ? onOpenChange(true) : close())}
      width={720}
      title={skill ? `Editar ${skill.name}` : "Criar skill"}
      description="Skill = instruções (SKILL.md) + arquivos. Os scripts rodam só no ambiente isolado do provedor, nunca no servidor."
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={!!saving}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} loading={!!saving}>
            {skill ? "Salvar" : "Criar skill"}
          </Button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={submit} className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-dashed border-line px-4 py-3">
          <p className="max-w-[420px] text-[12.5px] text-muted">
            Já tem a skill no Claude Code? Envie a pasta inteira: o SKILL.md vira as instruções e os demais arquivos vão junto (mantendo as subpastas).
          </p>
          <div className="flex gap-2">
            <input ref={folderRef} type="file" className="sr-only" multiple {...({ webkitdirectory: "", directory: "" } as Record<string, string>)} onChange={(e) => addFiles(e.target.files, "pasta")} />
            <input ref={mdRef} type="file" accept=".md,text/markdown" className="sr-only" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { await applySkillMd(f); setNote(`${f.name} lido.`); } if (mdRef.current) mdRef.current.value = ""; }} />
            <Button type="button" size="sm" variant="secondary" icon={<FolderUp className="size-4" aria-hidden />} onClick={() => folderRef.current?.click()}>
              Enviar pasta
            </Button>
            <Button type="button" size="sm" variant="ghost" icon={<FileUp className="size-4" aria-hidden />} onClick={() => mdRef.current?.click()}>
              Só o SKILL.md
            </Button>
          </div>
        </div>
        {note && <Callout tone="info">{note}</Callout>}
        {saving && <Callout tone="info">{saving}</Callout>}

        <FormSection title="Identificação">
          <div className="space-y-4">
            <Field label="Nome" requirement="required" error={errors.name}>
              {(a) => (
                <Input {...a} value={name} onChange={(e) => { setName(e.target.value); if (!skill && !slugTouched) setSlug(slugFrom(e.target.value)); }} placeholder="Ex.: Roteiro de petição (consignado)" />
              )}
            </Field>
            <Field label="Identificador" requirement="required" error={errors.slug} hint={skill ? "Não muda depois de criado." : "Nome técnico da skill no ambiente do agente."}>
              {(a) => <Input {...a} value={slug} disabled={!!skill} onChange={(e) => { setSlugTouched(true); setSlug(e.target.value); }} className="font-mono" />}
            </Field>
            <Field label="Quando usar (descrição)" requirement="required" error={errors.description} hint="O agente decide usar a skill por este texto. Até 1.024 caracteres.">
              {(a) => <Textarea {...a} value={description} maxLength={1024} onChange={(e) => setDescription(e.target.value)} rows={3} />}
            </Field>
            <Field label="Situação" requirement="required" hint="Só skill Ativa é carregada nas execuções.">
              {(a) => <Select {...a} value={status} onChange={(e) => setStatus(e.target.value as SkillStatus)} options={SKILL_STATUSES.map((s) => ({ value: s, label: SKILL_STATUS_LABEL[s] }))} />}
            </Field>
          </div>
        </FormSection>

        <FormSection title="Instruções (SKILL.md)">
          <Field label="Instruções" requirement="required" error={errors.instructions}>
            {(a) => <Textarea {...a} value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={16} className="font-mono text-[12.5px]" />}
          </Field>
        </FormSection>

        <FormSection title="Arquivos" description="Scripts (.py), modelos (.docx), referências (.md, .pdf, .json…). Até 10 MB cada, 25 MB no total.">
          <div className="space-y-3">
            {errors.files && <Callout tone="danger">{errors.files}</Callout>}
            <ul className="divide-y divide-line rounded-md border border-line">
              {existing.length === 0 && pending.length === 0 && <li className="px-4 py-3 text-[13px] text-muted">Nenhum arquivo. Skill só com instruções também funciona.</li>}
              {existing.map((f) => {
                const replaced = pendingPaths.has(f.path);
                const gone = removed.has(f.path);
                return (
                  <li key={`e-${f.path}`} className="flex items-center justify-between gap-3 px-4 py-2 text-[12.5px]">
                    <span className={gone || replaced ? "font-mono text-subtle line-through" : "font-mono text-foreground"}>{f.path}</span>
                    <span className="flex items-center gap-2 text-muted">
                      {replaced ? "substituído" : gone ? "removido" : formatFileSize(f.size)}
                      {!replaced && (
                        <IconButton
                          size="sm"
                          label={gone ? `Manter ${f.path}` : `Remover ${f.path}`}
                          onClick={() => setRemoved((cur) => { const n = new Set(cur); if (n.has(f.path)) n.delete(f.path); else n.add(f.path); return n; })}
                        >
                          {gone ? <Undo2 className="size-3.5" aria-hidden /> : <Trash2 className="size-3.5" aria-hidden />}
                        </IconButton>
                      )}
                    </span>
                  </li>
                );
              })}
              {pending.map((p) => (
                <li key={`p-${p.path}`} className="flex items-center justify-between gap-3 bg-success-soft/40 px-4 py-2 text-[12.5px]">
                  <span className="font-mono text-foreground">{p.path} <span className="font-sans text-success">novo</span></span>
                  <span className="flex items-center gap-2 text-muted">
                    {formatFileSize(p.file.size)}
                    <IconButton size="sm" label={`Tirar ${p.path}`} onClick={() => setPending((cur) => cur.filter((x) => x.path !== p.path))}>
                      <Trash2 className="size-3.5" aria-hidden />
                    </IconButton>
                  </span>
                </li>
              ))}
            </ul>
            <input ref={filesRef} type="file" multiple className="sr-only" onChange={(e) => addFiles(e.target.files, "arquivos")} />
            <Button type="button" size="sm" variant="secondary" icon={<FileUp className="size-4" aria-hidden />} onClick={() => filesRef.current?.click()}>
              Adicionar arquivos
            </Button>
          </div>
        </FormSection>
      </form>
    </Drawer>
  );
}
