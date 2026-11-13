"use client";

import { useRole } from "@/features/auth/hooks";
import type { DocumentScope } from "./constants";
import { canUploadDocuments } from "./upload-permission";

/** Pode enviar documento neste escopo? (papel real do servidor; ver `canUploadDocuments`). */
export function useCanUploadDocuments(scope: DocumentScope, readOnly = false): boolean {
  return canUploadDocuments(useRole(), scope, readOnly);
}
