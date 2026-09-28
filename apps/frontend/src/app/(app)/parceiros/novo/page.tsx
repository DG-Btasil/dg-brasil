import { PageContainer, RequirePermission } from "@/components/layout/guards";
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
