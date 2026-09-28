import type { IntegrationStatus, JudicialSource } from "@/lib/constants/status";
import type { ID, ISODateTime, OfficeScoped } from "./common";

/**
 * Estado de uma fonte da Integração Judicial no escritório (DJEN, DataJud…).
 * O que a fonte SABE fazer vem do provedor (services/judicial-integration.ts);
 * aqui fica só o que o escritório configurou e o resultado das sincronizações.
 */
export interface JudicialSourceState extends OfficeScoped {
  source: JudicialSource;
  status: IntegrationStatus;
  /** DJEN: OAB monitorada (número) e UF de inscrição. */
  oabNumber?: string;
  oabState?: string;
  /** DataJud: tribunais consultados (siglas). */
  courts?: string[];
  responsibleUserId?: ID;
  lastSyncAt?: ISODateTime;
  /** DJEN: data da comunicação mais recente encontrada. */
  lastCommunicationAt?: ISODateTime;
  /** Quantidade de itens importados pela fonte (comunicações ou processos enriquecidos). */
  importedCount: number;
  statusMessage?: string;
}
