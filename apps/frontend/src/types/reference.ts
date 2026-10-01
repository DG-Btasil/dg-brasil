import type { ReferenceMaterialStatus, ReferenceMaterialType } from "@/lib/constants/status";
import type { LegalArea } from "@/lib/constants/legal";
import type { ID, ISODateTime, OfficeScoped } from "./common";

/**
 * Referência (DG Brasil): material que os agentes podem consultar como
 * modelo ou orientação — petições aprovadas, exemplos de redação,
 * orientações internas. Somente Administrador. Sem embeddings/RAG nesta
 * etapa: o backend decidirá indexação e recuperação.
 */
export interface ReferenceMaterial extends OfficeScoped {
  title: string;
  description: string;
  type: ReferenceMaterialType;
  area?: LegalArea;
  /** Protótipo: apenas metadados do arquivo. Backend: storageKey no Supabase Storage. */
  file?: { name: string; sizeKb: number };
  storageKey?: string;
  tags: string[];
  skillIds: ID[];
  thesisIds: ID[];
  agentIds: ID[];
  status: ReferenceMaterialStatus;
  createdAt: ISODateTime;
  createdBy: ID;
  updatedAt: ISODateTime;
}
