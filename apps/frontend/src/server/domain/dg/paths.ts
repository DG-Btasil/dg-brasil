import { sanitizeFilename } from "@/server/domain/documents/storage";

/** Buckets e caminhos da área DG Brasil (puros; o banco confere o mesmo padrão na 039). */
export const REFERENCE_BUCKET = "reference-materials";

export const referenceObjectName = (referenceId: string, versionId: string, fileName: string) =>
  `references/${referenceId}/${versionId}/${sanitizeFilename(fileName)}`;
