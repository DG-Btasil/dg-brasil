"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Building2, UserRound } from "lucide-react";
import { ChoiceCards } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/display";
import { CLIENT_KIND_LABEL, type ClientKind } from "@/lib/constants/status";
import { repositories } from "@/repositories";
import { useToast } from "@/store/ui-store";
import { useCurrentUser } from "@/features/auth/hooks";
import { useDefaultClientOrigin } from "../../hooks";
import { companyToInput, emptyCompanyValues, emptyIndividualValues, individualToInput } from "../../schemas";
import { CompanyForm, IndividualForm } from "./client-forms";

export function ClientCreate() {
  const router = useRouter();
  const toast = useToast();
  const user = useCurrentUser();
  const [kind, setKind] = useState<ClientKind | undefined>(undefined);
  // Origem já vem preenchida com o escritório do usuário (Bárbara Cardoso Advocacia na equipe interna).
  const defaultOrigin = useDefaultClientOrigin();

  async function finish(id: string, name: string) {
    toast({ tone: "success", title: "Cliente cadastrado", description: `${name} foi adicionado à carteira do escritório.` });
    router.push(`/clientes/${id}`);
  }

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Clientes", href: "/clientes" }, { label: "Novo cliente" }]}
        title="Cadastrar cliente"
        description="Comece pelo tipo de pessoa. Informe o essencial agora — dados recomendados e opcionais podem ser completados depois."
      />
      <div className="mb-6 max-w-[760px]">
        <p aria-hidden className="mb-2 text-[12.5px] font-medium text-foreground">
          Tipo de cliente
        </p>
        <ChoiceCards<ClientKind>
          name="client-kind"
          legend="Tipo de cliente"
          value={kind}
          onChange={setKind}
          options={[
            {
              value: "INDIVIDUAL",
              label: CLIENT_KIND_LABEL.INDIVIDUAL,
              description: "Identificação por CPF. Qualificação civil e contato.",
              icon: <UserRound className="size-5" aria-hidden />,
            },
            {
              value: "COMPANY",
              label: CLIENT_KIND_LABEL.COMPANY,
              description: "Identificação por CNPJ. Representantes legais e quadro societário.",
              icon: <Building2 className="size-5" aria-hidden />,
            },
          ]}
        />
      </div>
      {kind === "INDIVIDUAL" && (
        <IndividualForm
          key="pf"
          defaultValues={emptyIndividualValues(user?.id, defaultOrigin)}
          submitLabel="Cadastrar cliente"
          onCancel={() => router.push("/clientes")}
          onSubmit={async (values) => {
            const id = await repositories.clients.create({ ...individualToInput(values), status: "NEW" });
            await finish(id, values.fullName);
          }}
        />
      )}
      {kind === "COMPANY" && (
        <CompanyForm
          key="pj"
          defaultValues={emptyCompanyValues(user?.id, defaultOrigin)}
          submitLabel="Cadastrar cliente"
          onCancel={() => router.push("/clientes")}
          onSubmit={async (values) => {
            const id = await repositories.clients.create({ ...companyToInput(values), status: "NEW" });
            await finish(id, values.tradeName || values.legalName);
          }}
        />
      )}
      {!kind && (
        <p className="text-[12.5px] text-muted">Selecione Pessoa Física ou Pessoa Jurídica para exibir o formulário correspondente.</p>
      )}
    </>
  );
}
