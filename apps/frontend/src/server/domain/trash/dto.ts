import type { TrashKind } from "./schemas";

/** Por que "Restaurar" seria recusado agora (o banco confere de novo ao restaurar). */
export type TrashBlockReason = "CLIENT_DELETED" | "CASE_DELETED" | "CNJ_IN_USE";

/** Uma linha da Lixeira. Só ADMIN recebe. */
export interface TrashItemDTO {
  id: string;
  kind: TrashKind;
  /** Nome do cliente, título do processo (ou do caso) ou título do documento. */
  title: string;
  deletedAt: string;
  /** Quem excluiu (da auditoria). Vazio quando a exclusão não foi feita por uma pessoa. */
  deletedByName?: string;
  blocked?: TrashBlockReason;
  /** CLIENT: CPF/CNPJ (só dígitos) e tipo. */
  document?: string;
  clientKind?: "INDIVIDUAL" | "COMPANY";
  /** PROCESS: número CNJ que o processo tinha; `cnjReleased` = o número já foi usado em outro cadastro. */
  cnj?: string;
  cnjReleased?: boolean;
  caseTitle?: string;
  /** PROCESS e DOCUMENT. */
  clientName?: string;
  /** DOCUMENT. */
  categoryLabel?: string;
}

/** Resultado de uma restauração: o suficiente para a tela dizer o que voltou. */
export type RestoreResultDTO =
  | { kind: "CLIENT"; id: string; cases: number; processes: number; documents: number; trashedProcesses: number; trashedDocuments: number }
  | { kind: "PROCESS"; id: string; legalCaseId: string; cnjReturned: boolean; openDeadlines: number }
  | { kind: "DOCUMENT"; id: string; clientId: string };
