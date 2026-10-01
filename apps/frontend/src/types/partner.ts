import type {
  ClientRelationshipStatus,
  PartnerOfficeStatus,
  PartnerRequestStatus,
  PartnerRequestType,
  PartnershipStatus,
} from "@/lib/constants/status";
import type { PartnerRole } from "@/lib/permissions";
import type { ActorRef, Address, ID, ISODate, ISODateTime, OfficeScoped } from "./common";
import type { User } from "./user";

export type { PartnerRole } from "@/lib/permissions";

/**
 * Escritório parceiro. Pertence ao escritório proprietário (officeId) e
 * trabalha com ele em casos específicos. Os usuários do parceiro são `User`
 * com `partnerOfficeId` (relação 1:N — não ficam embutidos aqui).
 *
 * `partnershipPercentage`/`ownerPercentage` são o padrão VIGENTE para NOVOS
 * casos. Cada caso guarda a própria cópia em ProcessPartnershipAgreement
 * (snapshot) — alterar o padrão nunca muda casos antigos.
 */
export interface PartnerOffice extends OfficeScoped {
  name: string;
  legalName?: string;
  cnpj?: string;
  responsibleName: string;
  responsibleOab: string;
  oabState: string;
  email: string;
  phone: string;
  address?: Address;
  status: PartnerOfficeStatus;
  /** Participação do parceiro nos honorários de novos casos (0–100). */
  partnershipPercentage: number;
  /** Participação da Bárbara Cardoso Advocacia (0–100). Soma sempre 100. */
  ownerPercentage: number;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  activatedAt?: ISODateTime;
  /** Observações internas. Nunca exibidas ao parceiro. */
  notes?: string;
  metadata?: Record<string, string>;
}

/** Usuário de escritório parceiro: um `User` com papel de parceiro e escritório obrigatório. */
export type PartnerUser = User & { role: PartnerRole; partnerOfficeId: ID };

/**
 * Relacionamento entre um cliente canônico e um escritório. O cliente
 * (`Client`) é único por CPF/CNPJ; cada escritório que atende a pessoa tem
 * o seu relacionamento. É o relacionamento que libera (ou não) a
 * visibilidade — o registro canônico sozinho não dá acesso a nada.
 */
export interface ClientOfficeRelationship extends OfficeScoped {
  clientId: ID;
  /** OWNER = Bárbara Cardoso Advocacia; PARTNER = escritório parceiro. */
  officeType: "OWNER" | "PARTNER";
  partnerOfficeId?: ID;
  status: ClientRelationshipStatus;
  createdAt: ISODateTime;
  createdBy: ID;
}

export interface PartnerRequestMessage {
  id: ID;
  at: ISODateTime;
  actor: ActorRef;
  /** OWNER = equipe interna; PARTNER = escritório parceiro. */
  side: "OWNER" | "PARTNER";
  message: string;
  documentId?: ID;
}

/** Comunicação operacional estruturada entre o escritório e o parceiro. */
export interface PartnerRequest extends OfficeScoped {
  partnerOfficeId: ID;
  clientId?: ID;
  legalCaseId?: ID;
  processId?: ID;
  type: PartnerRequestType;
  title: string;
  description: string;
  status: PartnerRequestStatus;
  createdBy: ActorRef;
  createdAt: ISODateTime;
  /** Prazo recomendado (não é prazo processual). */
  dueDate?: ISODate;
  messages: PartnerRequestMessage[];
  resolvedAt?: ISODateTime;
  updatedAt: ISODateTime;
}

/** Repasse registrado ao parceiro (fato financeiro; não há transferência real). */
export interface PartnerPayout {
  id: ID;
  at: ISODateTime;
  amount: number;
  note?: string;
  registeredBy: ID;
}

/**
 * Acordo de parceria do CASO. Nasce no ACEITE de um caso cuja origem é um
 * parceiro. É um SNAPSHOT: os percentuais são copiados do PartnerOffice no
 * aceite e não mudam quando o padrão do parceiro muda.
 *
 * Valores guardados = fatos. Estimativas e saldos são derivados em
 * `lib/domain/partnership.ts`.
 */
export interface CasePartnershipAgreement extends OfficeScoped {
  legalCaseId: ID;
  partnerOfficeId: ID;
  partnerPercentage: number;
  ownerPercentage: number;
  effectiveAt: ISODateTime;
  /** Base de receita: honorários estimados do caso. Estimativa, nunca garantia. */
  revenueBase?: number;
  /** Honorários efetivamente realizados (recebidos pelo escritório). */
  realizedRevenue?: number;
  /** Repasses já registrados ao parceiro. */
  payouts: PartnerPayout[];
  /** Encerrado quando a origem do caso é alterada após o aceite (histórico preservado). */
  cancelledAt?: ISODateTime;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

/** Acordo com os valores derivados. Só existe em leitura. */
export interface PartnershipAgreementView extends CasePartnershipAgreement {
  status: PartnershipStatus;
  estimatedPartnerAmount?: number;
  estimatedOwnerAmount?: number;
  realizedPartnerAmount?: number;
  realizedOwnerAmount?: number;
  paidPartnerAmount: number;
  paidOwnerAmount?: number;
  pendingPartnerAmount: number;
}

/** Consolidado financeiro de um parceiro (visão do próprio parceiro ou da Bárbara). */
export interface PartnerFinancialSummary {
  partnerOfficeId: ID;
  /** Participação sobre honorários realizados. */
  accumulatedShare: number;
  received: number;
  toReceive: number;
  /** Participação estimada em casos ainda sem honorários realizados. */
  estimatedShare: number;
  agreements: number;
}
