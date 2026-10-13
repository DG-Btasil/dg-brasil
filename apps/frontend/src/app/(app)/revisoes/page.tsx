import { RequirePermission } from "@/components/layout/server-guards";
import { ReviewQueue } from "@/features/reviews/components/review-queue";
import { reviewQueryFromSearchParams, reviewQueryToInput } from "@/features/reviews/list-query";
import { listReviewsAction } from "@/server/domain/reviews/actions";

/** Primeira página da fila, já com a visão e os filtros da URL. */
async function Queue({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const query = reviewQueryFromSearchParams(searchParams);
  return <ReviewQueue initialQuery={query} initialResult={await listReviewsAction(reviewQueryToInput(query))} />;
}

export default async function ReviewsPage({ searchParams }: PageProps<"/revisoes">) {
  const params = await searchParams;
  return (
    <RequirePermission permission="reviews.view">
      <Queue searchParams={params} />
    </RequirePermission>
  );
}
