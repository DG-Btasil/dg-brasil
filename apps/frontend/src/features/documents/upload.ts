"use client";

import { callAction, type ActionError, type ActionResult } from "@/lib/actions/result";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { confirmDocumentUploadAction, createDocumentAction, prepareDocumentUploadAction } from "@/server/domain/documents/actions";
import type { ConfirmedUploadDTO, PreparedUploadDTO } from "@/server/domain/documents/dto";
import { ALLOWED_FILE_TYPES, MAX_UPLOAD_BYTES } from "./constants";

/**
 * Envio de arquivo (Etapa 4.3, Fase C), sempre pelo servidor:
 *
 *   1. createDocumentAction    documento lógico + vínculo (só no primeiro envio)
 *   2. prepareDocumentUploadAction  o BANCO autoriza e o servidor devolve uma URL
 *                              assinada de upload (id da versão gerado no servidor)
 *   3. upload do arquivo para a URL assinada (o navegador nunca monta o caminho)
 *   4. confirmDocumentUploadAction  registra a versão (idempotente pelo id da versão)
 *
 * Falha no passo 3: nada foi registrado — tentar de novo pede outra URL.
 * Falha no passo 4: o arquivo JÁ está no Storage; a tela NÃO finge sucesso e
 * oferece "confirmar de novo" com o MESMO id de versão (sem reenviar). Objeto
 * enviado e nunca confirmado fica órfão e é tratado pela limpeza de órfãos do
 * Storage (mecanismo existente) — nada é apagado daqui.
 */

export type UploadStep = "create" | "prepare" | "upload" | "confirm" | "done";

/** O que falta para concluir depois de uma falha (a tela guarda e retoma). */
export type UploadResume =
  | { step: "upload"; documentId: string }
  | { step: "confirm"; documentId: string; versionId: string; fileName: string; mimeType: string };

export type UploadOutcome =
  | { ok: true; documentId: string; versionId: string; alreadyConfirmed: boolean }
  | { ok: false; step: Exclude<UploadStep, "done">; error: ActionError; resume?: UploadResume };

const uploadError = (message: string): ActionError => ({ ok: false, error: { code: "INTERNAL", message }, requestId: "" });

/** Confere tipo e tamanho ANTES de pedir qualquer coisa ao servidor (o servidor e o bucket conferem de novo). */
export function checkFile(file: Pick<File, "type" | "size">): string | undefined {
  if (file.size <= 0) return "O arquivo está vazio.";
  if (file.size > MAX_UPLOAD_BYTES) return "Arquivo maior que o limite de 50 MB.";
  if (!(ALLOWED_FILE_TYPES as readonly string[]).includes(file.type)) return "Tipo de arquivo não aceito. Envie PDF, Word, Excel, texto, CSV ou imagem.";
  return undefined;
}

async function putFile(prepared: PreparedUploadDTO, file: File): Promise<string | undefined> {
  try {
    const { error } = await getSupabaseBrowserClient().storage.from(prepared.bucket).uploadToSignedUrl(prepared.path, prepared.token, file, { contentType: file.type, upsert: false });
    return error ? "Não foi possível enviar o arquivo. Verifique a conexão e tente de novo." : undefined;
  } catch {
    return "Sem conexão com o servidor. Verifique a internet e tente novamente.";
  }
}

async function confirm(documentId: string, versionId: string, fileName: string, mimeType: string): Promise<ActionResult<ConfirmedUploadDTO>> {
  return callAction(() => confirmDocumentUploadAction({ documentId, versionId, fileName, mimeType }));
}

/**
 * Envia `file` como NOVA VERSÃO de um documento existente (ou retoma uma
 * confirmação pendente). `onStep` informa a etapa atual para a tela.
 */
export async function uploadVersion(
  documentId: string,
  file: File,
  onStep: (step: UploadStep) => void,
  resume?: Extract<UploadResume, { step: "confirm" }>,
): Promise<UploadOutcome> {
  if (resume) {
    onStep("confirm");
    const confirmed = await confirm(resume.documentId, resume.versionId, resume.fileName, resume.mimeType);
    if (!confirmed.ok) return { ok: false, step: "confirm", error: confirmed, resume };
    onStep("done");
    return { ok: true, documentId, versionId: resume.versionId, alreadyConfirmed: confirmed.data.alreadyConfirmed };
  }

  const problem = checkFile(file);
  if (problem) return { ok: false, step: "prepare", error: uploadError(problem), resume: { step: "upload", documentId } };

  onStep("prepare");
  const prepared = await callAction(() => prepareDocumentUploadAction({ documentId, fileName: file.name, mimeType: file.type, sizeBytes: file.size }));
  if (!prepared.ok) return { ok: false, step: "prepare", error: prepared, resume: { step: "upload", documentId } };

  onStep("upload");
  const failure = await putFile(prepared.data, file);
  if (failure) return { ok: false, step: "upload", error: uploadError(failure), resume: { step: "upload", documentId } };

  onStep("confirm");
  const pending = { step: "confirm" as const, documentId, versionId: prepared.data.versionId, fileName: file.name, mimeType: file.type };
  const confirmed = await confirm(documentId, prepared.data.versionId, file.name, file.type);
  if (!confirmed.ok) return { ok: false, step: "confirm", error: confirmed, resume: pending };
  onStep("done");
  return { ok: true, documentId, versionId: prepared.data.versionId, alreadyConfirmed: confirmed.data.alreadyConfirmed };
}

/** Documento NOVO + primeiro arquivo. */
export async function createAndUpload(
  input: { clientId?: string; legalCaseId?: string; legalProcessId?: string; category: string; title: string; description?: string },
  file: File,
  onStep: (step: UploadStep) => void,
): Promise<UploadOutcome> {
  const problem = checkFile(file);
  if (problem) return { ok: false, step: "create", error: uploadError(problem) };
  onStep("create");
  const created = await callAction(() => createDocumentAction(input));
  if (!created.ok) return { ok: false, step: "create", error: created };
  return uploadVersion(created.data.id, file, onStep);
}
