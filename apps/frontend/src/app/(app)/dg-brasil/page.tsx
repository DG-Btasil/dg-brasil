import { Suspense } from "react";
import { DgHome } from "@/features/dg-brasil/components/shared/dg-home";

export default function DgBrasilPage() {
  return (
    <Suspense>
      <DgHome />
    </Suspense>
  );
}
