"use client";

import { callAction, type ActionError, type ActionResult } from "@/lib/actions/result";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { cancelImportAction, startImportAction } from "@/server/domain/imports/actions";
import { csvBlob } from "./csv-blob";

/** Igual ao limite do bucket `imports` (017). */
export const MAX_IMPORT_BYTES = 20_971_520;

const fail = (message: string): ActionError => ({ ok: false, error: { code: "VALIDATION", message }, requestId: "" });

export function checkImportFile(file: Pick<File, "name" | "size">): string | undefined {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".xls")) return "Arquivo .xls (Excel antigo) não é aceito: abra no Excel e use “Salvar como” → .xlsx.";
  if (!lower.endsWith(".xlsx") && !lower.endsWith(".csv")) return "Formato não aceito. Envie um arquivo Excel (.xlsx) ou CSV.";
  if (file.size <= 0) return "O arquivo está vazio.";
  if (file.size > MAX_IMPORT_BYTES) return "Arquivo maior que o limite de 20 MB. Divida a planilha.";
  return undefined;
}

/**
 * Envio do arquivo, sempre pelo servidor:
 *   1. startImportAction → o banco cria a importação e decide o caminho; o
 *      servidor assina o upload só para esse caminho;
 *   2. o navegador envia o arquivo para a URL assinada (tipo de conteúdo vindo
 *      do servidor — o bucket só aceita CSV/XLSX);
 *   3. falhou o envio → a importação é cancelada (nada fica pela metade).
 * A leitura das colunas acontece na tela da importação.
 */
export async function uploadImportFile(file: File): Promise<ActionResult<{ jobId: string }>> {
  const problem = checkImportFile(file);
  if (problem) return fail(problem);
  const started = await callAction(() => startImportAction({ fileName: file.name, sizeBytes: file.size }));
  if (!started.ok) return started;
  const s = started.data;
  try {
    const { error } = await getSupabaseBrowserClient().storage.from(s.bucket).uploadToSignedUrl(s.path, s.token, file, { contentType: s.contentType, upsert: false });
    if (error) throw error;
  } catch {
    await callAction(() => cancelImportAction({ jobId: s.jobId }));
    return fail("Não foi possível enviar o arquivo. Verifique a conexão e tente de novo.");
  }
  return { ok: true, data: { jobId: s.jobId }, requestId: started.requestId };
}

/** Baixa o CSV do relatório como arquivo. */
export function downloadText(fileName: string, content: string) {
  const url = URL.createObjectURL(csvBlob(content));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
