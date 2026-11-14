"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRefresh } from "@/lib/hooks/use-refresh";
import { useState } from "react";
import { CircleStop, RotateCcw } from "lucide-react";
import { ActionErrorState } from "@/components/feedback/action-error";
import { Callout, EmptyState } from "@/components/feedback/states";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/display";
import { DefinitionGrid, Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { callAction, type ActionResult } from "@/lib/actions/result";
import { useActionFeedback } from "@/lib/actions/use-action-feedback";
import { runErrorLabel } from "@/lib/constants/ai";
import { formatDateTime, formatEventTime, formatNumber, formatUsd } from "@/lib/formatting";
import { useAutoRefresh } from "@/lib/hooks/use-auto-refresh";
import { useIdempotencyKey } from "@/lib/hooks/use-idempotency-key";
import { cancelAgentRunAction, retryAgentRunAction } from "@/server/domain/agents/actions";
import type { AgentRunCancelDTO, AgentRunDetailDTO } from "@/server/domain/agents/dto";
import { VerifyNowButton } from "@/features/dg-brasil/components/verify-now";
import { usePermission } from "@/features/auth/hooks";
import { useToast } from "@/store/ui-store";
import { canInterrupt, queuedRunNotice, withCancelAnswer, type OfficeRunState } from "../interrupt";
import { agentRunEventKindLabel, agentRunProviderLabel } from "../labels";
import { AGENT_RUN_STATUS_LABEL, AGENT_RUN_STATUS_TONE } from "./agent-runs-panel";
import { InterruptDialog } from "./interrupt-dialog";

const PROPOSAL_LABEL: Record<string, string> = {
  CREATE_DEADLINE: "Criar prazo",
  REQUEST_DOCUMENT: "Pedir documento",
  UPDATE_CASE: "Atualizar caso",
  CREATE_PROCESS: "Cadastrar processo",
  UPDATE_SKILL: "Alterar skill",
  UPDATE_AGENT: "Alterar agente",
  OTHER: "Providência",
};
const DECISION_LABEL: Record<string, string> = {
  PENDING: "Aguardando revisão",
  REOPENED: "Revisão reaberta",
  APPROVED: "Aprovado",
  REJECTED: "Rejeitado",
  CHANGES_REQUESTED: "Alterações pedidas",
  APPLIED: "Aplicado",
  FAILED: "Falhou ao aplicar",
};

/**
 * Detalhe de uma execução: situação, andamento no computador do escritório,
 * o que o agente entregou (cada item com a sua revisão humana), a linha do
 * tempo e as tentativas ligadas. Erro em linguagem de usuário (nunca o erro
 * bruto). Dados técnicos só para ADMIN. Enquanto na fila ou rodando, a tela
 * se atualiza sozinha.
 */
export function RunDetail({ result, office }: { result: ActionResult<AgentRunDetailDTO>; office?: OfficeRunState }) {
  if (!result.ok) return <ActionErrorState error={result} title="Não foi possível abrir a execução." />;
  return <Detail serverRun={result.data} office={office} />;
}

function Detail({ serverRun, office }: { serverRun: AgentRunDetailDTO; office?: OfficeRunState }) {
  const router = useRouter();
  const refresh = useRefresh();
  // Resposta do "Interromper": vale até os dados novos do servidor chegarem.
  const [answer, setAnswer] = useState<{ for: AgentRunDetailDTO; value: AgentRunCancelDTO } | null>(null);
  const run = withCancelAnswer(serverRun, answer?.for === serverRun ? answer.value : null);
  const toast = useToast();
  const failed = useActionFeedback();
  const idempotency = useIdempotencyKey();
  const isAdmin = usePermission("dgbrasil.manage");
  const [interrupting, setInterrupting] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const active = run.status === "QUEUED" || run.status === "RUNNING";
  useAutoRefresh(active, 5_000);
  // Na fila por causa do escritório (interruptor desligado ou nenhum computador conectado).
  const queued = run.status === "QUEUED" ? queuedRunNotice(office) : null;

  const error = runErrorLabel(run.errorCode);
  const canRetry = (run.status === "FAILED" || run.status === "CANCELLED") && !run.analysisId && run.retriedByIds.length === 0;
  const nothingDelivered = !run.proposals.length && !run.documents.length && !run.analysisResult;

  async function retry() {
    if (retrying) return;
    const payload = { id: run.id };
    setRetrying(true);
    const r = await callAction(() => retryAgentRunAction({ ...payload, key: idempotency.keyFor(payload) }));
    setRetrying(false);
    if (!r.ok) {
      failed(r, "Não foi possível pedir uma nova tentativa.");
      return;
    }
    idempotency.reset();
    toast({ tone: "success", title: "Nova tentativa pedida", description: "A execução nova entra na fila; a anterior fica no histórico." });
    router.push(`/execucoes/${r.data.runId}`);
  }

  return (
    <>
      <PageHeader
        breadcrumbs={[
          ...(run.legalCaseId ? [{ label: "Caso", href: `/casos/${run.legalCaseId}?aba=analise` }] : isAdmin ? [{ label: "DG Brasil", href: "/dg-brasil/execucoes" }] : []),
          { label: "Execução" },
        ]}
        title={`Execução · ${run.agent.name}`}
        description={`Pedida em ${formatDateTime(run.createdAt)}${run.attempt > 1 ? ` · tentativa automática ${run.attempt}` : ""}`}
        meta={<StatusBadge status={run.status} labels={AGENT_RUN_STATUS_LABEL} tones={AGENT_RUN_STATUS_TONE} />}
        actions={
          <div className="flex gap-2">
            {canInterrupt({ status: run.status, cancelRequested: run.cancelRequested }, isAdmin) && (
              <Button variant="secondary" icon={<CircleStop className="size-4" aria-hidden />} onClick={() => setInterrupting(true)}>
                Interromper
              </Button>
            )}
            {canRetry && (
              <Button icon={<RotateCcw className="size-4" aria-hidden />} loading={retrying} onClick={retry}>
                Tentar novamente
              </Button>
            )}
          </div>
        }
      />

      <div className="space-y-5">
        {active && (
          <Callout
            tone={run.status === "QUEUED" && !run.cancelRequested && queued ? queued.tone : "info"}
            title={
              run.cancelRequested
                ? "Interrupção solicitada."
                : run.status === "QUEUED"
                  ? (queued?.title ?? "Na fila do escritório.")
                  : `Em andamento${run.executorName ? ` no ${run.executorName}` : ""}.`
            }
          >
            {run.cancelRequested
              ? "O computador do escritório foi avisado e vai parar sem entregar nada novo."
              : run.status === "QUEUED"
                ? queued
                  ? queued.message
                  : "O computador do escritório está conectado e pega o trabalho na próxima passada pela fila. Esta tela se atualiza sozinha."
                : `${run.progress?.message ? `${run.progress.message}. ` : ""}Esta tela se atualiza sozinha. O que o agente entregar vai para Revisões e só vale depois da decisão humana.`}
            {run.status === "QUEUED" && !run.cancelRequested && office?.executionEnabled && <VerifyNowButton executionEnabled className="mt-3" />}
          </Callout>
        )}
        {error && run.status !== "CANCELLED" && (
          <Callout tone={run.status === "QUEUED" ? "warning" : "danger"} title={run.status === "QUEUED" ? "A tentativa anterior não terminou." : "A execução não terminou."}>
            {error}
            {run.status === "QUEUED"
              ? " O trabalho já voltou sozinho para a fila e será retomado quando o computador do escritório processar a fila."
              : run.analysisId && " Para tentar novamente, envie a análise pela tela do caso."}
          </Callout>
        )}
        {run.status === "CANCELLED" && <Callout tone="neutral" title="Execução interrompida.">Nada novo foi entregue depois do pedido de interrupção.</Callout>}

        <Panel>
          <PanelHeader title="O que o agente entregou" description="Cada item passa por revisão humana. Nada é aplicado sem aprovação." />
          <PanelBody className="space-y-4">
            {nothingDelivered ? (
              <EmptyState compact title={active ? "Ainda nada entregue." : "Nenhuma entrega nesta execução."} />
            ) : (
              <>
                {run.analysisResult && (
                  <Item
                    title="Resultado da análise"
                    detail={run.analysisResult.summary}
                    status={run.analysisResult.reviewStatus}
                    href={run.analysisResult.reviewId ? `/revisoes/${run.analysisResult.reviewId}` : undefined}
                  />
                )}
                {run.documents.map((d) => (
                  <Item key={d.versionId} title={`Minuta: ${d.title} (v${d.versionNumber})`} status={d.reviewStatus} href={d.reviewId ? `/revisoes/${d.reviewId}` : undefined} />
                ))}
                {run.proposals.map((p) => (
                  <Item
                    key={p.id}
                    title={`Proposta: ${PROPOSAL_LABEL[p.type] ?? PROPOSAL_LABEL.OTHER}`}
                    detail={p.summary}
                    status={p.status}
                    note={p.applicationError}
                    href={p.reviewId ? `/revisoes/${p.reviewId}` : undefined}
                  />
                ))}
              </>
            )}
          </PanelBody>
        </Panel>

        {run.events.length > 0 && <Timeline events={run.events} />}

        {(run.retryOfId || run.retriedByIds.length > 0) && (
          <Panel>
            <PanelHeader title="Tentativas" />
            <PanelBody className="space-y-1.5 text-[13px]">
              {run.retryOfId && (
                <p>
                  Esta é uma nova tentativa de{" "}
                  <Link href={`/execucoes/${run.retryOfId}`} className="font-medium text-navy hover:underline underline-offset-2">
                    uma execução anterior
                  </Link>
                  .
                </p>
              )}
              {run.retriedByIds.map((id) => (
                <p key={id}>
                  Tentada novamente em{" "}
                  <Link href={`/execucoes/${id}`} className="font-medium text-navy hover:underline underline-offset-2">
                    outra execução
                  </Link>
                  .
                </p>
              ))}
            </PanelBody>
          </Panel>
        )}

        {isAdmin && run.usage && (
          <Panel>
            <PanelHeader title="Dados técnicos (administrador)" description="Execuções pelo computador do escritório no modo assistido não medem tokens nem custo." />
            <PanelBody className="space-y-4">
              <DefinitionGrid
                columns={4}
                items={[
                  { label: "Executado por", value: `${agentRunProviderLabel(run.usage.provider)}${run.usage.provider === "CLAUDE_CODE" && run.executorName ? ` · ${run.executorName}` : ""}` },
                  { label: "Modelo", value: run.usage.model },
                  { label: "Tokens (entrada / saída)", value: run.usage.inputTokens !== undefined ? `${formatNumber(run.usage.inputTokens)} / ${formatNumber(run.usage.outputTokens ?? 0)}` : undefined },
                  { label: "Custo estimado", value: run.usage.estimatedCost !== undefined ? formatUsd(run.usage.estimatedCost, 4) : undefined },
                  { label: "Ferramentas usadas", value: run.usage.toolsUsed ? Object.entries(run.usage.toolsUsed).map(([k, v]) => `${k} ×${v}`).join(", ") : undefined, wide: true },
                  { label: "Mensagem técnica (sanitizada)", value: run.usage.errorMessage, wide: true },
                  {
                    label: "Relatório do computador",
                    value: run.usage.executorReport ? Object.entries(run.usage.executorReport).map(([k, v]) => `${k}: ${String(v)}`).join(" · ") : undefined,
                    wide: true,
                  },
                ]}
              />
              {run.config && Object.keys(run.config).length > 0 && (
                <details className="text-[12.5px]">
                  <summary className="cursor-pointer font-medium text-navy">Configuração usada nesta execução</summary>
                  <pre className="mt-2 overflow-x-auto rounded-md border border-line bg-surface-2 p-3 font-mono text-[11.5px] text-muted">{JSON.stringify(run.config, null, 2)}</pre>
                </details>
              )}
            </PanelBody>
          </Panel>
        )}
      </div>

      {interrupting && (
        <InterruptDialog
          subject="esta execução"
          run={() => cancelAgentRunAction({ id: run.id })}
          onDone={(value) => {
            setAnswer({ for: serverRun, value });
            refresh();
          }}
          onClose={() => setInterrupting(false)}
        />
      )}
    </>
  );
}

function Item({ title, detail, status, href, note }: { title: string; detail?: string; status?: string; href?: string; note?: string }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-md border border-line px-4 py-3">
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-foreground">{title}</p>
        {detail && <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap text-[12.5px] text-muted">{detail}</p>}
        {note && <p className="mt-0.5 text-[12px] text-danger">{note}</p>}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        {status && <Badge tone={status === "APPROVED" || status === "APPLIED" ? "success" : status === "REJECTED" || status === "FAILED" ? "danger" : "gold"}>{DECISION_LABEL[status] ?? "Situação não reconhecida"}</Badge>}
        {href && (
          <Link href={href} className="text-[12px] font-medium text-navy hover:underline underline-offset-2">
            Abrir revisão
          </Link>
        )}
      </div>
    </div>
  );
}

const EVENT_STATUS_LABEL: Record<string, string> = {
  QUEUED: "Na fila", RUNNING: "Em andamento", WAITING_HUMAN: "Aguardando decisão humana", COMPLETED: "Concluída", FAILED: "Falhou", CANCELLED: "Interrompida",
};

/** Linha do tempo (agent_run_events, 040): situação, reserva, documentos abertos (com a versão), entregas. */
function Timeline({ events }: { events: AgentRunDetailDTO["events"] }) {
  const text = (e: AgentRunDetailDTO["events"][number]) => {
    if (e.kind === "STATUS") return `${EVENT_STATUS_LABEL[e.to ?? ""] ?? agentRunEventKindLabel("STATUS")}${e.message ? ` · ${runErrorLabel(e.message) ?? e.message}` : ""}`;
    if (e.kind === "DOCUMENT_OPENED") return `Documento aberto: ${e.message ?? "documento do caso"}`;
    return e.message ?? agentRunEventKindLabel(e.kind);
  };
  return (
    <Panel>
      <PanelHeader title="Linha do tempo" description="O que aconteceu nesta execução, inclusive quais versões de documento foram processadas." />
      <PanelBody>
        <ol className="space-y-1.5 text-[12.5px]">
          {events.map((e, i) => (
            <li key={`${e.at}-${i}`} className="flex gap-3">
              <span className="w-28 shrink-0 tabular text-subtle">{formatEventTime(e.at)}</span>
              <span className={e.kind === "STATUS" ? "font-medium text-foreground" : "text-muted"}>{text(e)}</span>
            </li>
          ))}
        </ol>
      </PanelBody>
    </Panel>
  );
}
