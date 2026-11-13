import { HttpError } from "./handler";

/**
 * Leitura do corpo da API do computador do escritório, COM limite. Só é
 * chamada pelo handler depois das conferências do token, do limite de taxa e
 * da versão do conector.
 *
 * O limite vale de verdade: confere o tamanho declarado (Content-Length) e,
 * como ele pode faltar ou mentir, para de ler assim que os bytes recebidos
 * passam do teto. Nunca carrega um corpo maior que o limite na memória.
 */
export async function readJsonBody(request: Request, maxBytes: number): Promise<unknown> {
  if (request.method !== "POST" || !request.body) return undefined;
  const tooLarge = () => new HttpError(413, "TOO_LARGE", "Corpo da requisição grande demais.");

  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge();
    }
    chunks.push(value);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, "BAD_JSON", "JSON inválido.");
  }
}
