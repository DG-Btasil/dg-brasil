"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageContainer } from "@/components/layout/guards";
import { PageHeader } from "@/components/ui/display";
import { Panel, PanelBody } from "@/components/ui/panel";
import { AgreementForm } from "./agreement-form";

export function NewAgreementView({ clientId, legalCaseId }: { clientId?: string; legalCaseId?: string }) {
  const router = useRouter();
  return (
    <PageContainer className="max-w-[1080px]">
      <PageHeader
        breadcrumbs={[{ label: "Financeiro", href: "/financeiro" }, { label: "Novo contrato de honorários" }]}
        title="Novo contrato de honorários"
        description={
          <>
            Escolha o cliente, o caso e um modelo de honorários do escritório. O contrato abrange todos os processos do caso. Os modelos são mantidos em{" "}
            <Link href="/configuracoes?secao=honorarios" className="text-navy-700 underline underline-offset-2">
              Configurações › Modelos de honorários
            </Link>
            .
          </>
        }
      />
      <Panel>
        <PanelBody className="px-6 py-6">
          <AgreementForm
            defaultClientId={clientId}
            defaultCaseId={legalCaseId}
            onCreated={() => router.push("/financeiro")}
            onCancel={() => router.push("/financeiro")}
          />
        </PanelBody>
      </Panel>
    </PageContainer>
  );
}
