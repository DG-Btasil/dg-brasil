/**
 * Integração Judicial — contrato dos provedores de dados jurídicos externos.
 *
 * Nenhuma fonte fornece sozinha todos os dados. Cada provedor declara o que
 * sabe entregar (`capabilities`) e a interface se monta a partir disso:
 * adicionar uma nova fonte/fornecedor = implementar este contrato e registrar
 * em JUDICIAL_PROVIDERS, sem reescrever a tela.
 *
 * Fontes previstas:
 * - DJEN (Diário de Justiça Eletrônico Nacional): comunicações processuais,
 *   publicações e intimações, com consulta por OAB quando aplicável.
 * - DataJud (CNJ): metadados processuais — capa, classe, assuntos, tribunal,
 *   órgão julgador e movimentos disponíveis.
 *
 * NESTA ETAPA NÃO HÁ CHAMADA REAL. As implementações abaixo são mocks; a
 * implementação concreta vive no backend (jobs de sincronização, cotas,
 * deduplicação). Ver docs/BACKEND_HANDOFF.md, seção "Integração Judicial".
 */
import { nowISO } from "@/lib/clock";
import type { JudicialCapability, JudicialSource } from "@/lib/constants/status";
import type { ISODateTime } from "@/types";

/** Como a fonte é consultada. Orienta a UI (campos de configuração) e o backend (jobs). */
export type JudicialQueryMode = "BY_OAB" | "BY_CNJ";

export interface JudicialSyncResult {
  syncedAt: ISODateTime;
  /** Itens novos encontrados nesta execução (comunicações ou processos atualizados). */
  newItems: number;
  /** Data do item mais recente encontrado, quando a fonte informa. */
  latestItemAt?: ISODateTime;
}

export interface JudicialSourceConfig {
  oabNumber?: string;
  oabState?: string;
  courts?: string[];
  responsibleUserId?: string;
}

export interface JudicialIntegrationProvider {
  readonly source: JudicialSource;
  /** Nome exibido. */
  readonly name: string;
  readonly fullName: string;
  readonly description: string;
  readonly queryMode: JudicialQueryMode;
  readonly capabilities: readonly JudicialCapability[];
  /** Texto do contador de itens importados ("comunicações importadas", …). */
  readonly importedLabel: string;
  configure(config: JudicialSourceConfig): Promise<void>;
  sync(config: JudicialSourceConfig): Promise<JudicialSyncResult>;
}

/* ------------------------------------------------------------------ */
/* Mocks (somente demonstração)                                        */
/* ------------------------------------------------------------------ */

const mockSync = (newItems: number): Promise<JudicialSyncResult> =>
  Promise.resolve({ syncedAt: nowISO(), newItems, latestItemAt: nowISO() });

export const djenProvider: JudicialIntegrationProvider = {
  source: "DJEN",
  name: "DJEN",
  fullName: "Diário de Justiça Eletrônico Nacional",
  description: "Comunicações processuais, publicações e intimações dirigidas aos advogados do escritório, consultadas pela OAB quando aplicável.",
  queryMode: "BY_OAB",
  capabilities: ["COMMUNICATIONS", "PUBLICATIONS", "INTIMATIONS", "DERIVED_DEADLINES"],
  importedLabel: "Comunicações importadas",
  configure: async () => {},
  sync: () => mockSync(2),
};

export const dataJudProvider: JudicialIntegrationProvider = {
  source: "DATAJUD",
  name: "DataJud",
  fullName: "Base Nacional de Dados do Poder Judiciário (CNJ)",
  description: "Metadados dos processos já cadastrados: capa, tribunal, órgão julgador, classe, assuntos e histórico de movimentos disponível.",
  queryMode: "BY_CNJ",
  capabilities: ["PROCESS_METADATA", "MOVEMENTS", "COURT_BODY", "CLASS_SUBJECTS"],
  importedLabel: "Processos enriquecidos",
  configure: async () => {},
  sync: () => mockSync(1),
};

/** Registro de provedores. A UI itera sobre ele; nova fonte entra aqui. */
export const JUDICIAL_PROVIDERS: Record<JudicialSource, JudicialIntegrationProvider> = {
  DJEN: djenProvider,
  DATAJUD: dataJudProvider,
};
