"use client";

import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { PreparedFileDTO } from "@/server/domain/dg/dto";

/**
 * Envio de arquivo de referência da área DG Brasil, pelo mesmo padrão dos
 * documentos: o SERVIDOR monta o caminho e assina a URL; o navegador só envia
 * os bytes para ela (write-once).
 */

export async function sha256Hex(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function putSigned(prepared: PreparedFileDTO, file: Blob): Promise<string | undefined> {
  try {
    const { error } = await getSupabaseBrowserClient()
      .storage.from(prepared.bucket)
      .uploadToSignedUrl(prepared.storageObjectName, prepared.token, file, { contentType: prepared.mimeType, upsert: false });
    return error ? "Não foi possível enviar o arquivo. Verifique a conexão e tente de novo." : undefined;
  } catch {
    return "Sem conexão com o servidor. Verifique a internet e tente novamente.";
  }
}
