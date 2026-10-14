import type { Metadata } from "next";
import { Callout } from "@/components/feedback/states";
import { PageContainer } from "@/components/layout/guards";
import { AudienceSwitch } from "@/components/layout/server-guards";
import { HomeDashboard } from "@/features/home/components/home-dashboard";
import { loadInternalHome, loadPartnerHome } from "@/features/home/load";
import { PortalHome } from "@/features/partner-portal/components/portal-home";

export const metadata: Metadata = { title: "Home" };

/** Painel interno: dados do servidor, só os blocos que o papel pode ver. */
async function Internal() {
  return <HomeDashboard data={await loadInternalHome()} />;
}

/** Início do portal: dados do servidor, recortados ao escritório da sessão. */
async function Partner() {
  return <PortalHome data={await loadPartnerHome()} />;
}

export default async function HomePage({ searchParams }: PageProps<"/home">) {
  // Os guards de servidor (require*) mandam para cá quando o papel não permite a área.
  const denied = (await searchParams).negado === "1";
  return (
    <PageContainer>
      {denied && (
        <Callout tone="warning" title="Acesso restrito" className="mb-5">
          Seu perfil não tem permissão para a área que você tentou abrir.
        </Callout>
      )}
      <AudienceSwitch owner={<Internal />} partner={<Partner />} />
    </PageContainer>
  );
}
