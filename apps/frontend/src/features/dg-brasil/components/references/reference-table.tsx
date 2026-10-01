"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";
import { Library, Paperclip, Plus } from "lucide-react";
import { Can } from "@/components/layout/guards";
import { EmptyState } from "@/components/feedback/states";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckboxList } from "@/components/ui/checkbox-list";
import { Drawer } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Panel } from "@/components/ui/panel";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/table";
import { LEGAL_AREA_LABEL, LEGAL_AREAS, type LegalArea } from "@/lib/constants/legal";
import {
  REFERENCE_MATERIAL_STATUS_LABEL,
  REFERENCE_MATERIAL_STATUS_TONE,
  REFERENCE_MATERIAL_TYPE_LABEL,
  REFERENCE_MATERIAL_TYPES,
  type ReferenceMaterialType,
} from "@/lib/constants/status";
import { formatDate } from "@/lib/formatting";
import { repositories } from "@/repositories";
import { useScopedStore } from "@/store/scope";
import { useToast } from "@/store/ui-store";
import { useAgents, useSkills, useTheses } from "../../hooks";

/**
 * Referências (somente Administrador): petições aprovadas, exemplos de
 * redação e orientações que os agentes podem consultar. Sem indexação nesta
 * etapa — o backend decidirá armazenamento e recuperação.
 */
