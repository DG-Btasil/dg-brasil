import { onlyDigits } from "@/lib/formatting";
import type { ProcessPartyDTO } from "@/server/domain/processes/dto";
import { PARTY_TYPES, type PartyType } from "@/server/domain/processes/schemas";

/** Qualificação da parte no processo. */
export const PARTY_TYPE_LABEL: Record<PartyType, string> = {
  PLAINTIFF: "Autor",
  DEFENDANT: "Réu",
  INTERESTED: "Interessado",
  OTHER: "Outro",
};
export const PARTY_TYPE_OPTIONS = PARTY_TYPES.map((value) => ({ value, label: PARTY_TYPE_LABEL[value] }));

export interface PartyFormValues {
  type: PartyType;
  name: string;
  /** CPF ou CNPJ como digitado. Na edição, vazio = manter o documento atual. */
  document: string;
}

export const EMPTY_PARTY: PartyFormValues = { type: "DEFENDANT", name: "", document: "" };

export function partyFormFrom(party: ProcessPartyDTO): PartyFormValues {
  // O documento não volta para o campo (minimização, LGPD): a tela mostra só a máscara.
  return { type: party.type, name: party.name, document: "" };
}

/** Erros do formulário, com a mesma regra do servidor (CPF 11 dígitos, CNPJ 14). */
export function partyFormErrors(v: PartyFormValues): { name?: string; document?: string } {
  const digits = onlyDigits(v.document);
  return {
    name: v.name.trim() ? undefined : "Informe o nome da parte.",
    document: !v.document.trim() || digits.length === 11 || digits.length === 14 ? undefined : "Informe um CPF (11 dígitos) ou CNPJ (14 dígitos).",
  };
}

/** Entrada de `addProcessPartyAction`. */
export function partyAddInput(processId: string, v: PartyFormValues) {
  const document = onlyDigits(v.document);
  return { processId, type: v.type, name: v.name.trim(), ...(document ? { document } : {}) };
}

/**
 * Entrada de `updateProcessPartyAction`: só o que mudou. Documento vazio não
 * entra (mantém o atual; o servidor apagaria se recebesse vazio). Sem mudança,
 * devolve `undefined` e nada é enviado.
 */
export function partyUpdateInput(party: ProcessPartyDTO, v: PartyFormValues) {
  const patch: { type?: PartyType; name?: string; document?: string } = {};
  if (v.type !== party.type) patch.type = v.type;
  if (v.name.trim() !== party.name) patch.name = v.name.trim();
  const document = onlyDigits(v.document);
  if (document && document !== party.document) patch.document = document;
  return Object.keys(patch).length ? { id: party.id, patch } : undefined;
}
