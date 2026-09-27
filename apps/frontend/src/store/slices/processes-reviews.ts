import { nowISO } from "@/lib/clock";
import { REVIEW_DECISION_LABEL } from "@/lib/constants/status";
import { createId } from "@/lib/ids";
import type { AuditAction, Process, ProcessEvent, Review } from "@/types";
import {
  actorOf,
  auditEvent,
  SYSTEM_ACTOR,
  timelineEvent,
  updateById,
  withStep,
  type GetState,
  type SetState,
} from "../helpers";
import type { AppState, ProcessActions, ReviewActions } from "../types";
import { clientName } from "./clients-analyses";

const PETITION_AGENT = "agt_peticoes";

function processEvent(state: AppState, processId: string, title: string, source: ProcessEvent["source"], description?: string, important = false): ProcessEvent {
  return { id: createId("mov"), officeId: state.office.id, processId, at: nowISO(), title, description, source, important };
}

export function createProcessSlice(set: SetState, get: GetState): ProcessActions {
  return {
    createProcess: (input) => {
      const s = get();
      const id = createId("prc");
      const at = nowISO();
      const { nextDeadline, origin, ...data } = input;
      const process: Process = { ...data, id, officeId: s.office.id, origin: origin ?? "MANUAL", createdAt: at, updatedAt: at, lastMovementAt: at };
      const deadlines = nextDeadline
        ? [
            {
              id: createId("dl"),
              officeId: s.office.id,
              processId: id,
              clientId: input.clientId,
              title: nextDeadline.title,
              type: nextDeadline.type,
              dueDate: nextDeadline.dueDate,
              responsibleUserId: input.responsibleUserId,
              status: "OPEN" as const,
              createdAt: at,
            },
          ]
        : [];
      set({
        processes: [process, ...s.processes],
        processEvents: [processEvent(s, id, "Processo cadastrado manualmente", "MANUAL", `Cadastrado por ${actorOf(s).name}.`), ...s.processEvents],
        deadlines: [...deadlines, ...s.deadlines],
        auditEvents: [auditEvent(s, "PROCESS_CREATED", "process", id, `Processo “${input.title}” cadastrado.`), ...s.auditEvents],
      });
      return id;
    },
    updateProcess: (id, patch) =>
      set((s) => {
        const { nextDeadline: _ignored, ...rest } = patch;
        void _ignored;
        return {
          processes: updateById(s.processes, id, (p) => ({ ...p, ...rest, updatedAt: nowISO() })),
          auditEvents: [auditEvent(s, "PROCESS_UPDATED", "process", id, "Dados do processo atualizados."), ...s.auditEvents],
        };
      }),
    addProcessEvent: (processId, input) =>
      set((s) => ({
        processEvents: [processEvent(s, processId, input.title, "MANUAL", input.description, input.important ?? false), ...s.processEvents],
        processes: updateById(s.processes, processId, (p) => ({ ...p, lastMovementAt: nowISO(), updatedAt: nowISO() })),
      })),
    addDeadline: (input) => {
      const s = get();
      const process = s.processes.find((p) => p.id === input.processId);
      const id = createId("dl");
      set({
        deadlines: [{ ...input, id, officeId: s.office.id, clientId: process?.clientId ?? "", status: "OPEN", createdAt: nowISO() }, ...s.deadlines],
        auditEvents: [auditEvent(s, "DEADLINE_CREATED", "deadline", id, `Prazo “${input.title}” criado.`), ...s.auditEvents],
      });
      return id;
    },
    completeDeadline: (id) =>
      set((s) => {
        const deadline = s.deadlines.find((d) => d.id === id);
        return {
          deadlines: updateById(s.deadlines, id, (d) => ({ ...d, status: "DONE", completedAt: nowISO() })),
          notifications: s.notifications.map((n) =>
            n.type === "DEADLINE" && n.processId === deadline?.processId ? { ...n, read: true } : n,
          ),
          auditEvents: [auditEvent(s, "DEADLINE_COMPLETED", "deadline", id, `Prazo “${deadline?.title ?? ""}” cumprido.`), ...s.auditEvents],
        };
      }),
  };
}

const DECISION_AUDIT: Record<string, AuditAction> = {
  APPROVED: "REVIEW_APPROVED",
  REJECTED: "REVIEW_REJECTED",
  CHANGES_REQUESTED: "REVIEW_CHANGES_REQUESTED",
};

