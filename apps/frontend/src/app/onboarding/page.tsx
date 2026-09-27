import type { Metadata } from "next";
import { OnboardingScreen } from "@/features/onboarding/components/onboarding-screen";

export const metadata: Metadata = { title: "Implantação do escritório" };

export default function OnboardingPage() {
  return <OnboardingScreen />;
}
