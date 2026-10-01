"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { PageContainer } from "@/components/layout/guards";
import { PageHeader } from "@/components/ui/display";
import { useLegalCases } from "@/features/cases/hooks";
import { useProcessActions } from "../hooks";
import { ProcessForm } from "./process-form";

/** Página de cadastro manual (/processos/novo). Aceita ?caso=<id> e ?cliente=<id>. */
export function NewProcessPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const cases = useLegalCases();
  const { createProcess } = useProcessActions();
  const prefill = searchParams.get("caso") ?? "";
  const initialCaseId = cases.some((c) => c.id === prefill) ? prefill : "";
  const clientFilter = searchParams.get("cliente") ?? undefined;
  const back = initialCaseId ? `/casos/${initialCaseId}?aba=processos` : clientFilter ? `/clientes/${clientFilter}?aba=processos` : "/processos";

  return (
    <PageContainer className="max-w-[1200px]">
      <PageHeader
        title="Cadastrar processo"
        description="Todo processo pertence a um caso. Processos sem número CNJ ficam em pré-ajuizamento até a distribuição."
        breadcrumbs={[{ label: "Processos", href: "/processos" }, { label: "Cadastrar processo" }]}
      />
      <ProcessForm
        initialCaseId={initialCaseId}
        clientFilter={clientFilter}
        onCancel={() => router.push(back)}
        onSubmit={async (input) => {
          const id = await createProcess(input);
          if (id) router.push(`/processos/${id}`);
        }}
      />
    </PageContainer>
  );
}
