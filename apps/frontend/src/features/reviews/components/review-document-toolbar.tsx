"use client";

import { useState } from "react";
import { Bot, Download, FileDown, FilePen, FileText, PenLine } from "lucide-react";
import { REVIEW_CONTENT_ORIGIN_LABEL, VERSION_APPROVAL_STATUS_LABEL } from "@/lib/constants/status";
import { formatSince } from "@/lib/formatting";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Select, Textarea } from "@/components/ui/form";
import { MenuButton } from "@/components/ui/menu";
import type { DocumentVersion, Review } from "@/types";
import { useReviewActions } from "../hooks";

const APPROVAL_TONE = { PENDING: "gold", APPROVED: "success", SUPERSEDED: "neutral" } as const;

/**
 * Ações DO DOCUMENTO (separadas das ações de decisão): versão exibida,
 * Editar ▾ (com agente / manualmente) e Baixar ▾ (PDF / DOCX).
 */
export function ReviewDocumentToolbar({
  review,
  versions,
  viewed,
  onSelectVersion,
  canEdit,
  onEditManually,
}: {
  review: Review;
  versions: DocumentVersion[];
  viewed: DocumentVersion;
  onSelectVersion: (versionNumber: number) => void;
  /** Revisão em aberto + permissão de decidir + vendo a versão atual. */
  canEdit: boolean;
  onEditManually: () => void;
}) {
  const { download } = useReviewActions();
  const [agentOpen, setAgentOpen] = useState(false);
  const approved = viewed.approvalStatus === "APPROVED";
  const downloadLabel = approved ? "Baixar versão aprovada" : "Baixar rascunho";

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface px-5 py-3">
      <div className="min-w-0">
        <p className="flex items-center gap-2 truncate text-[13.5px] font-semibold text-foreground">
          <FileText className="size-4 shrink-0 text-navy-700" aria-hidden />
          <span className="truncate">
            {viewed.content.title} — Versão {viewed.versionNumber}
          </span>
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
          <span>
            Versão {viewed.versionNumber} · atualizada {formatSince(viewed.createdAt)}
          </span>
          <Badge tone={APPROVAL_TONE[viewed.approvalStatus]}>{VERSION_APPROVAL_STATUS_LABEL[viewed.approvalStatus]}</Badge>
          {viewed.source !== "AGENT" && (
            <Badge tone="neutral" icon={viewed.source === "MANUAL_EDIT" ? <FilePen className="size-3" aria-hidden /> : <Bot className="size-3" aria-hidden />}>
              {viewed.source === "MANUAL_EDIT" ? "Editado manualmente" : REVIEW_CONTENT_ORIGIN_LABEL.AGENT_EDIT}
            </Badge>
          )}
          {!approved && <span className="font-medium text-danger">Rascunho</span>}
        </p>
      </div>

      <div className="flex items-center gap-2">
        {versions.length > 1 && (
          <Select
            aria-label="Versão exibida"
            value={String(viewed.versionNumber)}
            onChange={(e) => onSelectVersion(Number(e.target.value))}
            options={versions.map((v) => ({
              value: String(v.versionNumber),
              label: `Versão ${v.versionNumber}${v.current ? " (atual)" : ""} — ${VERSION_APPROVAL_STATUS_LABEL[v.approvalStatus].toLowerCase()}`,
            }))}
            className="h-8 w-[250px] text-[12.5px]"
          />
        )}
        {canEdit && (
          <MenuButton
            label="Editar"
            icon={<PenLine className="size-3.5" aria-hidden />}
            items={[
              {
                key: "agent",
                label: "Editar com agente",
                description: "Descreva a alteração; o agente gera uma nova versão.",
                icon: <Bot className="size-4" aria-hidden />,
                onSelect: () => setAgentOpen(true),
              },
              {
                key: "manual",
                label: "Editar manualmente",
                description: "Altere o texto diretamente no editor.",
                icon: <FilePen className="size-4" aria-hidden />,
                onSelect: onEditManually,
              },
            ]}
          />
        )}
        <MenuButton
          label={downloadLabel}
          variant={approved ? "primary" : "secondary"}
          icon={<Download className="size-3.5" aria-hidden />}
          items={(["PDF", "DOCX"] as const).map((format) => ({
            key: format,
            label: `Baixar ${format}`,
            description: approved ? `Versão aprovada v${viewed.versionNumber}` : `Rascunho v${viewed.versionNumber} — marcado como não aprovado`,
            icon: <FileDown className="size-4" aria-hidden />,
            onSelect: () => void download(review, viewed.versionNumber, format),
          }))}
        />
      </div>

      {agentOpen && <AgentEditDialog review={review} onClose={() => setAgentOpen(false)} />}
    </div>
  );
}

/** "Editar com agente": o advogado comanda diretamente uma nova versão. */
function AgentEditDialog({ review, onClose }: { review: Review; onClose: () => void }) {
  const { requestAgentEdit } = useReviewActions();
  const [instruction, setInstruction] = useState("");
  const [error, setError] = useState<string>();
  const [sending, setSending] = useState(false);
  const current = review.contentVersion ?? 1;

  async function submit() {
    if (instruction.trim().length < 5) return setError("Descreva o que deve ser alterado.");
    setSending(true);
    const ok = await requestAgentEdit(review, instruction);
    setSending(false);
    if (ok) onClose();
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Editar com agente"
      description={`O agente gera a versão ${current + 1} a partir da sua instrução. A versão ${current} fica preservada e a nova versão volta para sua decisão.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button icon={<Bot className="size-4" aria-hidden />} onClick={submit} loading={sending}>
            Solicitar alteração ao agente
          </Button>
        </>
      }
    >
      <Field label="O que deseja alterar?" requirement="required" error={error}>
        {(p) => (
          <Textarea
            {...p}
            rows={5}
            value={instruction}
            placeholder="Ex.: Reduza a introdução e reescreva o terceiro parágrafo deixando a argumentação mais objetiva."
            onChange={(e) => {
              setInstruction(e.target.value);
              setError(undefined);
            }}
          />
        )}
      </Field>
      <p className="mt-3 text-[12px] text-subtle">Protótipo: a reescrita é simulada — a nova versão registra a instrução e mantém o texto.</p>
    </Dialog>
  );
}
