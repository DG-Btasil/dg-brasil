"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { PickerOption } from "@/components/ui/async-picker";
import { PageContainer } from "@/components/layout/guards";
import { PageHeader } from "@/components/ui/display";
import { Panel, PanelBody } from "@/components/ui/panel";
import type { FeeModelDTO } from "@/server/domain/finance/dto";
import { AgreementForm } from "./agreement-form";

export function NewAgreementView({ feeModels, defaultCase }: { feeModels: FeeModelDTO[]; defaultCase?: PickerOption }) {
  const router = useRouter();
  const back = defaultCase ? `/casos/${defaultCase.id}?aba=financeiro` : "/financeiro";
  return (
    <PageContainer className="max-w-[1080px]">
      <PageHeader
        breadcrumbs={[{ label: "Financeiro", href: "/financeiro" }, { label: "Novo contrato de honorários" }]}
        title="Novo contrato de honorários"
        description={
          <>
            Escolha o caso e um modelo de honorários do escritório. O contrato abrange todos os processos do caso. Os modelos são mantidos em{" "}
            <Link href="/configuracoes?secao=honorarios" className="text-navy-700 underline underline-offset-2">
              Configurações › Modelos de honorários
            </Link>
            .
          </>
        }
      />
      <Panel>
        <PanelBody className="px-6 py-6">
          <AgreementForm feeModels={feeModels} defaultCase={defaultCase} onCreated={(caseId) => router.push(`/casos/${caseId}?aba=financeiro`)} onCancel={() => router.push(back)} />
        </PanelBody>
      </Panel>
    </PageContainer>
  );
}
