"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Bot } from "lucide-react";
import { cn } from "@/lib/cn";
import type { Tone } from "@/lib/constants/status";
import { formatDateTime, pluralize } from "@/lib/formatting";
import { callAction, type ActionResult } from "@/lib/actions/result";
import { useActionFeedback } from "@/lib/actions/use-action-feedback";
import { useServerList } from "@/lib/hooks/use-server-list";
import { ActionErrorState } from "@/components/feedback/action-error";
import { EmptyState, SkeletonRows } from "@/components/feedback/states";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { Pagination } from "@/components/ui/pagination";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/table";
import type { Page } from "@/server/core/pagination";
import { cancelAgentRunAction, listAgentRunsAction } from "@/server/domain/agents/actions";
import type { AgentRunSummaryDTO } from "@/server/domain/agents/dto";
import { AGENT_RUN_STATUSES, type AgentRunStatus } from "@/server/domain/agents/schemas";
import { useToast } from "@/store/ui-store";
import { usePermission } from "@/features/auth/hooks";
import { useDirectoryUserMap } from "@/features/directory/directory-context";
import { AGENT_RUN_PAGE_SIZE, agentRunQueryToInput, agentRunQueryToSearchParams, type AgentRunListQuery } from "../list-query";

export const AGENT_RUN_STATUS_LABEL: Record<AgentRunStatus, string> = {
  QUEUED: "Na fila",
  RUNNING: "Executando",
  WAITING_HUMAN: "Aguardando decisão humana",
  COMPLETED: "Concluída",
  FAILED: "Falhou",
  CANCELLED: "Cancelada",
};
export const AGENT_RUN_STATUS_TONE: Record<AgentRunStatus, Tone> = {
  QUEUED: "info",
  RUNNING: "navy",
  WAITING_HUMAN: "gold",
  COMPLETED: "success",
  FAILED: "danger",
  CANCELLED: "neutral",
};
const ACTIVE: AgentRunStatus[] = ["QUEUED", "RUNNING", "WAITING_HUMAN"];
const STATUS_OPTIONS = AGENT_RUN_STATUSES.map((s) => ({ value: s, label: AGENT_RUN_STATUS_LABEL[s] }));

/**
 * Execuções de agente (ADMIN e LAWYER) pela RPC paginada (031): só colunas
 * fixas — nada de pedido em texto, custo, modelo nem erro bruto (só o
 * código). LAWYER só vê as dos casos que acessa (o banco decide). ADMIN pode
 * cancelar execução ainda não encerrada. Nada é executado por esta tela.
 */
