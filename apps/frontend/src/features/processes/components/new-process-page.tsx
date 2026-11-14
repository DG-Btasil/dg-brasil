"use client";

import { useRouter } from "next/navigation";
import { callAction } from "@/lib/actions/result";
import { useActionFeedback } from "@/lib/actions/use-action-feedback";
import { useIdempotencyKey } from "@/lib/hooks/use-idempotency-key";
import { PageContainer } from "@/components/layout/guards";
import type { PickerOption } from "@/components/ui/async-picker";
import { PageHeader } from "@/components/ui/display";
import { ButtonLink } from "@/components/ui/button";
import { Callout } from "@/components/feedback/states";
import { createProcessAction } from "@/server/domain/processes/actions";
import { useToast } from "@/store/ui-store";
import { ProcessForm } from "./process-form";

/**
 * Cadastro manual (/processos/novo, aceita ?caso=<id>). Chave de
 * idempotência por intenção de envio: clique duplo ou nova tentativa com os
 * mesmos dados devolve o MESMO processo (`deduplicated`), tratado como sucesso.
 */
export function NewProcessPage({
  initialCase,
  blockedCase,
}: {
  initialCase?: PickerOption & { lawyerId?: string };
  /** O caso da URL ainda não recebe processo (rascunho, rejeitado, arquivado): aviso com o motivo. */
  blockedCase?: { id: string; title: string; reason: string };
}) {
  const router = useRouter();
  const toast = useToast();
  const failed = useActionFeedback();
  const idempotency = useIdempotencyKey();
  const back = initialCase ? `/casos/${initialCase.id}?aba=processos` : "/processos";

  return (
    <PageContainer className="max-w-[1200px]">
      <PageHeader
        title="Cadastrar processo"
        description="Todo processo pertence a um caso e leva o nome dele. Processos sem número CNJ ficam em pré-ajuizamento até a distribuição. Prazos são lançados depois, na aba Prazos do processo."
        breadcrumbs={[{ label: "Processos", href: "/processos" }, { label: "Cadastrar processo" }]}
      />
      {blockedCase && (
        <Callout
          tone="warning"
          className="mb-5"
          title={`“${blockedCase.title}” ainda não recebe processo.`}
          action={
            <ButtonLink href={`/casos/${blockedCase.id}`} variant="secondary" size="sm">
              Abrir o caso
            </ButtonLink>
          }
        >
          {blockedCase.reason} Por isso ele não aparece na busca de casos abaixo.
        </Callout>
      )}
      <ProcessForm
        initialCase={initialCase}
        onCancel={() => router.push(back)}
        onSubmit={async (input, { caseTitle }) => {
          const result = await callAction(() => createProcessAction({ ...input, idempotencyKey: idempotency.keyFor(input) }));
          if (!result.ok) {
            failed(result, "Não foi possível cadastrar o processo.");
            return result;
          }
          idempotency.reset();
          toast({ tone: "success", title: "Processo cadastrado", description: caseTitle });
          // Recurso devolvido pelo servidor (também quando deduplicado).
          router.push(`/processos/${result.data.id}`);
          return result;
        }}
      />
    </PageContainer>
  );
}
