import { z } from "zod";
import { zUuid } from "@/server/core/validation";

/** Entradas do Google Drive (041). O banco revalida (papel, cliente, formato do ID). */
export const driveFolderId = z.string().trim().regex(/^[A-Za-z0-9_-]{10,200}$/, "ID de pasta do Drive inválido.");

export const searchFoldersSchema = z.object({ term: z.string().trim().max(100).default("") });
export const clientIdSchema = z.object({ clientId: zUuid() });
export const linkFolderSchema = z.object({ clientId: zUuid(), folderId: driveFolderId });
