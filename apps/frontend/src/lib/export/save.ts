import type { ExportedDocument } from "@/types";

/** Entrega o arquivo exportado ao navegador (protótipo). No produto: URL temporária do backend. */
export function saveExportedFile(file: ExportedDocument): void {
  const url = URL.createObjectURL(file.blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
