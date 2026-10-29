import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { fromStorageError, LEGAL_DOCUMENTS_BUCKET } from "@/server/domain/documents/storage";

/**
 * Assinatura de URL para o computador do escritório. ÚNICO uso da service
 * role neste módulo, e só com um caminho que o BANCO acabou de autorizar para
 * a reserva (executor_open_document, executor_list_references,
 * executor_prepare_output). Nunca um caminho vindo do computador.
 *
 * Download: 2 minutos. Envio: write-once (upsert false), só no bucket de
 * documentos jurídicos.
 */

export type ExecutorBucket = typeof LEGAL_DOCUMENTS_BUCKET | "reference-materials";

export interface ExecutorStorage {
  signDownload(bucket: ExecutorBucket, objectName: string, filename: string): Promise<string>;
  signUpload(objectName: string): Promise<string>;
}

export const DOWNLOAD_URL_SECONDS = 120;

export function signedExecutorStorage(createAdmin = createSupabaseAdminClient): ExecutorStorage {
  return {
    async signDownload(bucket, objectName, filename) {
      if (bucket !== LEGAL_DOCUMENTS_BUCKET && bucket !== "reference-materials") throw new Error("bucket não permitido");
      const { data, error } = await createAdmin().storage.from(bucket).createSignedUrl(objectName, DOWNLOAD_URL_SECONDS, { download: filename });
      if (error || !data) throw fromStorageError(error as never);
      return data.signedUrl;
    },
    async signUpload(objectName) {
      const { data, error } = await createAdmin().storage.from(LEGAL_DOCUMENTS_BUCKET).createSignedUploadUrl(objectName, { upsert: false });
      if (error || !data) throw fromStorageError(error as never);
      return data.signedUrl;
    },
  };
}
