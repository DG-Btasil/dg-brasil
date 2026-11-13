import { DOCUMENT_CATEGORIES, type DocumentCategory } from "@/lib/constants/status";
import { documentListInput } from "@/features/documents/constants";
import type { UploadTarget } from "@/features/documents/components/upload-dialog";
import type { DocumentListItem } from "@/server/domain/documents/dto";
import type { ReviewDetailDTO } from "@/server/domain/reviews/dto";
import type { ID, ISODateTime } from "@/types";

/**
 * "Anexar documento" na tela da revisão. Regras puras e testadas; o envio é o
 * MESMO da aba Documentos do caso (UploadDialog) e o servidor confere tudo de
 * novo. O documento anexado é um documento normal do caso: a revisão não muda.
 */

export type ReviewUploadTarget = Extract<UploadTarget, { kind: "new" }> & { legalCaseId: ID };

const text = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/** Pedido de documento do agente: categoria e nome pedidos já vêm preenchidos no envio (quem envia pode trocar). */
function requestedDocument(target: ReviewDetailDTO["target"]): Pick<ReviewUploadTarget, "defaultCategory" | "defaultTitle"> {
  if (target?.kind !== "AGENT_PROPOSAL" || target.proposalType !== "REQUEST_DOCUMENT") return {};
  // Payload do worker: { summary, data }; o pedido em si está em `data`.
  const inner = target.payload.data;
  const data = inner && typeof inner === "object" && !Array.isArray(inner) ? (inner as Record<string, unknown>) : target.payload;
  const category = (DOCUMENT_CATEGORIES as readonly string[]).includes(String(data.category)) ? (data.category as DocumentCategory) : undefined;
  const title = text(data.label)?.slice(0, 200);
  return { ...(category ? { defaultCategory: category } : {}), ...(title ? { defaultTitle: title } : {}) };
}

/**
 * Para onde vai o documento anexado: o caso da revisão (e o processo, quando a
 * revisão é de um processo — o servidor confere que ele é do caso). Revisão
 * sem caso (ex.: proposta de configuração do DG Brasil) não aceita anexo: null.
 */
export function reviewUploadTarget(review: Pick<ReviewDetailDTO, "legalCaseId" | "processId" | "target">): ReviewUploadTarget | null {
  if (!review.legalCaseId) return null;
  return {
    kind: "new",
    legalCaseId: review.legalCaseId,
    ...(review.processId ? { legalProcessId: review.processId } : {}),
    ...requestedDocument(review.target),
  };
}

/** Aba Documentos do caso (`?aba=` de features/cases/components/case-detail.tsx). */
export function caseDocumentsHref(legalCaseId: ID): string {
  return `/casos/${legalCaseId}?aba=documentos`;
}

/** Quem ainda decide a revisão: quem está na tela, outra pessoa (ex.: só administrador) ou ninguém (já decidida). */
export type ReviewDecisionPending = "MINE" | "OTHERS" | "NONE";

export function attachHelpText(pending: ReviewDecisionPending): string {
  const base = "O documento entra nos documentos do caso.";
  if (pending === "MINE") return `${base} A revisão continua aguardando a sua decisão.`;
  if (pending === "OTHERS") return `${base} A revisão continua aguardando decisão.`;
  return base;
}

/** Documentos mais novos do caso primeiro (entrada de `listDocumentsAction`; o servidor valida de novo). */
export function recentCaseDocumentsInput(legalCaseId: ID) {
  return { ...documentListInput({ legalCaseId }), sortBy: "createdAt" as const, sortDirection: "desc" as const };
}

/** Enviado por "Anexar documento" nesta visita à tela (o banco já confirmou). */
export interface SessionUpload {
  documentId: ID;
  title: string;
  attachedAt: ISODateTime;
}

export interface AttachedDocument {
  documentId: ID;
  title: string;
  category?: string;
  attachedAt: ISODateTime;
  /** Enviado por esta tela, nesta visita. */
  fromThisVisit: boolean;
}

/**
 * Lista de "Documentos anexados nesta revisão": os enviados por esta tela
 * nesta visita + os ARQUIVOS ENVIADOS ao caso depois que a revisão foi criada
 * (assim a lista sobrevive a recarregar a página). Material gerado por agente,
 * importado ou sem arquivo não entra. Mais novos primeiro, sem repetir.
 */
export function attachedDocuments(session: readonly SessionUpload[], caseDocuments: readonly DocumentListItem[], reviewCreatedAt: ISODateTime): AttachedDocument[] {
  const since = Date.parse(reviewCreatedAt);
  const visit = new Map(session.map((s) => [s.documentId, s]));
  const fromCase: AttachedDocument[] = caseDocuments
    .filter((d) => d.status === "ACTIVE" && d.surface === "INTERNAL" && d.currentVersion?.source === "UPLOAD")
    .filter((d) => visit.has(d.id) || Date.parse(d.createdAt) >= since)
    .map((d) => ({ documentId: d.id, title: d.title, category: d.category, attachedAt: d.createdAt, fromThisVisit: visit.has(d.id) }));
  const listed = new Set(fromCase.map((d) => d.documentId));
  const onlyHere: AttachedDocument[] = session.filter((s) => !listed.has(s.documentId)).map((s) => ({ ...s, fromThisVisit: true }));
  return [...onlyHere, ...fromCase].sort((a, b) => Date.parse(b.attachedAt) - Date.parse(a.attachedAt));
}
