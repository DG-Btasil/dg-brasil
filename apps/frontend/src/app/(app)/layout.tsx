import { AppShell } from "@/components/layout/app-shell";

export default function AuthenticatedLayout({ children }: LayoutProps<"/">) {
  return <AppShell>{children}</AppShell>;
}
