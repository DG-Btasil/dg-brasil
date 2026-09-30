/**
 * Contrato de exportação de versões de documento (PDF/DOCX).
 *
 * Protótipo: `mockDocumentExportService` gera o arquivo no navegador, a partir
 * do conteúdo mock, só para demonstrar a experiência.
 *
 * Produto: o BACKEND gera ou obtém o arquivo — valida autorização, resolve a
 * versão exata (`documentVersionId`), aplica a marca de rascunho quando a
 * versão não está aprovada, registra o download e devolve URL temporária ou
 * stream autorizado. Documentos sensíveis não devem ser gerados no navegador.
 * Ver BACKEND_HANDOFF.md, seção 14.
 */
import type { ExportFormat } from "@/lib/constants/status";
import { buildDocx, buildPdf } from "@/lib/export/documents";
import type { ExportedDocument, ReviewContent } from "@/types";

export interface ExportVersionRequest {
  title: string;
  content: ReviewContent;
  versionNumber: number;
  /** Versão não aprovada: exportada com "RASCUNHO — NÃO APROVADO". */
  draft: boolean;
  format: ExportFormat;
  footer: string;
}

export interface DocumentExportService {
  exportVersion(request: ExportVersionRequest): Promise<ExportedDocument>;
}

function fileName(title: string, version: number, draft: boolean, format: ExportFormat): string {
  const base = title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase()
    .slice(0, 60);
  return `${base}-v${version}${draft ? "-RASCUNHO" : "-aprovada"}.${format.toLowerCase()}`;
}

export const mockDocumentExportService: DocumentExportService = {
  async exportVersion(request) {
    const input = { content: request.content, versionNumber: request.versionNumber, draft: request.draft, footer: request.footer };
    const blob = request.format === "PDF" ? buildPdf(input) : buildDocx(input);
    return { fileName: fileName(request.title, request.versionNumber, request.draft, request.format), format: request.format, draft: request.draft, blob };
  },
};
