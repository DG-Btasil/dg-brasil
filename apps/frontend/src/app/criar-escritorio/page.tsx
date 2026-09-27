import type { Metadata } from "next";
import { CreateOfficeScreen } from "@/features/auth/components/create-office-screen";

export const metadata: Metadata = { title: "Criar escritório" };

export default function CreateOfficePage() {
  return <CreateOfficeScreen />;
}
