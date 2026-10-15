import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { DomainError } from "@/server/core/errors";
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
 *   edição    public.prepare_manual_revision(chave, revisão, versão)  → caminho
 *             da versão N+1 (034); o texto é gravado aqui, write-once
 *
 * Este módulo NUNCA decide acesso, não lê tabela, não grava nada no banco e
 * não recebe caminho vindo do navegador: o service só o chama com o caminho
 * devolvido por essas RPCs (conferido contra a regra recalculada em TS).
 * Operações: assinar upload (write-once, upsert false), consultar metadados
 * do objeto recém-enviado (tamanho/tipo), assinar download de 60 s e — para a
 * edição manual de minuta de texto (4.3.1) — ler os bytes de um caminho
 * autorizado e gravar a versão nova (write-once).
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
    async downloadObject(objectName, maxBytes) {
      const { data, error } = await bucket().download(objectName);
      if (error || !data) throw fromStorageError(error as never);
      if (data.size > maxBytes) throw new DomainError("VALIDATION", "Arquivo grande demais para editar aqui: envie uma nova versão.");
      return new Uint8Array(await data.arrayBuffer());
    },
    async uploadObject(objectName, bytes, contentType) {
      const { error } = await bucket().upload(objectName, bytes, { contentType, upsert: false });
      if (error) throw fromStorageError(error as never);
    },
  };
}
