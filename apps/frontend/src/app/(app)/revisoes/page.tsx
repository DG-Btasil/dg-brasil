import { RequirePermission } from "@/components/layout/guards";
import { ReviewQueue } from "@/features/reviews/components/review-queue";

export default function ReviewsPage() {
  return (
    <RequirePermission permission="reviews.view">
      <ReviewQueue />
    </RequirePermission>
  );
}
