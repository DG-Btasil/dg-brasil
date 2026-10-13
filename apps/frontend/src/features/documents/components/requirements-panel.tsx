"use client";

import { useMemo, useState } from "react";
import { ClipboardList, Download, FilePlus2 } from "lucide-react";
import { DOCUMENT_CATEGORIES, DOCUMENT_CATEGORY_LABEL, type DocumentCategory } from "@/lib/constants/status";
import { formatDate } from "@/lib/formatting";
import type { ActionResult } from "@/lib/actions/result";
import { Can } from "@/components/layout/guards";
import { ActionErrorState } from "@/components/feedback/action-error";
import { EmptyState } from "@/components/feedback/states";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select } from "@/components/ui/form";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import type { Page } from "@/server/core/pagination";
import type { DocumentListItem } from "@/server/domain/documents/dto";
import type { RequirementDTO } from "@/server/domain/documents/requirements/dto";
import { usePermission } from "@/features/auth/hooks";
import { REQUIREMENT_STATUS_LABEL, REQUIREMENT_STATUS_TONE } from "../constants";
import { useDocumentActions } from "../use-document-actions";

const CATEGORY_OPTIONS = DOCUMENT_CATEGORIES.map((c) => ({ value: c, label: DOCUMENT_CATEGORY_LABEL[c] }));
const label = (category: string) => DOCUMENT_CATEGORY_LABEL[category as DocumentCategory] ?? category;

/**
 * Pendências documentais do caso ("o que falta"). Não são arquivos: cada uma
 * é atendida por uma VERSÃO concreta de documento do caso e depois aprovada
 * ou rejeitada (decisão jurídica). A tela distingue "solicitado" de
 * "arquivo recebido"; o banco confere que a versão é do mesmo cliente e está
 * vinculada ao caso.
 */