export function AgentRunsPanel({
  initialQuery,
  initialResult,
  legalCaseId,
  syncUrl = false,
  title = "Execuções de agente",
  description = "Pedidos aos agentes do DG Brasil, do mais recente ao mais antigo.",
}: {
  initialQuery: AgentRunListQuery;
  initialResult: ActionResult<Page<AgentRunSummaryDTO>>;
  legalCaseId?: string;
  syncUrl?: boolean;
  title?: string;
  description?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const failed = useActionFeedback();
  const canCancel = usePermission("dgbrasil.manage");
  const users = useDirectoryUserMap();
  const scope = legalCaseId ? { legalCaseId } : {};
  const { query, setQuery, result, pending, retry } = useServerList({
    initialQuery,
    initialResult,
    load: (q: AgentRunListQuery) => listAgentRunsAction(agentRunQueryToInput(q, scope)),
    toSearch: syncUrl ? agentRunQueryToSearchParams : undefined,
  });
  const [cancelling, setCancelling] = useState<string | null>(null);
  const page = result.ok ? result.data : undefined;

  async function cancel(id: string) {
    setCancelling(id);
    const r = await callAction(() => cancelAgentRunAction({ id }));
    setCancelling(null);
    if (!r.ok) {
      failed(r, "Não foi possível cancelar a execução.");
      return;
    }
    toast({ tone: "success", title: "Execução cancelada" });
    retry();
    router.refresh();
  }

  return (
    <Panel>
      <PanelHeader
        title={title}
        description={description}
        actions={
          <Select
            aria-label="Situação da execução"
            placeholder="Todas as situações"
            options={STATUS_OPTIONS}
            value={query.status}
            onChange={(e) => setQuery({ status: e.target.value as AgentRunListQuery["status"], page: 1 })}
            className="h-8 w-[220px] text-[12.5px]"
          />
        }
      />
      <div aria-busy={pending || undefined} className={cn("transition-opacity", pending && "opacity-60")}>
        {!result.ok ? (
          <ActionErrorState error={result} onRetry={retry} title="Não foi possível carregar as execuções." />
        ) : !page ? (
          <SkeletonRows rows={4} />
        ) : page.items.length === 0 ? (
          <EmptyState compact icon={Bot} title={query.status ? "Nenhuma execução nesta situação." : "Nenhuma execução registrada."} />
        ) : (
          <>
            <p className="border-b border-line px-5 py-2 text-[12px] text-muted" aria-live="polite">
              {pluralize(page.total, "execução", "execuções")}
            </p>
            <Table caption={title}>
              <THead>
                <tr>
                  <Th>Agente</Th>
                  {!legalCaseId && <Th>Caso</Th>}
                  <Th>Pedida por</Th>
                  <Th>Pedida em</Th>
                  <Th>Concluída em</Th>
                  <Th className="text-right">Propostas</Th>
                  <Th>Situação</Th>
                  {canCancel && (
                    <Th>
                      <span className="sr-only">Ações</span>
                    </Th>
                  )}
                </tr>
              </THead>
              <TBody>
                {page.items.map((r) => (
                  <Tr key={r.id}>
                    <Td>
                      <span className="block font-medium text-foreground">{r.agentName}</span>
                      <span className="block text-[12px] text-muted">
                        {r.operation}
                        {r.attempt > 1 ? ` · tentativa ${r.attempt}` : ""}
                      </span>
                    </Td>
                    {!legalCaseId && (
                      <Td className="text-[12.5px]">
                        {r.legalCaseId ? (
                          <Link href={`/casos/${r.legalCaseId}?aba=analise`} className="text-navy hover:underline underline-offset-2">
                            Abrir caso
                          </Link>
                        ) : (
                          <span className="text-subtle">Sem caso</span>
                        )}
                      </Td>
                    )}
                    <Td className="text-[12.5px]">{(r.requestedById && users.get(r.requestedById)?.name) || "—"}</Td>
                    <Td className="tabular text-[12px] text-muted">{formatDateTime(r.createdAt)}</Td>
                    <Td className="tabular text-[12px] text-muted">{r.completedAt ? formatDateTime(r.completedAt) : "—"}</Td>
                    <Td className="text-right tabular">{r.proposalCount}</Td>
                    <Td>
                      <StatusBadge status={r.status} labels={AGENT_RUN_STATUS_LABEL} tones={AGENT_RUN_STATUS_TONE} />
                      {r.errorCode && <span className="mt-0.5 block font-mono text-[11px] text-danger">{r.errorCode}</span>}
                    </Td>
                    {canCancel && (
                      <Td className="text-right">
                        {ACTIVE.includes(r.status) && (
                          <Button size="sm" variant="ghost" loading={cancelling === r.id} disabled={!!cancelling} onClick={() => cancel(r.id)}>
                            Cancelar
                          </Button>
                        )}
                      </Td>
                    )}
                  </Tr>
                ))}
              </TBody>
            </Table>
            <Pagination page={page.page} pageSize={AGENT_RUN_PAGE_SIZE} total={page.total} disabled={pending} onPageChange={(p) => setQuery({ ...query, page: p })} noun={{ one: "execução", many: "execuções" }} />
          </>
        )}
      </div>
    </Panel>
  );
}
