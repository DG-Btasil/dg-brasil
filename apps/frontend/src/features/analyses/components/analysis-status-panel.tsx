"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { ArrowRight, FlaskConical, PauseCircle, PlayCircle, Send } from "lucide-react";
import { Callout } from "@/components/feedback/states";
import { Button, ButtonLink } from "@/components/ui/button";
import { DemoContentNotice } from "@/components/ui/display";
import { DOCUMENT_CATEGORY_LABEL } from "@/lib/constants/status";
import { usePermission } from "@/features/auth/hooks";
import { repositories } from "@/repositories";
import { useToast } from "@/store/ui-store";
import type { AnalysisTemplate, LegalAnalysis } from "@/types";
import { useAgentMap, useThesisMap } from "../hooks";
import { INTERRUPTIBLE_STATUSES } from "../utils";
import { InterruptDialog } from "./interrupt-dialog";

/** Situação atual da análise e a próxima ação possível. */
export function AnalysisStatusPanel({
  analysis,
  template,
  onGoToDocuments,
}: {
  analysis: LegalAnalysis;
  template: AnalysisTemplate | undefined;
  onGoToDocuments: () => void;
}) {
  const toast = useToast();
  const agents = useAgentMap();
  const theses = useThesisMap();
  const canStart = usePermission("analyses.start");
  const canDemo = usePermission("demo.tools");
  const canReviews = usePermission("reviews.view");
  const canDg = usePermission("dgbrasil.view");
  const [busy, setBusy] = useState(false);
  const [interrupting, setInterrupting] = useState(false);
  const agentName = (template && agents.get(template.primaryAgentId)?.name) ?? "Agente de Triagem Bancária";

  async function run(action: () => Promise<unknown>, title: string, description?: string) {
    setBusy(true);
    await action();
    setBusy(false);
    toast({ tone: "success", title, description });
  }

  const interruptAction = canStart && INTERRUPTIBLE_STATUSES.includes(analysis.status) && (
    <Button variant="ghost" size="sm" icon={<PauseCircle className="size-4" aria-hidden />} onClick={() => setInterrupting(true)}>
      Interromper análise
    </Button>
  );

  let body: ReactNode = null;
  switch (analysis.status) {
    case "WAITING_DOCUMENTS":
      body = (
        <Callout tone="warning" title="Para continuar a análise, ainda são necessários os seguintes documentos.">
          <ul className="mt-1.5 list-disc space-y-0.5 pl-5">
            {analysis.missingDocuments.map((c) => (
              <li key={c}>{DOCUMENT_CATEGORY_LABEL[c]}</li>
            ))}
          </ul>
          <Button variant="link" className="mt-2" onClick={onGoToDocuments}>
            Ir para Documentos <ArrowRight className="size-3.5" aria-hidden />
          </Button>
        </Callout>
      );
      break;
    case "READY":
      body = (
        <Callout
          tone="info"
          title="Documentação pronta para análise."
          action={
            canStart && (
              <Button
                icon={<Send className="size-4" aria-hidden />}
                loading={busy}
                onClick={() => run(() => repositories.analyses.sendToAgent(analysis.id), "Análise enviada ao agente", `${agentName} iniciou a avaliação.`)}
              >
                Enviar para o agente
              </Button>
            )
          }
        >
          O material será avaliado pelo {agentName}. O resultado segue para Revisões antes de qualquer providência.
        </Callout>
      );
      break;
    case "ANALYZING":
      body = (
        <div className="rounded-md border border-navy-100 bg-navy-50/50 px-4 py-3.5">
          <p className="text-[13px] font-semibold text-navy-800">O {agentName} está avaliando o material.</p>
          <p className="mt-0.5 text-[12.5px] text-muted">Quando concluir, o parecer preliminar será enviado para Revisões e você será notificado.</p>
          {canDemo && (
            <div className="mt-3 flex items-center gap-3 border-t border-dashed border-navy-100 pt-3">
              <Button
                variant="secondary"
                size="sm"
                icon={<FlaskConical className="size-4" aria-hidden />}
                loading={busy}
                onClick={() =>
                  run(
                    () => repositories.analyses.simulateAgentResult(analysis.id),
                    "Resultado simulado enviado para Revisões",
                    canReviews ? "Use “Abrir revisão” na aba Análise jurídica para decidir." : "Um advogado decidirá sobre o parecer.",
                  )
                }
              >
                Simular conclusão do agente (demonstração)
              </Button>
              <span className="text-[11.5px] text-muted">Ferramenta de demonstração: não há processamento real.</span>
            </div>
          )}
        </div>
      );
      break;
    case "WAITING_REVIEW":
      body = (
        <Callout
          tone="neutral"
          title="Parecer preliminar aguardando revisão humana."
          action={
            canReviews && analysis.reviewId ? (
              <ButtonLink href={`/revisoes/${analysis.reviewId}`} size="sm">
                Abrir revisão
              </ButtonLink>
            ) : undefined
          }
        >
          {canReviews ? "Nenhuma providência será tomada sem a aprovação de um advogado." : "Aguardando decisão de um advogado."}
        </Callout>
      );
      break;
    case "COMPLETED":
      body = (
        <div className="space-y-3">
          {analysis.result && (
            <dl className="grid grid-cols-[180px_minmax(0,1fr)] gap-x-6 gap-y-2.5 text-[13px]">
              <dt className="text-muted">Resumo</dt>
              <dd className="text-foreground">{analysis.result.summary}</dd>
              <dt className="text-muted">Teses identificadas</dt>
              <dd>
                <ul className="space-y-0.5">
                  {analysis.result.identifiedThesisIds.map((id) => {
                    const name = theses.get(id)?.name ?? "Tese";
                    return (
                      <li key={id}>
                        {canDg ? (
                          <Link href={`/dg-brasil/teses/${id}`} className="text-navy-700 hover:underline underline-offset-2">
                            {name}
                          </Link>
                        ) : (
                          name
                        )}
                      </li>
                    );
                  })}
                </ul>
              </dd>
              <dt className="text-muted">Recomendação</dt>
              <dd className="text-foreground">{analysis.result.recommendation}</dd>
            </dl>
          )}
          <DemoContentNotice />
          {analysis.processId && (
            <div>
              <ButtonLink href={`/processos/${analysis.processId}`} variant="secondary" size="sm">
                Abrir processo criado
              </ButtonLink>
            </div>
          )}
        </div>
      );
      break;
    case "INTERRUPTED":
      body = (
        <Callout
          tone="danger"
          title="Análise interrompida."
          action={
            canStart && (
              <Button
                variant="secondary"
                icon={<PlayCircle className="size-4" aria-hidden />}
                loading={busy}
                onClick={() => run(() => repositories.analyses.resume(analysis.id), "Análise retomada")}
              >
                Retomar análise
              </Button>
            )
          }
        >
          Motivo: {analysis.interruptionReason ?? "não informado"}.
        </Callout>
      );
      break;
    default:
      body = null;
  }

  return (
    <div className="space-y-3">
      {body}
      {interruptAction && <div className="flex justify-end">{interruptAction}</div>}
      <InterruptDialog analysisId={analysis.id} open={interrupting} onOpenChange={setInterrupting} />
    </div>
  );
}
