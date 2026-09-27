import { formatCNPJ, formatCPF, maskCNPJ, maskCPF } from "@/lib/formatting";
import { isDocumentSatisfied } from "@/lib/domain/analysis";
import type { Client, ClientDocument } from "@/types";

/** Nome principal exibido: nome completo (PF) ou razão social (PJ). */
export function clientDisplayName(client: Client): string {
  return client.kind === "INDIVIDUAL" ? client.fullName : client.legalName;
}

/** Linha secundária: nome social (PF) ou nome fantasia (PJ). */
export function clientSecondaryName(client: Client): string | undefined {
  return client.kind === "INDIVIDUAL" ? client.socialName : client.tradeName;
}

/** Nome curto usado em trilhas e títulos. */
export function clientShortName(client: Client): string {
  return client.kind === "INDIVIDUAL" ? (client.socialName ?? client.fullName) : (client.tradeName ?? client.legalName);
}

export function clientDocumentLabel(client: Client): "CPF" | "CNPJ" {
  return client.kind === "INDIVIDUAL" ? "CPF" : "CNPJ";
}

export function clientDocumentRaw(client: Client): string {
  return client.kind === "INDIVIDUAL" ? client.cpf : client.cnpj;
}

/** Identificador mascarado (minimização — LGPD). */
export function maskClientDocument(client: Client): string {
  return client.kind === "INDIVIDUAL" ? maskCPF(client.cpf) : maskCNPJ(client.cnpj);
}

export function formatClientDocument(client: Client): string {
  return client.kind === "INDIVIDUAL" ? formatCPF(client.cpf) : formatCNPJ(client.cnpj);
}

export interface DocumentProgress {
  received: number;
  total: number;
  pending: number;
}

/**
 * Progresso documental: recebidos (ou aguardando verificação) sobre o total
 * de itens cadastrados; pendentes = ausentes, a atualizar ou rejeitados.
 */
export function documentProgress(documents: ClientDocument[]): DocumentProgress {
  const received = documents.filter(isDocumentSatisfied).length;
  return { received, total: documents.length, pending: documents.length - received };
}
