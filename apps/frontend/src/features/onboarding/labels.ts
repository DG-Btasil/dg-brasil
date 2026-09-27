import type { ApprovalsValues, ClientProfileValues, CommunicationValues, WritingStyleValues } from "./schemas";

/** Rótulos em português dos valores próprios do onboarding. */

export const CLIENT_MIX_LABEL: Record<ClientProfileValues["clientMix"], string> = {
  INDIVIDUAL: "Pessoa Física",
  COMPANY: "Pessoa Jurídica",
  BOTH: "Ambos",
};

export const FORMALITY_LABEL: Record<WritingStyleValues["formality"], string> = {
  VERY_FORMAL: "Muito formal",
  FORMAL: "Formal",
  MODERATE: "Moderado",
};

export const LENGTH_LABEL: Record<WritingStyleValues["length"], string> = {
  CONCISE: "Concisa",
  BALANCED: "Equilibrada",
  DETAILED: "Detalhada",
};

export const APPROVAL_ITEM_LABEL: Record<ApprovalsValues["requiresApproval"][number], string> = {
  PETITIONS: "Petições e minutas",
  CLIENT_MESSAGES: "Mensagens a clientes",
  DEADLINES: "Cadastro e alteração de prazos",
  SKILL_CHANGES: "Alterações de Skills e regras",
  THIRD_PARTY_DOCUMENTS: "Documentos enviados a terceiros",
  NEW_CASES: "Aceite de novos casos",
};

export const TONE_LABEL: Record<CommunicationValues["tone"], string> = {
  FORMAL_CORDIAL: "Cordial e formal",
  CLOSE_OBJECTIVE: "Próximo e objetivo",
  TECHNICAL: "Técnico e detalhado",
};

export const INTAKE_CHANNELS = ["Indicação", "Site", "WhatsApp", "Redes sociais", "Parcerias"] as const;

export const CONTACT_CHANNELS = ["WhatsApp", "E-mail", "Telefone", "Reunião presencial", "Videochamada"] as const;

export const DEFAULT_STAGES: { key: string; label: string }[] = [
  { key: "new-client", label: "Novo cliente" },
  { key: "documents", label: "Documentos" },
  { key: "analysis", label: "Análise" },
  { key: "acceptance", label: "Aceite" },
  { key: "action", label: "Ação" },
  { key: "petition", label: "Petição" },
  { key: "review", label: "Revisão" },
  { key: "filing", label: "Protocolo" },
  { key: "follow-up", label: "Acompanhamento" },
];

export const LOCKED_APPROVAL_TEXT = "Ações externas relevantes sempre exigem confirmação humana";
