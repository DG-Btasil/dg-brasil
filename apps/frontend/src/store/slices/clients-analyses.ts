import { addDays, now, nowISO } from "@/lib/clock";
import { DEMO_LEGAL_DISCLAIMER } from "@/lib/constants/legal";
import { DOCUMENT_CATEGORY_LABEL } from "@/lib/constants/status";
import { missingDocumentCategories } from "@/lib/domain/analysis";
import { createId } from "@/lib/ids";
import { buildSteps } from "@/mocks";
import { type AgentTask, type Client, type LegalAnalysis, type Notification, type Review } from "@/types";
import {
  actorOf,
  agentActor,
  auditEvent,
  timelineEvent,
  updateById,
  withStep,
  type GetState,
  type SetState,
} from "../helpers";
import type { AnalysisActions, AppState, ClientActions } from "../types";

export function clientName(client: Client | undefined): string {
  if (!client) return "Cliente";
  return client.kind === "INDIVIDUAL" ? client.fullName : (client.tradeName ?? client.legalName);
}

const DOCUMENTATION_AGENT = "agt_documentacao";

/**
 * Após qualquer mudança de documento, reavalia as análises do cliente que
 * dependem de documentação. É a regra "documentos completos → pronta".
 */
function reevaluateClientAnalyses(state: AppState, clientId: string): Pick<AppState, "analyses" | "clients"> {
  const client = state.clients.find((c) => c.id === clientId);
  if (!client) return { analyses: state.analyses, clients: state.clients };
  let anyWaiting = false;
  const analyses = state.analyses.map((a) => {
    if (a.clientId !== clientId || !["WAITING_DOCUMENTS", "READY"].includes(a.status)) return a;
    const template = state.templates.find((t) => t.id === a.templateId);
    if (!template) return a;
    const missing = missingDocumentCategories(template, client, state.documents);
    if (missing.length === 0 && a.status === "WAITING_DOCUMENTS") {
      return {
        ...a,
        status: "READY" as const,
        missingDocuments: [],
        steps: withStep(a, { documents: "DONE", agent: "PENDING" }),
        timeline: [...a.timeline, timelineEvent(agentActor(state, DOCUMENTATION_AGENT), "Documentação completa. Análise pronta para envio ao agente.")],
        updatedAt: nowISO(),
      };
    }
    if (missing.length > 0) {
      anyWaiting = true;
      if (a.status === "READY") {
        return {
          ...a,
          status: "WAITING_DOCUMENTS" as const,
          missingDocuments: missing,
          steps: withStep(a, { documents: "BLOCKED" }),
          timeline: [...a.timeline, timelineEvent(agentActor(state, DOCUMENTATION_AGENT), "Nova pendência documental identificada.")],
          updatedAt: nowISO(),
        };
      }
      return { ...a, missingDocuments: missing };
    }
    return a;
  });
  const clients = updateById(state.clients, clientId, (c) => {
    // Cliente inativado só muda de status por ação explícita (reativar).
    if (c.status === "INACTIVE") return c;
    if (anyWaiting) return { ...c, status: "WAITING_DOCUMENTS" as const, updatedAt: nowISO() };
    if (c.status === "WAITING_DOCUMENTS") return { ...c, status: "ACTIVE" as const, updatedAt: nowISO() };
    return c;
  });
  return { analyses, clients };
}

