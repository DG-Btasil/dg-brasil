/** Consulta da linha do tempo de auditoria de UM registro (servidor e navegador). */

export const AUDIT_TIMELINE_PAGE_SIZE = 25;

export function auditTimelineInput(entityId: string, page = 1) {
  return { entityId, page, pageSize: AUDIT_TIMELINE_PAGE_SIZE, sortBy: "createdAt", sortDirection: "desc" };
}
