/**
 * Regras de visibilidade do PARCEIRO (fonte única, pura).
 *
 * O escritório proprietário (Bárbara Cardoso Advocacia) enxerga tudo. Um
 * escritório parceiro enxerga SOMENTE o que pertence à sua relação com o
 * DG Brasil. Estas funções decidem, registro a registro, o que o parceiro
 * pode receber — e removem campos internos dos registros que ele recebe.
 *
 * `store/scope.ts` aplica estas regras ao estado inteiro antes de qualquer
 * componente ler os dados. No backend, as MESMAS regras devem ser aplicadas
 * no servidor, com o `partnerOfficeId` vindo da sessão (nunca do cliente).
 */
import type { ProcessEventSource } from "@/lib/constants/status";
import type {
  AuditEvent,
  Client,
  ClientDocument,
  ClientOfficeRelationship,
  ID,
  LegalCase,
  Notification,
  Process,
  ProcessEvent,
} from "@/types";

/**
 * Caso visível ao parceiro: SOMENTE pelo acesso operacional
 * (`partnerOrganizationId`). A origem comercial do caso
 * (`originOrganizationId`) e a origem do CLIENTE nunca dão acesso.
 *
 * Exemplo: o parceiro Almeida cria um caso e escolhe a Bárbara (proprietária)
 * como origem → partnerOrganizationId = Almeida, originOrganizationId =
 * Bárbara. O Almeida continua vendo o caso, e não há divisão de parceria
 * (a origem é a proprietária). Já um caso criado pela equipe interna com
 * origem Almeida nasce interno (partnerOrganizationId = null): o Almeida só o
 * vê se a equipe vincular o parceiro explicitamente.
 */
export function partnerCanSeeCase(legalCase: Pick<LegalCase, "partnerOrganizationId">, partnerOfficeId: ID): boolean {
  return legalCase.partnerOrganizationId === partnerOfficeId;
}

/** Processo visível ao parceiro: o do CASO dele (processo sempre pertence a um caso). */
export function partnerCanSeeProcess(process: Pick<Process, "legalCaseId">, visibleCaseIds: ReadonlySet<ID>): boolean {
  return visibleCaseIds.has(process.legalCaseId);
}

/** Cliente com relacionamento ativo com o parceiro. O registro canônico sozinho não dá acesso. */
export function partnerRelatedClientIds(relationships: ClientOfficeRelationship[], partnerOfficeId: ID): Set<ID> {
  return new Set(
    relationships
      .filter((r) => r.officeType === "PARTNER" && r.partnerOfficeId === partnerOfficeId && r.status === "ACTIVE")
      .map((r) => r.clientId),
  );
}

/**
 * Documento visível ao parceiro: precisa estar marcado PARTNER_VISIBLE e
 * ser do próprio parceiro OU pertencer a um caso/processo do parceiro.
 * Documentos INTERNAL nunca são entregues.
 */
export function partnerCanSeeDocument(doc: ClientDocument, partnerOfficeId: ID, visibleCaseIds: ReadonlySet<ID>, visibleProcessIds: ReadonlySet<ID>): boolean {
  if (doc.visibility !== "PARTNER_VISIBLE") return false;
  if (doc.uploadedByPartnerOfficeId === partnerOfficeId) return true;
  if (doc.uploadedByPartnerOfficeId) return false;
  return (!!doc.legalCaseId && visibleCaseIds.has(doc.legalCaseId)) || (!!doc.processId && visibleProcessIds.has(doc.processId));
}

/** Movimentações públicas do processo. Notas internas e registros de agentes ficam de fora. */
const PARTNER_EVENT_SOURCES: readonly ProcessEventSource[] = ["JUDICIAL_INTEGRATION", "IMPORT", "SYSTEM"];
export function partnerCanSeeProcessEvent(event: ProcessEvent, visibleProcessIds: ReadonlySet<ID>): boolean {
  return visibleProcessIds.has(event.processId) && PARTNER_EVENT_SOURCES.includes(event.source);
}

/** Notificação endereçada ao parceiro (as internas não têm partnerOfficeId). */
export function partnerCanSeeNotification(n: Notification, partnerOfficeId: ID): boolean {
  return n.partnerOfficeId === partnerOfficeId;
}

/** Eventos de auditoria com resumo seguro para o parceiro (a auditoria interna nunca é entregue). */
export function partnerCanSeeAuditEvent(e: AuditEvent, partnerOfficeId: ID): boolean {
  return e.partnerOfficeId === partnerOfficeId && !!e.partnerSummary;
}

/* ------------------------------------------------------------------ */
/* Redação de campos internos                                          */
/* ------------------------------------------------------------------ */

/**
 * Remove observações internas, resumo jurídico e histórico de inativação.
 * Origem e escritório de cadastro só são mantidos quando são do próprio
 * parceiro ou do escritório proprietário (nunca revela outro parceiro).
 */
export function redactClientForPartner<C extends Client>(client: C, partnerOfficeId: ID, ownerOfficeId: ID): C {
  const { notes: _notes, legalSummary: _summary, inactivation: _inactivation, originOfficeId, createdByOfficeId, ...rest } = client;
  void _notes;
  void _summary;
  void _inactivation;
  const visible = (id: ID | undefined) => (id === partnerOfficeId || id === ownerOfficeId ? id : undefined);
  return { ...rest, originOfficeId: visible(originOfficeId), createdByOfficeId: visible(createdByOfficeId) } as C;
}

/** Remove notas, resumo interno, tese, análise, integração e estimativas econômicas. */
export function redactProcessForPartner(process: Process): Process {
  const {
    notes: _notes,
    summary: _summary,
    thesisId: _thesis,
    analysisId: _analysis,
    integrationId: _integration,
    economicEstimate: _estimate,
    ...rest
  } = process;
  void [_notes, _summary, _thesis, _analysis, _integration, _estimate];
  return rest;
}

/**
 * Caso sem dados internos: notas, nota interna de rejeição, análise,
 * responsável interno e quem aceitou. O motivo PÚBLICO da rejeição permanece.
 */
export function redactCaseForPartner(legalCase: LegalCase): LegalCase {
  const { notes: _notes, rejectionReasonInternal: _internal, analysisId: _analysis, acceptedBy: _acceptedBy, ...rest } = legalCase;
  void [_notes, _internal, _analysis, _acceptedBy];
  return { ...rest, assignedLawyerId: null };
}

/** Documento sem observações internas. */
export function redactDocumentForPartner(doc: ClientDocument): ClientDocument {
  const { notes: _notes, ...rest } = doc;
  void _notes;
  return rest;
}

/** Auditoria reduzida ao resumo seguro; autoria interna vira o nome do escritório. */
export function redactAuditEventForPartner(e: AuditEvent, ownerOfficeName: string, partnerUserIds: ReadonlySet<ID>): AuditEvent {
  const internalActor = e.actor.type !== "USER" || !partnerUserIds.has(e.actor.id);
  return {
    id: e.id,
    officeId: e.officeId,
    at: e.at,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId,
    partnerOfficeId: e.partnerOfficeId,
    partnerSummary: e.partnerSummary,
    description: e.partnerSummary ?? "",
    actor: internalActor ? { type: "SYSTEM", id: "owner", name: ownerOfficeName } : e.actor,
  };
}
