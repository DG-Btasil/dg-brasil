"use client";

import { useMemo } from "react";
import type { AgentTaskStatus } from "@/lib/constants/status";
import type { Permission } from "@/lib/permissions";
import { useCan } from "@/features/auth/hooks";
import { useScopedStore } from "@/store/scope";
import { AUDIT_ACTION_LABEL, type AgentTask, type AuditAction } from "@/types";

/* ------------------------------------------------------------------ */
/* Atividade do DG Brasil                                              */
/* ------------------------------------------------------------------ */

const TASK_SENTENCE: Record<AgentTaskStatus, string> = {
  COMPLETED: "concluiu uma tarefa.",
  RUNNING: "está executando uma tarefa.",
  WAITING_REVIEW: "enviou um material para Revisões.",
  BLOCKED: "precisa de intervenção humana.",
  FAILED: "não conseguiu concluir uma tarefa.",
};

export interface AgentActivityRow {
  task: AgentTask;
  sentence: string;
}

export function useAgentActivity(limit = 7): AgentActivityRow[] {
  const tasks = useScopedStore((s) => s.agentTasks);
  const agents = useScopedStore((s) => s.agents);
  return useMemo(() => {
    const names = new Map(agents.map((a) => [a.id, a.name]));
    return [...tasks]
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, limit)
      .map((task) => ({ task, sentence: `${names.get(task.agentId) ?? "Agente"} ${TASK_SENTENCE[task.status]}` }));
  }, [tasks, agents, limit]);
}

/* ------------------------------------------------------------------ */
/* Novidades do escritório                                             */
/* ------------------------------------------------------------------ */

/** Permissão exigida para ver cada família de ação da auditoria. */
function auditPermission(action: AuditAction): Permission | null {
  if (action.startsWith("FEE_MODEL_") || action.startsWith("AGREEMENT_") || action.startsWith("PAYMENT_")) return "finance.view";
  if (action.startsWith("SKILL_") || action.startsWith("AGENT_")) return "dgbrasil.view";
  if (action.startsWith("REVIEW_")) return "reviews.view";
  if (action === "INTEGRATION_UPDATED") return "settings.integrations.view";
  if (action.startsWith("USER_")) return "settings.team.manage";
  return null;
}

export type FeedSource = "AUDIT" | "PROCESS";

export interface FeedEntry {
  id: string;
  at: string;
  source: FeedSource;
  title: string;
  description: string;
  actorName: string;
  href?: string;
}

export function useOfficeFeed(limit = 10): FeedEntry[] {
  const auditEvents = useScopedStore((s) => s.auditEvents);
  const processEvents = useScopedStore((s) => s.processEvents);
  const processes = useScopedStore((s) => s.processes);
  const can = useCan();
  return useMemo(() => {
    const processTitle = new Map(processes.map((p) => [p.id, p.title]));
    const fromAudit: FeedEntry[] = auditEvents
      .filter((e) => {
        const perm = auditPermission(e.action);
        return perm === null || can(perm);
      })
      .map((e) => ({
        id: `aud-${e.id}`,
        at: e.at,
        source: "AUDIT",
        title: AUDIT_ACTION_LABEL[e.action],
        description: e.description,
        actorName: e.actor.name,
      }));
    const fromProcesses: FeedEntry[] = can("processes.view")
      ? processEvents
          .filter((e) => e.important)
          .map((e) => ({
            id: `mov-${e.id}`,
            at: e.at,
            source: "PROCESS",
            title: e.title,
            description: processTitle.get(e.processId) ?? "Processo",
            actorName: "",
            href: `/processos/${e.processId}?aba=movimentacoes`,
          }))
      : [];
    return [...fromAudit, ...fromProcesses].sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
  }, [auditEvents, processEvents, processes, can, limit]);
}
