"use client";

import type { ReactNode } from "react";
import { Select } from "@/components/ui/form";
import { CHANGE_ENTITY_LABEL, CHANGE_ENTITY_TYPES, CHANGE_STATUSES, CHANGE_STATUS_LABEL, type ChangeEntityType, type ChangeStatus } from "@/lib/constants/status";

export const PERIODS = ["7", "30", "90", "all"] as const;
export type Period = (typeof PERIODS)[number];
const PERIOD_LABEL: Record<Period, string> = { "7": "Últimos 7 dias", "30": "Últimos 30 dias", "90": "Últimos 90 dias", all: "Todo o período" };

export interface HistoryFilterValue {
  status: ChangeStatus | "";
  entity: ChangeEntityType | "";
  period: Period;
}

export function HistoryFilters({ value, onChange, resultCount }: { value: HistoryFilterValue; onChange: (v: HistoryFilterValue) => void; resultCount: number }) {
  return (
    <div className="flex flex-wrap items-end gap-3 border-b border-line px-5 py-3">
      <FilterField id="hist-status" label="Status">
        <Select
          id="hist-status"
          value={value.status}
          placeholder="Todos os status"
          options={CHANGE_STATUSES.map((s) => ({ value: s, label: CHANGE_STATUS_LABEL[s] }))}
          onChange={(e) => onChange({ ...value, status: e.target.value as ChangeStatus | "" })}
        />
      </FilterField>
      <FilterField id="hist-entity" label="Entidade">
        <Select
          id="hist-entity"
          value={value.entity}
          placeholder="Todas as entidades"
          options={CHANGE_ENTITY_TYPES.map((s) => ({ value: s, label: CHANGE_ENTITY_LABEL[s] }))}
          onChange={(e) => onChange({ ...value, entity: e.target.value as ChangeEntityType | "" })}
        />
      </FilterField>
      <FilterField id="hist-period" label="Período">
        <Select
          id="hist-period"
          value={value.period}
          options={PERIODS.map((p) => ({ value: p, label: PERIOD_LABEL[p] }))}
          onChange={(e) => onChange({ ...value, period: e.target.value as Period })}
        />
      </FilterField>
      <p className="ml-auto pb-2 text-[12px] text-muted" aria-live="polite">
        {resultCount === 1 ? "1 alteração" : `${resultCount} alterações`}
      </p>
    </div>
  );
}

function FilterField({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="w-[200px]">
      <label htmlFor={id} className="mb-1 block text-[11.5px] font-medium text-muted">
        {label}
      </label>
      {children}
    </div>
  );
}
