import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchCapped } from "./fetch-capped";
import { createOnceCache } from "./once-cache";
import {
  downloadLabelOf,
  editHintOf,
  fileExtension,
  fileFormatOf,
  imageMimeOf,
  MAX_PREVIEW_BYTES,
  previewKindOf,
  safeLinkHref,
  signatureMatches,
} from "./preview-rules";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const bytes = (...values: number[]) => new Uint8Array(values);
const ascii = (text: string) => new TextEncoder().encode(text);

/* ------------------------------------------------------------------ */
/* Tipo de prévia e rótulo do botão                                    */
/* ------------------------------------------------------------------ */

describe("formato do arquivo — MIME primeiro, extensão quando o MIME falta ou é genérico", () => {
  it("extensão: minúscula, sem ponto; nome sem extensão ou estranho devolve vazio", () => {
    expect(fileExtension("Procuração Maria.PDF")).toBe("pdf");
    expect(fileExtension("minuta.v2.docx")).toBe("docx");
    expect(fileExtension("sem-extensao")).toBe("");
    expect(fileExtension(".gitignore")).toBe("");
    expect(fileExtension("arquivo.")).toBe("");
    expect(fileExtension("nome.com espaço")).toBe("");
    expect(fileExtension(undefined)).toBe("");
  });
  it("MIME conhecido decide, com ou sem parâmetros", () => {
    expect(fileFormatOf({ mimeType: "application/pdf", filename: "x.docx" })).toBe("pdf");
    expect(fileFormatOf({ mimeType: "Application/PDF; charset=binary" })).toBe("pdf");
    expect(fileFormatOf({ mimeType: DOCX })).toBe("docx");
  });
  it("MIME ausente ou genérico: vale a extensão do nome", () => {
    expect(fileFormatOf({ filename: "Contrato.pdf" })).toBe("pdf");
    expect(fileFormatOf({ mimeType: "application/octet-stream", filename: "peticao.DOCX" })).toBe("docx");
    expect(fileFormatOf({ mimeType: null, filename: "foto.JPEG" })).toBe("jpg");
    expect(fileFormatOf({ mimeType: "application/octet-stream", filename: "sem-extensao" })).toBe("");
    expect(fileFormatOf({ mimeType: "constructor", filename: "x.pdf" })).toBe("pdf");
  });
});

describe("tipo de prévia", () => {
  it("PDF e DOCX têm prévia", () => {
    expect(previewKindOf({ mimeType: "application/pdf", filename: "procuracao.pdf" })).toBe("PDF");
    expect(previewKindOf({ mimeType: DOCX, filename: "peticao.docx" })).toBe("DOCX");
    expect(previewKindOf({ filename: "peticao.docx" })).toBe("DOCX");
  });
  it("imagem que o navegador mostra: a própria imagem", () => {
    for (const mimeType of ["image/png", "image/jpeg", "image/webp", "image/gif"]) expect(previewKindOf({ mimeType })).toBe("IMAGE");
    expect(imageMimeOf({ filename: "rg.jpeg" })).toBe("image/jpeg");
  });
  it("HTML nunca tem prévia, nem pelo MIME nem pela extensão", () => {
    expect(previewKindOf({ mimeType: "text/html", filename: "relatorio.html" })).toBe("NONE");
    expect(previewKindOf({ mimeType: "application/octet-stream", filename: "relatorio.htm" })).toBe("NONE");
    expect(previewKindOf({ mimeType: "text/html", filename: "disfarce.pdf" })).toBe("NONE");
    expect(previewKindOf({ mimeType: "application/xhtml+xml" })).toBe("NONE");
  });
  it("planilha, .doc antigo, texto, SVG, HEIC, TIFF e desconhecido: sem prévia", () => {
    expect(previewKindOf({ mimeType: XLSX, filename: "calculo.xlsx" })).toBe("NONE");
    expect(previewKindOf({ mimeType: "application/msword", filename: "antigo.doc" })).toBe("NONE");
    expect(previewKindOf({ mimeType: "text/plain", filename: "minuta.txt" })).toBe("NONE");
    expect(previewKindOf({ mimeType: "image/svg+xml", filename: "logo.svg" })).toBe("NONE");
    expect(previewKindOf({ mimeType: "image/heic" })).toBe("NONE");
    expect(previewKindOf({ mimeType: "image/tiff" })).toBe("NONE");
    expect(previewKindOf({})).toBe("NONE");
    expect(imageMimeOf({ mimeType: "image/svg+xml" })).toBeUndefined();
    expect(imageMimeOf({ filename: "x.constructor" })).toBeUndefined();
  });
});

