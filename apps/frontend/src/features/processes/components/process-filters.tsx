"use client";

import { X } from "lucide-react";
import {
  PROCESS_ORIGIN_LABEL,
  PROCESS_ORIGINS,
  PROCESS_PHASE_LABEL,
  PROCESS_PHASES,
  PROCESS_STATUS_LABEL,
  PROCESS_STATUSES,
  RELATIONSHIP_ORIGIN_LABEL,
  RELATIONSHIP_ORIGINS,
} from "@/lib/constants/status";
import { COURTS } from "@/lib/constants/legal";
import { pluralize } from "@/lib/formatting";
import { Button } from "@/components/ui/button";
import { SearchInput, Select } from "@/components/ui/form";
import { countActiveFilters, DEADLINE_FILTER_LABEL, EMPTY_PROCESS_FILTERS, DEADLINE_FILTERS, type ProcessFilters as Filters } from "../utils";

interface Option {
  value: string;
  label: string;
}

const statusOptions = PROCESS_STATUSES.map((s) => ({ value: s, label: PROCESS_STATUS_LABEL[s] }));
const caseOriginOptions = RELATIONSHIP_ORIGINS.map((o) => ({ value: o, label: RELATIONSHIP_ORIGIN_LABEL[o] }));
const originOptions = PROCESS_ORIGINS.map((o) => ({ value: o, label: PROCESS_ORIGIN_LABEL[o] }));
const phaseOptions = PROCESS_PHASES.map((p) => ({ value: p, label: PROCESS_PHASE_LABEL[p] }));
const deadlineOptions = DEADLINE_FILTERS.map((d) => ({ value: d, label: DEADLINE_FILTER_LABEL[d] }));
const courtOptions = COURTS.map((c) => ({ value: c, label: c }));

function FilterSelect({ label, value, options, onChange }: { label: string; value: string; options: readonly Option[]; onChange: (v: string) => void }) {
  return (
    <label className="block min-w-0">
      <span className="sr-only">{label}</span>
      <Select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} options={options} placeholder={label} className="h-8 text-[12.5px]" />
    </label>
  );
}

export function ProcessFilters({
  filters,
  onChange,
  clientOptions,
  responsibleOptions,
  resultCount,
  total,
  partnerOptions,
}: {
  filters: Filters;
  onChange: (next: Filters) => void;
  clientOptions: Option[];
  responsibleOptions: Option[];
  resultCount: number;
  total: number;
  /** Presente para quem vê parceiros: habilita os filtros de origem do caso. */
  partnerOptions?: Option[];
}) {
  const active = countActiveFilters(filters);
  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => onChange({ ...filters, [key]: value });

  return (
    <div className="border-b border-line px-5 py-3">
      <div className="flex items-center gap-3">
        <SearchInput
          aria-label="Buscar processos"
          placeholder="Buscar por número CNJ, título, cliente ou parte contrária"
          value={filters.q}
          onChange={(e) => set("q", e.target.value)}
          className="w-[420px]"
        />
        <p className="text-[12.5px] text-muted" aria-live="polite">
          {active > 0 ? `${pluralize(resultCount, "processo encontrado", "processos encontrados")} de ${total}` : pluralize(total, "processo", "processos")}
        </p>
        {active > 0 && (
          <Button variant="ghost" size="sm" className="ml-auto" icon={<X className="size-3.5" aria-hidden />} onClick={() => onChange(EMPTY_PROCESS_FILTERS)}>
            Limpar filtros ({active})
          </Button>
        )}
      </div>
      <div className="mt-2.5 grid grid-cols-5 gap-2">
        <FilterSelect label="Cliente" value={filters.clientId} options={clientOptions} onChange={(v) => set("clientId", v)} />
        <FilterSelect label="Responsável" value={filters.responsibleUserId} options={responsibleOptions} onChange={(v) => set("responsibleUserId", v)} />
        <FilterSelect label="Tribunal" value={filters.court} options={courtOptions} onChange={(v) => set("court", v)} />
        <FilterSelect label="Status" value={filters.status} options={statusOptions} onChange={(v) => set("status", v as Filters["status"])} />
        <FilterSelect label="Fase" value={filters.phase} options={phaseOptions} onChange={(v) => set("phase", v as Filters["phase"])} />
        <FilterSelect label="Prazo" value={filters.deadline} options={deadlineOptions} onChange={(v) => set("deadline", v as Filters["deadline"])} />
        <FilterSelect label="Origem do cadastro" value={filters.origin} options={originOptions} onChange={(v) => set("origin", v as Filters["origin"])} />
        {partnerOptions && (
          <>
            <FilterSelect
              label="Origem do caso: todos"
              value={filters.caseOrigin}
              options={caseOriginOptions}
              onChange={(v) => onChange({ ...filters, caseOrigin: v as Filters["caseOrigin"], partnerOfficeId: v === "INTERNAL" ? "" : filters.partnerOfficeId })}
            />
            <FilterSelect
              label="Escritório parceiro"
              value={filters.partnerOfficeId}
              options={partnerOptions}
              onChange={(v) => onChange({ ...filters, partnerOfficeId: v, caseOrigin: v ? "PARTNER" : filters.caseOrigin })}
            />
          </>
        )}
      </div>
    </div>
  );
}

