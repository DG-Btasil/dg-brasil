"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, CircleStop, FlaskConical, Plus, Send } from "lucide-react";
import { ANALYSIS_STATUS_LABEL, ANALYSIS_STATUS_TONE } from "@/lib/constants/status";
import { formatDateTime } from "@/lib/formatting";
import { callAction, type ActionResult } from "@/lib/actions/result";
import { useActionFeedback } from "@/lib/actions/use-action-feedback";
import { useIdempotencyKey } from "@/lib/hooks/use-idempotency-key";
import { Can } from "@/components/layout/guards";
import { ActionErrorState } from "@/components/feedback/action-error";
import { Callout, EmptyState } from "@/components/feedback/states";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { DefinitionGrid, Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import type { DbAnalysisStatus } from "@/repositories/api/db-mappings";
import type { Page } from "@/server/core/pagination";
import { cancelAnalysisAction, sendAnalysisToAgentAction } from "@/server/domain/analyses/actions";
import { InterruptDialog } from "@/features/agent-runs/components/interrupt-dialog";
import type { AnalysisDetailDTO, AnalysisListItem, TemplateFieldDTO } from "@/server/domain/analyses/dto";
import { useToast } from "@/store/ui-store";
import { formatFieldValue, SENDABLE_STATUSES } from "../fields";

export const DB_ANALYSIS_STATUS_LABEL: Record<DbAnalysisStatus, string> = {
  PENDING: "Pendente",
  WAITING_DOCUMENTS: "Aguardando documentos",
  QUEUED: "Na fila do agente",
  RUNNING: "Em análise",
  WAITING_REVIEW: "Aguardando revisão humana",
  COMPLETED: "Concluída",
  FAILED: "Falhou",
  CANCELLED: "Interrompida",
};

/**
 * Aba Análise do caso (ADMIN/LAWYER): análises do servidor, a atual com
 * documentos que faltam, resultado estruturado e envio ao agente
 * (send_legal_analysis_once, 029 — execução + fila + análise numa transação).
 * Sem UI otimista: a tela muda depois da resposta.
 */
export function AnalysisPanel({
  legalCaseId,
  analyses,
  current,
  fieldDefs,
  onGoToDocuments,
}: {
  legalCaseId: string;
  analyses: ActionResult<Page<AnalysisListItem>>;
  current?: ActionResult<AnalysisDetailDTO>;
  /** Definição dos campos do template da análise atual (rótulos). */
  fieldDefs: TemplateFieldDTO[];
  onGoToDocuments: () => void;
}) {
  const newHref = `/casos/${legalCaseId}/analise/nova`;
  const cta = (
    <Can permission="analyses.start">
      <ButtonLink href={newHref} size="sm" icon={<Plus className="size-4" aria-hidden />}>
        Nova análise
      </ButtonLink>
    </Can>
  );
  if (!analyses.ok) return <ActionErrorState error={analyses} title="Não foi possível carregar as análises do caso." />;
  const items = analyses.data.items;
  if (items.length === 0) {
    return (
      <Panel>
        <EmptyState
          icon={FlaskConical}
          title="Nenhuma análise jurídica neste caso."
          description="A análise reúne documentos e dados da relação e envia o material ao agente da área. O resultado passa por revisão humana."
          action={cta}
        />
      </Panel>
    );
  }
  return (
    <div className="space-y-5">
      {current && (!current.ok ? <ActionErrorState error={current} title="Não foi possível abrir a análise." /> : <CurrentAnalysis analysis={current.data} fieldDefs={fieldDefs} onGoToDocuments={onGoToDocuments} />)}
      <Panel>
        <PanelHeader title="Análises do caso" actions={cta} />
        <Table caption="Análises do caso">
          <THead>
            <tr>
              <Th>Modelo</Th>
              <Th>Situação</Th>
              <Th>Criada em</Th>
              <Th>Concluída em</Th>
            </tr>
          </THead>
          <TBody>
            {items.map((a) => (
              <Tr key={a.id}>
                <Td className="font-medium text-foreground">{a.templateName || "—"}</Td>
                <Td className="text-[12.5px]">{DB_ANALYSIS_STATUS_LABEL[a.dbStatus]}</Td>
                <Td className="text-[12px] text-muted tabular">{formatDateTime(a.createdAt)}</Td>
                <Td className="text-[12px] text-muted tabular">{a.completedAt ? formatDateTime(a.completedAt) : "—"}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </Panel>
    </div>
  );
}

function CurrentAnalysis({ analysis, fieldDefs, onGoToDocuments }: { analysis: AnalysisDetailDTO; fieldDefs: TemplateFieldDTO[]; onGoToDocuments: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const failed = useActionFeedback();
  const idempotency = useIdempotencyKey();
  const [sending, setSending] = useState(false);
  const [interrupting, setInterrupting] = useState(false);
  const sendable = SENDABLE_STATUSES.includes(analysis.dbStatus);
  const withAgent = analysis.dbStatus === "QUEUED" || analysis.dbStatus === "RUNNING";
  const missingRequired = analysis.missingRequirements.filter((m) => m.required);
  const labels = new Map(fieldDefs.map((f) => [f.key, f]));

  async function send() {
    if (sending) return;
    const payload = { analysisId: analysis.id };
    setSending(true);
    const result = await callAction(() => sendAnalysisToAgentAction({ ...payload, idempotencyKey: idempotency.keyFor(payload) }));
    setSending(false);
    if (!result.ok) {
      failed(result, "Não foi possível enviar a análise ao agente.");
      return;
    }
    idempotency.reset();
    toast({ tone: "success", title: "Análise enviada ao agente", description: "O resultado chegará em Revisões. Nada segue sem aprovação humana." });
    router.refresh();
  }

  return (
    <Panel>
      <PanelHeader
        title={analysis.templateName || "Análise jurídica"}
        description={`Criada em ${formatDateTime(analysis.createdAt)}${analysis.startedAt ? ` · enviada em ${formatDateTime(analysis.startedAt)}` : ""}`}
        // Mesmo rótulo da tabela "Análises do caso" (QA 4.3, OBS-06); a cor segue o grupo.
        actions={<StatusBadge status={analysis.status} labels={{ ...ANALYSIS_STATUS_LABEL, [analysis.status]: DB_ANALYSIS_STATUS_LABEL[analysis.dbStatus] }} tones={ANALYSIS_STATUS_TONE} />}
      />
      <PanelBody className="space-y-4">
        {analysis.interruptionReason && (
          <Callout tone="danger" title="A execução anterior não terminou.">
            {analysis.interruptionReason}
          </Callout>
        )}
        {sendable && missingRequired.length > 0 && (
          <Callout tone="warning" title="Para enviar ao agente, ainda são necessários os seguintes documentos.">
            <ul className="mt-1.5 list-disc space-y-0.5 pl-5">
              {missingRequired.map((m) => (
                <li key={`${m.category}-${m.label}`}>{m.label}</li>
              ))}
            </ul>
            <Button variant="link" className="mt-2" onClick={onGoToDocuments}>
              Ir para Documentos <ArrowRight className="size-3.5" aria-hidden />
            </Button>
          </Callout>
        )}
        {sendable && missingRequired.length === 0 && (
          <Can permission="analyses.start">
            <Callout
              tone="info"
              title={analysis.dbStatus === "FAILED" || analysis.dbStatus === "CANCELLED" ? "Enviar de novo ao agente." : "Documentação pronta para análise."}
              action={
                <Button icon={<Send className="size-4" aria-hidden />} loading={sending} onClick={send}>
                  Enviar ao agente
                </Button>
              }
            >
              O pedido de execução e a situação da análise são gravados juntos. Nenhuma IA roda nesta tela.
            </Callout>
          </Can>
        )}
        {withAgent && analysis.cancelRequested && (
          <Callout tone="warning" title="Interrupção solicitada.">
            O agente foi avisado e vai parar. A análise muda para interrompida assim que ele confirmar.
          </Callout>
        )}
        {withAgent && !analysis.cancelRequested && (
          <Callout
            tone="info"
            title={analysis.dbStatus === "QUEUED" ? "Na fila do agente." : "Com o agente."}
            action={
              <Can permission="analyses.start">
                <Button variant="secondary" icon={<CircleStop className="size-4" aria-hidden />} onClick={() => setInterrupting(true)}>
                  Interromper análise
                </Button>
              </Can>
            }
          >
            O resultado será enviado para Revisões e só segue depois da decisão humana.
          </Callout>
        )}
        {interrupting && (
          <InterruptDialog subject="esta análise" run={() => cancelAnalysisAction({ id: analysis.id })} onDone={() => router.refresh()} onClose={() => setInterrupting(false)} />
        )}
        {analysis.result && (
          <DefinitionGrid
            columns={2}
            items={[
              { label: "Resumo", value: analysis.result.summary || undefined, wide: true },
              { label: "Recomendação", value: analysis.result.recommendation || undefined, wide: true },
              { label: "Teses identificadas", value: analysis.result.identifiedThesisIds.length ? String(analysis.result.identifiedThesisIds.length) : undefined },
            ]}
          />
        )}
        {analysis.reviewId && (
          <p className="text-[13px]">
            <Link href={`/revisoes/${analysis.reviewId}`} className="font-medium text-navy hover:underline underline-offset-2">
              Abrir a revisão humana desta análise
            </Link>
          </p>
        )}
        {Object.keys(analysis.fields).length > 0 && (
          <div className="border-t border-line pt-4">
            <DefinitionGrid
              columns={3}
              items={Object.entries(analysis.fields).map(([key, raw]) => {
                const def = labels.get(key);
                return { label: def?.label ?? key, value: def ? formatFieldValue(def, raw) : raw, wide: def?.type === "textarea" };
              })}
            />
          </div>
        )}
        {analysis.missingRequirements.some((m) => !m.required) && (
          <p className="text-[12px] text-muted">
            Recomendados ainda ausentes:{" "}
            {analysis.missingRequirements
              .filter((m) => !m.required)
              .map((m) => m.label)
              .join(", ")}
            . <Badge tone="neutral">Não bloqueiam</Badge>
          </p>
        )}
      </PanelBody>
    </Panel>
  );
}
