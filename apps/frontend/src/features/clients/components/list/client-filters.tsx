"use client";

import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Checkbox, SearchInput, Select } from "@/components/ui/form";
import {
  ANALYSIS_STATUSES,
  ANALYSIS_STATUS_LABEL,
  CLIENT_KINDS,
  CLIENT_KIND_LABEL,
  CLIENT_STATUSES,
  CLIENT_STATUS_LABEL,
  type AnalysisStatus,
  type ClientKind,
  type ClientStatus,
} from "@/lib/constants/status";
import { onlyDigits } from "@/lib/formatting";
import type { ClientRow } from "../../hooks";
import { clientDocumentRaw } from "../../utils";

export type ClientLifecycleFilter = "active" | "inactive" | "all";

const LIFECYCLE_OPTIONS: { value: ClientLifecycleFilter; label: string }[] = [
  { value: "active", label: "Ativos" },
  { value: "inactive", label: "Inativos" },
  { value: "all", label: "Todos" },
];

export interface ClientFilterState {
  /** Ativos = qualquer status exceto INACTIVE. Inativos continuam pesquisáveis. */
  lifecycle: ClientLifecycleFilter;
  search: string;
  kind: ClientKind | "";
  status: ClientStatus | "";
  responsible: string;
  analysis: AnalysisStatus | "";
  hasProcesses: "" | "yes" | "no";
  pendingDocs: boolean;
}

export const EMPTY_FILTERS: ClientFilterState = {
  lifecycle: "all",
  search: "",
  kind: "",
  status: "",
  responsible: "",
  analysis: "",
  hasProcesses: "",
  pendingDocs: false,
};

export function hasActiveFilters(f: ClientFilterState): boolean {
  return Object.entries(f).some(([k, v]) => v !== EMPTY_FILTERS[k as keyof ClientFilterState]);
}

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function applyClientFilters(rows: ClientRow[], f: ClientFilterState): ClientRow[] {
  const term = normalize(f.search.trim());
  const digits = onlyDigits(f.search);
  return rows.filter(({ client, analysisStatus, activeProcesses, documents }) => {
    if (term) {
      const names =
        client.kind === "INDIVIDUAL" ? [client.fullName, client.socialName] : [client.legalName, client.tradeName];
      const haystack = normalize([...names, client.contact.email].filter(Boolean).join(" "));
      const docMatch = digits.length >= 3 && onlyDigits(clientDocumentRaw(client)).includes(digits);
      if (!haystack.includes(term) && !docMatch) return false;
    }
    if (f.lifecycle === "active" && client.status === "INACTIVE") return false;
    if (f.lifecycle === "inactive" && client.status !== "INACTIVE") return false;
    if (f.kind && client.kind !== f.kind) return false;
    if (f.status && client.status !== f.status) return false;
    if (f.responsible && client.responsibleUserId !== f.responsible) return false;
    if (f.analysis && (analysisStatus ?? "NOT_STARTED") !== f.analysis) return false;
    if (f.hasProcesses === "yes" && activeProcesses === 0) return false;
    if (f.hasProcesses === "no" && activeProcesses > 0) return false;
    if (f.pendingDocs && documents.pending === 0) return false;
    return true;
  });
}

const opts = <K extends string>(keys: readonly K[], labels: Record<K, string>) => keys.map((k) => ({ value: k, label: labels[k] }));

export function ClientFilters({
  value,
  onChange,
  responsibleOptions,
  resultCount,
}: {
  value: ClientFilterState;
  onChange: (next: ClientFilterState) => void;
  responsibleOptions: { value: string; label: string }[];
  resultCount: number;
}) {
  const set = <K extends keyof ClientFilterState>(key: K, v: ClientFilterState[K]) => onChange({ ...value, [key]: v });
  return (
    <div className="border-b border-line px-5 py-3.5" role="search" aria-label="Filtrar clientes">
      <div className="grid grid-cols-[minmax(240px,1.6fr)_repeat(6,minmax(0,1fr))] items-center gap-2.5">
        <SearchInput
          aria-label="Buscar por nome, nome fantasia, CPF/CNPJ ou e-mail"
          placeholder="Nome, CPF/CNPJ ou e-mail"
          value={value.search}
          onChange={(e) => set("search", e.target.value)}
        />
        <Select aria-label="Tipo de pessoa" placeholder="PF e PJ" options={opts(CLIENT_KINDS, CLIENT_KIND_LABEL)} value={value.kind} onChange={(e) => set("kind", e.target.value as ClientKind | "")} />
        <Select aria-label="Status do cliente" placeholder="Todos os status" options={opts(CLIENT_STATUSES, CLIENT_STATUS_LABEL)} value={value.status} onChange={(e) => set("status", e.target.value as ClientStatus | "")} />
        <Select aria-label="Responsável" placeholder="Todos os responsáveis" options={responsibleOptions} value={value.responsible} onChange={(e) => set("responsible", e.target.value)} />
        <Select aria-label="Análise jurídica" placeholder="Qualquer análise" options={opts(ANALYSIS_STATUSES, ANALYSIS_STATUS_LABEL)} value={value.analysis} onChange={(e) => set("analysis", e.target.value as AnalysisStatus | "")} />
        <Select
          aria-label="Possui processos ativos"
          placeholder="Processos: todos"
          options={[
            { value: "yes", label: "Com processos ativos" },
            { value: "no", label: "Sem processos ativos" },
          ]}
          value={value.hasProcesses}
          onChange={(e) => set("hasProcesses", e.target.value as ClientFilterState["hasProcesses"])}
        />
        <Checkbox label="Documentação pendente" checked={value.pendingDocs} onChange={(e) => set("pendingDocs", e.target.checked)} className="items-center" />
      </div>
      <div className="mt-2.5 flex items-center justify-between text-[12px] text-muted">
        <div className="flex items-center gap-3">
          <div role="radiogroup" aria-label="Situação do cadastro" className="inline-flex rounded-md border border-line bg-surface p-0.5">
            {LIFECYCLE_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={value.lifecycle === o.value}
                onClick={() => set("lifecycle", o.value)}
                className={cn(
                  "rounded-[5px] px-2.5 py-1 text-[12px] font-medium transition-colors",
                  value.lifecycle === o.value ? "bg-navy text-white" : "text-muted hover:bg-surface-muted hover:text-foreground",
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
          <span aria-live="polite">
            {resultCount === 1 ? "1 cliente encontrado" : `${resultCount} clientes encontrados`}
          </span>
        </div>
        {hasActiveFilters(value) && (
          <Button variant="ghost" size="sm" icon={<X className="size-3.5" aria-hidden />} onClick={() => onChange(EMPTY_FILTERS)}>
            Limpar filtros
          </Button>
        )}
      </div>
    </div>
  );
}
