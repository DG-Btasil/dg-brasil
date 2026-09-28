import type { Metadata } from "next";
import { AudienceSwitch, PageContainer } from "@/components/layout/guards";
import { HomeDashboard } from "@/features/home/components/home-dashboard";
import { PortalHome } from "@/features/partner-portal/components/portal-home";

export const metadata: Metadata = { title: "Home" };

export default function HomePage() {
  return (
    <PageContainer>
      <AudienceSwitch owner={<HomeDashboard />} partner={<PortalHome />} />
    </PageContainer>
  );
}
