"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { PickerOption } from "@/components/ui/async-picker";
import { Callout } from "@/components/feedback/states";
import { PageContainer } from "@/components/layout/guards";
import { PageHeader } from "@/components/ui/display";
import { Panel, PanelBody } from "@/components/ui/panel";
import type { FeeModelDTO } from "@/server/domain/finance/dto";
import { AgreementForm } from "./agreement-form";

/**
 * Novo contrato de honorários — do PROCESSO (046). Vindo do processo
 * (`?processo=`), ele já vem escolhido; vindo do caso (`?caso=`), pergunta
 * qual processo do caso.
 */
export function NewAgreementView({
  feeModels,
  defaultProcess,
  caseContext,
}: {
  feeModels: FeeModelDTO[];
  defaultProcess?: PickerOption;
  /** Caso de origem (?caso=): seus processos e o link de volta. */
  caseContext?: { id: string; title: string; processes: PickerOption[] };
}) {
  const router = useRouter();
  const back = defaultProcess ? `/processos/${defaultProcess.id}?aba=financeiro` : caseContext ? `/casos/${caseContext.id}?aba=financeiro` : "/financeiro?aba=contratos";
  return (
    <PageContainer className="max-w-[1080px]">
      <PageHeader
        breadcrumbs={[{ label: "Financeiro", href: "/financeiro" }, { label: "Novo contrato de honorários" }]}
        title="Novo contrato de honorários"
        description={
          <>
            O contrato pertence a um processo. Escolha o processo e um modelo de honorários do escritório. Os modelos são mantidos em{" "}
            <Link href="/financeiro?aba=modelos" className="text-navy-700 underline underline-offset-2">
              Financeiro › Modelos de honorários
            </Link>
            .
          </>
        }
      />
      {caseContext && caseContext.processes.length === 0 && (
        <Callout tone="warning" title="Este caso ainda não tem processo." className="mb-4">
          O contrato de honorários é do processo. Cadastre o processo do caso “{caseContext.title}” ou escolha outro processo abaixo.
        </Callout>
      )}
      <Panel>
        <PanelBody className="px-6 py-6">
          <AgreementForm
            feeModels={feeModels}
            defaultProcess={defaultProcess}
            caseProcesses={caseContext?.processes}
            onCreated={(processId) => router.push(`/processos/${processId}?aba=financeiro`)}
            onCancel={() => router.push(back)}
          />
        </PanelBody>
      </Panel>
    </PageContainer>
  );
}
