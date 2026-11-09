import { RequirePermission } from "@/components/layout/server-guards";
import { ReviewQueue } from "@/features/reviews/components/review-queue";
import { reviewQueryFromSearchParams, reviewQueryToInput } from "@/features/reviews/list-query";
import { getReviewSummaryAction, listReviewsAction } from "@/server/domain/reviews/actions";

/** Primeira página da fila, já com a visão e os filtros da URL, e os indicadores da fila inteira (em paralelo). */
async function Queue({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const query = reviewQueryFromSearchParams(searchParams);
  const [result, summary] = await Promise.all([listReviewsAction(reviewQueryToInput(query)), getReviewSummaryAction()]);
  return <ReviewQueue initialQuery={query} initialResult={result} initialSummary={summary} />;
}

export default async function ReviewsPage({ searchParams }: PageProps<"/revisoes">) {
  const params = await searchParams;
  return (
    <RequirePermission permission="reviews.view">
      <Queue searchParams={params} />
    </RequirePermission>
  );
}
