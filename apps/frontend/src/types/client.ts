import type {
  ClientKind,
  ClientStatus,
  DocumentCategory,
  DocumentStatus,
  DocumentVerification,
  DocumentVisibility,
} from "@/lib/constants/status";
import type { Gender, IdDocumentType, MaritalStatus } from "@/lib/constants/legal";
import type { Address, Contact, ID, ISODate, ISODateTime, OfficeScoped, Timestamps } from "./common";

interface ClientBase extends OfficeScoped, Timestamps {
  kind: ClientKind;
  status: ClientStatus;
  responsibleUserId: ID;
  contact: Contact;
  address?: Address;
  /** Observações internas estruturadas. */
  notes?: string;
  /** Resumo jurídico curto do relacionamento com o cliente. */
  legalSummary?: string;
  /** Preenchido quando o cliente é inativado (status INACTIVE). Mantido no histórico. */
  inactivation?: ClientInactivation;
  /**
   * Origem do cliente: escritório (proprietário ou parceiro) ao qual a
   * entrada comercial foi atribuída NO CADASTRO. Obrigatória na criação
   * (formulário + ação). Não é quem digitou (ver createdByOfficeId), nem a
   * origem de processos, nem o parceiro financeiro de um caso. Nunca é
   * sobrescrita por deduplicação; mudar exige ação explícita e auditada.
   * Pode chegar ausente ao parceiro quando pertence a outro escritório.
   */
  originOfficeId?: ID;
  /**
   * Escritório do usuário que registrou o cadastro canônico (auditoria).
   * NÃO define a origem do cliente, de processos futuros nem a divisão
   * financeira (que pertencem ao processo).
   */
  createdByOfficeId?: ID;
}

export const CLIENT_INACTIVATION_REASONS = ["SERVICE_ENDED", "CLIENT_GAVE_UP", "CONTRACT_ENDED", "DUPLICATE", "OTHER"] as const;
export type ClientInactivationReason = (typeof CLIENT_INACTIVATION_REASONS)[number];
export const CLIENT_INACTIVATION_REASON_LABEL: Record<ClientInactivationReason, string> = {
  SERVICE_ENDED: "Encerramento do atendimento",
  CLIENT_GAVE_UP: "Cliente desistiu",
  CONTRACT_ENDED: "Contrato encerrado",
  DUPLICATE: "Duplicado",
  OTHER: "Outro",
};

export interface ClientInactivation {
  reason?: ClientInactivationReason;
  note?: string;
  at: ISODateTime;
  by: ID;
  /** Status anterior, para a reativação voltar ao ponto em que estava. */
  previousStatus: ClientStatus;
}

/**
 * Registro de um cliente excluído. O protótipo não apaga o rastro: guarda o
 * nome e quando/por quem foi removido, para que processos que ficaram sem
 * vínculo possam exibir de quem eram. No backend: soft delete (deletedAt).
 */
export interface RemovedClientRecord {
  id: ID;
  officeId: ID;
  name: string;
  document: string;
  deletedAt: ISODateTime;
  deletedBy: ID;
  linkedProcessIds: ID[];
}

export interface IdentityDocument {
  type: IdDocumentType;
  number: string;
  issuer?: string;
  state?: string;
}

export interface IndividualClient extends ClientBase {
  kind: "INDIVIDUAL";
  fullName: string;
  socialName?: string;
  cpf: string;
  identityDocument?: IdentityDocument;
  birthDate?: ISODate;
  nationality?: string;
  birthplace?: string;
  gender?: Gender;
  maritalStatus?: MaritalStatus;
  stableUnion?: boolean;
  profession?: string;
}

export interface LegalRepresentative {
  id: ID;
  name: string;
  cpf: string;
  role: string;
  email?: string;
  phone?: string;
  isPrimary: boolean;
}

export interface Partner {
  id: ID;
  name: string;
  /** CPF ou CNPJ — exibido sempre mascarado. */
  document: string;
  qualification: string;
  sharePercent?: number;
}

export interface CompanyClient extends ClientBase {
  kind: "COMPANY";
  legalName: string;
  tradeName?: string;
  cnpj: string;
  registrationStatus?: string;
  openingDate?: ISODate;
  legalNature?: string;
  mainCnae?: string;
  secondaryCnaes?: string[];
  representatives: LegalRepresentative[];
  partners: Partner[];
}

export type Client = IndividualClient | CompanyClient;

/**
 * Documento. Pode pertencer ao Cliente (ex.: RG), ao Caso (ex.: contrato
 * bancário) ou ao Processo (ex.: petição protocolada — então também ao Caso).
 * `clientId` sempre presente; `legalCaseId` e `processId` opcionais.
 */
export interface ClientDocument extends OfficeScoped {
  clientId: ID;
  legalCaseId?: ID;
  processId?: ID;
  name: string;
  category: DocumentCategory;
  status: DocumentStatus;
  verification: DocumentVerification;
  fileName?: string;
  sizeKb?: number;
  uploadedAt?: ISODateTime;
  uploadedBy?: ID;
  /** Se o documento é exigido por alguma análise em curso. */
  required: boolean;
  notes?: string;
  updatedAt: ISODateTime;
  /** INTERNAL (padrão) nunca chega ao parceiro; PARTNER_VISIBLE fica disponível ao parceiro do caso. */
  visibility: DocumentVisibility;
  /** Escritório parceiro que enviou o documento (ausente = equipe interna). */
  uploadedByPartnerOfficeId?: ID;
  /**
   * Versionamento: documentos da mesma "família" compartilham versionGroupId.
   * Uma nova versão cria OUTRO documento; a anterior é preservada com
   * `supersededAt`. Nada é sobrescrito.
   */
  versionGroupId?: ID;
  version?: number;
  supersededAt?: ISODateTime;
  /** Enviado oficialmente à Bárbara Cardoso Advocacia: a partir daqui o parceiro não edita nem apaga. */
  submittedAt?: ISODateTime;
  /** Revisão de origem (documento produzido internamente e aprovado). */
  sourceReviewId?: ID;
  /** Cópia congelada da versão aprovada, para exibição ao parceiro sem expor a revisão. */
  approvedContent?: { title: string; sections: { heading: string; body: string }[]; version: number; approvedAt: ISODateTime };
}
