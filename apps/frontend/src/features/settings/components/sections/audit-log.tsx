"use client";

import { useEffect, useRef, useState } from "react";
import { History } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatDateTime, pluralize } from "@/lib/formatting";
import { callAction, type ActionResult } from "@/lib/actions/result";
import { ActionErrorState } from "@/components/feedback/action-error";
import { EmptyState, SkeletonRows } from "@/components/feedback/states";
import { Badge } from "@/components/ui/badge";
import { Input, Select } from "@/components/ui/form";
import { Pagination } from "@/components/ui/pagination";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/table";
import type { Page } from "@/server/core/pagination";
import { listAuditEventsAction } from "@/server/domain/audit/actions";
import type { AuditEventDTO } from "@/server/domain/audit/dto";
import { ACTOR_TYPE_LABEL, AUDIT_ACTION_LABEL, actionLabel, eventDetail } from "@/features/audit/humanize";

const PAGE_SIZE = 25;
const ACTION_OPTIONS = Object.entries(AUDIT_ACTION_LABEL)
  .map(([value, label]) => ({ value, label }))
  .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
const ACTOR_OPTIONS = (Object.keys(ACTOR_TYPE_LABEL) as AuditEventDTO["actorType"][]).map((value) => ({ value, label: ACTOR_TYPE_LABEL[value] }));

interface Filters {
  action: string;
  actorType: string;
  from: string;
  to: string;
  page: number;
}

/** Período do formulário (datas locais) → limites ISO no fuso de São Paulo. */
const fromIso = (d: string) => (d ? `${d}T00:00:00-03:00` : undefined);
const toIso = (d: string) => (d ? `${d}T23:59:59-03:00` : undefined);

/**
 * Registro de auditoria do escritório (ADMIN, `audit.view`): a trilha do
 * BANCO, paginada e filtrada no servidor (ação, tipo de ator, período). Sem
 * IP, user agent nem texto livre — só o que a metadata sanitizada traz.
 */
export function AuditLog() {
  const [filters, setFilters] = useState<Filters>({ action: "", actorType: "", from: "", to: "", page: 1 });
  const [result, setResult] = useState<ActionResult<Page<AuditEventDTO>> | null>(null);
  const [pending, setPending] = useState(true);
  const seq = useRef(0);

  useEffect(() => {
    const id = ++seq.current;
    callAction(() =>
      listAuditEventsAction({
        action: filters.action || undefined,
        actorType: filters.actorType || undefined,
        from: fromIso(filters.from),
        to: toIso(filters.to),
        page: filters.page,
        pageSize: PAGE_SIZE,
        sortBy: "createdAt",
        sortDirection: "desc",
      }),
    ).then((r) => {
      // Resposta de uma consulta antiga nunca sobrescreve a mais nova.
      if (id !== seq.current) return;
      setResult(r);
      setPending(false);
    });
  }, [filters]);

  // "Carregando" começa no evento (não no efeito); o efeito só busca.
  const set = (patch: Partial<Filters>) => {
    setPending(true);
    setFilters((f) => ({ ...f, ...patch, page: patch.page ?? 1 }));
  };
  const page = result?.ok ? result.data : undefined;

  return (
    <Panel>
      <PanelHeader
        title="Registro de auditoria"
        description="Ações relevantes feitas por pessoas, agentes e pelo sistema, registradas pelo banco."
        actions={page ? <span className="text-[12px] text-muted tabular">{pluralize(page.total, "evento", "eventos")}</span> : undefined}
      />
      <div className="flex flex-wrap items-end gap-3 border-b border-line px-5 py-3" role="search" aria-label="Filtrar auditoria">
        <Select aria-label="Ação" placeholder="Todas as ações" options={ACTION_OPTIONS} value={filters.action} onChange={(e) => set({ action: e.target.value })} className="h-8 w-[260px] text-[12.5px]" />
        <Select aria-label="Tipo de responsável" placeholder="Todos" options={ACTOR_OPTIONS} value={filters.actorType} onChange={(e) => set({ actorType: e.target.value })} className="h-8 w-[160px] text-[12.5px]" />
        <label className="flex items-center gap-2 text-[12.5px] text-muted">
          De
          <Input type="date" aria-label="Data inicial" value={filters.from} onChange={(e) => set({ from: e.target.value })} className="h-8 w-[150px]" />
        </label>
        <label className="flex items-center gap-2 text-[12.5px] text-muted">
          Até
          <Input type="date" aria-label="Data final" value={filters.to} onChange={(e) => set({ to: e.target.value })} className="h-8 w-[150px]" />
        </label>
      </div>
      <div aria-busy={pending || undefined} className={cn("transition-opacity", pending && "opacity-60")}>
        {!result ? (
          <SkeletonRows rows={5} />
        ) : !result.ok ? (
          <ActionErrorState error={result} onRetry={() => set({ page: filters.page })} title="Não foi possível carregar a auditoria." />
        ) : !page || page.items.length === 0 ? (
          <EmptyState compact icon={History} title="Nenhum evento encontrado." description="Ajuste os filtros de ação, responsável ou período." />
        ) : (
          <>
            <Table caption="Registro de auditoria">
              <THead>
                <tr>
                  <Th className="w-[160px]">Data</Th>
                  <Th className="w-[220px]">Responsável</Th>
                  <Th className="w-[240px]">Ação</Th>
                  <Th>Detalhe</Th>
                </tr>
              </THead>
              <TBody>
                {page.items.map((e) => (
                  <Tr key={e.id}>
                    <Td className="tabular text-muted">{formatDateTime(e.at)}</Td>
                    <Td>
                      <span className="text-foreground">{e.actorName ?? "—"}</span>
                      <span className="ml-1.5 text-[11.5px] text-subtle">{ACTOR_TYPE_LABEL[e.actorType]}</span>
                    </Td>
                    <Td>
                      <Badge tone="navy">{actionLabel(e.action)}</Badge>
                    </Td>
                    <Td className="text-muted">
                      {eventDetail(e) ?? "—"}
                      {e.metadataOmitted && <span className="block text-[11.5px] text-subtle">Detalhes em texto livre omitidos</span>}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
            <Pagination page={page.page} pageSize={PAGE_SIZE} total={page.total} disabled={pending} onPageChange={(p) => set({ page: p })} noun={{ one: "evento", many: "eventos" }} />
          </>
        )}
      </div>
    </Panel>
  );
}
