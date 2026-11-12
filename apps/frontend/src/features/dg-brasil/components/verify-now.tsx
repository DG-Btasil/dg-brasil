"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { callAction } from "@/lib/actions/result";
import { useActionFeedback } from "@/lib/actions/use-action-feedback";
import { usePermission } from "@/features/auth/hooks";
import { getExecutorWakeAction, requestExecutorWakeAction } from "@/server/domain/dg/actions";
import type { ExecutorWakeDTO } from "@/server/domain/dg/dto";
import { describeWake, wakePollMs, type WakeTone } from "../wake";

const TONE_CLASS: Record<WakeTone, string> = {
  info: "text-muted",
  success: "text-success",
  warning: "text-warning",
  neutral: "text-muted",
};

/**
 * "Verificar agora" (052). Pede à sessão Vigia do computador do escritório que
 * processe a fila na hora, sem esperar os 30 minutos. Só ADMIN e LAWYER veem o
 * botão (o banco também confere). Depois do clique, a tela pergunta a cada
 * poucos segundos se a Vigia atendeu.
 */
export function VerifyNowButton({ executionEnabled, className }: { executionEnabled: boolean; className?: string }) {
  const canRequest = usePermission("office.wake");
  const failed = useActionFeedback();
  const [wake, setWake] = useState<ExecutorWakeDTO | null>(null);
  const [sending, setSending] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [tick, setTick] = useState(0);

  // Lê a situação ao abrir e a cada "tick" (enquanto o pedido estiver pendente).
  useEffect(() => {
    if (!canRequest) return;
    let alive = true;
    callAction(() => getExecutorWakeAction()).then((r) => {
      if (!alive) return;
      if (r.ok) setWake(r.data);
      setNow(Date.now());
    });
    return () => {
      alive = false;
    };
  }, [canRequest, tick]);

  const view = describeWake(wake?.last, now);
  const waiting = view?.waiting === true;
  const delay = wakePollMs(wake?.last, now);
  useEffect(() => {
    if (!waiting) return;
    const t = setTimeout(() => setTick((n) => n + 1), delay);
    return () => clearTimeout(t);
  }, [waiting, delay, now]);

  if (!canRequest) return null;

  async function request() {
    if (sending) return;
    setSending(true);
    const r = await callAction(() => requestExecutorWakeAction());
    setSending(false);
    if (!r.ok) {
      failed(r, "Não foi possível pedir a verificação.");
      return;
    }
    setWake(r.data);
    setNow(Date.now());
  }

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          icon={<RefreshCw className="size-4" aria-hidden />}
          loading={sending}
          disabled={!executionEnabled || view?.pending === true}
          onClick={() => void request()}
        >
          Verificar agora
        </Button>
        {view ? (
          <p role="status" aria-live="polite" className={`text-[12.5px] ${TONE_CLASS[view.tone]}`}>
            {view.text}
          </p>
        ) : (
          <p className="text-[12.5px] text-muted">
            {executionEnabled
              ? "A Vigia processa a fila a cada 30 minutos. Para não esperar, peça a verificação agora."
              : "A execução está desligada: ligue para poder pedir a verificação."}
          </p>
        )}
      </div>
    </div>
  );
}
