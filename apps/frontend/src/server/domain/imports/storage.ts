import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { DomainError } from "@/server/core/errors";
import { fromStorageError } from "@/server/domain/documents/storage";

/**
 * Arquivo da importação no bucket privado `imports` (017).
 *
 * Mesmo padrão dos documentos (signed-storage.ts): o usuário não assina URL
 * (política RESTRICTIVE da 017), então o servidor usa a service role — mas SÓ
 * no caminho que o BANCO devolveu com o JWT do usuário (import_create_job /
 * import_authorize_file / import_files_to_delete, 042), conferido contra a
 * regra recalculada aqui. Este módulo não decide acesso, não lê tabela e não
 * recebe caminho do navegador. Operações: assinar upload (write-once), baixar
 * e apagar o arquivo de um job encerrado.
 */

export const IMPORTS_BUCKET = "imports";
/** Igual ao limite do bucket (017). */
export const MAX_IMPORT_FILE_BYTES = 20_971_520;
export const IMPORT_CONTENT_TYPE = {
  CSV: "text/csv",
  XLSX: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
} as const;
export type ImportFileType = keyof typeof IMPORT_CONTENT_TYPE;

/** Mesma regra de private.import_create_job (042). */
export function importObjectName(jobId: string, fileType: ImportFileType): string {
  return `jobs/${jobId.toLowerCase()}/source.${fileType.toLowerCase()}`;
}

export interface ImportStorage {
  createSignedUploadUrl(objectName: string): Promise<{ signedUrl: string; token: string }>;
  download(objectName: string, maxBytes: number): Promise<Uint8Array>;
  remove(objectName: string): Promise<void>;
}

export function signedImportStorage(createAdmin: () => SupabaseClient = createSupabaseAdminClient): ImportStorage {
  const bucket = () => createAdmin().storage.from(IMPORTS_BUCKET);
  return {
    async createSignedUploadUrl(objectName) {
      const { data, error } = await bucket().createSignedUploadUrl(objectName, { upsert: false });
      if (error || !data) throw fromStorageError(error as never);
      return { signedUrl: data.signedUrl, token: data.token };
    },
    async download(objectName, maxBytes) {
      const { data, error } = await bucket().download(objectName);
      if (error || !data) {
        const e = fromStorageError(error as never);
        if (e.code === "NOT_FOUND") throw new DomainError("NOT_FOUND", "O arquivo ainda não chegou ao servidor. Envie de novo.", { technicalCode: e.technicalCode });
        throw e;
      }
      if (data.size > maxBytes) throw new DomainError("VALIDATION", "Arquivo maior que o limite de 20 MB.");
      return new Uint8Array(await data.arrayBuffer());
    },
    async remove(objectName) {
      const { error } = await bucket().remove([objectName]);
      if (error) throw fromStorageError(error as never);
    },
  };
}
