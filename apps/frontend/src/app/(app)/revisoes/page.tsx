import { RequirePermission } from "@/components/layout/server-guards";
import { ReviewQueue } from "@/features/reviews/components/review-queue";
import { reviewQueryFromSearchParams } from "@/features/reviews/list-query";
import { loadReviewQueue } from "@/features/reviews/load-queue";
import { getReviewSummaryAction } from "@/server/domain/reviews/actions";

/**
 * Primeira página da fila, já com o modo (agrupada por execução, o padrão, ou
 * lista), a visão e os filtros da URL, e os indicadores da fila inteira (em
 * paralelo).
 */
async function Queue({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const query = reviewQueryFromSearchParams(searchParams);
  const [result, summary] = await Promise.all([loadReviewQueue(query), getReviewSummaryAction()]);
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
