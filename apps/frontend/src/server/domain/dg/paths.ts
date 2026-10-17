import { sanitizeFilename } from "@/server/domain/documents/storage";

/** Buckets e caminhos da área DG Brasil (puros; o banco confere o mesmo padrão na 039). */
export const SKILL_FILES_BUCKET = "skill-files";
export const REFERENCE_BUCKET = "reference-materials";

export const skillObjectName = (skillId: string, versionId: string, path: string) => `skills/${skillId}/${versionId}/${path}`;
export const referenceObjectName = (referenceId: string, versionId: string, fileName: string) =>
  `references/${referenceId}/${versionId}/${sanitizeFilename(fileName)}`;
