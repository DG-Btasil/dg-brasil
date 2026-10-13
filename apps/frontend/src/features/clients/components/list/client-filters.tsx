"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { SearchInput, Select } from "@/components/ui/form";
import { CLIENT_KINDS, CLIENT_KIND_LABEL, type ClientKind } from "@/lib/constants/status";
import { useDebouncedCallback } from "@/lib/hooks/use-server-list";
import { DEFAULT_CLIENT_QUERY, hasClientFilters, type ClientLifecycle, type ClientListQuery } from "../../list-query";

const LIFECYCLE_OPTIONS: { value: ClientLifecycle; label: string }[] = [
  { value: "active", label: "Ativos" },
  { value: "inactive", label: "Inativos" },
  { value: "all", label: "Todos" },
];

/**
 * Filtros da lista de clientes. Só oferece o que o BACKEND filtra (busca por
 * nome ou CPF/CNPJ, tipo, situação, responsável, origem): nenhum filtro
 * acontece no navegador sobre uma página já baixada.
 */
export function ClientFilters({
  value,
  onChange,
  responsibleOptions,
  originOptions,
  total,
}: {
  value: ClientListQuery;
  onChange: (next: ClientListQuery) => void;
  responsibleOptions: { value: string; label: string }[];
  /** Presente para quem vê parceiros: habilita o filtro de origem. */
  originOptions?: { value: string; label: string }[];
  total: number | undefined;
}) {
  // O campo responde na hora; a consulta sai com atraso (debounce).
  const [search, setSearch] = useState(value.search);
  // Busca trocada por fora (ex.: "Limpar filtros" do estado vazio): o campo acompanha.
  const [synced, setSynced] = useState(value.search);
  if (synced !== value.search) {
    setSynced(value.search);
    if (value.search !== search.trim()) setSearch(value.search);
  }
  const commitSearch = useDebouncedCallback((text: string) => onChange({ ...value, search: text.trim(), page: 1 }));
  const set = <K extends keyof ClientListQuery>(key: K, v: ClientListQuery[K]) => onChange({ ...value, [key]: v, page: 1 });

  return (
    <div className="border-b border-line px-5 py-3.5" role="search" aria-label="Filtrar clientes">
      <div className="grid grid-cols-[minmax(240px,1.6fr)_repeat(3,minmax(0,1fr))] items-center gap-2.5">
        <SearchInput
          aria-label="Buscar por nome, razão social ou CPF/CNPJ"
          placeholder="Nome, razão social ou CPF/CNPJ"
          value={search}
          maxLength={120}
          onChange={(e) => {
            setSearch(e.target.value);
            commitSearch(e.target.value);
          }}
        />
        <Select
          aria-label="Tipo de pessoa"
          placeholder="PF e PJ"
          options={CLIENT_KINDS.map((k) => ({ value: k, label: CLIENT_KIND_LABEL[k] }))}
          value={value.kind}
          onChange={(e) => set("kind", e.target.value as ClientKind | "")}
        />
        <Select aria-label="Responsável" placeholder="Todos os responsáveis" options={responsibleOptions} value={value.responsible} onChange={(e) => set("responsible", e.target.value)} />
        {originOptions ? (
          <Select aria-label="Origem do cliente" placeholder="Todas as origens" options={originOptions} value={value.origin} onChange={(e) => set("origin", e.target.value)} />
        ) : (
          <span />
        )}
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
          {total !== undefined && <span aria-live="polite">{total === 1 ? "1 cliente encontrado" : `${total} clientes encontrados`}</span>}
        </div>
        {hasClientFilters(value) && (
          <Button
            variant="ghost"
            size="sm"
            icon={<X className="size-3.5" aria-hidden />}
            onClick={() => {
              setSearch("");
              onChange({ ...DEFAULT_CLIENT_QUERY, sort: value.sort, direction: value.direction });
            }}
          >
            Limpar filtros
          </Button>
        )}
      </div>
    </div>
  );
}
