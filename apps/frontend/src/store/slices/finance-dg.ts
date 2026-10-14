import { nowISO } from "@/lib/clock";
import { AGENT_AUTONOMY_LABEL, AGENT_STATUS_LABEL, INTEGRATION_STATUS_LABEL } from "@/lib/constants/status";
import { createId } from "@/lib/ids";
import { JUDICIAL_PROVIDERS } from "@/services/judicial-integration";
import type { Agent, ChangeHistoryEntry, DiffLine, LegalThesis, Skill } from "@/types";
import { actorOf, auditEvent, updateById, type GetState, type SetState } from "../helpers";
import type { AppState, DgActions, SkillChangeProposal } from "../types";

function historyEntry(state: AppState, proposal: SkillChangeProposal, status: ChangeHistoryEntry["status"]): ChangeHistoryEntry {
  const skill = state.skills.find((sk) => sk.id === proposal.skillId);
  const from = skill?.version ?? 1;
  return {
    id: createId("chg"),
    officeId: state.office.id,
    at: nowISO(),
    action: "UPDATED",
    requestedBy: actorOf(state).id,
    originalRequest: proposal.originalRequest,
    suggestedChange: proposal.suggestedChange,
    entityType: "SKILL",
    entityId: proposal.skillId,
    entityName: skill?.name ?? "Skill",
    fromVersion: from,
    toVersion: status === "APPLIED" ? from + 1 : from,
    responsible: "TUTOR_DG",
    status,
    diff: proposal.diff,
    impact: proposal.impact,
    affectedAgentIds: proposal.affectedAgentIds,
  };
}

/** Linhas "adicionadas" do diff de uma criação: rótulo: valor, só para o que foi preenchido. */
function creationDiff(fields: [string, string | string[] | undefined][]): DiffLine[] {
  return fields.flatMap(([label, value]) => {
    if (Array.isArray(value)) return value.length ? [{ type: "added" as const, text: `${label}: ${value.join("; ")}` }] : [];
    return value ? [{ type: "added" as const, text: `${label}: ${value}` }] : [];
  });
}

/** Registro de criação/alteração manual (sem Tutor DG) no Histórico de Alterações. */
function manualEntry(
  state: AppState,
  input: Pick<ChangeHistoryEntry, "entityType" | "entityId" | "entityName" | "fromVersion" | "toVersion" | "suggestedChange" | "diff" | "affectedAgentIds"> & {
    action: "CREATED" | "UPDATED";
  },
): ChangeHistoryEntry {
  return {
    id: createId("chg"),
    officeId: state.office.id,
    at: nowISO(),
    requestedBy: actorOf(state).id,
    originalRequest: input.action === "CREATED" ? "Criação manual pela interface." : "Alteração manual pela interface.",
    responsible: "USER",
    status: "APPLIED",
    ...input,
  };
}

