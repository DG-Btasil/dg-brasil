/**
 * Arquivo do CSV com o BOM UTF-8 SEMPRE no início: o Excel em português só
 * reconhece os acentos com ele, e o BOM gerado no servidor se perde no caminho
 * da Server Action (QA 7, IMP-03).
 */
export function csvBlob(content: string): Blob {
  return new Blob(["\uFEFF", content.replace(/^\uFEFF/, "")], { type: "text/csv;charset=utf-8" });
}
