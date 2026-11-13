import type { PartnerOfficeStatus } from "@/lib/constants/status";
import type { Address, ISODateTime, OfficeScoped } from "./common";

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
  /** Participação da Barbara Cardoso Advocacia (0–100). Soma sempre 100. */
  ownerPercentage: number;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  activatedAt?: ISODateTime;
  /** Observações internas. Nunca exibidas ao parceiro. */
  notes?: string;
  metadata?: Record<string, string>;
}
