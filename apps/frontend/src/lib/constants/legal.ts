/**
 * Vocabulário jurídico de apoio (áreas, UFs, tribunais).
 * Tribunais listados são órgãos reais do Judiciário brasileiro, usados apenas
 * como opção de cadastro. Nenhum dado processual real é associado a eles.
 */

export const LEGAL_AREAS = [
  "BANKING",
  "CONSUMER",
  "SOCIAL_SECURITY",
  "CIVIL",
  "LABOR",
  "TAX",
  "CORPORATE",
  "FAMILY",
] as const;
export type LegalArea = (typeof LEGAL_AREAS)[number];
export const LEGAL_AREA_LABEL: Record<LegalArea, string> = {
  BANKING: "Direito Bancário",
  CONSUMER: "Direito do Consumidor",
  SOCIAL_SECURITY: "Direito Previdenciário",
  CIVIL: "Direito Civil",
  LABOR: "Direito do Trabalho",
  TAX: "Direito Tributário",
  CORPORATE: "Direito Empresarial",
  FAMILY: "Direito de Família",
};

export const BRAZILIAN_STATES = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA",
  "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
] as const;
export type BrazilianState = (typeof BRAZILIAN_STATES)[number];

export const COURTS = [
  "TJSP", "TJRJ", "TJMG", "TJPR", "TJRS", "TJSC", "TJBA", "TJDFT", "TJGO", "TJPE",
  "TRF1", "TRF2", "TRF3", "TRF4", "TRF5", "TRF6",
  "TRT2", "TRT15",
  "STJ",
] as const;

export const MARITAL_STATUSES = ["SINGLE", "MARRIED", "DIVORCED", "WIDOWED", "SEPARATED"] as const;
export type MaritalStatus = (typeof MARITAL_STATUSES)[number];
export const MARITAL_STATUS_LABEL: Record<MaritalStatus, string> = {
  SINGLE: "Solteiro(a)",
  MARRIED: "Casado(a)",
  DIVORCED: "Divorciado(a)",
  WIDOWED: "Viúvo(a)",
  SEPARATED: "Separado(a) judicialmente",
};

export const ID_DOCUMENT_TYPES = ["RG", "CNH", "PASSPORT", "RNM", "OTHER"] as const;
export type IdDocumentType = (typeof ID_DOCUMENT_TYPES)[number];
export const ID_DOCUMENT_TYPE_LABEL: Record<IdDocumentType, string> = {
  RG: "RG",
  CNH: "CNH",
  PASSPORT: "Passaporte",
  RNM: "RNM",
  OTHER: "Outro",
};

/** Marca textual para todo conteúdo jurídico de demonstração. */
export const DEMO_LEGAL_DISCLAIMER = "Conteúdo jurídico fictício para demonstração da interface.";
export const DEMO_REFERENCE_LABEL = "Referência jurídica de demonstração";
