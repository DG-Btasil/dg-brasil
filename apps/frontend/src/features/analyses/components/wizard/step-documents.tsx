"use client";

import { ExternalLink } from "lucide-react";
import { Callout } from "@/components/feedback/states";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { DOCUMENT_CATEGORY_LABEL, type DocumentCategory } from "@/lib/constants/status";
import { recommendedDocumentsFor, requiredDocumentsFor } from "@/lib/domain/analysis";
import type { AnalysisTemplate, Client, ClientDocument } from "@/types";
import { categoryStatus } from "@/features/clients/components/detail/documents/document-checklist";
import { DocumentStatusLabel } from "@/features/clients/components/detail/documents/document-status-icon";

export function StepDocuments({
  template,
  client,
  documents,
  missing,
}: {
  template: AnalysisTemplate;
  client: Client;
  documents: ClientDocument[];
  missing: DocumentCategory[];
}) {
  const rows = [
    ...requiredDocumentsFor(template, client).map((r) => ({ ...r, kind: "required" as const })),
    ...recommendedDocumentsFor(template, client).map((r) => ({ ...r, kind: "recommended" as const })),
  ];
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-[15px] font-semibold text-foreground">Verificar documentação</h2>
        <p className="mt-0.5 text-[13px] text-muted">Documentos exigidos pela {template.name} para {client.kind === "INDIVIDUAL" ? "pessoa física" : "pessoa jurídica"}.</p>
      </div>
      {missing.length > 0 ? (
        <Callout
          tone="warning"
          title="Para continuar a análise, ainda são necessários os seguintes documentos."
          action={
            <ButtonLink href={`/clientes/${client.id}?aba=documentos`} variant="secondary" size="sm" icon={<ExternalLink className="size-3.5" aria-hidden />}>
              Adicionar documentos
            </ButtonLink>
          }
        >
          <p>{missing.map((c) => DOCUMENT_CATEGORY_LABEL[c]).join(", ")}.</p>
          <p className="mt-1">Você pode continuar mesmo assim: a análise ficará aguardando os documentos e seguirá ao agente quando estiverem completos.</p>
        </Callout>
      ) : (
        <Callout tone="success" title="Documentação pronta para análise.">
          Todos os documentos obrigatórios foram recebidos.
        </Callout>
      )}
      <Panel>
        <Table caption="Documentos exigidos pela análise">
          <THead>
            <tr>
              <Th>Documento</Th>
              <Th>Exigência</Th>
              <Th>Situação</Th>
            </tr>
          </THead>
          <TBody>
            {rows.map((r) => (
              <Tr key={`${r.kind}-${r.category}`}>
                <Td>
                  <span className="block text-foreground">{r.label}</span>
                  {r.description && <span className="block text-[12px] text-muted">{r.description}</span>}
                </Td>
                <Td>
                  <Badge tone={r.kind === "required" ? "navy" : "neutral"}>{r.kind === "required" ? "Obrigatório" : "Recomendado"}</Badge>
                </Td>
                <Td>
                  <DocumentStatusLabel status={categoryStatus(r.category, documents)} />
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </Panel>
    </div>
  );
}
