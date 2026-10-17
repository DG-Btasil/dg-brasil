import { RequirePermission } from "@/components/layout/server-guards";

/** Área DG Brasil (ADMIN): agentes, skills, teses, referências e execuções reais. */
export default function DgBrasilLayout({ children }: LayoutProps<"/dg-brasil">) {
  return <RequirePermission permission="dgbrasil.view">{children}</RequirePermission>;
}