describe("rótulo do botão de baixar — o formato real, sem conversão", () => {
  it("Word", () => {
    expect(downloadLabelOf({ mimeType: DOCX, filename: "peticao.docx" })).toBe("Baixar em Word");
    expect(downloadLabelOf({ mimeType: "application/msword", filename: "antigo.doc" })).toBe("Baixar em Word");
    expect(downloadLabelOf({ filename: "peticao.DOCX" })).toBe("Baixar em Word");
  });
  it("PDF", () => {
    expect(downloadLabelOf({ mimeType: "application/pdf", filename: "procuracao.pdf" })).toBe("Baixar em PDF");
  });
  it("outros formatos dizem qual é; desconhecido fica genérico", () => {
    expect(downloadLabelOf({ mimeType: XLSX, filename: "calculo.xlsx" })).toBe("Baixar arquivo (XLSX)");
    expect(downloadLabelOf({ mimeType: "text/html", filename: "relatorio.html" })).toBe("Baixar arquivo (HTML)");
    expect(downloadLabelOf({ mimeType: "text/plain", filename: "minuta.txt" })).toBe("Baixar arquivo (TXT)");
    expect(downloadLabelOf({ mimeType: "image/jpeg", filename: "rg.jpeg" })).toBe("Baixar arquivo (JPG)");
    expect(downloadLabelOf({})).toBe("Baixar arquivo");
  });
  it("ajuda de edição: Word baixa e reenvia; PDF só nova versão", () => {
    expect(editHintOf({ mimeType: DOCX })).toBe("Para editar, baixe em Word, altere e envie a nova versão na aba Documentos do caso.");
    expect(editHintOf({ mimeType: "application/pdf" })).toMatch(/PDF não é editado na tela/);
    expect(editHintOf({ mimeType: XLSX })).toMatch(/nova versão do arquivo/);
  });
});

/* ------------------------------------------------------------------ */
/* Conferências de segurança                                           */
/* ------------------------------------------------------------------ */

