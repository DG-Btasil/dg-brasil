"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { FormProvider, useForm, type Path } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { callAction, mapFieldErrors } from "@/lib/actions/result";
import { useActionFeedback } from "@/lib/actions/use-action-feedback";
import { replaceCompanyPeopleAction } from "@/server/domain/clients/actions";
import { useToast } from "@/store/ui-store";
import type { CompanyClient } from "@/types";
import { companyPeopleSchema, companyPeopleToValues, type CompanyPeopleFormValues } from "../../schemas";
import { companyPeopleInput } from "../../server-input";
import { useSingleSubmit } from "./client-forms";
import { PartnersFields } from "./partners-fields";
import { RepresentativesFields } from "./representatives-fields";

/**
 * Representação e quadro societário da PJ, com gravação PRÓPRIA: a tela manda
 * as duas listas completas (estado final) e o banco substitui tudo numa
 * transação (028). Nada muda na tela antes da confirmação; em erro, o que foi
 * digitado continua no formulário.
 *
 * Depois de salvar, a página recarrega do servidor e este formulário é
 * remontado (key = `updatedAt` do cliente) com os ids reais das linhas novas.
 */
export function CompanyPeopleForm({ client }: { client: CompanyClient }) {
  const router = useRouter();
  const toast = useToast();
  const failed = useActionFeedback();
  const methods = useForm<CompanyPeopleFormValues>({ resolver: zodResolver(companyPeopleSchema), defaultValues: companyPeopleToValues(client), shouldFocusError: true });

  const submit = useSingleSubmit<CompanyPeopleFormValues>(async (values, { setError }) => {
    const result = await callAction(() => replaceCompanyPeopleAction(companyPeopleInput(client.id, values)));
    if (!result.ok) {
      const fields = mapFieldErrors(result.error.fieldErrors);
      Object.entries(fields).forEach(([name, message], i) => setError(name as Path<CompanyPeopleFormValues>, { message }, { shouldFocus: i === 0 }));
      failed(result, "Não foi possível salvar representantes e sócios.");
      return;
    }
    const { representatives: r, partners: p } = result.data;
    const changed = r.added + r.updated + r.removed + p.added + p.updated + p.removed > 0;
    toast({ tone: "success", title: changed ? "Representação e sócios atualizados" : "Nada a alterar", description: changed ? "O quadro foi salvo." : undefined });
    router.refresh();
  }, methods.setError);

  return (
    <FormProvider {...methods}>
      <form noValidate onSubmit={methods.handleSubmit(submit)} aria-label="Representação e quadro societário" className="mt-6">
        <Panel className="px-6">
          <RepresentativesFields />
          <PartnersFields />
          <div className="-mx-6 flex items-center justify-between gap-3 rounded-b-lg border-t border-line bg-surface px-6 py-3.5">
            <p className="text-[12px] text-muted">Representantes e sócios são salvos juntos, separadamente do restante do cadastro.</p>
            <div className="flex items-center gap-2">
              <Button variant="secondary" disabled={methods.formState.isSubmitting || !methods.formState.isDirty} onClick={() => methods.reset()}>
                Descartar alterações
              </Button>
              <Button type="submit" loading={methods.formState.isSubmitting}>
                Salvar representantes e sócios
              </Button>
            </div>
          </div>
        </Panel>
      </form>
    </FormProvider>
  );
}
