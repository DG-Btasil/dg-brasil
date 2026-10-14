import type { ID } from "@/types";

export const DG_SECTIONS = ["agentes", "execucoes", "skills", "teses", "referencias", "historico"] as const;
export type DgSection = (typeof DG_SECTIONS)[number];

export const DG_SECTION_LABEL: Record<DgSection, string> = {
  agentes: "Agentes",
  execucoes: "Execuções",
  skills: "Skills",
  teses: "Teses",
  referencias: "Referências",
  historico: "Histórico de alterações",
};

export const dgRoutes = {
  home: "/dg-brasil",
  section: (s: DgSection) => (s === "agentes" ? "/dg-brasil" : s === "historico" || s === "referencias" || s === "execucoes" ? `/dg-brasil/${s}` : `/dg-brasil?secao=${s}`),
  agent: (id: ID) => `/dg-brasil/agentes/${id}`,
  skill: (id: ID) => `/dg-brasil/skills/${id}`,
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
