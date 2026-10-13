"use server";

import { runAction } from "@/server/core/action";
import * as service from "./service";
import { assignReviewSchema, decideReviewSchema, listReviewsSchema, reopenReviewSchema, reviewIdSchema } from "./schemas";

/**
 * Server Actions de revisão humana. Ler: `reviews.view`; atribuir, decidir e
 * reabrir: `reviews.decide` (ADMIN e LAWYER). Decisão só por decide_review.
 */

export async function listReviewsAction(input: unknown) {
  return runAction({ name: "reviews.list", permission: "reviews.view", schema: listReviewsSchema, input, handler: service.listReviews });
}

export async function getReviewAction(input: unknown) {
  return runAction({ name: "reviews.get", permission: "reviews.view", schema: reviewIdSchema, input, handler: (ctx, { id }) => service.getReview(ctx, id) });
}

export async function assignReviewAction(input: unknown) {
  return runAction({ name: "reviews.assign", permission: "reviews.decide", schema: assignReviewSchema, input, handler: service.assignReview });
}

export async function decideReviewAction(input: unknown) {
  return runAction({ name: "reviews.decide", permission: "reviews.decide", schema: decideReviewSchema, input, handler: service.decideReview });
}

export async function reopenReviewAction(input: unknown) {
  return runAction({ name: "reviews.reopen", permission: "reviews.decide", schema: reopenReviewSchema, input, handler: service.reopenReview });
}
