"use client";

import { useRouter } from "next/navigation";
import { callAction } from "@/lib/actions/result";
import { useActionFeedback } from "@/lib/actions/use-action-feedback";
import { PageContainer } from "@/components/layout/guards";
import { PageHeader } from "@/components/ui/display";
import { updateProcessAction } from "@/server/domain/processes/actions";
import type { ProcessInternalDTO } from "@/server/domain/processes/dto";
import { useToast } from "@/store/ui-store";
import { ProcessEditForm } from "./process-form";

/** Edição dos dados cadastrais do processo (PATCH no servidor; vazio limpa). */
export function EditProcessPage({ process }: { process: ProcessInternalDTO }) {
  const router = useRouter();
  const toast = useToast();
  const failed = useActionFeedback();
  const back = `/processos/${process.id}`;

  return (
    <PageContainer className="max-w-[1200px]">
      <PageHeader
        title="Editar processo"
        breadcrumbs={[{ label: "Processos", href: "/processos" }, { label: process.title, href: back }, { label: "Editar" }]}
        description="Atualize os dados cadastrais. Prazos e andamentos são registrados nas abas do processo."
      />
      <ProcessEditForm
        process={process}
        onCancel={() => router.push(back)}
        onSubmit={async (patch) => {
          const result = await callAction(() => updateProcessAction({ id: process.id, patch }));
          if (!result.ok) {
            if (!result.error.fieldErrors) failed(result, "Não foi possível salvar o processo.");
            return result;
          }
          toast({ tone: "success", title: "Processo atualizado" });
          router.push(back);
          return result;
        }}
      />
    </PageContainer>
  );
}
