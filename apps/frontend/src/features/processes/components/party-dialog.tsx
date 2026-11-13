"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/form";
import { callAction } from "@/lib/actions/result";
import { useActionFeedback } from "@/lib/actions/use-action-feedback";
import { maskDocument } from "@/lib/formatting";
import { addProcessPartyAction, updateProcessPartyAction } from "@/server/domain/processes/actions";
import type { ProcessPartyDTO } from "@/server/domain/processes/dto";
import type { PartyType } from "@/server/domain/processes/schemas";
import { useToast } from "@/store/ui-store";
import { EMPTY_PARTY, PARTY_TYPE_OPTIONS, partyAddInput, partyFormErrors, partyFormFrom, partyUpdateInput, type PartyFormValues } from "../party-input";

/**
 * Cadastro e edição de uma parte do processo (autor, réu, interessado). O
 * servidor confere a permissão e o processo; a tela só recarrega depois da
 * resposta. Na edição, o documento atual aparece mascarado e só muda se a
 * pessoa digitar outro.
 */
export function PartyDialog({ processId, party, onClose }: { processId: string; party?: ProcessPartyDTO; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const failed = useActionFeedback();
  const [values, setValues] = useState<PartyFormValues>(party ? partyFormFrom(party) : EMPTY_PARTY);
  const [errors, setErrors] = useState<{ name?: string; document?: string }>({});
  const [saving, setSaving] = useState(false);
  const patch = (p: Partial<PartyFormValues>) => setValues((v) => ({ ...v, ...p }));

  async function save() {
    const found = partyFormErrors(values);
    setErrors(found);
    if (found.name || found.document) return;
    const update = party ? partyUpdateInput(party, values) : undefined;
    if (party && !update) {
      onClose();
      return;
    }
    setSaving(true);
    const result = await callAction<unknown>(() => (party ? updateProcessPartyAction(update) : addProcessPartyAction(partyAddInput(processId, values))));
    setSaving(false);
    if (!result.ok) {
      const fields = result.error.fieldErrors;
      const name = fields?.name?.[0] ?? fields?.["patch.name"]?.[0];
      const document = fields?.document?.[0] ?? fields?.["patch.document"]?.[0];
      if (name || document) setErrors({ name, document });
      else failed(result, party ? "Não foi possível atualizar a parte." : "Não foi possível adicionar a parte.");
      return;
    }
    toast({ tone: "success", title: party ? "Parte atualizada" : "Parte adicionada", description: values.name.trim() });
    router.refresh();
    onClose();
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !saving && onClose()}
      size="sm"
      title={party ? "Editar parte" : "Adicionar parte"}
      description="Partes do processo além do cliente. A alteração fica registrada na auditoria."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button loading={saving} onClick={save}>
            {party ? "Salvar" : "Adicionar parte"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Qualificação" requirement="required">
          {(a) => <Select {...a} options={PARTY_TYPE_OPTIONS} value={values.type} onChange={(e) => patch({ type: e.target.value as PartyType })} />}
        </Field>
        <Field label="Nome" requirement="required" error={errors.name}>
          {(a) => (
            <Input
              {...a}
              maxLength={300}
              value={values.name}
              onChange={(e) => {
                patch({ name: e.target.value });
                setErrors((x) => ({ ...x, name: undefined }));
              }}
            />
          )}
        </Field>
        <Field
          label="CPF ou CNPJ"
          requirement="optional"
          error={errors.document}
          hint={party?.document ? `Cadastrado: ${maskDocument(party.document)}. Preencha só para trocar.` : "Só os números, com ou sem pontuação."}
        >
          {(a) => (
            <Input
              {...a}
              inputMode="numeric"
              maxLength={18}
              className="tabular"
              value={values.document}
              onChange={(e) => {
                patch({ document: e.target.value });
                setErrors((x) => ({ ...x, document: undefined }));
              }}
            />
          )}
        </Field>
      </div>
    </Dialog>
  );
}