export function createClientSlice(set: SetState, get: GetState): ClientActions {
  return {
    addDocument: (input) => {
      const s = get();
      const at = nowISO();
      const user = actorOf(s);
      // Se já existe um item "ausente" da mesma categoria, ele é preenchido em vez de duplicado.
      const placeholder = s.documents.find(
        (d) => d.clientId === input.clientId && d.category === input.category && (d.status === "MISSING" || d.status === "NEEDS_UPDATE" || d.status === "REJECTED"),
      );
      const id = placeholder?.id ?? createId("doc");
      const doc = {
        id,
        officeId: s.office.id,
        clientId: input.clientId,
        legalCaseId: input.legalCaseId ?? placeholder?.legalCaseId,
        processId: input.processId,
        name: input.name,
        category: input.category,
        status: "PENDING" as const,
        verification: "UNVERIFIED" as const,
        fileName: input.fileName ?? `${input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.pdf`,
        sizeKb: input.sizeKb ?? 240,
        uploadedAt: at,
        uploadedBy: user.id,
        required: placeholder?.required ?? false,
        notes: input.notes,
        updatedAt: at,
        // Documento da equipe interna nasce INTERNAL; só a equipe pode disponibilizá-lo ao parceiro.
        visibility: placeholder?.visibility ?? ("INTERNAL" as const),
      };
      const documents = placeholder ? updateById(s.documents, id, () => doc) : [doc, ...s.documents];
      const client = s.clients.find((c) => c.id === input.clientId);
      const next = { ...s, documents };
      set({
        documents,
        ...reevaluateClientAnalyses(next, input.clientId),
        auditEvents: [
          auditEvent(s, "DOCUMENT_ADDED", "document", id, `${DOCUMENT_CATEGORY_LABEL[input.category]} adicionado para ${clientName(client)}.`),
          ...s.auditEvents,
        ],
      });
      return id;
    },
    updateDocumentStatus: (id, status, notes) => {
      const s = get();
      const doc = s.documents.find((d) => d.id === id);
      if (!doc) return;
      const documents = updateById(s.documents, id, (d) => ({
        ...d,
        status,
        verification: status === "RECEIVED" ? "VERIFIED" : status === "REJECTED" ? "FAILED" : d.verification,
        notes: notes ?? d.notes,
        updatedAt: nowISO(),
      }));
      set({
        documents,
        ...reevaluateClientAnalyses({ ...s, documents }, doc.clientId),
        auditEvents: [auditEvent(s, "DOCUMENT_STATUS_CHANGED", "document", id, `Status do documento “${doc.name}” alterado.`), ...s.auditEvents],
      });
    },
  };
}

