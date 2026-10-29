import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { fromStorageError } from "@/server/domain/documents/storage";
import { REFERENCE_BUCKET } from "./paths";

export { REFERENCE_BUCKET, referenceObjectName } from "./paths";

/**
 * ÚNICO uso da service role no domínio DG Brasil: assinar a URL de ENVIO de
 * arquivo de referência (bucket reference-materials, fechado ao navegador —
 * 017/039). O caminho é montado AQUI, pelo servidor, depois de a Server Action
 * conferir sessão + ADMIN — nunca vem do navegador. Upload write-once
 * (upsert false). O banco confere depois que o objeto existe e está no
 * caminho da versão (dg_save_reference_once).
 */

export interface DgStorage {
  createSignedUploadUrl(bucket: string, objectName: string): Promise<{ token: string }>;
}

export function signedDgStorage(createAdmin = createSupabaseAdminClient): DgStorage {
  return {
    async createSignedUploadUrl(bucket, objectName) {
      if (bucket !== REFERENCE_BUCKET) throw new Error("bucket não permitido");
      const { data, error } = await createAdmin().storage.from(bucket).createSignedUploadUrl(objectName, { upsert: false });
      if (error || !data) throw fromStorageError(error as never);
      return { token: data.token };
    },
  };
}
