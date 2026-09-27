"use client";

import { useMemo, useState } from "react";
import { ChevronRight, FileSignature, Plus } from "lucide-react";
import { StatusBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { SearchInput, Select } from "@/components/ui/form";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { SortableTh, TBody, THead, Table, Td, Th, Tr, sortBy, type SortDirection } from "@/components/ui/table";
import { EmptyState } from "@/components/feedback/states";
import { AGREEMENT_STATUSES, AGREEMENT_STATUS_LABEL, AGREEMENT_STATUS_TONE, type AgreementStatus } from "@/lib/constants/status";
import { formatCurrency, formatDate } from "@/lib/formatting";
import type { FeeModel } from "@/types";
import type { AgreementRow } from "../utils";
import { AgreementDrawer } from "./agreement-drawer";
import { FeeModelCell, ProcessCell } from "./agreement-summary";

type SortKey = "client" | "total" | "received" | "pending" | "next";
const NO_MODEL = "__none__";

export function AgreementsTable({ rows, feeModels }: { rows: AgreementRow[]; feeModels: FeeModel[] }) {
  const [status, setStatus] = useState<AgreementStatus | "">("");
  const [model, setModel] = useState("");
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey | null>("next");
  const [direction, setDirection] = useState<SortDirection>("asc");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = rows.filter((r) => {
      if (status && r.agreement.status !== status) return false;
      if (model === NO_MODEL && r.agreement.feeModelId) return false;
      if (model && model !== NO_MODEL && r.agreement.feeModelId !== model) return false;
      if (!q) return true;
      return [r.clientName, r.process?.title, r.process?.cnj, r.feeModel?.name].some((v) => v?.toLowerCase().includes(q));
    });
    if (!sortKey) return list;
    const getter: Record<SortKey, (r: AgreementRow) => string | number | undefined> = {
      client: (r) => r.clientName,
      total: (r) => r.agreement.totalContracted,
      received: (r) => r.received,
      pending: (r) => r.outstandingBalance,
      next: (r) => r.nextDueDate,
    };
    return sortBy(list, getter[sortKey], direction);
  }, [rows, status, model, query, sortKey, direction]);

  const selected = useMemo(() => rows.find((r) => r.agreement.id === selectedId) ?? null, [rows, selectedId]);

  function onSort(key: SortKey) {
    if (key === sortKey) setDirection((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setDirection("asc");
    }
  }

  const modelOptions = [...feeModels.map((m) => ({ value: m.id, label: m.name })), { value: NO_MODEL, label: "Sem modelo (valores próprios)" }];
  const sortProps = { currentKey: sortKey, direction, onSort };

  return (
    <Panel>
      <PanelHeader
        title="Contratos de honorários"
        description="Clique em um contrato para ver o cronograma e registrar pagamentos."
        actions={<span className="text-[12px] text-muted tabular">{filtered.length} de {rows.length}</span>}
      />
      {rows.length === 0 ? (
        <EmptyState
          icon={FileSignature}
          title="Nenhum contrato de honorários registrado."
          description="Associe um modelo de honorários a um cliente ou processo para gerar o cronograma de pagamentos."
          action={
            <ButtonLink href="/financeiro/contratos/novo" icon={<Plus className="size-4" aria-hidden />}>
              Novo contrato de honorários
            </ButtonLink>
          }
        />
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3 border-b border-line px-5 py-3">
            <label className="w-[280px]">
              <span className="sr-only">Buscar por cliente, processo ou modelo</span>
              <SearchInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar cliente, processo ou modelo" />
            </label>
            <label className="w-[180px]">
              <span className="sr-only">Filtrar por status</span>
              <Select
                value={status}
                onChange={(e) => setStatus(e.target.value as AgreementStatus | "")}
                placeholder="Todos os status"
                options={AGREEMENT_STATUSES.map((s) => ({ value: s, label: AGREEMENT_STATUS_LABEL[s] }))}
              />
            </label>
            <label className="w-[240px]">
              <span className="sr-only">Filtrar por modelo de honorários</span>
              <Select value={model} onChange={(e) => setModel(e.target.value)} placeholder="Todos os modelos" options={modelOptions} />
            </label>
          </div>
          {filtered.length === 0 ? (
            <EmptyState compact title="Nenhum contrato corresponde aos filtros." description="Ajuste a busca ou limpe os filtros de status e modelo." />
          ) : (
            <Table caption="Contratos de honorários">
              <THead>
                <tr>
                  <SortableTh label="Cliente" sortKey="client" {...sortProps} />
                  <Th>Processo</Th>
                  <Th>Modelo de honorários</Th>
                  <SortableTh label="Contratado" sortKey="total" className="text-right" {...sortProps} />
                  <SortableTh label="Recebido" sortKey="received" className="text-right" {...sortProps} />
                  <SortableTh label="Pendente" sortKey="pending" className="text-right" {...sortProps} />
                  <SortableTh label="Próx. vencimento" sortKey="next" {...sortProps} />
                  <Th>Status</Th>
                  <Th>
                    <span className="sr-only">Abrir</span>
                  </Th>
                </tr>
              </THead>
              <TBody>
                {filtered.map((r) => (
                  <Tr key={r.agreement.id} interactive onClick={() => setSelectedId(r.agreement.id)}>
                    <Td className="font-medium text-foreground">{r.clientName}</Td>
                    <Td className="max-w-[240px] truncate" onClick={(e) => e.stopPropagation()}>
                      <ProcessCell row={r} />
                    </Td>
                    <Td>
                      <FeeModelCell row={r} />
                    </Td>
                    <Td className="text-right tabular">{formatCurrency(r.agreement.totalContracted)}</Td>
                    <Td className="text-right tabular">{formatCurrency(r.received)}</Td>
                    <Td className="text-right tabular">
                      {formatCurrency(r.outstandingBalance)}
                      {r.overdueAmount > 0 && <span className="block text-[11.5px] text-danger">{formatCurrency(r.overdueAmount)} em atraso</span>}
                    </Td>
                    <Td className="tabular text-muted">{r.nextDueDate ? formatDate(r.nextDueDate) : "—"}</Td>
                    <Td>
                      <StatusBadge status={r.agreement.status} labels={AGREEMENT_STATUS_LABEL} tones={AGREEMENT_STATUS_TONE} />
                    </Td>
                    <Td className="text-right">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedId(r.agreement.id);
                        }}
                        aria-label={`Ver cronograma do contrato de ${r.clientName}`}
                        className="rounded-md p-1 text-subtle hover:bg-surface-sunken hover:text-foreground"
                      >
                        <ChevronRight className="size-4" aria-hidden />
                      </button>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </>
      )}
      <AgreementDrawer row={selected} onOpenChange={(open) => !open && setSelectedId(null)} />
    </Panel>
  );
}
