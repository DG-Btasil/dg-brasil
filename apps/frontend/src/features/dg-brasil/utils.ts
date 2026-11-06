import type { ID } from "@/types";

/**
 * Seções da Central DG Brasil (Roadmap 2.0): "Conexões" abre a área e mostra
 * se a integração do escritório está de pé; "Computador do escritório" e
 * "Integrações" vieram de Configurações.
 */
export const DG_SECTIONS = ["conexoes", "agentes", "execucoes", "computador", "integracoes", "teses", "referencias", "historico"] as const;
export type DgSection = (typeof DG_SECTIONS)[number];

export const DG_SECTION_LABEL: Record<DgSection, string> = {
  conexoes: "Conexões",
  agentes: "Agentes",
  execucoes: "Execuções",
  computador: "Computador do escritório",
  integracoes: "Integrações",
  teses: "Teses",
  referencias: "Referências",
  historico: "Histórico de alterações",
};

export const dgRoutes = {
  home: "/dg-brasil",
  agents: "/dg-brasil?secao=agentes",
  section: (s: DgSection) =>
    s === "conexoes" ? "/dg-brasil" : s === "agentes" || s === "teses" ? `/dg-brasil?secao=${s}` : `/dg-brasil/${s}`,
  agent: (id: ID) => `/dg-brasil/agentes/${id}`,
  thesis: (id: ID) => `/dg-brasil/teses/${id}`,
  historyEntry: (id: ID) => `/dg-brasil/historico#${id}`,
  review: (id: ID) => `/revisoes/${id}`,
  process: (id: ID) => `/processos/${id}`,
  client: (id: ID) => `/clientes/${id}`,
};

export function formatVersion(version: number): string {
  return `v${version}`;
}

export function formatVersionChange(from: number, to: number): string {
  if (from === 0) return `Criação · ${formatVersion(to)}`;
  return from === to ? `${formatVersion(from)} (sem alteração)` : `${formatVersion(from)} → ${formatVersion(to)}`;
}

/** "A, B e C" */
export function joinNames(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
}
