import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { fromStorageError, LEGAL_DOCUMENTS_BUCKET, type DocumentStorage } from "./storage";

/**
 * ÚNICO uso da service role no domínio de Documentos.
 *
 * Os buckets são privados e o usuário não assina URL (017: sem política para
 * `authenticated` + política RESTRICTIVE). Então o servidor assina com a
 * service role — mas SÓ um caminho que o BANCO já autorizou com o JWT do
 * usuário (migration 026):
 *
 *   upload    public.authorize_document_upload(doc, versão, arquivo)  → caminho
 *   download  public.authorize_document_download(versão)              → caminho
 *             (registra LGPD DOWNLOAD + auditoria DOCUMENT_DOWNLOADED, ator USER)
 *
 * Este módulo NUNCA decide acesso, não lê tabela, não grava nada no banco e
 * não recebe caminho vindo do navegador: o service só o chama com o caminho
 * devolvido por essas RPCs (conferido contra a regra recalculada em TS).
 * Operações: assinar upload (write-once, upsert false), consultar metadados
 * do objeto recém-enviado (tamanho/tipo) e assinar download de 60 s.
 *
 * Injetável (`DocumentDeps.storage`) para teste; o client admin é criado só
 * quando uma operação roda.
 */
export function signedDocumentStorage(createAdmin: () => SupabaseClient = createSupabaseAdminClient): DocumentStorage {
  const bucket = () => createAdmin().storage.from(LEGAL_DOCUMENTS_BUCKET);
  return {
    async createSignedUploadUrl(objectName) {
      const { data, error } = await bucket().createSignedUploadUrl(objectName, { upsert: false });
      if (error || !data) throw fromStorageError(error as never);
      return { signedUrl: data.signedUrl, token: data.token };
    },
    async getObjectInfo(objectName) {
      const { data, error } = await bucket().info(objectName);
      if (error || !data) {
        const e = error as { statusCode?: string; status?: number } | null;
        const status = Number(e?.statusCode ?? e?.status ?? 0);
        if (status === 400 || status === 404) return null;
        throw fromStorageError(error as never);
      }
      return { sizeBytes: typeof data.size === "number" ? data.size : undefined, contentType: data.contentType ?? undefined };
    },
    async createSignedDownloadUrl(objectName, expiresInSeconds, downloadName) {
      const { data, error } = await bucket().createSignedUrl(objectName, expiresInSeconds, { download: downloadName });
      if (error || !data) throw fromStorageError(error as never);
      return data.signedUrl;
    },
  };
}