export function createAnalysisSlice(set: SetState, get: GetState): AnalysisActions {
  return {
    startAnalysis: ({ legalCaseId, clientId, templateId, fields }) => {
      const s = get();
      const client = s.clients.find((c) => c.id === clientId);
      // Cada análise pertence a um caso do cliente.
      const legalCase = s.legalCases.find((c) => c.id === legalCaseId && c.clientId === clientId);
      if (!legalCase) throw new Error("Caso inexistente.");
      const template = s.templates.find((t) => t.id === templateId);
      if (!client || !template) throw new Error("Cliente ou template inexistente.");
      const actor = actorOf(s);
      const at = nowISO();
      const missing = missingDocumentCategories(template, client, s.documents);
      const ready = missing.length === 0;
      const id = createId("ana");
      const timeline = [
        timelineEvent(actor, `${template.name} iniciada.`),
        ready
          ? timelineEvent(agentActor(s, DOCUMENTATION_AGENT), "Documentação completa.")
          : timelineEvent(
              agentActor(s, DOCUMENTATION_AGENT),
              `Documentos pendentes: ${missing.map((m) => DOCUMENT_CATEGORY_LABEL[m].toLowerCase()).join(", ")}.`,
            ),
      ];
      if (ready) timeline.push(timelineEvent(agentActor(s, template.primaryAgentId), "Avaliação do material iniciada."));
      const analysis: LegalAnalysis = {
        id,
        officeId: s.office.id,
        clientId,
        legalCaseId,
        templateId,
        status: ready ? "ANALYZING" : "WAITING_DOCUMENTS",
        fields,
        missingDocuments: missing,
        steps: buildSteps(ready ? ["DONE", "CURRENT", "PENDING", "PENDING"] : ["BLOCKED", "PENDING", "PENDING", "PENDING"], [at, ready ? at : undefined]),
        timeline,
        startedAt: at,
        startedBy: actor.id,
        createdAt: at,
        updatedAt: at,
      };
      const tasks: AgentTask[] = ready
        ? [
            {
              id: createId("tsk"),
              officeId: s.office.id,
              agentId: template.primaryAgentId,
              title: `${template.name} em execução — ${clientName(client)}`,
              status: "RUNNING",
              clientId,
              at,
            },
          ]
        : [];
      set({
        analyses: [analysis, ...s.analyses],
        // O status do caso passa a acompanhar a análise (store/app-store sincroniza).
        legalCases: updateById(s.legalCases, legalCaseId, (c) => ({ ...c, analysisId: id, updatedAt: at })),
        agentTasks: [...tasks, ...s.agentTasks],
        clients: updateById(s.clients, clientId, (c) => ({ ...c, status: ready ? "ACTIVE" : "WAITING_DOCUMENTS", updatedAt: at })),
        documents: s.documents.map((d) => (d.clientId === clientId && missing.includes(d.category) ? { ...d, required: true } : d)),
        auditEvents: [auditEvent(s, "ANALYSIS_STARTED", "analysis", id, `${template.name} iniciada para ${clientName(client)}.`), ...s.auditEvents],
      });
      return id;
    },

    sendAnalysisToAgent: (analysisId) => {
      const s = get();
      const a = s.analyses.find((x) => x.id === analysisId);
      if (!a || a.status !== "READY") return;
      const template = s.templates.find((t) => t.id === a.templateId);
      const client = s.clients.find((c) => c.id === a.clientId);
      const agentId = template?.primaryAgentId ?? "agt_triagem";
      set({
        analyses: updateById(s.analyses, analysisId, (x) => ({
          ...x,
          status: "ANALYZING",
          steps: withStep(x, { documents: "DONE", agent: "CURRENT" }),
          timeline: [...x.timeline, timelineEvent(actorOf(s), "Análise enviada ao agente."), timelineEvent(agentActor(s, agentId), "Avaliação do material iniciada.")],
          updatedAt: nowISO(),
        })),
        agentTasks: [
          {
            id: createId("tsk"),
            officeId: s.office.id,
            agentId,
            title: `${template?.name ?? "Análise"} em execução — ${clientName(client)}`,
            status: "RUNNING",
            clientId: a.clientId,
            at: nowISO(),
          },
          ...s.agentTasks,
        ],
        auditEvents: [auditEvent(s, "ANALYSIS_UPDATED", "analysis", analysisId, `Análise de ${clientName(client)} enviada ao agente.`), ...s.auditEvents],
      });
    },

    /**
     * Demonstração: registra o resultado que o agente produziria.
     * Não há IA real nem timer — a conclusão é disparada explicitamente.
     */
    simulateAgentResult: (analysisId) => {
      const s = get();
      const a = s.analyses.find((x) => x.id === analysisId);
      if (!a || a.status !== "ANALYZING") return null;
      const template = s.templates.find((t) => t.id === a.templateId);
      const client = s.clients.find((c) => c.id === a.clientId);
      const agentId = template?.primaryAgentId ?? "agt_triagem";
      const thesisIds = (template?.thesisIds ?? []).slice(0, 2);
      const thesisNames = s.theses.filter((t) => thesisIds.includes(t.id)).map((t) => t.name);
      const reviewId = createId("rev");
      const at = nowISO();
      const name = clientName(client);
      const consulted = s.documents.filter((d) => d.clientId === a.clientId && (d.status === "RECEIVED" || d.status === "PENDING")).map((d) => d.id);
      const review: Review = {
        id: reviewId,
        officeId: s.office.id,
        title: `Parecer preliminar — ${template?.name ?? "Análise"} de ${name}`,
        type: "ANALYSIS_RESULT",
        status: "PENDING",
        priority: "HIGH",
        clientId: a.clientId,
        legalCaseId: a.legalCaseId,
        analysisId,
        agentId,
        skillIds: template?.skillIds ?? [],
        thesisId: thesisIds[0],
        consultedDocumentIds: consulted,
        summary: `O agente avaliou ${consulted.length} documentos e o relato informado, e identificou ${thesisNames.length} tese(s) possivelmente aplicável(is) para revisão do advogado.`,
        evidence: [
          `Instituição informada: ${a.fields.instituicao ?? "não informada"}.`,
          "Documentos obrigatórios conferidos pelo Agente de Documentação.",
          "Dados do contrato comparados com o extrato apresentado.",
        ],
        proposedActions: thesisNames.map((t) => `Avaliar aplicação da tese “${t}”.`).concat("Encaminhar ao Agente de Petições para minuta após aprovação."),
        nextStepOnApproval: "a análise será concluída e o caso ficará pronto para aceite ou rejeição (aceitar exige advogado responsável)",
        content: {
          title: `Parecer preliminar — ${template?.name ?? "Análise"}`,
          sections: [
            { heading: "Contexto", body: a.fields.relato ?? "Relato não informado." },
            { heading: "Documentos analisados", body: `${consulted.length} documentos do cliente foram consultados.` },
            { heading: "Teses possivelmente aplicáveis", body: thesisNames.length ? thesisNames.map((t, i) => `${i + 1}. ${t}`).join("\n") : "Nenhuma tese vigente aplicável." },
            { heading: "Recomendação", body: "Viabilidade preliminar favorável, sujeita à validação do advogado responsável." },
          ],
          disclaimer: DEMO_LEGAL_DISCLAIMER,
        },
        assignedUserId: client?.responsibleUserId,
        createdAt: at,
        dueAt: addDays(now(), 3).toISOString(),
      };
      const notification: Notification = {
        id: createId("ntf"),
        officeId: s.office.id,
        type: "REVIEW_WAITING",
        severity: "info",
        title: "Nova revisão: resultado de análise",
        description: `Parecer preliminar de ${name} aguardando decisão.`,
        at,
        read: false,
        clientId: a.clientId,
        reviewId,
        cta: { label: "Revisar", href: `/revisoes/${reviewId}` },
        requiredPermission: "reviews.view",
      };
      set({
        reviews: [review, ...s.reviews],
        notifications: [notification, ...s.notifications],
        analyses: updateById(s.analyses, analysisId, (x) => ({
          ...x,
          status: "WAITING_REVIEW",
          reviewId,
          result: { summary: review.summary, identifiedThesisIds: thesisIds, recommendation: "Viabilidade preliminar favorável." },
          steps: withStep(x, { agent: "DONE", review: "CURRENT" }),
          timeline: [...x.timeline, timelineEvent(agentActor(s, agentId), "Parecer preliminar concluído e enviado para Revisões.")],
          updatedAt: at,
        })),
        agentTasks: [
          { id: createId("tsk"), officeId: s.office.id, agentId, title: `Análise concluída — ${name}`, status: "WAITING_REVIEW", clientId: a.clientId, reviewId, at },
          ...s.agentTasks.map((t) => (t.clientId === a.clientId && t.status === "RUNNING" && t.agentId === agentId ? { ...t, status: "COMPLETED" as const } : t)),
        ],
        auditEvents: [auditEvent(s, "REVIEW_CREATED", "review", reviewId, `Resultado da análise de ${name} enviado para Revisões.`, agentActor(s, agentId)), ...s.auditEvents],
      });
      return reviewId;
    },

    interruptAnalysis: (analysisId, reason) =>
      set((s) => {
        const a = s.analyses.find((x) => x.id === analysisId);
        const client = s.clients.find((c) => c.id === a?.clientId);
        return {
          analyses: updateById(s.analyses, analysisId, (x) => ({
            ...x,
            status: "INTERRUPTED",
            interruptionReason: reason,
            timeline: [...x.timeline, timelineEvent(actorOf(s), `Análise interrompida: ${reason}`)],
            updatedAt: nowISO(),
          })),
          auditEvents: [auditEvent(s, "ANALYSIS_INTERRUPTED", "analysis", analysisId, `Análise de ${clientName(client)} interrompida.`), ...s.auditEvents],
        };
      }),

    resumeAnalysis: (analysisId) => {
      const s = get();
      const a = s.analyses.find((x) => x.id === analysisId);
      if (!a) return;
      const template = s.templates.find((t) => t.id === a.templateId);
      const client = s.clients.find((c) => c.id === a.clientId);
      if (!template || !client) return;
      const missing = missingDocumentCategories(template, client, s.documents);
      const ready = missing.length === 0;
      set({
        analyses: updateById(s.analyses, analysisId, (x) => ({
          ...x,
          status: ready ? "READY" : "WAITING_DOCUMENTS",
          missingDocuments: missing,
          interruptionReason: undefined,
          steps: withStep(x, { documents: ready ? "DONE" : "BLOCKED", agent: "PENDING", review: "PENDING" }),
          timeline: [...x.timeline, timelineEvent(actorOf(s), ready ? "Análise retomada. Documentação completa." : "Análise retomada. Ainda há documentos pendentes.")],
          updatedAt: nowISO(),
        })),
        auditEvents: [auditEvent(s, "ANALYSIS_UPDATED", "analysis", analysisId, `Análise de ${clientName(client)} retomada.`), ...s.auditEvents],
      });
    },
  };
}
