"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { PageContainer } from "@/components/layout/guards";
import { PageHeader } from "@/components/ui/display";
import { useClients, useProcessActions } from "../hooks";
import { ProcessForm } from "./process-form";

/** Página de cadastro manual (/processos/novo). Aceita ?cliente=<id>. */
export function NewProcessPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const clients = useClients();
  const { createProcess } = useProcessActions();
  const prefill = searchParams.get("cliente") ?? "";
  const initialClientId = clients.some((c) => c.id === prefill) ? prefill : "";
  const back = initialClientId ? `/clientes/${initialClientId}` : "/processos";

  return (
    <PageContainer className="max-w-[1200px]">
      <PageHeader
        title="Cadastrar processo"
        description="Cadastro manual. Processos sem número CNJ ficam em pré-ajuizamento até a distribuição."
        breadcrumbs={[{ label: "Processos", href: "/processos" }, { label: "Cadastrar processo" }]}
      />
      <ProcessForm
        initialClientId={initialClientId}
        onCancel={() => router.push(back)}
        onSubmit={async (input) => {
          const id = await createProcess(input);
          if (id) router.push(`/processos/${id}`);
        }}
      />
    </PageContainer>
  );
}
