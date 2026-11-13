import type { ClientKind, ClientStatus, LegalCaseStatus, ProcessStatus } from "@/lib/constants/status";

/** Um grupo de resultados: os primeiros itens e quantos a busca alcança ao todo. */
export interface SearchGroup<T> {
  items: T[];
  total: number;
}

export interface ClientSearchHit {
  id: string;
  name: string;
  kind: ClientKind;
  status: ClientStatus;
  /** CPF/CNPJ com os dígitos do meio apenas (***.456.789-**): o resultado da busca não leva o documento inteiro. */
  maskedDocument: string;
}

export interface CaseSearchHit {
  id: string;
  title: string;
  clientName: string;
  status: LegalCaseStatus;
}

export interface ProcessSearchHit {
  id: string;
  title: string;
  /** 20 dígitos, sem máscara. */
  cnj?: string;
  clientName: string;
  status: ProcessStatus;
}

/**
 * Resultado da busca do cabeçalho. Cada grupo só existe para quem tem a
 * permissão daquela lista (grupo ausente = o papel não busca ali).
 */
export interface GlobalSearchDTO {
  clients?: SearchGroup<ClientSearchHit>;
  cases?: SearchGroup<CaseSearchHit>;
  processes?: SearchGroup<ProcessSearchHit>;
}
