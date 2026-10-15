import { RequirePermission } from "@/components/layout/server-guards";
import { TutorDg } from "@/features/dg-brasil/tutor/tutor-dg";
import { DemoAreaNotice } from "@/components/feedback/demo-area-notice";

export default function DgBrasilLayout({ children }: LayoutProps<"/dg-brasil">) {
  return (
    <RequirePermission permission="dgbrasil.view">
      <DemoAreaNotice area="A configuração da área DG Brasil (agentes, skills, teses, referências e histórico)" />
      {children}
      <TutorDg />
    </RequirePermission>
  );
}