/** Efeitos da APROVAÇÃO, por tipo de revisão. É aqui que "o fluxo continua". */
function applyApproval(state: AppState, review: Review): Partial<AppState> {
  const at = nowISO();
  const actor = actorOf(state);
  switch (review.type) {
    case "ANALYSIS_RESULT": {
      const analysis = state.analyses.find((a) => a.id === review.analysisId);
      if (!analysis) return {};
      const template = state.templates.find((t) => t.id === analysis.templateId);
      const client = state.clients.find((c) => c.id === analysis.clientId);
      const processId = analysis.processId ?? createId("prc");
      const newProcess: Process | null = analysis.processId
        ? null
        : {
            id: processId,
            officeId: state.office.id,
            clientId: analysis.clientId,
            title: `Ação a partir da ${template?.name.toLowerCase() ?? "análise"}`,
            area: template?.area ?? "BANKING",
            actionType: "A definir na minuta",
            clientPole: "ACTIVE",
            opposingParty: analysis.fields.instituicao,
            responsibleUserId: client?.responsibleUserId ?? actor.id,
            status: "PRE_FILING",
            phase: "PRELIMINARY",
            origin: "AGENT",
            thesisId: review.thesisId,
            analysisId: analysis.id,
            summary: analysis.result?.summary,
            createdAt: at,
            updatedAt: at,
            lastMovementAt: at,
          };
      return {
        analyses: updateById(state.analyses, analysis.id, (a) => ({
          ...a,
          status: "COMPLETED",
          completedAt: at,
          processId,
          steps: withStep(a, { review: "DONE", conclusion: "DONE" }),
          timeline: [...a.timeline, timelineEvent(actor, "Resultado aprovado. Processo criado em pré-ajuizamento.")],
          updatedAt: at,
        })),
        processes: newProcess ? [newProcess, ...state.processes] : state.processes,
        processEvents: newProcess
          ? [processEvent(state, processId, "Processo criado a partir de análise aprovada", "AGENT", `Aprovado por ${actor.name}.`), ...state.processEvents]
          : state.processEvents,
        agentTasks: [
          {
            id: createId("tsk"),
            officeId: state.office.id,
            agentId: PETITION_AGENT,
            title: `Preparar minuta de petição inicial — ${clientName(client)}`,
            status: "RUNNING",
            clientId: analysis.clientId,
            processId,
            at,
          },
          ...state.agentTasks,
        ],
      };
    }
    case "PETITION_DRAFT":
      return review.processId
        ? {
            processes: updateById(state.processes, review.processId, (p) => ({
              ...p,
              status: p.status === "PRE_FILING" ? "PREPARING" : p.status,
              lastMovementAt: at,
              updatedAt: at,
            })),
            processEvents: [
              processEvent(state, review.processId, "Minuta aprovada — pronta para protocolo manual", "MANUAL", `Aprovada por ${actor.name}.`, true),
              ...state.processEvents,
            ],
          }
        : {};
    case "DEADLINE_PROPOSAL":
    case "PROCESS_UPDATE":
      return review.processId
        ? {
            processEvents: [
              processEvent(
                state,
                review.processId,
                review.type === "DEADLINE_PROPOSAL" ? "Prazo confirmado pelo responsável" : "Providências sugeridas registradas",
                "MANUAL",
                `Confirmado por ${actor.name}.`,
              ),
              ...state.processEvents,
            ],
          }
        : {};
    case "DOCUMENT_CHECK":
    case "CLIENT_MESSAGE":
      return review.analysisId
        ? {
            analyses: updateById(state.analyses, review.analysisId, (a) => ({
              ...a,
              timeline: [
                ...a.timeline,
                timelineEvent(actor, review.type === "CLIENT_MESSAGE" ? "Mensagem ao cliente aprovada — disponível para envio pela equipe." : "Conferência documental confirmada."),
              ],
            })),
          }
        : {};
    default:
      return {};
  }
}

export function createReviewSlice(set: SetState, get: GetState): ReviewActions {
  return {
    decideReview: (reviewId, decision, comment) => {
      const s = get();
      const review = s.reviews.find((r) => r.id === reviewId);
      if (!review) return;
      const at = nowISO();
      const actor = actorOf(s);
      let effects: Partial<AppState> = {};
      if (decision === "APPROVED") {
        effects = applyApproval(s, review);
      } else if (review.analysisId) {
        effects = {
          analyses: updateById(s.analyses, review.analysisId, (a) =>
            decision === "CHANGES_REQUESTED"
              ? {
                  ...a,
                  status: "ANALYZING",
                  steps: withStep(a, { agent: "CURRENT", review: "PENDING" }),
                  timeline: [...a.timeline, timelineEvent(actor, `Alterações solicitadas: ${comment ?? ""}`)],
                  updatedAt: at,
                }
              : {
                  ...a,
                  status: "INTERRUPTED",
                  interruptionReason: comment,
                  timeline: [...a.timeline, timelineEvent(actor, `Resultado rejeitado: ${comment ?? ""}`)],
                  updatedAt: at,
                },
          ),
        };
      }
      const base = { ...s, ...effects };
      const agentTasks =
        decision === "CHANGES_REQUESTED"
          ? [
              {
                id: createId("tsk"),
                officeId: s.office.id,
                agentId: review.agentId,
                title: `Ajustando “${review.title}” conforme solicitado`,
                status: "RUNNING" as const,
                clientId: review.clientId,
                processId: review.processId,
                reviewId,
                at,
              },
              ...base.agentTasks,
            ]
          : base.agentTasks.map((t) => (t.reviewId === reviewId && t.status === "WAITING_REVIEW" ? { ...t, status: "COMPLETED" as const } : t));
      set({
        ...effects,
        agentTasks,
        reviews: updateById(s.reviews, reviewId, (r) => ({ ...r, status: decision, decidedAt: at })),
        reviewDecisions: [{ id: createId("dec"), officeId: s.office.id, reviewId, decision, comment, userId: actor.id, at }, ...s.reviewDecisions],
        notifications: s.notifications.map((n) => (n.reviewId === reviewId ? { ...n, read: true } : n)),
        auditEvents: [
          auditEvent(s, DECISION_AUDIT[decision] ?? "REVIEW_APPROVED", "review", reviewId, `“${review.title}”: ${REVIEW_DECISION_LABEL[decision].toLowerCase()}.`),
          ...(decision === "APPROVED" && review.type === "ANALYSIS_RESULT" && !s.analyses.find((a) => a.id === review.analysisId)?.processId
            ? [auditEvent(s, "PROCESS_CREATED", "process", review.analysisId ?? "", "Processo criado a partir de análise aprovada.", SYSTEM_ACTOR)]
            : []),
          ...s.auditEvents,
        ],
      });
    },
    markNotificationRead: (id) => set((s) => ({ notifications: updateById(s.notifications, id, (n) => ({ ...n, read: true })) })),
    markAllNotificationsRead: () => set((s) => ({ notifications: s.notifications.map((n) => ({ ...n, read: true })) })),
  };
}
