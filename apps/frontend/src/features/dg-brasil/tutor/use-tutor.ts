"use client";

import { useCallback } from "react";
import type { ID, Skill } from "@/types";
import { useAgents, useDgActions, useSkills } from "../hooks";
import { dgRoutes } from "../utils";
import { respond, scenarioForSkill, TUTOR_SCENARIOS } from "./scenarios";
import { useTutorControls, type TutorMessage } from "./tutor-store";

/** Orquestra a conversa do Tutor DG. Alterações só após confirmação explícita. */
export function useTutor() {
  const skills = useSkills();
  const agents = useAgents();
  const { applySkillChange, cancelSkillChange } = useDgActions();
  const { openTutor, closeTutor, addMessages, setProposalState, resetConversation } = useTutorControls();

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      addMessages([{ role: "user", text: trimmed }, respond(trimmed, skills, agents)]);
    },
    [addMessages, skills, agents],
  );

  const openWithSkill = useCallback(
    (skill: Skill) => {
      const scenario = scenarioForSkill(skill);
      openTutor(
        { skillId: skill.id, skillName: skill.name },
        {
          role: "tutor",
          text: `Você está na Skill “${skill.name}” (v${skill.version}). Descreva o comportamento que gostaria de ajustar — por exemplo, algo que o agente faz e não deveria, ou que deveria fazer de outro jeito.`,
          suggestions: scenario ? [scenario.prompt] : TUTOR_SCENARIOS.map((s) => s.prompt),
        },
      );
    },
    [openTutor],
  );

  const apply = useCallback(
    async (message: TutorMessage) => {
      if (!message.proposal) return false;
      const { proposal, skillName } = message.proposal;
      const before = skills.find((s) => s.id === proposal.skillId)?.version ?? 1;
      const historyId = await applySkillChange(proposal);
      if (!historyId) return false;
      setProposalState(message.id, "applied");
      addMessages([
        {
          role: "tutor",
          text: `Alteração aplicada. A Skill “${skillName}” passou da v${before} para a v${before + 1} e o registro foi incluído no Histórico de Alterações.`,
          links: [
            { label: "Ver no histórico", href: dgRoutes.historyEntry(historyId) },
            { label: `Abrir Skill ${skillName}`, href: dgRoutes.skill(proposal.skillId) },
          ],
        },
      ]);
      return true;
    },
    [skills, applySkillChange, setProposalState, addMessages],
  );

  const cancel = useCallback(
    async (message: TutorMessage) => {
      if (!message.proposal) return false;
      const id = await cancelSkillChange(message.proposal.proposal);
      if (!id) return false;
      setProposalState(message.id, "cancelled");
      addMessages([
        {
          role: "tutor",
          text: "Proposta cancelada. Nenhuma configuração foi alterada; o cancelamento ficou registrado no histórico.",
          links: [{ label: "Ver no histórico", href: dgRoutes.historyEntry(id) }],
        },
      ]);
      return true;
    },
    [cancelSkillChange, setProposalState, addMessages],
  );

  return { send, openWithSkill, apply, cancel, open: openTutor, close: closeTutor, reset: resetConversation };
}

/** Versão atual da Skill e se a proposta ainda corresponde ao valor vigente. */
export function useProposalStatus(message: TutorMessage): { currentVersion: number; stale: boolean } {
  const skills = useSkills();
  const p = message.proposal;
  const skill = p ? skills.find((s) => s.id === p.proposal.skillId) : undefined;
  const key: ID | undefined = p?.proposal.parameterChanges[0]?.key;
  const current = skill?.parameters.find((x) => x.key === key)?.value;
  return { currentVersion: skill?.version ?? 1, stale: !!p && p.state === "open" && current !== p.fromValue };
}
