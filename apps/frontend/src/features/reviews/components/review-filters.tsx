"use client";

import { X } from "lucide-react";
import { REVIEW_STATUS_LABEL, REVIEW_STATUSES, REVIEW_TYPE_LABEL, REVIEW_TYPES } from "@/lib/constants/status";
import { Button } from "@/components/ui/button";
import { Checkbox, Select } from "@/components/ui/form";
import { countReviewFilters, DATE_RANGE_LABEL, DATE_RANGES, EMPTY_REVIEW_FILTERS, type ReviewFilters as Filters } from "../utils";

interface Option {
  value: string;
  label: string;
}

const typeOptions = REVIEW_TYPES.map((t) => ({ value: t, label: REVIEW_TYPE_LABEL[t] }));
const statusOptions = REVIEW_STATUSES.map((s) => ({ value: s, label: REVIEW_STATUS_LABEL[s] }));
const dateOptions = DATE_RANGES.map((d) => ({ value: d, label: DATE_RANGE_LABEL[d] }));

function FilterSelect({ label, value, options, onChange }: { label: string; value: string; options: readonly Option[]; onChange: (v: string) => void }) {
  return <Select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} options={options} placeholder={label} className="h-8 text-[12.5px]" />;
}

export function ReviewFilters({
  filters,
  onChange,
  agentOptions,
  processOptions,
  clientOptions,
  userOptions,
  partnerOptions,
  showStatus,
}: {
  filters: Filters;
  onChange: (f: Filters) => void;
  agentOptions: Option[];
  processOptions: Option[];
  clientOptions: Option[];
  userOptions: Option[];
  /** "Interno / Bárbara" + parceiros ativos. Ausente = filtro oculto. */
  partnerOptions?: Option[];
  showStatus: boolean;
}) {
  const active = countReviewFilters(filters);
  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => onChange({ ...filters, [key]: value });

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
      <Checkbox
        label="Somente urgentes"
        checked={filters.urgentOnly}
        onChange={(e) => set("urgentOnly", e.target.checked)}
        className="mr-2 items-center"
      />
      <div className="grid flex-1 grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
        <FilterSelect label="Tipo" value={filters.type} options={typeOptions} onChange={(v) => set("type", v as Filters["type"])} />
        <FilterSelect label="Agente" value={filters.agentId} options={agentOptions} onChange={(v) => set("agentId", v)} />
        <FilterSelect label="Cliente" value={filters.clientId} options={clientOptions} onChange={(v) => set("clientId", v)} />
        <FilterSelect label="Processo" value={filters.processId} options={processOptions} onChange={(v) => set("processId", v)} />
        <FilterSelect label="Responsável" value={filters.assignedUserId} options={userOptions} onChange={(v) => set("assignedUserId", v)} />
        {partnerOptions && (
          <FilterSelect label="Escritório parceiro" value={filters.partnerOfficeId} options={partnerOptions} onChange={(v) => set("partnerOfficeId", v)} />
        )}
        <FilterSelect label="Período" value={filters.dateRange} options={dateOptions} onChange={(v) => set("dateRange", v as Filters["dateRange"])} />
        {showStatus && <FilterSelect label="Status" value={filters.status} options={statusOptions} onChange={(v) => set("status", v as Filters["status"])} />}
      </div>
      {active > 0 && (
        <Button variant="ghost" size="sm" icon={<X className="size-3.5" aria-hidden />} onClick={() => onChange(EMPTY_REVIEW_FILTERS)}>
          Limpar ({active})
        </Button>
      )}
    </div>
  );
}
