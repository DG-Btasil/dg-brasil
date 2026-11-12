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

/**
 * Canal de aquisição: COMO o cliente chegou (marketing). Não confundir com o
 * escritório de origem (escritório principal ou parceiro), que é outra
 * informação. A mesma lista está no banco (migration 045).
 */
export const ACQUISITION_CHANNELS = [
  "REFERRAL",
  "GOOGLE_ADS",
  "META_ADS",
  "OTHER_PAID_TRAFFIC",
  "SOCIAL_MEDIA",
  "WEBSITE_SEARCH",
  "WHATSAPP",
  "RETURNING_CLIENT",
  "EVENT",
  "OTHER",
] as const;
export type AcquisitionChannel = (typeof ACQUISITION_CHANNELS)[number];
export const ACQUISITION_CHANNEL_LABEL: Record<AcquisitionChannel, string> = {
  REFERRAL: "Indicação / recomendação",
  GOOGLE_ADS: "Google Ads",
  META_ADS: "Meta Ads (Instagram/Facebook)",
  OTHER_PAID_TRAFFIC: "Outro tráfego pago",
  SOCIAL_MEDIA: "Redes sociais (orgânico)",
  WEBSITE_SEARCH: "Site / busca no Google",
  WHATSAPP: "WhatsApp",
  RETURNING_CLIENT: "Cliente antigo",
  EVENT: "Evento / palestra",
  OTHER: "Outro",
};
export const ACQUISITION_CHANNEL_OPTIONS = ACQUISITION_CHANNELS.map((c) => ({ value: c, label: ACQUISITION_CHANNEL_LABEL[c] }));
export const isAcquisitionChannel = (v: string): v is AcquisitionChannel => (ACQUISITION_CHANNELS as readonly string[]).includes(v);

/**
 * Forma de pagamento do custo operacional inicial do contrato de honorários,
 * escolhida pelo cliente. Dado interno do cadastro; ausente = ainda não
 * combinado. Os valores em reais ficam na configuração do escritório. A mesma
 * lista está no banco (migration 055), que a entrega ao agente do contrato.
 */
export const CONTRACT_PAYMENT_METHODS = ["PIX_UPFRONT", "BOLETO_INSTALLMENTS", "CARD_INSTALLMENTS", "END_OF_CASE"] as const;
export type ContractPaymentMethod = (typeof CONTRACT_PAYMENT_METHODS)[number];
export const CONTRACT_PAYMENT_METHOD_LABEL: Record<ContractPaymentMethod, string> = {
  PIX_UPFRONT: "À vista no Pix",
  BOLETO_INSTALLMENTS: "Parcelado no boleto",
  CARD_INSTALLMENTS: "Parcelado no cartão",
  END_OF_CASE: "Ao final da ação",
};
export const CONTRACT_PAYMENT_METHOD_OPTIONS = CONTRACT_PAYMENT_METHODS.map((m) => ({ value: m, label: CONTRACT_PAYMENT_METHOD_LABEL[m] }));

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
/** Gênero (opcional no cadastro de PF). Ausente = "Não informado". */
export const GENDERS = ["MALE", "FEMALE", "OTHER"] as const;
export type Gender = (typeof GENDERS)[number];
export const GENDER_LABEL: Record<Gender, string> = {
  MALE: "Masculino",
  FEMALE: "Feminino",
  OTHER: "Outro",
};
export const GENDER_NOT_INFORMED = "Não informado";

export const DEMO_LEGAL_DISCLAIMER = "Conteúdo jurídico fictício para demonstração da interface.";
export const DEMO_REFERENCE_LABEL = "Referência jurídica de demonstração";
