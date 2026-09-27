"use client";

import { useMemo } from "react";
import { StatusBadge } from "@/components/ui/badge";
import { LEGAL_AREA_LABEL } from "@/lib/constants/legal";
import { SKILL_STATUS_LABEL, SKILL_STATUS_TONE, THESIS_STATUS_LABEL, THESIS_STATUS_TONE } from "@/lib/constants/status";
import type { Agent, ID } from "@/types";
import { useDgActions, useSkills, useTheses } from "../../hooks";
import { dgRoutes, formatVersion } from "../../utils";
import { LinkedItems, type LinkedItem } from "./linked-items";

export function AgentSkillsTab({ agent }: { agent: Agent }) {
  const skills = useSkills();
  const { updateAgent } = useDgActions();

  const { items, available } = useMemo(() => {
    const linked: LinkedItem[] = [];
    for (const id of agent.skillIds) {
      const s = skills.find((sk) => sk.id === id);
      if (!s) continue;
      linked.push({
        id: s.id,
        name: s.name,
        href: dgRoutes.skill(s.id),
        description: s.purpose,
        meta: (
          <>
            <span className="tabular">{formatVersion(s.version)}</span>
            <StatusBadge status={s.status} labels={SKILL_STATUS_LABEL} tones={SKILL_STATUS_TONE} />
          </>
        ),
      });
    }
    const options = skills.filter((s) => !agent.skillIds.includes(s.id)).map((s) => ({ value: s.id, label: s.name }));
    return { items: linked, available: options };
  }, [agent.skillIds, skills]);

  const nameOf = (id: ID) => skills.find((s) => s.id === id)?.name ?? "Skill";

  return (
    <LinkedItems
      title="Skills do agente"
      description="Capacidades que o agente usa para executar suas tarefas."
      emptyTitle="Nenhuma Skill vinculada a este agente."
      addLabel="Selecione uma Skill para vincular"
      items={items}
      available={available}
      onAdd={(id) => updateAgent(agent.id, { skillIds: [...agent.skillIds, id] }, `Skill “${nameOf(id)}” vinculada`)}
      onRemove={(id) => updateAgent(agent.id, { skillIds: agent.skillIds.filter((x) => x !== id) }, `Skill “${nameOf(id)}” removida`)}
    />
  );
}

export function AgentThesesTab({ agent }: { agent: Agent }) {
  const theses = useTheses();
  const { updateAgent } = useDgActions();

  const { items, available } = useMemo(() => {
    const linked: LinkedItem[] = [];
    for (const id of agent.thesisIds) {
      const t = theses.find((th) => th.id === id);
      if (!t) continue;
      linked.push({
        id: t.id,
        name: t.name,
        href: dgRoutes.thesis(t.id),
        description: LEGAL_AREA_LABEL[t.area],
        meta: (
          <>
            <span className="tabular">{formatVersion(t.version)}</span>
            <StatusBadge status={t.status} labels={THESIS_STATUS_LABEL} tones={THESIS_STATUS_TONE} />
          </>
        ),
      });
    }
    const options = theses.filter((t) => !agent.thesisIds.includes(t.id)).map((t) => ({ value: t.id, label: t.name }));
    return { items: linked, available: options };
  }, [agent.thesisIds, theses]);

  const nameOf = (id: ID) => theses.find((t) => t.id === id)?.name ?? "Tese";

  return (
    <LinkedItems
      title="Teses acessíveis"
      description="Conhecimento jurídico do escritório que o agente pode consultar."
      emptyTitle="Nenhuma tese vinculada a este agente."
      addLabel="Selecione uma tese para vincular"
      items={items}
      available={available}
      onAdd={(id) => updateAgent(agent.id, { thesisIds: [...agent.thesisIds, id] }, `Tese “${nameOf(id)}” vinculada`)}
      onRemove={(id) => updateAgent(agent.id, { thesisIds: agent.thesisIds.filter((x) => x !== id) }, `Tese “${nameOf(id)}” removida`)}
    />
  );
}
