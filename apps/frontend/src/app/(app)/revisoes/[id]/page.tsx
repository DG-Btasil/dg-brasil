import { RequirePermission } from "@/components/layout/server-guards";
import { ReviewDetail } from "@/features/reviews/components/review-detail";

export default async function ReviewDetailPage({ params }: PageProps<"/revisoes/[id]">) {
  const { id } = await params;
  return (
    <RequirePermission permission="reviews.view">
      <ReviewDetail id={id} />
    </RequirePermission>
  );
}
