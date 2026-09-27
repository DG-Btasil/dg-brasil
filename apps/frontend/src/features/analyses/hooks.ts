"use client";

import { useMemo } from "react";
import { useAppStore } from "@/store/app-store";
import type { Agent, AnalysisTemplate, ID, LegalAnalysis, LegalThesis } from "@/types";
import { sortAnalysesByRecent } from "./utils";

export function useTemplates(): AnalysisTemplate[] {
  return useAppStore((s) => s.templates);
}

export function useTemplate(id: ID | undefined): AnalysisTemplate | undefined {
  const templates = useTemplates();
  return useMemo(() => templates.find((t) => t.id === id), [templates, id]);
}

/** Template usado como referência quando não há análise (primeiro ativo). */
export function useReferenceTemplate(): AnalysisTemplate | undefined {
  const templates = useTemplates();
  return useMemo(() => templates.find((t) => t.active) ?? templates[0], [templates]);
}

export function useAllAnalyses(): LegalAnalysis[] {
  return useAppStore((s) => s.analyses);
}

/** Análises do cliente, da mais recente para a mais antiga. */
export function useClientAnalyses(clientId: ID): LegalAnalysis[] {
  const analyses = useAllAnalyses();
  return useMemo(() => sortAnalysesByRecent(analyses.filter((a) => a.clientId === clientId)), [analyses, clientId]);
}

export function useThesisMap(): Map<ID, LegalThesis> {
  const theses = useAppStore((s) => s.theses);
  return useMemo(() => new Map(theses.map((t) => [t.id, t])), [theses]);
}

export function useAgentMap(): Map<ID, Agent> {
  const agents = useAppStore((s) => s.agents);
  return useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
}
