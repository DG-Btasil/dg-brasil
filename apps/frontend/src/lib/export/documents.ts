/**
 * Geração de PDF e DOCX de demonstração a partir do conteúdo estruturado de
 * uma versão (título + seções). Protótipo apenas: no produto, a geração é do
 * backend (ver services/document-export.ts e BACKEND_HANDOFF.md).
 *
 * Versão não aprovada recebe SEMPRE a marca "RASCUNHO — NÃO APROVADO"
 * (marca d'água e cabeçalho), para evitar protocolo acidental.
 */
import { DRAFT_WATERMARK } from "@/lib/constants/status";
import type { ReviewContent } from "@/types";
import { createZip } from "./zip";

export interface ExportDocumentInput {
  content: ReviewContent;
  versionNumber: number;
  draft: boolean;
  /** Linha de identificação, ex.: "Bárbara Cardoso Advocacia · v4". */
  footer: string;
}

/* ------------------------------------------------------------------ */
/* PDF                                                                 */
/* ------------------------------------------------------------------ */

// Caracteres fora do Latin-1 mapeados para WinAnsiEncoding (fontes padrão do PDF).
const WIN_ANSI: Record<string, number> = { "—": 0x97, "–": 0x96, "“": 0x93, "”": 0x94, "‘": 0x91, "’": 0x92, "•": 0x95, "…": 0x85, "€": 0x80 };

function pdfString(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = WIN_ANSI[ch] ?? ch.charCodeAt(0);
    const byte = code <= 0xff ? code : 0x3f; // "?" para o que não existe na fonte
    const c = String.fromCharCode(byte);
    out += c === "(" || c === ")" || c === "\\" ? `\\${c}` : c;
  }
  return `(${out})`;
}

function wrap(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if ((line + " " + word).trim().length > maxChars) {
        if (line) lines.push(line);
        line = word;
      } else line = (line + " " + word).trim();
    }
    lines.push(line);
  }
  return lines;
}

interface PdfLine {
  text: string;
  font: "F1" | "F2";
  size: number;
  gap: number;
}

export function buildPdf(input: ExportDocumentInput): Blob {
  const { content, draft } = input;
  const W = 595;
  const H = 842;
  const left = 64;
  const top = H - 72;
  const bottom = 72;

  const lines: PdfLine[] = [];
  wrap(content.title, 60).forEach((t) => lines.push({ text: t, font: "F2", size: 16, gap: 22 }));
  lines.push({ text: "", font: "F1", size: 11, gap: 10 });
  for (const section of content.sections) {
    lines.push({ text: section.heading.toUpperCase(), font: "F2", size: 10, gap: 18 });
    wrap(section.body, 88).forEach((t) => lines.push({ text: t, font: "F1", size: 11, gap: 16 }));
    lines.push({ text: "", font: "F1", size: 11, gap: 8 });
  }
  wrap(content.disclaimer, 100).forEach((t) => lines.push({ text: t, font: "F1", size: 8, gap: 12 }));

  // Paginação
  const pages: PdfLine[][] = [[]];
  let y = top;
  for (const line of lines) {
    if (y - line.gap < bottom) {
      pages.push([]);
      y = top;
    }
    y -= line.gap;
    pages[pages.length - 1]!.push(line);
  }

  const streams = pages.map((pageLines, index) => {
    let ops = "";
    if (draft) {
      ops += `q 0.86 0.86 0.86 rg BT /F2 46 Tf 0.7071 0.7071 -0.7071 0.7071 150 220 Tm ${pdfString(DRAFT_WATERMARK)} Tj ET Q\n`;
      ops += `q 0.70 0.10 0.10 rg BT /F2 9 Tf ${left} ${H - 40} Td ${pdfString(`${DRAFT_WATERMARK} · Versão ${input.versionNumber}`)} Tj ET Q\n`;
    }
    let cursor = top;
    for (const line of pageLines) {
      cursor -= line.gap;
      if (line.text) ops += `BT /${line.font} ${line.size} Tf ${left} ${cursor} Td ${pdfString(line.text)} Tj ET\n`;
    }
    ops += `q 0.45 0.45 0.45 rg BT /F1 8 Tf ${left} 40 Td ${pdfString(`${input.footer} · página ${index + 1} de ${pages.length}`)} Tj ET Q\n`;
    return ops;
  });

  // Objetos: 1 catálogo, 2 páginas, 3-4 fontes, depois (página, conteúdo) por página.
  const objects: string[] = [];
  const pageIds = pages.map((_, i) => 5 + i * 2);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  streams.forEach((stream, i) => {
    const pageId = 5 + i * 2;
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageId + 1} 0 R >>`;
    objects[pageId + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}endstream`;
  });

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = pdf.length;
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  // Cada caractere já é um byte (0–255): gravar como Latin-1.
  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xff;
  return new Blob([bytes], { type: "application/pdf" });
}

/* ------------------------------------------------------------------ */
/* DOCX                                                                */
/* ------------------------------------------------------------------ */

function xml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function paragraph(text: string, opts: { bold?: boolean; size?: number; color?: string; spacingAfter?: number } = {}): string {
  const rPr = `<w:rPr>${opts.bold ? "<w:b/>" : ""}${opts.color ? `<w:color w:val="${opts.color}"/>` : ""}${opts.size ? `<w:sz w:val="${opts.size}"/>` : ""}</w:rPr>`;
  return `<w:p><w:pPr><w:spacing w:after="${opts.spacingAfter ?? 160}"/></w:pPr><w:r>${rPr}<w:t xml:space="preserve">${xml(text)}</w:t></w:r></w:p>`;
}

export function buildDocx(input: ExportDocumentInput): Blob {
  const { content, draft } = input;
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

  const body = [
    ...(draft ? [paragraph(`${DRAFT_WATERMARK} · Versão ${input.versionNumber}`, { bold: true, color: "B31B1B", size: 20 })] : []),
    paragraph(content.title, { bold: true, size: 32, spacingAfter: 320 }),
    ...content.sections.flatMap((s) => [
      paragraph(s.heading.toUpperCase(), { bold: true, size: 20, spacingAfter: 80 }),
      ...s.body.split("\n").map((line) => paragraph(line, { size: 22 })),
    ]),
    paragraph(content.disclaimer, { size: 16, color: "666666" }),
    paragraph(input.footer, { size: 16, color: "666666" }),
  ].join("");

  const sectPr = `<w:sectPr>${draft ? '<w:headerReference w:type="default" r:id="rIdHeader"/>' : ""}<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>`;
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body}${sectPr}</w:body></w:document>`;

  const files: { name: string; text: string }[] = [
    {
      name: "[Content_Types].xml",
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>${draft ? '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' : ""}</Types>`,
    },
    {
      name: "_rels/.rels",
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    },
    {
      name: "word/_rels/document.xml.rels",
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${draft ? '<Relationship Id="rIdHeader" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>' : ""}</Relationships>`,
    },
    { name: "word/document.xml", text: document },
  ];
  if (draft) {
    files.push({
      name: "word/header1.xml",
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr ${W}>${paragraph(`${DRAFT_WATERMARK} · Versão ${input.versionNumber}`, { bold: true, color: "B31B1B", size: 20 })}</w:hdr>`,
    });
  }
  const encoder = new TextEncoder();
  const zip = createZip(files.map((f) => ({ name: f.name, data: encoder.encode(f.text) })));
  return new Blob([zip], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
}
