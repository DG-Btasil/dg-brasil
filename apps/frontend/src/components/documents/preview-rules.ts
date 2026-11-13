/**
 * Regras PURAS da prévia de arquivo (sem React, sem rede): que tipo de prévia
 * cabe, o rótulo do botão de baixar e as conferências de segurança.
 * O tipo declarado (MIME ou extensão) só escolhe o caminho; antes de mostrar,
 * os primeiros bytes do arquivo são conferidos (`signatureMatches`).
 */

export type PreviewKind = "PDF" | "DOCX" | "IMAGE" | "NONE";

export interface PreviewFile {
  mimeType?: string | null;
  filename?: string | null;
}

/** Acima disto a prévia não é montada: a pessoa baixa o arquivo. */
export const MAX_PREVIEW_BYTES = 15 * 1024 * 1024;

/** Quantos bytes do começo do arquivo são lidos para conferir o formato. */
export const SIGNATURE_BYTES = 1024;

const MIME_FORMAT: Record<string, string> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel": "xls",
  "text/plain": "txt",
  "text/markdown": "md",
  "text/csv": "csv",
  "text/html": "html",
  "application/xhtml+xml": "html",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/tiff": "tiff",
  "image/svg+xml": "svg",
};

const EXTENSION_ALIAS: Record<string, string> = { jpeg: "jpg", htm: "html", xhtml: "html", tif: "tiff", markdown: "md" };

/** Só o que o navegador mostra com segurança em <img>. SVG fica de fora de propósito. */
const IMAGE_MIME: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };

/** Extensão em minúsculas, sem o ponto. "" quando não há ou não parece extensão. */
export function fileExtension(filename: string | null | undefined): string {
  const name = (filename ?? "").trim();
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "";
  const ext = name.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,5}$/.test(ext) ? ext : "";
}

/**
 * Formato real do arquivo como um nome curto ("pdf", "docx", "xlsx"…).
 * O MIME gravado vale primeiro; a extensão do nome só entra quando o MIME
 * falta ou é genérico (ex.: application/octet-stream). "" = desconhecido.
 */
export function fileFormatOf(file: PreviewFile): string {
  const mime = (file.mimeType ?? "").split(";")[0].trim().toLowerCase();
  if (Object.hasOwn(MIME_FORMAT, mime)) return MIME_FORMAT[mime];
  const ext = fileExtension(file.filename);
  return Object.hasOwn(EXTENSION_ALIAS, ext) ? EXTENSION_ALIAS[ext] : ext;
}

/**
 * Que prévia cabe. HTML nunca tem prévia (arquivo HTML dentro da página é
 * risco de script); planilha, .doc antigo, texto e o resto também não.
 */
export function previewKindOf(file: PreviewFile): PreviewKind {
  const format = fileFormatOf(file);
  if (format === "pdf") return "PDF";
  if (format === "docx") return "DOCX";
  if (Object.hasOwn(IMAGE_MIME, format)) return "IMAGE";
  return "NONE";
}

/** Rótulo do botão de baixar: diz o formato real. Não há conversão entre Word e PDF. */
export function downloadLabelOf(file: PreviewFile): string {
  const format = fileFormatOf(file);
  if (format === "docx" || format === "doc") return "Baixar em Word";
  if (format === "pdf") return "Baixar em PDF";
  return format ? `Baixar arquivo (${format.toUpperCase()})` : "Baixar arquivo";
}

/** Como corrigir o arquivo: PDF e Word não são editados na tela. */
export function editHintOf(file: PreviewFile): string {
  const format = fileFormatOf(file);
  if (format === "docx" || format === "doc") return "Para editar, baixe em Word, altere e envie a nova versão na aba Documentos do caso.";
  if (format === "pdf") return "PDF não é editado na tela. Para corrigir, envie a nova versão do arquivo na aba Documentos do caso.";
  return "Este formato não é editado na tela. Para corrigir, envie a nova versão do arquivo na aba Documentos do caso.";
}

/** MIME que a prévia de imagem usa (definido aqui, nunca o que veio da rede). */
export function imageMimeOf(file: PreviewFile): string | undefined {
  const format = fileFormatOf(file);
  return Object.hasOwn(IMAGE_MIME, format) ? IMAGE_MIME[format] : undefined;
}

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  return bytes.length >= offset + signature.length && signature.every((b, i) => bytes[offset + i] === b);
}

function hasAscii(bytes: Uint8Array, text: string): boolean {
  const limit = Math.min(bytes.length, SIGNATURE_BYTES) - text.length;
  for (let i = 0; i <= limit; i += 1) {
    let match = true;
    for (let j = 0; j < text.length; j += 1) {
      if (bytes[i + j] !== text.charCodeAt(j)) {
        match = false;
        break;
      }
    }
    if (match) return true;
  }
  return false;
}

/**
 * Os primeiros bytes batem com o formato declarado? Sem isso, a prévia não é
 * montada (um arquivo que diz ser PDF e não é vai para "Baixe para ver").
 */
export function signatureMatches(file: PreviewFile, head: Uint8Array): boolean {
  switch (fileFormatOf(file)) {
    case "pdf":
      // Os leitores aceitam o cabeçalho %PDF- em qualquer ponto do primeiro KB.
      return hasAscii(head, "%PDF-");
    case "docx":
      return startsWith(head, [0x50, 0x4b, 0x03, 0x04]);
    case "png":
      return startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "jpg":
      return startsWith(head, [0xff, 0xd8, 0xff]);
    case "gif":
      return startsWith(head, [0x47, 0x49, 0x46, 0x38]);
    case "webp":
      return startsWith(head, [0x52, 0x49, 0x46, 0x46]) && startsWith(head, [0x57, 0x45, 0x42, 0x50], 8);
    default:
      return false;
  }
}

/**
 * Link vindo de dentro de um documento: só http, https e mailto continuam
 * clicáveis. Qualquer outro (javascript:, data:, file:, âncora interna)
 * volta null e o link vira texto.
 */
export function safeLinkHref(href: string | null | undefined): string | null {
  const raw = (href ?? "").trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:" ? url.href : null;
}
