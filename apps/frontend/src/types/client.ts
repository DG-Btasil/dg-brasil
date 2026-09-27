import type {
  ClientKind,
  ClientStatus,
  DocumentCategory,
  DocumentStatus,
  DocumentVerification,
} from "@/lib/constants/status";
import type { IdDocumentType, MaritalStatus } from "@/lib/constants/legal";
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
  gender?: string;
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

export interface ClientDocument extends OfficeScoped {
  clientId: ID;
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
}
