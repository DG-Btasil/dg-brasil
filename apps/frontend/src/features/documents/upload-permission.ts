import { can } from "@/lib/permissions";
import type { Role } from "@/types";
import type { DocumentScope } from "./constants";

/**
 * Quem pode ENVIAR documento num cliente, caso ou processo (regra única da
 * tela: aba Documentos e "Anexar documento" da revisão). Só decide o que
 * mostrar; o servidor (documents.create) e o banco conferem de novo.
 *
 * - Equipe interna: `documents.manage`.
 * - Parceiro: envia para caso/processo do próprio escritório, nunca só para o cliente.
 * - `readOnly` (ex.: caso arquivado ou recusado no portal): ninguém envia.
 */
export function canUploadDocuments(role: Role | null | undefined, scope: DocumentScope, readOnly = false): boolean {
  if (readOnly) return false;
  if (can(role, "documents.manage")) return true;
  return can(role, "partnerPortal.documents.submit") && !("clientId" in scope);
}
