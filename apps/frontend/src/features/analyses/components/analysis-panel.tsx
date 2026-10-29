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
import { useAutoRefresh } from "@/lib/hooks/use-auto-refresh";
import { formatFieldValue, SENDABLE_STATUSES } from "../fields";
import { AnalysisResultView } from "./analysis-result-view";

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
  office,
}: {
  legalCaseId: string;
  analyses: ActionResult<Page<AnalysisListItem>>;
  current?: ActionResult<AnalysisDetailDTO>;
  /** Definição dos campos do template da análise atual (rótulos). */
  fieldDefs: TemplateFieldDTO[];
  onGoToDocuments: () => void;
  /** Interruptor geral da IA (039). false = execuções ficam na fila. */
  /** Execução pelo escritório: interruptor e computador conectado (040). */
  office?: { enabled: boolean; online: boolean };
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
      {current && (!current.ok ? <ActionErrorState error={current} title="Não foi possível abrir a análise." /> : <CurrentAnalysis analysis={current.data} fieldDefs={fieldDefs} onGoToDocuments={onGoToDocuments} office={office} />)}
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

/** Texto fixo do banco (039) quando a análise volta da revisão humana. */
const BACK_FROM_REVIEW = /rejeitado na revisão|Alterações pedidas na revisão/;

function CurrentAnalysis({ analysis, fieldDefs, onGoToDocuments, office }: { analysis: AnalysisDetailDTO; fieldDefs: TemplateFieldDTO[]; onGoToDocuments: () => void; office?: { enabled: boolean; online: boolean } }) {
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
  const backFromReview = !!analysis.interruptionReason && BACK_FROM_REVIEW.test(analysis.interruptionReason);
  // Enquanto o agente trabalha, a tela se atualiza sozinha (para quando terminar).
  useAutoRefresh(withAgent);

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
        {office?.enabled === false && (withAgent || sendable) && (
          <Callout tone="warning" title="A execução pelo escritório está desligada pelo administrador.">
            Pedidos ficam na fila e só começam quando for religada em Configurações → Computador do escritório.
          </Callout>
        )}
        {office?.enabled && !office.online && withAgent && (
          <Callout tone="info" title="Nenhum computador do escritório conectado agora.">
            A análise fica na fila até alguém no escritório abrir o Claude Code e processar os trabalhos do DG Brasil.
          </Callout>
        )}
        {analysis.interruptionReason && (
          <Callout tone={backFromReview ? "warning" : "danger"} title={backFromReview ? "O resultado voltou da revisão humana." : "A execução anterior não terminou."}>
            {analysis.interruptionReason}
            {analysis.agentRunId && (
              <Link href={`/execucoes/${analysis.agentRunId}`} className="ml-1.5 font-medium underline underline-offset-2">
                Ver a execução
              </Link>
            )}
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
        {analysis.result && <AnalysisResultView result={analysis.result} reviewStatus={analysis.reviewStatus} />}
        {analysis.reviewId && (
          <p className="text-[13px]">
            <Link href={`/revisoes/${analysis.reviewId}`} className="font-medium text-navy hover:underline underline-offset-2">
              Abrir a revisão humana desta análise
            </Link>
            {analysis.agentRunId && (
              <>
                {" · "}
                <Link href={`/execucoes/${analysis.agentRunId}`} className="text-navy hover:underline underline-offset-2">
                  Ver a execução do agente
                </Link>
              </>
            )}
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
