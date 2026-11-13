import type { ActionResult } from "@/lib/actions/result";
import { pluralize } from "@/lib/formatting";
import type { Page } from "@/server/core/pagination";
import type { ReviewGroupDTO, ReviewGroupPage, ReviewListItem } from "@/server/domain/reviews/dto";

/**
 * A fila de Revisões tem dois modos (agrupada por execução ou em lista) e uma
 * só listagem na tela. Cada linha da página diz o que é: um grupo ou uma
 * revisão. Assim a tela desenha pelo que CHEGOU do servidor, nunca pelo modo
 * que a pessoa acabou de escolher (a resposta do modo antigo ainda pode estar
 * na tela enquanto a nova carrega).
 */
export type ReviewQueueEntry = { type: "group"; group: ReviewGroupDTO } | { type: "review"; review: ReviewListItem };

/** `total` conta as linhas da página (grupos ou revisões); `totalItems`, as revisões dentro dos grupos. */
export type ReviewQueuePage = Page<ReviewQueueEntry> & { totalItems?: number };

export function queueFromGroups(result: ActionResult<ReviewGroupPage>): ActionResult<ReviewQueuePage> {
  if (!result.ok) return result;
  return { ...result, data: { ...result.data, items: result.data.items.map((group) => ({ type: "group" as const, group })) } };
}

export function queueFromReviews(result: ActionResult<Page<ReviewListItem>>): ActionResult<ReviewQueuePage> {
  if (!result.ok) return result;
  return { ...result, data: { ...result.data, items: result.data.items.map((review) => ({ type: "review" as const, review })) } };
}

/** "2 documentos · 17 propostas · 1 análise" (só os tipos que o grupo tem). */
export function groupCountsLabel(group: Pick<ReviewGroupDTO, "documents" | "proposals" | "analyses">): string {
  return [
    group.documents > 0 && pluralize(group.documents, "documento", "documentos"),
    group.proposals > 0 && pluralize(group.proposals, "proposta", "propostas"),
    group.analyses > 0 && pluralize(group.analyses, "análise", "análises"),
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Título do grupo: o agente que fez o trabalho ou, sem execução, quem enviou foi a equipe. */
export function groupTitle(group: Pick<ReviewGroupDTO, "agentRunId" | "agentName">): string {
  if (!group.agentRunId) return "Enviado pela equipe";
  return group.agentName ? `Trabalho de ${group.agentName}` : "Trabalho de agente";
}
