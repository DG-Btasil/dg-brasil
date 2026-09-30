import { nowISO } from "@/lib/clock";
import { OPEN_REVIEW_STATUSES, REVIEW_DECISION_LABEL, REVIEW_STATUS_LABEL } from "@/lib/constants/status";
import { createId } from "@/lib/ids";
import type { ReviewContentOrigin } from "@/lib/constants/status";
import type { AuditAction, Process, ProcessEvent, Review } from "@/types";
import {
  actorOf,
  auditEvent,
  SYSTEM_ACTOR,
  timelineEvent,
  updateById,
  viewerOf,
  withStep,
  type GetState,
  type SetState,
} from "../helpers";
import type { AppState, ProcessActions, ReviewActions } from "../types";
import { clientName } from "./clients-analyses";
import { partnershipSnapshotFor } from "./partners";

const PETITION_AGENT = "agt_peticoes";

/** Origem da versão ATUAL do conteúdo (a última edição registrada, ou o agente). */
function currentContentOrigin(review: Review): ReviewContentOrigin {
  const version = review.contentVersion ?? 1;
  const edit = [...(review.history ?? [])].reverse().find((h) => (h.kind === "MANUAL_EDIT" || h.kind === "AGENT_EDIT") && h.toVersion === version);
  return edit?.kind === "MANUAL_EDIT" ? "MANUAL_EDIT" : edit?.kind === "AGENT_EDIT" ? "AGENT_EDIT" : "AGENT";
}

/** Caixa de notificações do usuário da sessão (interna × parceiro). */
function inboxOf(state: AppState): (n: AppState["notifications"][number]) => boolean {
  const viewer = viewerOf(state);
  if (viewer?.audience === "PARTNER") return (n) => !!viewer.partnerOfficeId && n.partnerOfficeId === viewer.partnerOfficeId;
  return (n) => !n.partnerOfficeId;
}

function processEvent(state: AppState, processId: string, title: string, source: ProcessEvent["source"], description?: string, important = false): ProcessEvent {
  return { id: createId("mov"), officeId: state.office.id, processId, at: nowISO(), title, description, source, important };
}

