"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { Callout } from "@/components/feedback/states";
import { AsyncPicker, type PickerOption } from "@/components/ui/async-picker";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/form";
import { callAction } from "@/lib/actions/result";
import { useActionFeedback } from "@/lib/actions/use-action-feedback";
import { useIdempotencyKey } from "@/lib/hooks/use-idempotency-key";
import { requestAgentRunAction } from "@/server/domain/agents/actions";
import { listCasesAction } from "@/server/domain/cases/actions";
import type { AgentDetailDTO } from "@/server/domain/dg/dto";
import { useToast } from "@/store/ui-store";

/**
 * Pedir uma execução avulsa deste agente num caso (fora de análise). Só
 * enfileira (request_agent_run_once: valida papel e caso no banco, idempotente);
 * o computador do escritório executa quando processar a fila (com a execução
 * ligada). Tudo o que o agente entregar vai para Revisões.
 */
export function RunAgentDialog({ agent, onClose }: { agent: AgentDetailDTO; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const failed = useActionFeedback();
  const idempotency = useIdempotencyKey();
  const [legalCase, setLegalCase] = useState<PickerOption | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  const searchCases = useCallback(async (q: string): Promise<{ ok: true; options: PickerOption[] } | { ok: false; message: string }> => {
    const r = await callAction(() => listCasesAction({ q: q.trim() || undefined, pageSize: 10 }));
    if (!r.ok) return { ok: false, message: r.error.message };
    return { ok: true, options: r.data.items.map((c) => ({ id: c.id, label: c.title, description: c.clientName })) };
  }, []);

  async function run() {
    if (!legalCase) {
      setError("Escolha o caso.");
      return;
    }
    const payload = { agentId: agent.id, legalCaseId: legalCase.id, requestText: text.trim() || undefined, operation: "EXECUTE" };
    setSaving(true);
    const r = await callAction(() => requestAgentRunAction({ ...payload, idempotencyKey: idempotency.keyFor(payload) }));
    setSaving(false);
    if (!r.ok) {
      failed(r, "Não foi possível pedir a execução.");
      return;
    }
    idempotency.reset();
    toast({ tone: "success", title: "Execução pedida", description: "Ela entra na fila; o que o agente entregar vai para Revisões." });
    onClose();
    router.push(`/execucoes/${r.data.runId}`);
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Executar ${agent.name} em um caso`}
      description="Execução avulsa (fora de análise). Use só casos fictícios até a revisão LGPD do provedor."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={saving} onClick={run} disabled={agent.status !== "ACTIVE"}>
            Executar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {agent.status !== "ACTIVE" && <Callout tone="warning">Ative o agente antes de executar.</Callout>}
        <Field label="Caso" requirement="required" error={error}>
          {(p) => <AsyncPicker {...p} value={legalCase} onChange={(o) => { setLegalCase(o); setError(undefined); }} search={searchCases} placeholder="Buscar caso pelo título" />}
        </Field>
        <Field label="Pedido ao agente" requirement="optional" hint="O que você quer desta execução. Vai como dado (o agente não trata como regra).">
          {(p) => <Textarea {...p} rows={4} maxLength={20_000} value={text} onChange={(e) => setText(e.target.value)} />}
        </Field>
      </div>
    </Dialog>
  );
}
