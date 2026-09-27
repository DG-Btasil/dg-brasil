import { addDays, nowISO, parseISODate, toISODate, todayISO } from "@/lib/clock";
import { INTEGRATION_STATUS_LABEL } from "@/lib/constants/status";
import { deriveAgreementStatus } from "@/lib/domain/finance";
import { createId } from "@/lib/ids";
import type { ChangeHistoryEntry, Payment } from "@/types";
import { actorOf, auditEvent, updateById, type GetState, type SetState } from "../helpers";
import type { AppState, DgActions, FinanceActions, SkillChangeProposal } from "../types";
import { clientName } from "./clients-analyses";

/** Gera o cronograma de pagamentos de um contrato. */
function schedulePayments(state: AppState, agreementId: string, input: { upfrontFee: number; fixedFee: number; installments: number; monthlyFee?: number; startDate: string }): Payment[] {
  const start = parseISODate(input.startDate);
  const today = todayISO();
  const list: Payment[] = [];
  const push = (description: string, amount: number, offsetDays: number) => {
    const dueDate = toISODate(addDays(start, offsetDays));
    list.push({
      id: createId("pay"),
      officeId: state.office.id,
      agreementId,
      description,
      amount,
      dueDate,
      status: dueDate < today ? "OVERDUE" : "PENDING",
    });
  };
  if (input.upfrontFee > 0) push("Entrada", input.upfrontFee, 0);
  if (input.fixedFee > 0) {
    const n = Math.max(1, input.installments);
    const each = Math.round((input.fixedFee / n) * 100) / 100;
    for (let i = 1; i <= n; i += 1) push(`Parcela ${i}/${n}`, each, 30 * i);
  }
  if (input.monthlyFee && input.monthlyFee > 0) {
    for (let i = 0; i < 6; i += 1) push("Mensalidade", input.monthlyFee, 30 * i);
  }
  return list;
}

export function createFinanceSlice(set: SetState, get: GetState): FinanceActions {
  return {
    createFeeModel: (input) => {
      const s = get();
      const id = createId("fee");
      set({
        feeModels: [...s.feeModels, { ...input, id, officeId: s.office.id, updatedAt: nowISO() }],
        auditEvents: [auditEvent(s, "FEE_MODEL_CREATED", "feeModel", id, `Modelo de honorários “${input.name}” criado.`), ...s.auditEvents],
      });
      return id;
    },
    updateFeeModel: (id, patch) =>
      set((s) => ({
        feeModels: updateById(s.feeModels, id, (m) => ({ ...m, ...patch, updatedAt: nowISO() })),
        auditEvents: [auditEvent(s, "FEE_MODEL_UPDATED", "feeModel", id, "Modelo de honorários alterado."), ...s.auditEvents],
      })),
    createAgreement: (input) => {
      const s = get();
      const id = createId("agr");
      const totalContracted = input.upfrontFee + input.fixedFee + (input.monthlyFee ? input.monthlyFee * 6 : 0);
      const process = s.processes.find((p) => p.id === input.processId);
      const estimatedSuccessFee =
        input.successFeePercent && process?.caseValue ? Math.round(process.caseValue * (input.successFeePercent / 100)) : undefined;
      const payments = schedulePayments(s, id, input);
      const agreement = {
        ...input,
        id,
        officeId: s.office.id,
        totalContracted,
        estimatedSuccessFee,
        status: "ACTIVE" as const,
        createdAt: nowISO(),
      };
      const allPayments = [...s.payments, ...payments];
      const client = s.clients.find((c) => c.id === input.clientId);
      set({
        agreements: [{ ...agreement, status: deriveAgreementStatus(agreement, allPayments) }, ...s.agreements],
        payments: allPayments,
        auditEvents: [auditEvent(s, "AGREEMENT_CREATED", "agreement", id, `Contrato de honorários criado para ${clientName(client)}.`), ...s.auditEvents],
      });
      return id;
    },
    registerPayment: (paymentId) =>
      set((s) => {
        const payments = updateById(s.payments, paymentId, (p) => ({ ...p, status: "PAID" as const, paidAt: nowISO() }));
        const payment = payments.find((p) => p.id === paymentId);
        return {
          payments,
          agreements: s.agreements.map((a) => (a.id === payment?.agreementId ? { ...a, status: deriveAgreementStatus(a, payments) } : a)),
          auditEvents: [auditEvent(s, "PAYMENT_REGISTERED", "payment", paymentId, `Pagamento “${payment?.description ?? ""}” registrado.`), ...s.auditEvents],
        };
      }),
  };
}

function historyEntry(state: AppState, proposal: SkillChangeProposal, status: ChangeHistoryEntry["status"]): ChangeHistoryEntry {
  const skill = state.skills.find((sk) => sk.id === proposal.skillId);
  const from = skill?.version ?? 1;
  return {
    id: createId("chg"),
    officeId: state.office.id,
    at: nowISO(),
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

export function createDgSlice(set: SetState, get: GetState): DgActions {
  return {
    updateAgent: (id, patch) =>
      set((s) => {
        const agent = s.agents.find((a) => a.id === id);
        return {
          agents: updateById(s.agents, id, (a) => ({ ...a, ...patch, version: a.version + 1, updatedAt: nowISO() })),
          auditEvents: [auditEvent(s, "AGENT_UPDATED", "agent", id, `${agent?.name ?? "Agente"} configurado.`), ...s.auditEvents],
        };
      }),
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
  };
}
