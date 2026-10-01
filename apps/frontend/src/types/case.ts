import type { LegalCaseStatus } from "@/lib/constants/status";
import type { LegalArea } from "@/lib/constants/legal";
import type { ID, ISODateTime, OfficeScoped, Timestamps } from "./common";

/**
 * Caso Jurídico: a demanda/atendimento em análise ou execução.
 *
 *   Client (pessoa) → LegalCase (demanda) → LegalProcess (processo judicial)
 *
 * - Um cliente pode ter nenhum, um ou vários casos.
 * - Um caso pode existir sem processo judicial (em análise, preparação ou
 *   resolvido sem ação) e pode ter vários processos.
 * - A ORIGEM do caso (`originOfficeId`) é independente da origem histórica
 *   do cliente e é ela que determina a parceria e a divisão financeira.
 * - O acordo financeiro e o acordo de parceria pertencem ao CASO; um contrato
 *   pode abranger vários processos.
 */
export interface LegalCase extends OfficeScoped, Timestamps {
  clientId: ID;
  title: string;
  area: LegalArea;
  /** Tipo da demanda, ex.: "Revisional de contrato bancário". */
  caseType: string;
  /**
   * Origem do caso: escritório proprietário ou um escritório parceiro.
   * Parceiro só pode atribuir o próprio escritório ou o proprietário.
   * Depois do aceite, só um Administrador interno altera (auditado).
   */
  originOfficeId: ID;
  /** Escritório do usuário que criou o caso (quem enviou). Não muda a origem. */
  createdByOfficeId: ID;
  createdBy: ID;
  /** Advogado responsável. Pode ser nulo antes do aceite; obrigatório para aceitar. */
  assignedLawyerId: ID | null;
  summary: string;
  opposingParty?: string;
  status: LegalCaseStatus;
  /** Análise jurídica do caso (cada caso tem a sua). */
  analysisId?: ID;
  submittedAt?: ISODateTime;
  acceptedAt?: ISODateTime;
  acceptedBy?: ID;
  rejectedAt?: ISODateTime;
  /** Texto visível ao parceiro ("Não aceito"). */
  rejectionReasonPublic?: string;
  /** Nota interna. NUNCA é entregue ao parceiro. */
  rejectionReasonInternal?: string;
  closedAt?: ISODateTime;
  archivedAt?: ISODateTime;
  /** Observações internas do escritório. Nunca chegam ao parceiro. */
  notes?: string;
  /** Observações enviadas pelo parceiro junto com o caso. */
  partnerNotes?: string;
}

/** Visão do caso com dados derivados (somente leitura). */
export interface LegalCaseRow {
  legalCase: LegalCase;
  clientName: string;
  originName: string;
  /** Parceiro de origem (ausente = caso próprio). */
  partnerName?: string;
  lawyerName?: string;
  processCount: number;
  documentCount: number;
}
