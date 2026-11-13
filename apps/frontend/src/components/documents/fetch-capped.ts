import { SIGNATURE_BYTES } from "./preview-rules";

/**
 * Busca os bytes de um arquivo para a prévia, com teto de tamanho.
 * A URL assinada vem com `Content-Disposition: attachment` (nome de
 * download): por isso é `fetch` + Blob, que nunca dispara o download do
 * navegador. Sem cookies, sem cache em disco e sem `Referer`.
 */
export type CappedFile = { kind: "OK"; blob: Blob; head: Uint8Array } | { kind: "TOO_LARGE"; sizeBytes?: number };

export async function fetchCapped(url: string, maxBytes: number, fetcher: typeof fetch = fetch): Promise<CappedFile> {
  const response = await fetcher(url, { credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  // Tamanho declarado acima do teto: nem começa a ler.
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    return { kind: "TOO_LARGE", sizeBytes: declared };
  }

  // O tamanho declarado pode faltar ou mentir: o teto vale também na leitura.
  let blob: Blob;
  const reader = response.body?.getReader();
  if (!reader) {
    blob = await response.blob();
    if (blob.size > maxBytes) return { kind: "TOO_LARGE", sizeBytes: blob.size };
  } else {
    const chunks: BlobPart[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { kind: "TOO_LARGE" };
      }
      chunks.push(value);
    }
    blob = new Blob(chunks);
  }
  const head = new Uint8Array(await blob.slice(0, SIGNATURE_BYTES).arrayBuffer());
  return { kind: "OK", blob, head };
}
