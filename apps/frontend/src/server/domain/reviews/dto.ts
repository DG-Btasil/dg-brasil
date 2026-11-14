import type { DocumentCategory, Priority, ReviewDecisionKind, ReviewStatus } from "@/lib/constants/status";
import type { DbAnalysisStatus, DbReviewDecision, DbReviewStatus } from "@/repositories/api/db-mappings";
import type { AnalysisResult, ID, ISODateTime } from "@/types";
import type { Page } from "@/server/core/pagination";
import type { BulkDecision, BulkPlanItem } from "./bulk-rules";
import type { REVIEW_TARGET_KINDS } from "./schemas";

/**
 * DTOs de revisão humana. Só ADMIN e LAWYER (RLS de reviews): não existe DTO
 * de parceiro. O CONTEÚDO revisado não é copiado na revisão: vem do alvo
 * (análise, versão de documento ou proposta do agente), lido na hora.
 */

export type ReviewTargetKind = (typeof REVIEW_TARGET_KINDS)[number];

export interface ReviewListItem {
  id: ID;
  targetKind: ReviewTargetKind;
  targetId: ID;
  /** Só quando o alvo é proposta de agente. */
  proposalType?: string;
  /** O que está em revisão (template da análise, documento e versão, tipo da proposta). Só rótulo. */
  subject: string;
  /** Só em proposta do agente: o que ela pede, em uma linha (documento pedido, título ou resumo). */
  detail?: string;
  /** Só em proposta do agente: se aprovada, manda um texto ao parceiro do caso (não entra na aprovação em conjunto). */
  sendsToPartner?: boolean;
  /** Agente que gerou a proposta (quando houver). */
  agentName?: string;
  caseTitle?: string;
  clientName?: string;
  /** Proposta que altera a configuração do DG Brasil: só ADMIN decide. */
  requiresAdmin: boolean;
  legalCaseId?: ID;
  processId?: ID;
  /** Execução do agente que gerou o item (067); vazio quando foi enviado por uma pessoa. */
  agentRunId?: ID;
  /** Status do front (PENDING + prioridade URGENT = URGENT). */
  status: ReviewStatus;
  dbStatus: DbReviewStatus;
  priority: Priority;
  assignedReviewerId?: ID;
  dueAt?: ISODateTime;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  decidedAt?: ISODateTime;
}

/**
 * Indicadores da fila (revisões EM ABERTO), contados no banco para a fila
 * inteira com a RLS de quem pede — não só a página carregada.
 */
export interface ReviewSummaryDTO {
  /** Aguardando decisão (PENDING ou REOPENED). */
  open: number;
  /** Em aberto com prioridade URGENT ou HIGH. */
  topPriority: number;
  /** Em aberto com prazo até o fim do 7º dia (inclui vencidas). */
  dueSoon: number;
  /** Em aberto sem responsável. */
  unassigned: number;
}

/**
 * Um grupo da fila agrupada (067): os itens de uma execução do agente ou, para
 * o que foi enviado por pessoas, os itens de um caso. Só rótulos e contagens
 * dos itens que passam nos filtros; nenhum conteúdo revisado.
 */
export interface ReviewGroupDTO {
  /** "run:<id da execução>" ou "case:<id do caso>". */
  key: string;
  /** Presente quando o grupo é de uma execução do agente. */
  agentRunId?: ID;
  legalCaseId?: ID;
  agentName?: string;
  caseTitle?: string;
  clientName?: string;
  total: number;
  documents: number;
  proposals: number;
  analyses: number;
  /** Quantos ainda aguardam decisão. */
  open: number;
  unassigned: number;
  /** A prioridade mais alta entre os itens. */
  topPriority: Priority;
  /** Quando o primeiro e o último item chegaram. */
  firstCreatedAt: ISODateTime;
  lastCreatedAt: ISODateTime;
  reviewerIds: ID[];
}

/** Página de grupos; `total` conta grupos e `totalItems`, as revisões dentro deles. */
export type ReviewGroupPage = Page<ReviewGroupDTO> & { totalItems: number };

/**
 * O que aconteceu com UM item da decisão em conjunto. DECIDED = decisão
 * registrada; SKIPPED = ficou de fora pela regra (`reason` e `message` dizem
 * por quê); FAILED = o sistema recusou ou deu erro (`message`). `subject` é o
 * rótulo do item na fila (vazio quando a revisão não foi encontrada).
 */
export type BulkDecisionItemDTO = BulkPlanItem;

export interface BulkDecisionResultDTO {
  decision: BulkDecision;
  decided: number;
  skipped: number;
  failed: number;
  /** Um resultado por item, na ordem pedida. */
  items: BulkDecisionItemDTO[];
}

