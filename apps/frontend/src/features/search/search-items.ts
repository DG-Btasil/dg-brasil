import { CLIENT_KIND_SHORT, CLIENT_STATUS_LABEL, LEGAL_CASE_STATUS_LABEL, PROCESS_STATUS_LABEL } from "@/lib/constants/status";
import { formatCNJ } from "@/lib/formatting/masks";
import type { GlobalSearchDTO } from "@/server/domain/search/dto";

/** Resultado da busca do cabeçalho → grupos e itens prontos para a tela (puro, testado). */

export type SearchGroupKey = "clients" | "cases" | "processes";

export interface SearchItem {
  key: string;
  group: SearchGroupKey;
  href: string;
  title: string;
  /** Linha de apoio: documento mascarado, cliente, número CNJ, situação. */
  detail: string;
}

export interface SearchGroupView {
  key: SearchGroupKey;
  label: string;
  items: SearchItem[];
  total: number;
  /** Lista completa já filtrada, quando a busca pode ir para a URL (sem dígitos). */
  allHref?: string;
}

const GROUP_LABEL: Record<SearchGroupKey, string> = { clients: "Clientes", cases: "Casos", processes: "Processos" };
const LIST_HREF: Record<SearchGroupKey, string> = { clients: "/clientes", cases: "/casos", processes: "/processos" };

const join = (...parts: (string | undefined)[]) => parts.filter((p) => p && p.trim()).join(" · ");

/**
 * Busca com dígitos (CPF/CNPJ, número CNJ) NUNCA vai para a URL, nem para o
 * histórico: é a mesma regra das listas (`?busca=` só sem dígitos).
 */
export const isUrlSafeSearch = (text: string) => !/\d/.test(text);

export function searchGroups(result: GlobalSearchDTO, text: string): SearchGroupView[] {
  const q = text.trim();
  const allHref = (group: SearchGroupKey) => (q && isUrlSafeSearch(q) ? `${LIST_HREF[group]}?busca=${encodeURIComponent(q)}` : undefined);
  const groups: SearchGroupView[] = [];
  if (result.clients) {
    groups.push({
      key: "clients",
      label: GROUP_LABEL.clients,
      total: result.clients.total,
      allHref: allHref("clients"),
      items: result.clients.items.map((c) => ({
        key: `clients:${c.id}`,
        group: "clients",
        href: `/clientes/${c.id}`,
        title: c.name || "(sem nome)",
        detail: join(CLIENT_KIND_SHORT[c.kind], c.maskedDocument, c.status === "ACTIVE" ? undefined : CLIENT_STATUS_LABEL[c.status]),
      })),
    });
  }
  if (result.cases) {
    groups.push({
      key: "cases",
      label: GROUP_LABEL.cases,
      total: result.cases.total,
      allHref: allHref("cases"),
      items: result.cases.items.map((c) => ({
        key: `cases:${c.id}`,
        group: "cases",
        href: `/casos/${c.id}`,
        title: c.title,
        detail: join(c.clientName, LEGAL_CASE_STATUS_LABEL[c.status]),
      })),
    });
  }
  if (result.processes) {
    groups.push({
      key: "processes",
      label: GROUP_LABEL.processes,
      total: result.processes.total,
      allHref: allHref("processes"),
      items: result.processes.items.map((p) => ({
        key: `processes:${p.id}`,
        group: "processes",
        href: `/processos/${p.id}`,
        title: p.title,
        detail: join(p.cnj ? formatCNJ(p.cnj) : "Sem número", p.clientName, PROCESS_STATUS_LABEL[p.status]),
      })),
    });
  }
  return groups;
}

/** Itens na ordem da tela (para as setas do teclado). */
export const flatItems = (groups: readonly SearchGroupView[]): SearchItem[] => groups.flatMap((g) => g.items);

/** Próximo item ao andar com as setas: dá a volta nas pontas. */
export function moveIndex(current: number, delta: 1 | -1, count: number): number {
  if (count === 0) return -1;
  if (current < 0) return delta === 1 ? 0 : count - 1;
  return (current + delta + count) % count;
}
