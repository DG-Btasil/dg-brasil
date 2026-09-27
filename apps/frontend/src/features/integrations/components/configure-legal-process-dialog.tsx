"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, MaskedInput } from "@/components/ui/form";
import { Callout } from "@/components/feedback/states";

/**
 * Configuração do provedor de acompanhamento processual. O fornecedor
 * ainda não foi definido: a conexão é simulada e a credencial real ficará
 * no backend, nunca no navegador.
 */
export function ConfigureLegalProcessDialog({
  open,
  onOpenChange,
  currentOab,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentOab?: string;
  onSave: () => Promise<void>;
}) {
  const [oab, setOab] = useState(currentOab ?? "");
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);
  const invalid = oab.trim().length < 4;

  async function save() {
    setTouched(true);
    if (invalid) return;
    setSaving(true);
    await onSave();
    setSaving(false);
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Configurar acompanhamento processual"
      description="Consulta periódica de processos e movimentações a partir da OAB do escritório."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button loading={saving} onClick={save}>
            Salvar configuração (simulada)
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Callout tone="info" title="Fornecedor ainda não definido">
          O DG Brasil está avaliando a plataforma de acompanhamento processual. Até a escolha, esta configuração é simulada e nenhuma consulta externa
          é feita. Quando o fornecedor for definido, as credenciais serão armazenadas criptografadas no backend seguro — nunca no navegador.
        </Callout>
        <Field label="OAB associada" requirement="required" hint="Ex.: OAB/SP 000.101" error={touched && invalid ? "Informe a OAB que será monitorada." : undefined}>
          {(p) => <MaskedInput {...p} mask="oab" value={oab} onChange={(e) => setOab(e.target.value)} onBlur={() => setTouched(true)} />}
        </Field>
        <p className="text-[12px] text-muted">
          Processos encontrados entram com origem “Integração” e movimentações novas geram notificações. Frequência prevista: a cada 6 horas.
        </p>
      </div>
    </Dialog>
  );
}
