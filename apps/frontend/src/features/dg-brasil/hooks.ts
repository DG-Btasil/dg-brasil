"use client";

import { useCallback, useMemo } from "react";
import { daysSince } from "@/lib/clock";
import { repositories } from "@/repositories";
import type { SkillChangeProposal } from "@/store/types";
import { useAppStore } from "@/store/app-store";
import { useToast } from "@/store/ui-store";
import type { Agent, AgentTask, ChangeHistoryEntry, ID, LegalThesis, Skill } from "@/types";

/* ------------------------------------------------------------------ */
/* Leitura                                                             */
/* ------------------------------------------------------------------ */

export function useAgents(): Agent[] {
  return useAppStore((s) => s.agents);
}

export function useAgent(id: ID | undefined): Agent | undefined {
  const agents = useAgents();
  return useMemo(() => agents.find((a) => a.id === id), [agents, id]);
}

export function useSkills(): Skill[] {
  return useAppStore((s) => s.skills);
}

export function useSkill(id: ID | undefined): Skill | undefined {
  const skills = useSkills();
  return useMemo(() => skills.find((s) => s.id === id), [skills, id]);
}

export function useTheses(): LegalThesis[] {
  return useAppStore((s) => s.theses);
}

export function useThesis(id: ID | undefined): LegalThesis | undefined {
  const theses = useTheses();
  return useMemo(() => theses.find((t) => t.id === id), [theses, id]);
}

/** Tarefas recentes (todas ou de um agente), mais novas primeiro. */
export function useAgentTasks(agentId?: ID): AgentTask[] {
  const tasks = useAppStore((s) => s.agentTasks);
  return useMemo(
    () => tasks.filter((t) => !agentId || t.agentId === agentId).sort((a, b) => b.at.localeCompare(a.at)),
    [tasks, agentId],
  );
}

/** Histórico de alterações, mais novas primeiro. */
export function useChangeHistory(entityId?: ID): ChangeHistoryEntry[] {
  const history = useAppStore((s) => s.changeHistory);
  return useMemo(
    () => history.filter((h) => !entityId || h.entityId === entityId).sort((a, b) => b.at.localeCompare(a.at)),
    [history, entityId],
  );
}

export function useAiUsage() {
  return useAppStore((s) => s.aiUsage);
}

/** Mapas id → entidade para exibir nomes em listas. */
export function useDgMaps() {
  const agents = useAgents();
  const skills = useSkills();
  const theses = useTheses();
  return useMemo(
    () => ({
      agents: new Map(agents.map((a) => [a.id, a])),
      skills: new Map(skills.map((s) => [s.id, s])),
      theses: new Map(theses.map((t) => [t.id, t])),
    }),
    [agents, skills, theses],
  );
}

/** Agentes que usam cada Skill / cada tese. */
export function useUsageIndex() {
  const agents = useAgents();
  return useMemo(() => {
    const bySkill = new Map<ID, Agent[]>();
    const byThesis = new Map<ID, Agent[]>();
    for (const agent of agents) {
      for (const id of agent.skillIds) bySkill.set(id, [...(bySkill.get(id) ?? []), agent]);
      for (const id of agent.thesisIds) byThesis.set(id, [...(byThesis.get(id) ?? []), agent]);
    }
    return { bySkill, byThesis };
  }, [agents]);
}

export interface DgOverview {
  activeAgents: number;
  totalAgents: number;
  activeSkills: number;
  activeTheses: number;
  changesLast30Days: number;
  monthTokens: number;
}

export function useDgOverview(): DgOverview {
  const agents = useAgents();
  const skills = useSkills();
  const theses = useTheses();
  const history = useAppStore((s) => s.changeHistory);
  const usage = useAiUsage();
  return useMemo(
    () => ({
      activeAgents: agents.filter((a) => a.status === "ACTIVE").length,
      totalAgents: agents.length,
      activeSkills: skills.filter((s) => s.status === "ACTIVE").length,
      activeTheses: theses.filter((t) => t.status === "ACTIVE").length,
      changesLast30Days: history.filter((h) => h.status === "APPLIED" && daysSince(h.at) <= 30).length,
      monthTokens: usage.inputTokens + usage.outputTokens,
    }),
    [agents, skills, theses, history, usage],
  );
}

/* ------------------------------------------------------------------ */
/* Ações (escritas via repositório + feedback)                        */
/* ------------------------------------------------------------------ */

type AgentPatch = Parameters<typeof repositories.dg.updateAgent>[1];

export function useDgActions() {
  const toast = useToast();

  const updateAgent = useCallback(
    async (id: ID, patch: AgentPatch, successTitle: string) => {
      try {
        await repositories.dg.updateAgent(id, patch);
        toast({ tone: "success", title: successTitle });
        return true;
      } catch {
        toast({ tone: "danger", title: "Não foi possível salvar a alteração." });
        return false;
      }
    },
    [toast],
  );

  /** Só é chamada após confirmação explícita do usuário. */
  const applySkillChange = useCallback(
    async (proposal: SkillChangeProposal): Promise<ID | null> => {
      try {
        const id = await repositories.dg.applySkillChange(proposal);
        toast({ tone: "success", title: "Alteração aplicada", description: "Registrada no Histórico de Alterações." });
        return id;
      } catch {
        toast({ tone: "danger", title: "Não foi possível aplicar a alteração." });
        return null;
      }
    },
    [toast],
  );

  const cancelSkillChange = useCallback(
    async (proposal: SkillChangeProposal): Promise<ID | null> => {
      try {
        const id = await repositories.dg.cancelSkillChange(proposal);
        toast({ tone: "info", title: "Proposta cancelada", description: "Nenhuma configuração foi alterada." });
        return id;
      } catch {
        toast({ tone: "danger", title: "Não foi possível registrar o cancelamento." });
        return null;
      }
    },
    [toast],
  );

  return { updateAgent, applySkillChange, cancelSkillChange };
}