export function ReferenceTable() {
  const references = useScopedStore((s) => s.references);
  const skills = useSkills();
  const theses = useTheses();
  const agents = useAgents();
  const [creating, setCreating] = useState(false);
  const names = useMemo(() => new Map([...skills.map((x) => [x.id, x.name] as const), ...theses.map((x) => [x.id, x.name] as const), ...agents.map((x) => [x.id, x.name] as const)]), [skills, theses, agents]);

  return (
    <section aria-labelledby="dg-references-title">
      <div className="mb-3 flex items-end justify-between gap-4">
        <div>
          <h2 id="dg-references-title" className="text-[15px] font-semibold text-foreground">
            Referências
          </h2>
          <p className="mt-0.5 text-[12.5px] text-muted">Modelos e orientações do escritório que os agentes podem consultar.</p>
        </div>
        <Can permission="dgbrasil.manage">
          <Button icon={<Plus className="size-4" aria-hidden />} onClick={() => setCreating(true)}>
            Adicionar referência
          </Button>
        </Can>
      </div>
      <CreateReferenceDrawer open={creating} onOpenChange={setCreating} />
      <Panel>
        {references.length === 0 ? (
          <EmptyState icon={Library} title="Nenhuma referência cadastrada." description="Adicione petições aprovadas, exemplos de redação e orientações internas." />
        ) : (
          <Table caption="Referências do DG Brasil">
            <THead>
              <tr>
                <Th>Nome</Th>
                <Th>Categoria</Th>
                <Th>Área</Th>
                <Th>Vínculos</Th>
                <Th>Status</Th>
                <Th>Atualização</Th>
              </tr>
            </THead>
            <TBody>
              {references.map((r) => {
                const links = [...r.skillIds, ...r.thesisIds, ...r.agentIds].map((id) => names.get(id)).filter(Boolean);
                return (
                  <Tr key={r.id}>
                    <Td className="max-w-[340px]">
                      <div className="truncate font-medium text-foreground">{r.title}</div>
                      <div className="truncate text-[12px] text-muted">
                        {r.file ? `${r.file.name} · ` : ""}
                        {r.tags.map((t) => `#${t}`).join(" ")}
                      </div>
                    </Td>
                    <Td className="whitespace-nowrap text-[12.5px]">{REFERENCE_MATERIAL_TYPE_LABEL[r.type]}</Td>
                    <Td className="whitespace-nowrap text-[12.5px]">{r.area ? LEGAL_AREA_LABEL[r.area] : "—"}</Td>
                    <Td className="max-w-[240px] text-[12.5px]">{links.length ? <span className="line-clamp-2">{links.join(", ")}</span> : <span className="text-subtle">Nenhum</span>}</Td>
                    <Td>
                      <StatusBadge status={r.status} labels={REFERENCE_MATERIAL_STATUS_LABEL} tones={REFERENCE_MATERIAL_STATUS_TONE} />
                    </Td>
                    <Td className="whitespace-nowrap tabular text-[12.5px]">{formatDate(r.updatedAt)}</Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        )}
      </Panel>
    </section>
  );
}

const TYPE_OPTIONS = REFERENCE_MATERIAL_TYPES.map((t) => ({ value: t, label: REFERENCE_MATERIAL_TYPE_LABEL[t] }));
const AREA_OPTIONS = LEGAL_AREAS.map((a) => ({ value: a, label: LEGAL_AREA_LABEL[a] }));

function CreateReferenceDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const toast = useToast();
  const skills = useSkills();
  const theses = useTheses();
  const agents = useAgents();
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [type, setType] = useState<ReferenceMaterialType | "">("");
  const [description, setDescription] = useState("");
  const [area, setArea] = useState<LegalArea | "">("");
  const [tags, setTags] = useState("");
  const [file, setFile] = useState<{ name: string; sizeKb: number }>();
  const [skillIds, setSkillIds] = useState<string[]>([]);
  const [thesisIds, setThesisIds] = useState<string[]>([]);
  const [agentIds, setAgentIds] = useState<string[]>([]);
  const [errors, setErrors] = useState<{ title?: string; type?: string; description?: string }>({});
  const [saving, setSaving] = useState(false);

  function close() {
    setTitle("");
    setType("");
    setDescription("");
    setArea("");
    setTags("");
    setFile(undefined);
    setSkillIds([]);
    setThesisIds([]);
    setAgentIds([]);
    setErrors({});
    onOpenChange(false);
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    const found = {
      title: title.trim() ? undefined : "Informe o nome da referência.",
      type: type ? undefined : "Selecione a categoria.",
      description: description.trim() ? undefined : "Descreva quando usar esta referência.",
    };
    setErrors(found);
    if (found.title || found.type || found.description || !type) return;
    setSaving(true);
    try {
      await repositories.references.create({
        title: title.trim(),
        type,
        description: description.trim(),
        area: area || undefined,
        file,
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        skillIds,
        thesisIds,
        agentIds,
      });
      toast({ tone: "success", title: "Referência adicionada", description: "Registrada no histórico de auditoria." });
      close();
    } catch (error) {
      toast({ tone: "danger", title: "Não foi possível adicionar a referência.", description: error instanceof Error ? error.message : undefined });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      open={open}
      onOpenChange={(o) => (o ? onOpenChange(true) : close())}
      width={720}
      title="Adicionar referência"
      description="Material de apoio para os agentes. Somente Administrador."
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancelar
          </Button>
          <Button onClick={() => submit()} loading={saving}>
            Adicionar referência
          </Button>
        </>
      }
    >
      <form noValidate onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-[minmax(0,1fr)_240px] gap-4">
          <Field label="Nome" requirement="required" error={errors.title}>
            {(a) => <Input {...a} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />}
          </Field>
          <Field label="Categoria" requirement="required" error={errors.type}>
            {(a) => <Select {...a} value={type} onChange={(e) => setType(e.target.value as ReferenceMaterialType)} options={TYPE_OPTIONS} placeholder="Selecione" />}
          </Field>
        </div>
        <Field label="Descrição" requirement="required" error={errors.description} hint="Quando e como os agentes devem usar este material.">
          {(a) => <Textarea {...a} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />}
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Área" requirement="optional">
            {(a) => <Select {...a} value={area} onChange={(e) => setArea(e.target.value as LegalArea)} options={AREA_OPTIONS} placeholder="Todas as áreas" />}
          </Field>
          <Field label="Tags" requirement="optional" hint="Separadas por vírgula.">
            {(a) => <Input {...a} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="consignado, revisional" />}
          </Field>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface-muted px-3 py-2.5 text-[12.5px]">
          <span className="inline-flex min-w-0 items-center gap-2">
            <Paperclip className="size-4 shrink-0 text-subtle" aria-hidden />
            {file ? (
              <span className="truncate text-foreground">
                {file.name} <span className="text-muted">· {file.sizeKb} KB</span>
              </span>
            ) : (
              <span className="text-muted">Nenhum arquivo selecionado (opcional)</span>
            )}
          </span>
          <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()}>
            {file ? "Trocar arquivo" : "Selecionar arquivo"}
          </Button>
          <input
            ref={fileRef}
            type="file"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) setFile({ name: f.name, sizeKb: Math.max(1, Math.round(f.size / 1024)) });
              e.target.value = "";
            }}
          />
        </div>
        <p className="text-[12px] text-subtle">Protótipo: somente os metadados do arquivo são registrados. O envio real será feito pelo backend.</p>
        <div className="grid grid-cols-3 gap-4">
          <CheckboxList legend="Skills" options={skills.map((s) => ({ value: s.id, label: s.name }))} value={skillIds} onChange={setSkillIds} />
          <CheckboxList legend="Teses" options={theses.map((t) => ({ value: t.id, label: t.name }))} value={thesisIds} onChange={setThesisIds} />
          <CheckboxList legend="Agentes" options={agents.map((a) => ({ value: a.id, label: a.name }))} value={agentIds} onChange={setAgentIds} />
        </div>
      </form>
    </Drawer>
  );
}