export function createProcessSlice(set: SetState, get: GetState): ProcessActions {
  return {
    createProcess: (input) => {
      const s = get();
      const id = createId("prc");
      const at = nowISO();
      const { nextDeadline, origin, relationshipOrigin, originPartnerOfficeId, ...data } = input;
      const partnerOrigin = relationshipOrigin === "PARTNER" && originPartnerOfficeId;
      const process: Process = {
        ...data,
        id,
        officeId: s.office.id,
        origin: origin ?? "MANUAL",
        relationshipOrigin: partnerOrigin ? "PARTNER" : "INTERNAL",
        ...(partnerOrigin ? { originPartnerOfficeId } : {}),
        createdAt: at,
        updatedAt: at,
        lastMovementAt: at,
      };
      // Caso originado por parceiro: copia a divisão vigente (snapshot) para o acordo do caso.
      const agreement = partnershipSnapshotFor(s, process);
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
        partnershipAgreements: agreement ? [agreement, ...s.partnershipAgreements] : s.partnershipAgreements,
        auditEvents: [
          agreement
            ? auditEvent(s, "PARTNER_PROCESS_CREATED", "process", id, `Processo “${input.title}” cadastrado com origem em parceiro (divisão ${agreement.partnerPercentage}% / ${agreement.ownerPercentage}%).`, undefined, undefined, {
                partnerOfficeId: agreement.partnerOfficeId,
                summary: `Processo criado: ${input.title}.`,
              })
            : auditEvent(s, "PROCESS_CREATED", "process", id, `Processo “${input.title}” cadastrado.`),
          ...s.auditEvents,
        ],
      });
      return id;
    },
    updateProcess: (id, patch) =>
      set((s) => {
        // Origem relacional não muda por edição comum: ela define o acordo financeiro do caso.
        const { nextDeadline: _ignored, relationshipOrigin: _ro, originPartnerOfficeId: _po, ...rest } = patch;
        void [_ignored, _ro, _po];
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
    /**
     * Exclui o processo, suas movimentações e prazos. O CLIENTE NÃO É AFETADO.
     * Revisões, documentos e contratos de honorários continuam existindo
     * (histórico); documentos deixam de apontar para o processo.
     */
    deleteProcess: (id) =>
      set((s) => {
        const process = s.processes.find((p) => p.id === id);
        if (!process) return {};
        const reviews = s.reviews.filter((r) => r.processId === id).length;
        const deadlines = s.deadlines.filter((d) => d.processId === id && d.status === "OPEN").length;
        const agreements = s.agreements.filter((a) => a.processId === id).length;
        const documents = s.documents.filter((d) => d.processId === id).length;
        return {
          processes: s.processes.filter((p) => p.id !== id),
          processEvents: s.processEvents.filter((e) => e.processId !== id),
          deadlines: s.deadlines.filter((d) => d.processId !== id),
          documents: s.documents.map((d) => (d.processId === id ? { ...d, processId: undefined } : d)),
          notifications: s.notifications.map((n) => (n.processId === id ? { ...n, read: true } : n)),
          auditEvents: [
            auditEvent(s, "PROCESS_DELETED", "process", id, `Processo “${process.title}” excluído. O cliente foi mantido.`, undefined, [
              ...(process.cnj ? [{ label: "Número CNJ", value: process.cnj }] : []),
              { label: "Revisões associadas (mantidas)", value: String(reviews) },
              { label: "Prazos em aberto removidos", value: String(deadlines) },
              { label: "Contratos de honorários associados (mantidos)", value: String(agreements) },
              { label: "Documentos desvinculados", value: String(documents) },
            ]),
            ...s.auditEvents,
          ],
        };
      }),
    linkProcessClient: (processId, clientId) =>
      set((s) => {
        const process = s.processes.find((p) => p.id === processId);
        const client = s.clients.find((c) => c.id === clientId);
        if (!process || !client) return {};
        const wasPending = process.clientLinkStatus === "PENDING_LINK";
        return {
          processes: updateById(s.processes, processId, (p) => ({
            ...p,
            clientId,
            clientLinkStatus: undefined,
            removedClientName: undefined,
            updatedAt: nowISO(),
          })),
          processEvents: [
            processEvent(s, processId, `Cliente vinculado: ${clientName(client)}`, "MANUAL", wasPending ? `Vínculo pendente resolvido por ${actorOf(s).name}.` : undefined),
            ...s.processEvents,
          ],
          notifications: s.notifications.map((n) => (n.type === "DATA_INTEGRITY" && n.processId === processId ? { ...n, read: true } : n)),
          auditEvents: [
            auditEvent(s, "PROCESS_CLIENT_LINKED", "process", processId, `Processo “${process.title}” vinculado a ${clientName(client)}.`, undefined,
              wasPending && process.removedClientName ? [{ label: "Cliente removido anteriormente", value: process.removedClientName }] : undefined),
            ...s.auditEvents,
          ],
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
            relationshipOrigin: "INTERNAL",
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
    case "PETITION_DRAFT": {
      const process = review.processId ? state.processes.find((p) => p.id === review.processId) : undefined;
      // Caso de parceiro: guarda uma cópia congelada da versão aprovada como documento
      // INTERNAL. Ela só chega ao parceiro quando a equipe a disponibilizar.
      const approvedCopy =
        process?.relationshipOrigin === "PARTNER" && review.clientId
          ? [
              {
                id: createId("doc"),
                officeId: state.office.id,
                clientId: review.clientId,
                processId: process.id,
                name: `${review.content.title} — versão aprovada`,
                category: "PETITION" as const,
                status: "RECEIVED" as const,
                verification: "VERIFIED" as const,
                fileName: `${review.content.title.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-")}-aprovada.pdf`,
                sizeKb: 300,
                uploadedAt: at,
                uploadedBy: actor.id,
                required: false,
                updatedAt: at,
                visibility: "INTERNAL" as const,
                sourceReviewId: review.id,
                approvedContent: {
                  title: review.content.title,
                  sections: review.content.sections,
                  version: review.contentVersion ?? 1,
                  approvedAt: at,
                },
              },
            ]
          : [];
      return review.processId
        ? {
            documents: approvedCopy.length ? [...approvedCopy, ...state.documents] : state.documents,
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
    }
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
        // A decisão fica atrelada à versão do conteúdo: aprovação não vale para versões posteriores.
        reviewDecisions: [
          { id: createId("dec"), officeId: s.office.id, reviewId, decision, comment, userId: actor.id, at, contentVersion: review.contentVersion ?? 1 },
          ...s.reviewDecisions,
        ],
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
    /**
     * Edição manual de pequenas correções, sem regenerar pelo agente.
     * A versão anterior é preservada; a revisão continua aguardando decisão.
     */
    editReviewContent: (reviewId, content) =>
      set((s) => {
        const review = s.reviews.find((r) => r.id === reviewId);
        if (!review || !OPEN_REVIEW_STATUSES.includes(review.status)) return {};
        const at = nowISO();
        const actor = actorOf(s);
        const fromVersion = review.contentVersion ?? 1;
        const toVersion = fromVersion + 1;
        const changedSections = content.sections
          .filter((section, i) => {
            const before = review.content.sections[i];
            return !before || before.heading !== section.heading || before.body !== section.body;
          })
          .map((section) => section.heading);
        if (content.title !== review.content.title) changedSections.unshift("Título");
        if (changedSections.length === 0) return {};
        const archivedOrigin = currentContentOrigin(review);
        return {
          reviews: updateById(s.reviews, reviewId, (r) => ({
            ...r,
            content,
            contentVersion: toVersion,
            previousVersions: [...(r.previousVersions ?? []), { version: fromVersion, content: r.content, origin: archivedOrigin, at, actor }],
            history: [...(r.history ?? []), { id: createId("rvh"), kind: "MANUAL_EDIT" as const, at, actor, fromVersion, toVersion, changedSections }],
          })),
          auditEvents: [
            auditEvent(s, "REVIEW_VERSION_CREATED", "review", reviewId, `“${review.title}”: versão v${toVersion} criada (v${fromVersion} preservada). Aguarda nova aprovação.`, actor),
            auditEvent(s, "REVIEW_EDITED", "review", reviewId, `“${review.title}” editada manualmente (v${fromVersion} → v${toVersion}).`, actor, [
              { label: "Origem", value: "MANUAL_EDIT" },
              { label: "Seções alteradas", value: changedSections.join(", ") },
            ]),
            ...s.auditEvents,
          ],
        };
      }),
    /**
     * "Editar com agente": o advogado dá uma instrução e o agente gera nova
     * versão (AGENT_EDIT). Protótipo: a reescrita é SIMULADA — o texto é
     * mantido e a instrução fica registrada; no backend, o worker do agente
     * produz o conteúdo. A versão anterior é preservada e a revisão continua
     * aguardando decisão (nunca aprovada automaticamente).
     */
    requestAgentEdit: (reviewId, instruction) =>
      set((s) => {
        const review = s.reviews.find((r) => r.id === reviewId);
        const text = instruction.trim();
        if (!review || !OPEN_REVIEW_STATUSES.includes(review.status) || !text) return {};
        const at = nowISO();
        const actor = actorOf(s);
        const fromVersion = review.contentVersion ?? 1;
        const toVersion = fromVersion + 1;
        const archivedOrigin = currentContentOrigin(review);
        return {
          reviews: updateById(s.reviews, reviewId, (r) => ({
            ...r,
            content: { ...r.content, sections: r.content.sections.map((section) => ({ ...section })) },
            contentVersion: toVersion,
            // Reaberta volta a "Pendente": a nova versão aguarda decisão como qualquer outra.
            status: r.status === "REOPENED" ? ("PENDING" as const) : r.status,
            previousVersions: [...(r.previousVersions ?? []), { version: fromVersion, content: r.content, origin: archivedOrigin, at, actor }],
            history: [...(r.history ?? []), { id: createId("rvh"), kind: "AGENT_EDIT" as const, at, actor, fromVersion, toVersion, instruction: text }],
          })),
          agentTasks: [
            { id: createId("tsk"), officeId: s.office.id, agentId: review.agentId, title: `Nova versão de “${review.title}” a pedido de ${actor.name}`, status: "COMPLETED" as const, clientId: review.clientId, processId: review.processId, reviewId, at },
            ...s.agentTasks,
          ],
          auditEvents: [
            auditEvent(s, "REVIEW_VERSION_CREATED", "review", reviewId, `“${review.title}”: versão v${toVersion} criada pelo agente (v${fromVersion} preservada). Aguarda nova aprovação.`, actor),
            auditEvent(s, "REVIEW_AGENT_EDITED", "review", reviewId, `Alteração solicitada ao agente em “${review.title}” (v${fromVersion} → v${toVersion}).`, actor, [
              { label: "Origem", value: "AGENT_EDIT" },
              { label: "Instrução", value: text },
            ]),
            ...s.auditEvents,
          ],
        };
      }),
    recordReviewDownload: (reviewId, version, format, draft) =>
      set((s) => {
        const review = s.reviews.find((r) => r.id === reviewId);
        if (!review) return {};
        return {
          auditEvents: [
            auditEvent(
              s,
              draft ? "DOCUMENT_DRAFT_DOWNLOADED" : "DOCUMENT_APPROVED_DOWNLOADED",
              "review",
              reviewId,
              `“${review.title}” v${version} baixada em ${format}${draft ? " como rascunho (não aprovada)" : " (versão aprovada)"}.`,
            ),
            ...s.auditEvents,
          ],
        };
      }),
    /**
     * Reabre uma revisão já decidida. A decisão anterior NÃO é apagada: continua
     * em reviewDecisions e o evento de reabertura entra na trilha e na auditoria.
     * Efeitos já aplicados pela decisão anterior não são desfeitos automaticamente.
     */
    reopenReview: (reviewId, reason) =>
      set((s) => {
        const review = s.reviews.find((r) => r.id === reviewId);
        if (!review || OPEN_REVIEW_STATUSES.includes(review.status)) return {};
        const at = nowISO();
        const actor = actorOf(s);
        return {
          reviews: updateById(s.reviews, reviewId, (r) => ({
            ...r,
            status: "REOPENED" as const,
            decidedAt: undefined,
            history: [...(r.history ?? []), { id: createId("rvh"), kind: "REOPENED" as const, at, actor, previousStatus: review.status, reason }],
          })),
          auditEvents: [
            auditEvent(s, "REVIEW_REOPENED", "review", reviewId, `“${review.title}” reaberta.`, actor, [
              { label: "Decisão anterior", value: REVIEW_STATUS_LABEL[review.status] },
              ...(reason ? [{ label: "Motivo", value: reason }] : []),
            ]),
            ...s.auditEvents,
          ],
        };
      }),
    // Leitura de notificação respeita a caixa do usuário: interna ou do próprio parceiro.
    markNotificationRead: (id) =>
      set((s) => {
        const inbox = inboxOf(s);
        return { notifications: s.notifications.map((n) => (n.id === id && inbox(n) ? { ...n, read: true } : n)) };
      }),
    markAllNotificationsRead: () =>
      set((s) => {
        const inbox = inboxOf(s);
        return { notifications: s.notifications.map((n) => (inbox(n) ? { ...n, read: true } : n)) };
      }),
  };
}
