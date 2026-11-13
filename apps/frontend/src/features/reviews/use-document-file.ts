"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchCapped } from "@/components/documents/fetch-capped";
import { createOnceCache } from "@/components/documents/once-cache";
import { MAX_PREVIEW_BYTES } from "@/components/documents/preview-rules";
import { callAction, NETWORK_ERROR_MESSAGE } from "@/lib/actions/result";
import { downloadDocumentAction } from "@/server/domain/documents/actions";
import type { ID } from "@/types";

/** Bytes de uma versão de documento, prontos para a prévia. */
export type DocumentFileResult =
  | { status: "READY"; blob: Blob; head: Uint8Array }
  | { status: "TOO_LARGE"; sizeBytes?: number }
  | { status: "ERROR"; message: string; requestId?: string };

const FETCH_ERROR_MESSAGE = "O arquivo não pôde ser carregado para a prévia. Tente de novo ou baixe o arquivo.";

/**
 * O servidor autoriza, REGISTRA o acesso (LGPD + auditoria) e devolve a URL
 * assinada de 60 s; os bytes vêm direto do Storage. Nunca lança.
 */
async function loadDocumentFile(documentId: ID, versionId: ID): Promise<DocumentFileResult> {
  const signed = await callAction(() => downloadDocumentAction({ documentId, versionId }));
  if (!signed.ok) return { status: "ERROR", message: signed.error.message, requestId: signed.requestId || undefined };
  try {
    const file = await fetchCapped(signed.data.url, MAX_PREVIEW_BYTES);
    return file.kind === "TOO_LARGE" ? { status: "TOO_LARGE", sizeBytes: file.sizeBytes } : { status: "READY", blob: file.blob, head: file.head };
  } catch {
    return { status: "ERROR", message: typeof navigator !== "undefined" && navigator.onLine === false ? NETWORK_ERROR_MESSAGE : FETCH_ERROR_MESSAGE };
  }
}

/** Uma leitura por versão aberta: remontar a tela não busca (nem registra) de novo. */
const cache = createOnceCache<DocumentFileResult>();

/**
 * Arquivo da versão para a prévia. Busca UMA vez por versão aberta (não a
 * cada render) e os mesmos bytes servem a toda a prévia. `enabled: false`
 * (formato sem prévia) não busca nada — e nada é registrado como acesso.
 */
export function useDocumentFile(documentId: ID, versionId: ID, enabled: boolean) {
  const key = `${documentId}:${versionId}`;
  const [loaded, setLoaded] = useState<{ key: string; result: DocumentFileResult } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const handle = cache.acquire(key, () => loadDocumentFile(documentId, versionId));
    void handle.promise.then((result) => {
      if (alive) setLoaded({ key, result });
    });
    return () => {
      alive = false;
      handle.release();
    };
  }, [documentId, versionId, key, enabled, attempt]);

  /** "Tentar de novo": descarta o resultado e busca outra vez (novo acesso registrado). */
  const retry = useCallback(() => {
    cache.forget(key);
    setLoaded(null);
    setAttempt((n) => n + 1);
  }, [key]);

  const result = enabled && loaded?.key === key ? loaded.result : null;
  return { result, retry };
}
