import type { ActionResult } from "@/lib/actions/result";
import { listReviewGroupsAction, listReviewsAction } from "@/server/domain/reviews/actions";
import { reviewQueryToGroupInput, reviewQueryToInput, type ReviewListQuery } from "./list-query";
import { queueFromGroups, queueFromReviews, type ReviewQueuePage } from "./queue-entries";

/**
 * Uma página da fila no modo pedido: grupos por execução do agente ou
 * revisões item a item. A mesma chamada serve a primeira página (no servidor)
 * e as seguintes (na tela).
 */
export async function loadReviewQueue(query: ReviewListQuery): Promise<ActionResult<ReviewQueuePage>> {
  if (query.mode === "grupos") return queueFromGroups(await listReviewGroupsAction(reviewQueryToGroupInput(query)));
  return queueFromReviews(await listReviewsAction(reviewQueryToInput(query)));
}
