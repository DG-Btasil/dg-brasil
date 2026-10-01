"use client";

import { useMemo, useState } from "react";
import { FolderOpen, Plus, SearchX, X } from "lucide-react";
import { LEGAL_AREA_LABEL, LEGAL_AREAS } from "@/lib/constants/legal";
import { LEGAL_CASE_STATUS_LABEL, LEGAL_CASE_STATUSES } from "@/lib/constants/status";
import { pluralize } from "@/lib/formatting";
import { Can, PageContainer } from "@/components/layout/guards";
import { EmptyState } from "@/components/feedback/states";
import { Button, ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/display";
import { SearchInput, Select } from "@/components/ui/form";
import { Panel } from "@/components/ui/panel";
import { usePermission } from "@/features/auth/hooks";
import { usePartnerOptions } from "@/features/partners/hooks";
import { useCaseRows, useEligibleLawyers } from "../hooks";
import { CASE_PERIOD_OPTIONS, countCaseFilters, EMPTY_CASE_FILTERS, filterCaseRows, type CaseFilters } from "../utils";
import { CaseTable } from "./case-table";

interface Option {
  value: string;
  label: string;
}

const statusOptions = LEGAL_CASE_STATUSES.map((s) => ({ value: s, label: LEGAL_CASE_STATUS_LABEL[s] }));
const areaOptions = LEGAL_AREAS.map((a) => ({ value: a, label: LEGAL_AREA_LABEL[a] }));

function FilterSelect({ label, value, options, onChange }: { label: string; value: string; options: readonly Option[]; onChange: (v: string) => void }) {
  return (
    <label className="block min-w-0">
      <span className="sr-only">{label}</span>
      <Select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} options={options} placeholder={label} className="h-8 text-[12.5px]" />
    </label>
  );
}

/** Casos jurídicos (equipe interna): Cliente → Caso → Processo(s). */
export function CaseList() {
  const rows = useCaseRows();
  const lawyers = useEligibleLawyers();
  const partnerOptions = usePartnerOptions();
  const canPartners = usePermission("partners.view");
  const [filters, setFilters] = useState<CaseFilters>(EMPTY_CASE_FILTERS);
  const filtered = useMemo(() => filterCaseRows(rows, filters), [rows, filters]);
  const active = countCaseFilters(filters);
  const set = <K extends keyof CaseFilters>(key: K, value: CaseFilters[K]) => setFilters((f) => ({ ...f, [key]: value }));

  const clientOptions = useMemo(() => {
    const map = new Map(rows.map((r) => [r.legalCase.clientId, r.clientName]));
    return [...map].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  }, [rows]);

  const cta = (
    <Can permission="cases.edit">
      <ButtonLink href="/casos/novo" icon={<Plus className="size-4" aria-hidden />}>
        Novo caso
      </ButtonLink>
    </Can>
  );

  return (
    <PageContainer>
      <PageHeader
        title="Casos"
        description="Cada caso reúne o cliente, a origem, a análise, as revisões, os processos judiciais e o financeiro de uma demanda."
        actions={cta}
      />
      {rows.length === 0 ? (
        <Panel>
          <EmptyState icon={FolderOpen} title="Nenhum caso cadastrado." description="Crie um caso a partir de um cliente ou receba casos enviados pelos parceiros." action={cta} />
        </Panel>
      ) : (
        <Panel>
          <div className="border-b border-line px-5 py-3">
            <div className="flex items-center gap-3">
              <SearchInput
                aria-label="Buscar casos"
                placeholder="Buscar por caso, cliente, tipo ou parte contrária"
                value={filters.q}
                onChange={(e) => set("q", e.target.value)}
                className="w-[420px]"
              />
              <p className="text-[12.5px] text-muted" aria-live="polite">
                {active > 0 ? `${pluralize(filtered.length, "caso encontrado", "casos encontrados")} de ${rows.length}` : pluralize(rows.length, "caso", "casos")}
              </p>
              {active > 0 && (
                <Button variant="ghost" size="sm" className="ml-auto" icon={<X className="size-3.5" aria-hidden />} onClick={() => setFilters(EMPTY_CASE_FILTERS)}>
                  Limpar filtros ({active})
                </Button>
              )}
            </div>
            <div className="mt-2.5 grid grid-cols-4 gap-2">
              <FilterSelect label="Situação" value={filters.status} options={statusOptions} onChange={(v) => set("status", v as CaseFilters["status"])} />
              <FilterSelect label="Área" value={filters.area} options={areaOptions} onChange={(v) => set("area", v as CaseFilters["area"])} />
              <FilterSelect label="Responsável" value={filters.lawyerId} options={lawyers} onChange={(v) => set("lawyerId", v)} />
              <FilterSelect label="Cliente" value={filters.clientId} options={clientOptions} onChange={(v) => set("clientId", v)} />
              {canPartners && (
                <>
                  <FilterSelect
                    label="Origem: todas"
                    value={filters.origin}
                    options={[
                      { value: "INTERNAL", label: "Bárbara Cardoso Advocacia" },
                      { value: "PARTNER", label: "Escritórios parceiros" },
                    ]}
                    onChange={(v) => setFilters((f) => ({ ...f, origin: v as CaseFilters["origin"], partnerOfficeId: v === "INTERNAL" ? "" : f.partnerOfficeId }))}
                  />
                  <FilterSelect
                    label="Parceiro"
                    value={filters.partnerOfficeId}
                    options={partnerOptions}
                    onChange={(v) => setFilters((f) => ({ ...f, partnerOfficeId: v, origin: v ? "PARTNER" : f.origin }))}
                  />
                </>
              )}
              <FilterSelect label="Data de criação" value={filters.period} options={CASE_PERIOD_OPTIONS} onChange={(v) => set("period", v as CaseFilters["period"])} />
            </div>
          </div>
          {filtered.length === 0 ? (
            <EmptyState
              icon={SearchX}
              title="Nenhum caso corresponde aos filtros."
              description="Ajuste a busca ou limpe os filtros."
              action={
                <Button variant="secondary" onClick={() => setFilters(EMPTY_CASE_FILTERS)}>
                  Limpar filtros
                </Button>
              }
            />
          ) : (
            <CaseTable rows={filtered} />
          )}
        </Panel>
      )}
    </PageContainer>
  );
}