export function createDgSlice(set: SetState, get: GetState): DgActions {
  return {
    createAgent: (input) => {
      const s = get();
      const id = createId("agt");
      const at = nowISO();
      const agent: Agent = {
        id,
        officeId: s.office.id,
        name: input.name,
        role: input.role,
        description: input.description,
        objective: input.objective,
        status: input.status,
        skillIds: input.skillIds,
        thesisIds: input.thesisIds,
        permissions: [],
        autonomy: input.autonomy,
        rules: input.rules,
        version: 1,
        // Configuração técnica padrão; ajustável depois em "Configuração avançada".
        config: { model: s.aiUsage.primaryModel, maxOutputTokens: 4096, tools: [], concurrency: 1 },
        updatedAt: at,
      };
      const skillNames = s.skills.filter((sk) => input.skillIds.includes(sk.id)).map((sk) => sk.name);
      const thesisNames = s.theses.filter((t) => input.thesisIds.includes(t.id)).map((t) => t.name);
      set({
        agents: [...s.agents, agent],
        changeHistory: [
          manualEntry(s, {
            action: "CREATED",
            entityType: "AGENT",
            entityId: id,
            entityName: input.name,
            fromVersion: 0,
            toVersion: 1,
            suggestedChange: `Agente “${input.name}” criado.`,
            diff: creationDiff([
              ["Função", input.role],
              ["Descrição", input.description],
              ["Objetivo", input.objective],
              ["Skills", skillNames],
              ["Teses permitidas", thesisNames],
              ["Regras", input.rules],
            ]),
            affectedAgentIds: [id],
          }),
          ...s.changeHistory,
        ],
        auditEvents: [auditEvent(s, "AGENT_CREATED", "agent", id, `Agente “${input.name}” criado.`), ...s.auditEvents],
      });
      return id;
    },
    updateAgent: (id, patch) =>
      set((s) => {
        const agent = s.agents.find((a) => a.id === id);
        if (!agent) return {};
        const diff: DiffLine[] = [];
        const listChange = (label: string, before: string[], after: string[] | undefined) => {
          if (!after || before.join("\n") === after.join("\n")) return;
          before.filter((v) => !after.includes(v)).forEach((v) => diff.push({ type: "removed", text: `${label}: ${v}` }));
          after.filter((v) => !before.includes(v)).forEach((v) => diff.push({ type: "added", text: `${label}: ${v}` }));
        };
        const names = (ids: string[] | undefined, list: { id: string; name: string }[]) => ids?.map((x) => list.find((i) => i.id === x)?.name ?? x);
        if (patch.status && patch.status !== agent.status) diff.push({ type: "removed", text: `Status: ${AGENT_STATUS_LABEL[agent.status]}` }, { type: "added", text: `Status: ${AGENT_STATUS_LABEL[patch.status]}` });
        if (patch.autonomy && patch.autonomy !== agent.autonomy) diff.push({ type: "removed", text: `Autonomia: ${AGENT_AUTONOMY_LABEL[agent.autonomy]}` }, { type: "added", text: `Autonomia: ${AGENT_AUTONOMY_LABEL[patch.autonomy]}` });
        if (patch.description !== undefined && patch.description !== agent.description) diff.push({ type: "removed", text: `Descrição: ${agent.description}` }, { type: "added", text: `Descrição: ${patch.description}` });
        listChange("Regra", agent.rules, patch.rules);
        listChange("Skill", names(agent.skillIds, s.skills) ?? [], names(patch.skillIds, s.skills));
        listChange("Tese", names(agent.thesisIds, s.theses) ?? [], names(patch.thesisIds, s.theses));
        return {
          agents: updateById(s.agents, id, (a) => ({ ...a, ...patch, version: a.version + 1, updatedAt: nowISO() })),
          changeHistory: [
            manualEntry(s, {
              action: "UPDATED",
              entityType: "AGENT",
              entityId: id,
              entityName: agent.name,
              fromVersion: agent.version,
              toVersion: agent.version + 1,
              suggestedChange: `Configuração do agente “${agent.name}” alterada.`,
              diff,
              affectedAgentIds: [id],
            }),
            ...s.changeHistory,
          ],
          auditEvents: [auditEvent(s, "AGENT_UPDATED", "agent", id, `${agent.name} configurado.`), ...s.auditEvents],
        };
      }),
    createSkill: (input) => {
      const s = get();
      const id = createId("skl");
      const at = nowISO();
      const skill: Skill = {
        id,
        officeId: s.office.id,
        name: input.name,
        description: input.description,
        purpose: input.purpose,
        status: input.status,
        version: input.version,
        parameters: [],
        instructions: input.instructions,
        references: [],
        templates: [],
        files: [],
        updatedAt: at,
        updatedBy: actorOf(s).id,
      };
      const agentNames = s.agents.filter((a) => input.agentIds.includes(a.id)).map((a) => a.name);
      set({
        skills: [...s.skills, skill],
        // Relação Skill ↔ agente vive no agente (agent.skillIds).
        agents: s.agents.map((a) => (input.agentIds.includes(a.id) && !a.skillIds.includes(id) ? { ...a, skillIds: [...a.skillIds, id], updatedAt: at } : a)),
        changeHistory: [
          manualEntry(s, {
            action: "CREATED",
            entityType: "SKILL",
            entityId: id,
            entityName: input.name,
            fromVersion: 0,
            toVersion: input.version,
            suggestedChange: `Skill “${input.name}” criada.`,
            diff: creationDiff([
              ["Descrição", input.description],
              ["Finalidade", input.purpose],
              ["Instruções", input.instructions],
              ["Agentes relacionados", agentNames],
            ]),
            affectedAgentIds: input.agentIds,
          }),
          ...s.changeHistory,
        ],
        auditEvents: [auditEvent(s, "SKILL_CREATED", "skill", id, `Skill “${input.name}” criada.`), ...s.auditEvents],
      });
      return id;
    },
    createThesis: (input) => {
      const s = get();
      const id = createId("ths");
      const at = nowISO();
      const actor = actorOf(s);
      const thesis: LegalThesis = {
        id,
        officeId: s.office.id,
        name: input.name,
        area: input.area,
        status: input.status,
        version: 1,
        summary: input.summary,
        foundations: input.foundations,
        applicationCriteria: input.applicationCriteria,
        nonApplicationCriteria: input.nonApplicationCriteria,
        requiredDocuments: input.requiredDocuments,
        // Referências criadas pela interface ficam marcadas como demonstração até validação jurídica.
        references: input.references.map((r) => ({ ...r, demo: true })),
        relatedTemplates: [],
        skillIds: input.skillIds,
        notes: input.notes,
        versions: [{ version: 1, at, authorId: actor.id, note: "Tese criada." }],
        updatedAt: at,
      };
      const agentNames = s.agents.filter((a) => input.agentIds.includes(a.id)).map((a) => a.name);
      set({
        theses: [...s.theses, thesis],
        agents: s.agents.map((a) => (input.agentIds.includes(a.id) && !a.thesisIds.includes(id) ? { ...a, thesisIds: [...a.thesisIds, id], updatedAt: at } : a)),
        changeHistory: [
          manualEntry(s, {
            action: "CREATED",
            entityType: "THESIS",
            entityId: id,
            entityName: input.name,
            fromVersion: 0,
            toVersion: 1,
            suggestedChange: `Tese “${input.name}” criada.`,
            diff: creationDiff([
              ["Descrição", input.summary],
              ["Fundamentos", input.foundations],
              ["Critérios de aplicação", input.applicationCriteria],
              ["Critérios de não aplicação", input.nonApplicationCriteria],
              ["Documentos necessários", input.requiredDocuments],
              ["Agentes autorizados", agentNames],
            ]),
            affectedAgentIds: input.agentIds,
          }),
          ...s.changeHistory,
        ],
        auditEvents: [auditEvent(s, "THESIS_CREATED", "thesis", id, `Tese “${input.name}” criada.`), ...s.auditEvents],
      });
      return id;
    },
    /** Só é chamada depois da confirmação explícita do usuário no Tutor DG. */
    applySkillChange: (proposal) => {
      const s = get();
      const entry = historyEntry(s, proposal, "APPLIED");
      set({
        skills: updateById(s.skills, proposal.skillId, (sk) => {
          const parameters = sk.parameters.map((p) => {
            const change = proposal.parameterChanges.find((c) => c.key === p.key);
            return change ? { ...p, value: change.value } : p;
          });
          const added = proposal.parameterChanges
            .filter((c) => !sk.parameters.some((p) => p.key === c.key))
            .map((c) => ({ key: c.key, label: c.label, value: c.value }));
          return { ...sk, parameters: [...parameters, ...added], version: sk.version + 1, updatedAt: nowISO(), updatedBy: actorOf(s).id };
        }),
        changeHistory: [entry, ...s.changeHistory],
        auditEvents: [
          auditEvent(s, "SKILL_UPDATED", "skill", proposal.skillId, `Skill “${entry.entityName}” atualizada (v${entry.fromVersion} → v${entry.toVersion}) via Tutor DG.`),
          ...s.auditEvents,
        ],
      });
      return entry.id;
    },
    cancelSkillChange: (proposal) => {
      const s = get();
      const entry = historyEntry(s, proposal, "CANCELLED");
      set({ changeHistory: [entry, ...s.changeHistory] });
      return entry.id;
    },
    updateIntegrationStatus: (id, status) =>
      set((s) => {
        const integration = s.integrations.find((i) => i.id === id);
        return {
          integrations: updateById(s.integrations, id, (i) => ({
            ...i,
            status,
            statusMessage: status === "CONNECTED" ? undefined : i.statusMessage,
            lastSyncAt: status === "CONNECTED" ? nowISO() : i.lastSyncAt,
          })),
          notifications:
            status === "CONNECTED"
              ? s.notifications.map((n) => (n.type === "INTEGRATION_ISSUE" ? { ...n, read: true } : n))
              : s.notifications,
          auditEvents: [
            auditEvent(s, "INTEGRATION_UPDATED", "integration", id, `${integration?.name ?? "Integração"}: ${INTEGRATION_STATUS_LABEL[status].toLowerCase()}.`),
            ...s.auditEvents,
          ],
        };
      }),
    syncIntegration: (id) => set((s) => ({ integrations: updateById(s.integrations, id, (i) => ({ ...i, lastSyncAt: nowISO() })) })),
    configureJudicialSource: (id, config) =>
      set((s) => {
        const source = s.judicialSources.find((j) => j.id === id);
        if (!source) return {};
        const provider = JUDICIAL_PROVIDERS[source.source];
        const details = [
          ...(config.oabNumber ? [{ label: "OAB monitorada", value: `${config.oabNumber}/${config.oabState ?? ""}` }] : []),
          ...(config.courts?.length ? [{ label: "Tribunais", value: config.courts.join(", ") }] : []),
        ];
        return {
          judicialSources: updateById(s.judicialSources, id, (j) => ({ ...j, ...config, status: "CONNECTED" as const, statusMessage: undefined })),
          auditEvents: [
            auditEvent(s, "JUDICIAL_SOURCE_CONFIGURED", "judicialSource", id, `${provider.name} configurado (simulação, sem conexão real).`, undefined, details),
            ...s.auditEvents,
          ],
        };
      }),
    recordJudicialSync: (id, result) =>
      set((s) => {
        const source = s.judicialSources.find((j) => j.id === id);
        if (!source) return {};
        const provider = JUDICIAL_PROVIDERS[source.source];
        return {
          judicialSources: updateById(s.judicialSources, id, (j) => ({
            ...j,
            lastSyncAt: result.syncedAt,
            lastCommunicationAt: source.source === "DJEN" && result.newItems > 0 ? (result.latestItemAt ?? j.lastCommunicationAt) : j.lastCommunicationAt,
            importedCount: j.importedCount + result.newItems,
          })),
          auditEvents: [
            auditEvent(s, "JUDICIAL_SOURCE_SYNCED", "judicialSource", id, `${provider.name} sincronizado (simulação): ${result.newItems} item(ns) novo(s).`),
            ...s.auditEvents,
          ],
        };
      }),
  };
}
