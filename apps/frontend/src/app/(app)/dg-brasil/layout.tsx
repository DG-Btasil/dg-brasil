import { RequirePermission } from "@/components/layout/server-guards";
import { TutorDg } from "@/features/dg-brasil/tutor/tutor-dg";

export default function DgBrasilLayout({ children }: LayoutProps<"/dg-brasil">) {
  return (
    <RequirePermission permission="dgbrasil.view">
      {children}
      <TutorDg />
    </RequirePermission>
  );
}
