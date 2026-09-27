import type { DocumentCategory } from "@/lib/constants/status";
import type { AnalysisTemplate, Client, ClientDocument, DocumentRequirement } from "@/types";

/** Documento conta como entregue quando recebido ou aguardando verificação. */
export function isDocumentSatisfied(doc: ClientDocument): boolean {
  return doc.status === "RECEIVED" || doc.status === "PENDING";
}

export function requiredDocumentsFor(template: AnalysisTemplate, client: Pick<Client, "kind">): DocumentRequirement[] {
  return template.requiredDocuments.filter((r) => !r.appliesTo || r.appliesTo.includes(client.kind));
}

export function recommendedDocumentsFor(template: AnalysisTemplate, client: Pick<Client, "kind">): DocumentRequirement[] {
  return template.recommendedDocuments.filter((r) => !r.appliesTo || r.appliesTo.includes(client.kind));
}

/** Categorias obrigatórias ainda não atendidas pelos documentos do cliente. */
export function missingDocumentCategories(
  template: AnalysisTemplate,
  client: Pick<Client, "id" | "kind">,
  documents: ClientDocument[],
): DocumentCategory[] {
  const satisfied = new Set(
    documents.filter((d) => d.clientId === client.id && isDocumentSatisfied(d)).map((d) => d.category),
  );
  return requiredDocumentsFor(template, client)
    .map((r) => r.category)
    .filter((category) => !satisfied.has(category));
}
