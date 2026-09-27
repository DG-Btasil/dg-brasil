"use client";

import { Upload } from "lucide-react";
import { Can } from "@/components/layout/guards";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel, PanelHeader } from "@/components/ui/panel";
import type { DocumentCategory, DocumentStatus } from "@/lib/constants/status";
import { isDocumentSatisfied, recommendedDocumentsFor, requiredDocumentsFor } from "@/lib/domain/analysis";
import type { AnalysisTemplate, Client, ClientDocument, DocumentRequirement } from "@/types";
import { DocumentStatusLabel } from "./document-status-icon";

const STATUS_PRIORITY: Record<DocumentStatus, number> = { RECEIVED: 0, PENDING: 1, NEEDS_UPDATE: 2, REJECTED: 3, MISSING: 4 };

/** Melhor situação disponível para uma categoria entre os documentos do cliente. */
export function categoryStatus(category: DocumentCategory, documents: ClientDocument[]): DocumentStatus {
  const matches = documents.filter((d) => d.category === category);
  if (matches.length === 0) return "MISSING";
  return matches.map((d) => d.status).sort((a, b) => STATUS_PRIORITY[a] - STATUS_PRIORITY[b])[0] ?? "MISSING";
}

function Row({ req, kind, documents, onAdd }: { req: DocumentRequirement; kind: "required" | "recommended"; documents: ClientDocument[]; onAdd: (c: DocumentCategory) => void }) {
  const status = categoryStatus(req.category, documents);
  const satisfied = status === "RECEIVED" || status === "PENDING";
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_170px_110px] items-center gap-4 px-5 py-2.5">
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-[13px] text-foreground">
          {req.label}
          {kind === "recommended" && <Badge tone="neutral">Recomendado</Badge>}
        </p>
        {req.description && <p className="text-[12px] text-muted">{req.description}</p>}
      </div>
      <DocumentStatusLabel status={status} />
      <div className="text-right">
        {!satisfied && (
          <Can permission="documents.manage">
            <Button variant="ghost" size="sm" icon={<Upload className="size-3.5" aria-hidden />} onClick={() => onAdd(req.category)} aria-label={`Enviar ${req.label}`}>
              Enviar
            </Button>
          </Can>
        )}
      </div>
    </li>
  );
}

export function DocumentChecklist({
  template,
  client,
  documents,
  reference,
  onAdd,
}: {
  template: AnalysisTemplate;
  client: Client;
  documents: ClientDocument[];
  /** Sem análise: o checklist é apenas referência. */
  reference: boolean;
  onAdd: (category: DocumentCategory) => void;
}) {
  const required = requiredDocumentsFor(template, client);
  const recommended = recommendedDocumentsFor(template, client);
  const done = required.filter((r) => documents.some((d) => d.category === r.category && isDocumentSatisfied(d))).length;
  return (
    <Panel>
      <PanelHeader
        title={reference ? "Checklist de referência" : "Checklist da análise"}
        description={
          reference
            ? `Baseado no modelo “${template.name}”. Nenhuma análise foi iniciada para este cliente.`
            : `Documentos exigidos pela ${template.name}.`
        }
        actions={
          <span className="text-[12.5px] text-muted">
            <span className="tabular font-semibold text-foreground">
              {done}/{required.length}
            </span>{" "}
            obrigatórios atendidos
          </span>
        }
      />
      <ul className="divide-y divide-line" aria-label="Documentos exigidos">
        {required.map((r) => (
          <Row key={`req-${r.category}`} req={r} kind="required" documents={documents} onAdd={onAdd} />
        ))}
        {recommended.map((r) => (
          <Row key={`rec-${r.category}`} req={r} kind="recommended" documents={documents} onAdd={onAdd} />
        ))}
      </ul>
    </Panel>
  );
}
