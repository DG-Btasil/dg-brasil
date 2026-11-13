import { maskDocument } from "@/lib/formatting/masks";
import { can } from "@/lib/permissions";
import type { ServiceContext } from "@/server/core/context";
import type { Page } from "@/server/core/pagination";
import * as cases from "@/server/domain/cases/service";
import type { CaseListItem } from "@/server/domain/cases/dto";
import * as clients from "@/server/domain/clients/service";
import type { ClientListItem } from "@/server/domain/clients/dto";
import * as processes from "@/server/domain/processes/service";
import type { ProcessListItem } from "@/server/domain/processes/dto";
import type { CaseSearchHit, ClientSearchHit, GlobalSearchDTO, ProcessSearchHit, SearchGroup } from "./dto";
import { GLOBAL_SEARCH_GROUP_LIMIT, type GlobalSearchInput } from "./schemas";

/**
 * Busca do cabeçalho: as TRÊS buscas das listas (clientes, casos, processos),
 * cada uma com poucos resultados. Nada de consulta própria: as regras são as
 * dos services das listas — permissão do papel, RLS, e o parceiro vendo só o
 * que é do próprio escritório.
 *
 *   - Cliente: nome; só dígitos = começo do CPF/CNPJ.
 *   - Caso: título ou parte contrária.
 *   - Processo: título (ou do caso); só dígitos = trecho do número CNJ.
 *
 * O texto buscado não é gravado em log nem volta na resposta; o CPF/CNPJ dos
 * clientes achados sai mascarado.
 */

const page = { page: 1, pageSize: GLOBAL_SEARCH_GROUP_LIMIT };
const group = <T, H>(result: Page<T>, hit: (item: T) => H): SearchGroup<H> => ({ items: result.items.map(hit), total: result.total });

export const clientHit = (c: ClientListItem): ClientSearchHit => ({ id: c.id, name: c.name, kind: c.kind, status: c.status, maskedDocument: c.document ? maskDocument(c.document) : "" });
export const caseHit = (c: CaseListItem): CaseSearchHit => ({ id: c.id, title: c.title, clientName: c.clientName, status: c.status });
export const processHit = (p: ProcessListItem): ProcessSearchHit => ({ id: p.id, title: p.title, cnj: p.cnj, clientName: p.clientName, status: p.status });

export async function globalSearch(ctx: ServiceContext, input: GlobalSearchInput): Promise<GlobalSearchDTO> {
  const role = ctx.session.role;
  const q = input.q;
  const [clientPage, casePage, processPage] = await Promise.all([
    can(role, "clients.view") ? clients.listClients(ctx, { ...page, q, column: "display_name", ascending: true }) : undefined,
    can(role, "cases.view") || can(role, "partnerPortal.view") ? cases.listCases(ctx, { ...page, q, column: "updated_at", ascending: false }) : undefined,
    can(role, "processes.view") ? processes.listProcesses(ctx, { ...page, q, column: "updated_at", ascending: false }) : undefined,
  ]);
  return {
    ...(clientPage ? { clients: group(clientPage, clientHit) } : {}),
    ...(casePage ? { cases: group(casePage, caseHit) } : {}),
    ...(processPage ? { processes: group(processPage, processHit) } : {}),
  };
}
