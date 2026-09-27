import type { Metadata } from "next";
import { PageContainer } from "@/components/layout/guards";
import { HomeDashboard } from "@/features/home/components/home-dashboard";

export const metadata: Metadata = { title: "Home" };

export default function HomePage() {
  return (
    <PageContainer>
      <HomeDashboard />
    </PageContainer>
  );
}
