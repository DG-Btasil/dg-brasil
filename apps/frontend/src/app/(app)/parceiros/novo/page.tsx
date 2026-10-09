import { PageContainer } from "@/components/layout/guards";
import { RequirePermission } from "@/components/layout/server-guards";
import { PartnerCreate } from "@/features/partners/components/partner-form";

export default function NewPartnerPage() {
  return (
    <PageContainer>
      <RequirePermission permission="partners.manage">
        <PartnerCreate />
      </RequirePermission>
    </PageContainer>
  );
}
