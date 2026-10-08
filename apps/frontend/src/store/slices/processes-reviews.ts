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
      const { nextDeadline, origin, ...data } = input;
      // Processo SEMPRE pertence a um caso; o cliente é o do caso.
      const legalCase = s.legalCases.find((c) => c.id === input.legalCaseId);
      if (!legalCase) throw new Error("Selecione o caso relacionado.");
      if (legalCase.status === "REJECTED" || legalCase.status === "ARCHIVED" || legalCase.status === "DRAFT") throw new Error("Não é possível vincular processo a este caso na situação atual.");
      const process: Process = {
        ...data,
        clientId: legalCase.clientId,
        id,
        officeId: s.office.id,
        origin: origin ?? "MANUAL",
        createdAt: at,
        updatedAt: at,
        lastMovementAt: at,
      };
      const deadlines = nextDeadline
        ? [
            {
              id: createId("dl"),
              officeId: s.office.id,
              processId: id,
              clientId: legalCase.clientId,
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
        // Caso aceito passa a "em andamento" com o primeiro processo.
        legalCases: updateById(s.legalCases, legalCase.id, (c) => (c.status === "ACCEPTED" ? { ...c, status: "IN_PROGRESS" as const, updatedAt: at } : c)),
        auditEvents: [
          auditEvent(s, "PROCESS_CREATED", "process", id, `Processo “${input.title}” cadastrado no caso “${legalCase.title}”.`, undefined, undefined,
            legalCase.partnerOrganizationId ? { partnerOfficeId: legalCase.partnerOrganizationId, summary: `Processo cadastrado: ${input.title}.` } : undefined),
          ...s.auditEvents,
        ],
      });
      return id;
    },
    updateProcess: (id, patch) =>
      set((s) => {
        // O caso do processo não muda por edição comum.
        const { nextDeadline: _ignored, legalCaseId: _case, ...rest } = patch;
        void [_ignored, _case];
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
          deadlines: updateById(s.deadlines, id, (d) => ({ ...d, status: "COMPLETED", completedAt: nowISO() })),
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
        // Contratos pertencem ao caso: excluir o processo não os afeta.
        const agreements = s.agreements.filter((a) => a.legalCaseId === process.legalCaseId).length;
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
              { label: "Contratos de honorários do caso (mantidos)", value: String(agreements) },
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
          // O cliente do processo é o cliente do caso: os dois mudam juntos.
          legalCases: updateById(s.legalCases, process.legalCaseId, (c) => ({ ...c, clientId, updatedAt: nowISO() })),
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
      const legalCase = analysis.legalCaseId ? state.legalCases.find((c) => c.id === analysis.legalCaseId) : undefined;
      const client = state.clients.find((c) => c.id === analysis.clientId);
      // Análise aprovada conclui a análise. O processo NÃO é criado aqui: o caso
      // segue para a decisão humana (aceitar com advogado responsável, ou rejeitar).
      const needsLawyer = legalCase && !legalCase.assignedLawyerId;
      return {
        analyses: updateById(state.analyses, analysis.id, (a) => ({
          ...a,
          status: "COMPLETED",
          completedAt: at,
          steps: withStep(a, { review: "DONE", conclusion: "DONE" }),
          timeline: [...a.timeline, timelineEvent(actor, "Resultado aprovado. Caso pronto para aceite ou rejeição.")],
          updatedAt: at,
        })),
        notifications: needsLawyer
          ? [
              {
                id: createId("ntf"),
                officeId: state.office.id,
                type: "CASE_LAWYER_REQUIRED" as const,
                severity: "warning" as const,
                title: "Advogado responsável necessário",
                description: `${legalCase.title} · análise aprovada; defina o responsável para aceitar o caso.`,
                at,
                read: false,
                clientId: client?.id,
                legalCaseId: legalCase.id,
                cta: { label: "Abrir caso", href: `/casos/${legalCase.id}` },
                requiredPermission: "cases.decide" as const,
              },
              ...state.notifications,
            ]
          : state.notifications,
      };
    }
    case "PETITION_DRAFT": {
      const process = review.processId ? state.processes.find((p) => p.id === review.processId) : undefined;
      const legalCase = state.legalCases.find((c) => c.id === (review.legalCaseId ?? process?.legalCaseId));
      // Caso de parceiro: guarda uma cópia congelada da versão aprovada como documento
      // INTERNAL. Ela só chega ao parceiro quando a equipe a disponibilizar.
      const approvedCopy =
        legalCase && legalCase.partnerOrganizationId && review.clientId
          ? [
              {
                id: createId("doc"),
                officeId: state.office.id,
                clientId: review.clientId,
                legalCaseId: legalCase.id,
                processId: process?.id,
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
        : // Minuta pré-protocolo (caso ainda sem processo): só guarda a versão aprovada.
          { documents: approvedCopy.length ? [...approvedCopy, ...state.documents] : state.documents };
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
