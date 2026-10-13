import type { DocumentVerification, DocumentVisibility } from "@/lib/constants/status";
import type { ID, ISODateTime } from "@/types";

/**
 * DTOs de documento POR CONTEXTO. O do parceiro não tem campo interno
 * (descrição, autor, origem da versão, aprovação, observações, caminho no
 * Storage): não há como devolvê-los por engano.
 *
 * O caminho do objeto no Storage nunca sai do servidor (nem para a equipe
 * interna): o navegador recebe só URLs assinadas de curta duração.
 */

/** Aprovação da versão (revisão com alvo document_version_id) — view document_version_approvals. */
export type DocumentApprovalStatus = "APPROVED" | "REJECTED" | "SUPERSEDED" | "PENDING";

export type DocumentStatusDb = "ACTIVE" | "ARCHIVED";

/** Versão (arquivo imutável) — visão interna. */
export interface DocumentVersionInternalDTO {
  id: ID;
  versionNumber: number;
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
  source: "UPLOAD" | "AGENT" | "MANUAL_EDIT" | "IMPORT" | "EXTERNAL";
  createdBy?: ID;
  createdAt: ISODateTime;
  verification: DocumentVerification;
  verifiedAt?: ISODateTime;
  approval: DocumentApprovalStatus;
}

/** Versão — visão do parceiro: arquivo e verificação, sem aprovação nem autor. */
export interface DocumentVersionPartnerDTO {
  id: ID;
  versionNumber: number;
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
  createdAt: ISODateTime;
  verification: DocumentVerification;
}

/** Linha da listagem — interno. */
export interface DocumentListItemInternal {
  id: ID;
  clientId: ID;
  category: string;
  title: string;
  visibility: DocumentVisibility;
  status: DocumentStatusDb;
  createdBy?: ID;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  currentVersion?: DocumentVersionInternalDTO;
}

/** Linha da listagem — parceiro (sempre PARTNER_VISIBLE, por RLS). */
export interface DocumentListItemPartner {
  id: ID;
  clientId: ID;
  category: string;
  title: string;
  status: DocumentStatusDb;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  currentVersion?: DocumentVersionPartnerDTO;
}

export type DocumentListItem = ({ surface: "INTERNAL" } & DocumentListItemInternal) | ({ surface: "PARTNER" } & DocumentListItemPartner);

export interface DocumentInternalDTO extends Omit<DocumentListItemInternal, "currentVersion"> {
  description?: string;
  versions: DocumentVersionInternalDTO[];
  legalCaseIds: ID[];
  legalProcessIds: ID[];
}

export interface DocumentPartnerDTO extends Omit<DocumentListItemPartner, "currentVersion"> {
  versions: DocumentVersionPartnerDTO[];
  /** Só os casos/processos do próprio escritório (RLS). */
  legalCaseIds: ID[];
  legalProcessIds: ID[];
}

export type DocumentDetailDTO = { surface: "INTERNAL"; document: DocumentInternalDTO } | { surface: "PARTNER"; document: DocumentPartnerDTO };

/** Resposta do passo 1 do upload: o navegador envia o arquivo para `signedUrl` (ou `uploadToSignedUrl` com o token). */
export interface PreparedUploadDTO {
  documentId: ID;
  versionId: ID;
  signedUrl: string;
  token: string;
  /** Bucket privado (para `storage.from(bucket).uploadToSignedUrl(path, token, arquivo)`). */
  bucket: string;
  /**
   * Caminho do objeto, só para `uploadToSignedUrl` de quem acabou de pedir o
   * upload (o nome do arquivo é o que o próprio usuário escolheu). Não é
   * devolvido em nenhuma leitura.
   */
  path: string;
}

export interface ConfirmedUploadDTO {
  documentId: ID;
  versionId: ID;
  /** true quando a versão já tinha sido registrada (confirmação repetida). */
  alreadyConfirmed: boolean;
}

/** URL assinada de curta duração. Nunca é logada. */
export interface DownloadUrlDTO {
  documentId: ID;
  versionId: ID;
  url: string;
  expiresInSeconds: number;
}
