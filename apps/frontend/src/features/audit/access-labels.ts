import { ACCESS_ACTIONS, ACCESS_RESOURCE_TYPES } from "@/server/domain/audit/schemas";

/**
 * Registro de acesso a dado pessoal (LGPD): rótulos do que foi acessado e de
 * como. Os valores são os do sistema (`personal_data_access_events`).
 */

type AccessAction = (typeof ACCESS_ACTIONS)[number];
type AccessResourceType = (typeof ACCESS_RESOURCE_TYPES)[number];

export const ACCESS_ACTION_LABEL: Record<AccessAction, string> = {
  VIEW_DETAIL: "Abriu",
  DOWNLOAD: "Baixou",
  EXPORT: "Exportou",
  PRINT: "Imprimiu",
  ADMIN_ACCESS: "Acesso administrativo",
};

export const ACCESS_RESOURCE_LABEL: Record<AccessResourceType, string> = {
  CLIENT: "Ficha do cliente",
  DOCUMENT: "Documento",
  DOCUMENT_VERSION: "Arquivo de documento",
  LEGAL_CASE: "Caso",
  LEGAL_PROCESS: "Processo",
  EXPORT: "Exportação de dados",
  REPORT: "Relatório",
};

export const ACCESS_ACTION_OPTIONS = ACCESS_ACTIONS.map((value) => ({ value, label: ACCESS_ACTION_LABEL[value] }));
export const ACCESS_RESOURCE_OPTIONS = ACCESS_RESOURCE_TYPES.map((value) => ({ value, label: ACCESS_RESOURCE_LABEL[value] }));

/** "Abriu · Ficha do cliente". Valor novo do sistema sai com texto neutro, nunca o código. */
export function accessSummary(action: string, resourceType: string): string {
  const did = ACCESS_ACTION_LABEL[action as AccessAction] ?? "Acessou";
  const what = ACCESS_RESOURCE_LABEL[resourceType as AccessResourceType] ?? "Dado do cliente";
  return `${did} · ${what}`;
}

/** Período do filtro (datas locais) → limites no fuso de São Paulo. */
export const accessPeriodFrom = (date: string) => (date ? `${date}T00:00:00-03:00` : undefined);
export const accessPeriodTo = (date: string) => (date ? `${date}T23:59:59-03:00` : undefined);

export interface AccessLogFilters {
  clientId: string;
  action: string;
  resourceType: string;
  from: string;
  to: string;
  page: number;
}

export const ACCESS_LOG_PAGE_SIZE = 25;

/** Filtros da tela → entrada de `listPersonalDataAccessEventsAction` (vazio não vai). */
export function accessLogInput(f: AccessLogFilters) {
  return {
    clientId: f.clientId || undefined,
    action: f.action || undefined,
    resourceType: f.resourceType || undefined,
    from: accessPeriodFrom(f.from),
    to: accessPeriodTo(f.to),
    page: f.page,
    pageSize: ACCESS_LOG_PAGE_SIZE,
    sortBy: "createdAt",
    sortDirection: "desc",
  };
}