describe("assinatura do arquivo — os bytes têm de confirmar o formato declarado", () => {
  it("PDF: cabeçalho %PDF- no começo (ou logo depois de lixo inicial)", () => {
    expect(signatureMatches({ mimeType: "application/pdf" }, ascii("%PDF-1.7\n"))).toBe(true);
    expect(signatureMatches({ mimeType: "application/pdf" }, ascii("\n\n%PDF-1.4"))).toBe(true);
    expect(signatureMatches({ mimeType: "application/pdf" }, ascii("<html><script>alert(1)</script>"))).toBe(false);
    expect(signatureMatches({ mimeType: "application/pdf" }, bytes())).toBe(false);
  });
  it("DOCX: pacote ZIP", () => {
    expect(signatureMatches({ mimeType: DOCX }, bytes(0x50, 0x4b, 0x03, 0x04, 0x14))).toBe(true);
    expect(signatureMatches({ mimeType: DOCX }, ascii("%PDF-1.7"))).toBe(false);
    expect(signatureMatches({ mimeType: DOCX }, bytes(0x50, 0x4b))).toBe(false);
  });
  it("imagens: cada formato com a sua assinatura", () => {
    expect(signatureMatches({ mimeType: "image/png" }, bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe(true);
    expect(signatureMatches({ mimeType: "image/jpeg" }, bytes(0xff, 0xd8, 0xff, 0xe0))).toBe(true);
    expect(signatureMatches({ mimeType: "image/gif" }, ascii("GIF89a"))).toBe(true);
    expect(signatureMatches({ mimeType: "image/webp" }, ascii("RIFF\u0001\u0002\u0003\u0004WEBPVP8 "))).toBe(true);
    expect(signatureMatches({ mimeType: "image/webp" }, ascii("RIFF\u0001\u0002\u0003\u0004WAVEfmt "))).toBe(false);
    expect(signatureMatches({ mimeType: "image/png" }, ascii("<svg onload=alert(1)>"))).toBe(false);
  });
  it("formato sem prévia nunca confirma", () => {
    expect(signatureMatches({ mimeType: "text/html" }, ascii("<!doctype html>"))).toBe(false);
    expect(signatureMatches({}, ascii("%PDF-1.7"))).toBe(false);
  });
});

describe("links de dentro do documento", () => {
  it("http, https e mailto continuam", () => {
    expect(safeLinkHref("https://www.tjrj.jus.br/consulta")).toBe("https://www.tjrj.jus.br/consulta");
    expect(safeLinkHref(" http://exemplo.com.br ")).toBe("http://exemplo.com.br/");
    expect(safeLinkHref("mailto:contato@exemplo.com.br")).toBe("mailto:contato@exemplo.com.br");
  });
  it("javascript:, data:, file:, âncora e relativo viram texto", () => {
    expect(safeLinkHref("javascript:alert(1)")).toBeNull();
    expect(safeLinkHref("JaVaScRiPt:alert(1)")).toBeNull();
    expect(safeLinkHref(" \tjavascript:alert(1)")).toBeNull();
    expect(safeLinkHref("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(safeLinkHref("file:///C:/Windows/win.ini")).toBeNull();
    expect(safeLinkHref("#_Toc123")).toBeNull();
    expect(safeLinkHref("/revisoes")).toBeNull();
    expect(safeLinkHref("")).toBeNull();
    expect(safeLinkHref(null)).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Leitura com teto de tamanho                                         */
/* ------------------------------------------------------------------ */

describe("busca do arquivo para a prévia — teto de tamanho", () => {
  const respond = (body: BodyInit, headers: Record<string, string> = {}, status = 200) => vi.fn(async () => new Response(body, { status, headers })) as unknown as typeof fetch;

  it("limite da prévia: 15 MB", () => {
    expect(MAX_PREVIEW_BYTES).toBe(15 * 1024 * 1024);
  });
  it("arquivo dentro do teto: devolve os bytes e o começo para conferência; sem cookies, sem cache, sem referer", async () => {
    const fetcher = respond(ascii("%PDF-1.7 conteúdo"));
    const file = await fetchCapped("https://storage.exemplo/x?token=t", 1000, fetcher);
    expect(file.kind).toBe("OK");
    if (file.kind !== "OK") return;
    expect(file.blob.size).toBe(ascii("%PDF-1.7 conteúdo").byteLength);
    expect(signatureMatches({ mimeType: "application/pdf" }, file.head)).toBe(true);
    expect(fetcher).toHaveBeenCalledWith("https://storage.exemplo/x?token=t", { credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" });
  });
  it("tamanho declarado acima do teto: nem lê", async () => {
    const file = await fetchCapped("u", 10, respond(new Uint8Array(4), { "content-length": "5000" }));
    expect(file).toEqual({ kind: "TOO_LARGE", sizeBytes: 5000 });
  });
  it("sem tamanho declarado: o teto vale na leitura", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(8));
        controller.enqueue(new Uint8Array(8));
        controller.close();
      },
    });
    expect(await fetchCapped("u", 10, respond(stream))).toEqual({ kind: "TOO_LARGE" });
  });
  it("resposta de erro do Storage (URL vencida, sem acesso) lança", async () => {
    await expect(fetchCapped("u", 10, respond("expired", {}, 400))).rejects.toThrow("HTTP 400");
  });
});

/* ------------------------------------------------------------------ */
/* Uma leitura por versão aberta                                       */
/* ------------------------------------------------------------------ */

describe("uma leitura por versão aberta (cada leitura é registrada como acesso)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("dois usos ao mesmo tempo: carrega uma vez e reparte o resultado", async () => {
    const cache = createOnceCache<string>();
    const load = vi.fn(async () => "bytes");
    const a = cache.acquire("v1", load);
    const b = cache.acquire("v1", load);
    expect(await a.promise).toBe("bytes");
    expect(b.promise).toBe(a.promise);
    expect(load).toHaveBeenCalledTimes(1);
  });
  it("soltar e pegar de novo no mesmo instante (remontagem da tela) não carrega de novo", () => {
    const cache = createOnceCache<string>();
    const load = vi.fn(async () => "bytes");
    cache.acquire("v1", load).release();
    const again = cache.acquire("v1", load);
    vi.runAllTimers();
    expect(load).toHaveBeenCalledTimes(1);
    expect(cache.size()).toBe(1);
    again.release();
  });
  it("quando o último uso sai, a entrada é descartada; abrir de novo é uma leitura nova", () => {
    const cache = createOnceCache<string>();
    const load = vi.fn(async () => "bytes");
    const a = cache.acquire("v1", load);
    const b = cache.acquire("v1", load);
    a.release();
    a.release();
    vi.runAllTimers();
    expect(cache.size()).toBe(1);
    b.release();
    vi.runAllTimers();
    expect(cache.size()).toBe(0);
    cache.acquire("v1", load);
    expect(load).toHaveBeenCalledTimes(2);
  });
  it("versões diferentes não se misturam", () => {
    const cache = createOnceCache<string>();
    const load = vi.fn(async () => "bytes");
    cache.acquire("v1", load);
    cache.acquire("v2", load);
    expect(load).toHaveBeenCalledTimes(2);
  });
  it("tentar de novo: esquece o resultado; quem ainda segurava o antigo não derruba o novo", () => {
    const cache = createOnceCache<string>();
    const load = vi.fn(async () => "bytes");
    const old = cache.acquire("v1", load);
    cache.forget("v1");
    const fresh = cache.acquire("v1", load);
    old.release();
    vi.runAllTimers();
    expect(load).toHaveBeenCalledTimes(2);
    expect(cache.size()).toBe(1);
    fresh.release();
    vi.runAllTimers();
    expect(cache.size()).toBe(0);
  });
});