export type ReviewTargetDTO =
  | {
      kind: "ANALYSIS";
      analysisId: ID;
      analysisStatus: DbAnalysisStatus;
      templateId: ID;
      agentRunId?: ID;
      result?: AnalysisResult;
      resultData: Record<string, unknown>;
    }
  | {
      kind: "DOCUMENT_VERSION";
      documentVersionId: ID;
      documentId: ID;
      versionNumber: number;
      title: string;
      category: DocumentCategory;
      visibility: "INTERNAL" | "PARTNER_VISIBLE";
      originalFilename?: string;
      mimeType?: string;
      source: string;
      createdAt: ISODateTime;
    }
  | {
      kind: "AGENT_PROPOSAL";
      proposalId: ID;
      agentRunId: ID;
      proposalType: string;
      proposalStatus: string;
      payload: Record<string, unknown>;
      requiresHumanReview: boolean;
      createdAt: ISODateTime;
      /** Presente quando uma pessoa corrigiu e aprovou (069): o que o agente propôs. `payload` é o que foi aprovado. */
      originalPayload?: Record<string, unknown>;
      correctedById?: ID;
      correctedAt?: ISODateTime;
    };

export interface ReviewDecisionDTO {
  id: ID;
  /** Decisão no vocabulário do front; null para REOPEN (evento de histórico, não decisão). */
  decision: ReviewDecisionKind | null;
  dbDecision: DbReviewDecision;
  notes?: string;
  decidedById: ID;
  at: ISODateTime;
}

/**
 * Conteúdo editável da versão em revisão (034). Só texto (minutas .md/.txt do
 * agente ou enviadas como texto); PDF/DOCX seguem por "Enviar nova versão".
 */
export type ReviewContentDTO =
  | {
      kind: "TEXT";
      versionId: ID;
      versionNumber: number;
      mimeType: string;
      text: string;
      /** Editável agora? Revisão decidida ou documento arquivado: só leitura. */
      editable: boolean;
      readOnlyReason?: "DECIDED" | "ARCHIVED" | "SUPERSEDED";
    }
  | { kind: "UNAVAILABLE"; reason: "NOT_DOCUMENT" | "FORMAT" | "TOO_LARGE" };

/** Resultado da edição manual: a revisão NOVA (da versão N+1) para onde a tela navega. */
export interface ManualRevisionDTO {
  reviewId: ID;
  previousReviewId: ID;
  versionId: ID;
  versionNumber: number;
  deduplicated: boolean;
}

/** Resultado de "Corrigir e aprovar" (069): a decisão registrada e os nomes dos campos que mudaram. */
export interface CorrectionResultDTO {
  decisionId: ID;
  fields: string[];
  status: ReviewStatus;
}

/** Por que não dá para pedir o refazer (070). */
export type RedoBlock = "NO_RUN" | "DECIDED" | "ALREADY_REDONE" | "LIMIT" | "RUNNING" | "AGENT_INACTIVE" | "ANALYSIS_MOVED";

/**
 * "Pedir para o agente refazer" (070): o trabalho que gerou o item, a posição
 * na cadeia de refazeres (0 = trabalho original; no máximo 3) e os dois lados
 * do vínculo: o refazer já pedido deste trabalho e de qual revisão este
 * trabalho é o refazer.
 */
export interface ReviewRedoDTO {
  agentRunId?: ID;
  agentName?: string;
  runStatus?: string;
  round: number;
  /** Este trabalho é o refazer de outro: o anterior e a revisão em que pediram. */
  redoOfRunId?: ID;
  redoOfReviewId?: ID;
  /** O refazer já pedido deste trabalho (por esta revisão ou por outro item do mesmo trabalho). */
  redone?: { agentRunId: ID; status: string; createdAt: ISODateTime; requestedById?: ID; reviewId?: ID };
  /** O refazer foi pedido nesta revisão. */
  redoneFromThisReview: boolean;
  canRedo: boolean;
  blocked?: RedoBlock;
  /** Frase do motivo, quando não dá para pedir. */
  message?: string;
}

/** Resposta do pedido de refazer. */
export interface RedoResultDTO {
  agentRunId: ID;
  round: number;
  deduplicated: boolean;
}

export interface ReviewDetailDTO extends ReviewListItem {
  /** null quando o alvo não pôde ser lido (ex.: removido). */
  target: ReviewTargetDTO | null;
  decisions: ReviewDecisionDTO[];
  /** Refazer (070); null quando a situação não pôde ser lida. */
  redo: ReviewRedoDTO | null;
}