export function RequirementsPanel({
  legalCaseId,
  requirements,
  documents,
}: {
  legalCaseId: string;
  requirements: ActionResult<Page<RequirementDTO>>;
  /** Documentos do caso (para escolher o arquivo que atende a pendência). */
  documents: ActionResult<Page<DocumentListItem>>;
}) {
  const actions = useDocumentActions();
  const canManage = usePermission("documents.manage");
  const canDecide = usePermission("reviews.decide");
  const [creating, setCreating] = useState(false);
  const [satisfying, setSatisfying] = useState<RequirementDTO | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const byVersion = useMemo(() => {
    const map = new Map<string, DocumentListItem>();
    if (documents.ok) for (const d of documents.data.items) if (d.currentVersion) map.set(d.currentVersion.id, d);
    return map;
  }, [documents]);

  async function act(id: string, run: () => Promise<unknown>) {
    setBusy(id);
    await run();
    setBusy(null);
  }

  if (!requirements.ok) return <ActionErrorState error={requirements} title="Não foi possível carregar as pendências do caso." />;
  const items = requirements.data.items;
  const required = items.filter((r) => r.required);
  const done = required.filter((r) => r.status === "APPROVED").length;

  return (
    <Panel>
      <PanelHeader
        title="Pendências documentais"
        description="O que falta para o caso. Cada pendência é atendida por um arquivo enviado e depois aprovada."
        actions={
          <div className="flex items-center gap-3">
            {required.length > 0 && (
              <span className="text-[12.5px] text-muted">
                <span className="tabular font-semibold text-foreground">
                  {done}/{required.length}
                </span>{" "}
                obrigatórias aprovadas
              </span>
            )}
            <Can permission="documents.manage">
              <Button size="sm" variant="secondary" icon={<FilePlus2 className="size-4" aria-hidden />} onClick={() => setCreating(true)}>
                Nova pendência
              </Button>
            </Can>
          </div>
        }
      />
      {items.length === 0 ? (
        <EmptyState compact icon={ClipboardList} title="Nenhuma pendência registrada." description="Registre os documentos que o caso precisa para acompanhar o que falta." />
      ) : (
        <Table caption="Pendências documentais do caso">
          <THead>
            <tr>
              <Th>Documento necessário</Th>
              <Th>Categoria</Th>
              <Th>Situação</Th>
              <Th>Arquivo</Th>
              <Th className="text-right">
                <span className="sr-only">Ações</span>
              </Th>
            </tr>
          </THead>
          <TBody>
            {items.map((r) => {
              const versionId = r.surface === "INTERNAL" ? r.satisfiedByDocumentVersionId : undefined;
              const doc = versionId ? byVersion.get(versionId) : undefined;
              return (
                <Tr key={r.id}>
                  <Td className="max-w-[280px]">
                    <span className="block truncate font-medium text-foreground">{r.label}</span>
                    {!r.required && <Badge tone="neutral">Opcional</Badge>}
                  </Td>
                  <Td className="whitespace-nowrap text-[12.5px]">{label(r.category)}</Td>
                  <Td>
                    <StatusBadge status={r.status} labels={REQUIREMENT_STATUS_LABEL} tones={REQUIREMENT_STATUS_TONE} />
                    {r.requestedAt && r.status === "REQUESTED" && <span className="ml-2 text-[11.5px] text-muted">desde {formatDate(r.requestedAt)}</span>}
                  </Td>
                  <Td className="max-w-[220px] text-[12.5px]">
                    {versionId ? (
                      doc ? (
                        <Button
                          size="sm"
                          variant="link"
                          icon={<Download className="size-3.5" aria-hidden />}
                          disabled={!!busy}
                          onClick={() => act(`dl:${r.id}`, () => actions.download(doc.id, versionId))}
                        >
                          <span className="truncate">{doc.title}</span>
                        </Button>
                      ) : (
                        <span className="text-muted">Versão anterior de um documento do caso</span>
                      )
                    ) : (
                      <span className="text-subtle">Nenhum arquivo</span>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap text-right">
                    <div className="inline-flex items-center gap-1">
                      {canManage && (r.status === "MISSING" || r.status === "REJECTED") && (
                        <Button size="sm" variant="ghost" loading={busy === r.id} disabled={!!busy} onClick={() => act(r.id, () => actions.requestRequirement(r.id))}>
                          {r.status === "REJECTED" ? "Solicitar de novo" : "Solicitar"}
                        </Button>
                      )}
                      {canManage && (r.status === "MISSING" || r.status === "REQUESTED" || r.status === "REJECTED") && (
                        <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => setSatisfying(r)}>
                          Registrar recebimento
                        </Button>
                      )}
                      {canDecide && r.status === "RECEIVED" && (
                        <>
                          <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => act(r.id, () => actions.rejectRequirement(r.id))}>
                            Rejeitar
                          </Button>
                          <Button size="sm" variant="secondary" loading={busy === r.id} disabled={!!busy} onClick={() => act(r.id, () => actions.approveRequirement(r.id))}>
                            Aprovar
                          </Button>
                        </>
                      )}
                    </div>
                  </Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      )}
      {creating && <CreateRequirementDialog legalCaseId={legalCaseId} onClose={() => setCreating(false)} />}
      {satisfying && <SatisfyDialog requirement={satisfying} documents={documents} onClose={() => setSatisfying(null)} />}
    </Panel>
  );
}

function CreateRequirementDialog({ legalCaseId, onClose }: { legalCaseId: string; onClose: () => void }) {
  const actions = useDocumentActions();
  const [labelText, setLabelText] = useState("");
  const [category, setCategory] = useState("");
  const [required, setRequired] = useState(true);
  const [requestNow, setRequestNow] = useState(true);
  const [errors, setErrors] = useState<{ label?: string; category?: string }>({});
  const [saving, setSaving] = useState(false);

  async function save() {
    const found = { label: labelText.trim() ? undefined : "Descreva o documento.", category: category ? undefined : "Selecione a categoria." };
    setErrors(found);
    if (found.label || found.category) return;
    setSaving(true);
    const r = await actions.createRequirement({ legalCaseId, label: labelText.trim(), category, required, requestNow });
    setSaving(false);
    if (r.ok) onClose();
    else setErrors({ label: r.error.fieldErrors?.label?.[0], category: r.error.fieldErrors?.category?.[0] });
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !saving && onClose()}
      title="Nova pendência documental"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={save} loading={saving}>
            Registrar pendência
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Documento necessário" requirement="required" error={errors.label}>
          {(p) => <Input {...p} value={labelText} maxLength={200} onChange={(e) => setLabelText(e.target.value)} placeholder="Ex.: Extrato do INSS dos últimos 12 meses" autoFocus />}
        </Field>
        <Field label="Categoria" requirement="required" error={errors.category}>
          {(p) => <Select {...p} value={category} onChange={(e) => setCategory(e.target.value)} options={CATEGORY_OPTIONS} placeholder="Selecione" />}
        </Field>
        <Checkbox label="Obrigatória" checked={required} onChange={(e) => setRequired(e.target.checked)} />
        <Checkbox label="Já solicitar ao cliente/parceiro" description="A pendência nasce como “Solicitado”." checked={requestNow} onChange={(e) => setRequestNow(e.target.checked)} />
      </div>
    </Dialog>
  );
}

/** Atende a pendência com a versão ATUAL de um documento do caso (o banco confere cliente e vínculo). */
function SatisfyDialog({ requirement, documents, onClose }: { requirement: RequirementDTO; documents: ActionResult<Page<DocumentListItem>>; onClose: () => void }) {
  const actions = useDocumentActions();
  const options = useMemo(
    () =>
      documents.ok
        ? documents.data.items
            .filter((d) => d.currentVersion && d.status === "ACTIVE")
            .sort((a, b) => Number(b.category === requirement.category) - Number(a.category === requirement.category))
            .map((d) => ({ value: d.currentVersion!.id, label: `${d.title} · v${d.currentVersion!.versionNumber}${d.category === requirement.category ? "" : ` · ${label(d.category)}`}` }))
        : [],
    [documents, requirement.category],
  );
  const [versionId, setVersionId] = useState(options[0]?.value ?? "");
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!versionId) return setError("Escolha o arquivo.");
    setSaving(true);
    const r = await actions.satisfyRequirement(requirement.id, versionId);
    setSaving(false);
    if (r.ok) onClose();
    else setError(r.error.fieldErrors?.documentVersionId?.[0]);
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !saving && onClose()}
      title="Registrar recebimento"
      description={`Pendência: “${requirement.label}”. Escolha o arquivo do caso que a atende.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={save} loading={saving} disabled={!options.length}>
            Registrar recebimento
          </Button>
        </>
      }
    >
      {options.length === 0 ? (
        <p className="text-[13px] text-muted">Nenhum documento com arquivo neste caso. Envie o arquivo em “Documentos do caso” e volte aqui.</p>
      ) : (
        <Field label="Arquivo" requirement="required" error={error} hint="Documentos da mesma categoria aparecem primeiro.">
          {(p) => <Select {...p} value={versionId} onChange={(e) => setVersionId(e.target.value)} options={options} />}
        </Field>
      )}
    </Dialog>
  );
}
