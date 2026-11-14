"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Eye } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatDateTime, maskCNPJ, maskCPF, pluralize } from "@/lib/formatting";
import { callAction, type ActionResult } from "@/lib/actions/result";
import { ActionErrorState } from "@/components/feedback/action-error";
import { EmptyState, SkeletonRows } from "@/components/feedback/states";
import { AsyncPicker, type PickerOption } from "@/components/ui/async-picker";
import { Input, Select } from "@/components/ui/form";
import { Pagination } from "@/components/ui/pagination";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/table";
import type { Page } from "@/server/core/pagination";
import { listPersonalDataAccessEventsAction } from "@/server/domain/audit/actions";
import type { PersonalDataAccessEventDTO } from "@/server/domain/audit/dto";
import { listClientsAction } from "@/server/domain/clients/actions";
import { ACCESS_ACTION_OPTIONS, ACCESS_LOG_PAGE_SIZE, ACCESS_RESOURCE_OPTIONS, accessLogInput, accessSummary, type AccessLogFilters } from "@/features/audit/access-labels";
import { ACTOR_TYPE_LABEL } from "@/features/audit/humanize";

/** Busca de clientes para o filtro (qualquer situação; no máximo 10 por vez; servidor + RLS). */
async function searchClients(q: string): Promise<{ ok: true; options: PickerOption[] } | { ok: false; message: string }> {
  const result = await callAction(() => listClientsAction({ q: q.trim() || undefined, pageSize: 10, sortBy: "name", sortDirection: "asc" }));
  if (!result.ok) return { ok: false, message: result.error.message };
  return {
    ok: true,
    options: result.data.items.map((c) => ({ id: c.id, label: c.name, description: c.kind === "INDIVIDUAL" ? maskCPF(c.document) : maskCNPJ(c.document) })),
  };
}

/**
 * Acessos a dados pessoais (LGPD), só Administrador (`audit.view`): quem abriu
 * a ficha de um cliente, baixou um documento ou exportou dados, e quando. O
 * registro é gravado pelo sistema a cada acesso e não pode ser alterado. Sem
 * IP nem navegador: só quem, o quê, quando e a finalidade declarada.
 */
export function PersonalDataAccessLog() {
  const [filters, setFilters] = useState<AccessLogFilters>({ clientId: "", action: "", resourceType: "", from: "", to: "", page: 1 });
  const [client, setClient] = useState<PickerOption | null>(null);
  const [result, setResult] = useState<ActionResult<Page<PersonalDataAccessEventDTO>> | null>(null);
  const [pending, setPending] = useState(true);
  const seq = useRef(0);

  useEffect(() => {
    const id = ++seq.current;
    callAction(() => listPersonalDataAccessEventsAction(accessLogInput(filters))).then((r) => {
      // Resposta de uma consulta antiga nunca sobrescreve a mais nova.
      if (id !== seq.current) return;
      setResult(r);
      setPending(false);
    });
  }, [filters]);

  // "Carregando" começa no evento (não no efeito); o efeito só busca.
  const set = (patch: Partial<AccessLogFilters>) => {
    setPending(true);
    setFilters((f) => ({ ...f, ...patch, page: patch.page ?? 1 }));
  };
  const page = result?.ok ? result.data : undefined;

  return (
    <Panel>
      <PanelHeader
        title="Acessos a dados pessoais (LGPD)"
        description="Quem abriu a ficha de cada cliente, baixou documento ou exportou dados. Registrado automaticamente a cada acesso."
        actions={page ? <span className="text-[12px] text-muted tabular">{pluralize(page.total, "acesso", "acessos")}</span> : undefined}
      />
      <div className="flex flex-wrap items-end gap-3 border-b border-line px-5 py-3" role="search" aria-label="Filtrar acessos a dados pessoais">
        <div className="w-[320px]">
          <AsyncPicker
            value={client}
            search={searchClients}
            placeholder="Filtrar por cliente"
            emptyText="Nenhum cliente encontrado."
            onChange={(o) => {
              setClient(o);
              set({ clientId: o?.id ?? "" });
            }}
          />
        </div>
        <Select aria-label="O que foi feito" placeholder="Todos os acessos" options={ACCESS_ACTION_OPTIONS} value={filters.action} onChange={(e) => set({ action: e.target.value })} className="h-9 w-[190px] text-[12.5px]" />
        <Select aria-label="O que foi acessado" placeholder="Todos os dados" options={ACCESS_RESOURCE_OPTIONS} value={filters.resourceType} onChange={(e) => set({ resourceType: e.target.value })} className="h-9 w-[200px] text-[12.5px]" />
        <label className="flex items-center gap-2 text-[12.5px] text-muted">
          De
          <Input type="date" aria-label="Data inicial" value={filters.from} onChange={(e) => set({ from: e.target.value })} className="h-9 w-[150px]" />
        </label>
        <label className="flex items-center gap-2 text-[12.5px] text-muted">
          Até
          <Input type="date" aria-label="Data final" value={filters.to} onChange={(e) => set({ to: e.target.value })} className="h-9 w-[150px]" />
        </label>
      </div>
      <div aria-busy={pending || undefined} className={cn("transition-opacity", pending && "opacity-60")}>
        {!result ? (
          <SkeletonRows rows={5} />
        ) : !result.ok ? (
          <ActionErrorState error={result} onRetry={() => set({ page: filters.page })} title="Não foi possível carregar os acessos." />
        ) : !page || page.items.length === 0 ? (
          <EmptyState compact icon={Eye} title="Nenhum acesso encontrado." description="Ajuste o cliente, o tipo de acesso ou o período." />
        ) : (
          <>
            <Table caption="Acessos a dados pessoais">
              <THead>
                <tr>
                  <Th className="w-[160px]">Data</Th>
                  <Th className="w-[240px]">Quem acessou</Th>
                  <Th className="w-[260px]">Acesso</Th>
                  <Th className="w-[230px]">Cliente</Th>
                  <Th>Finalidade</Th>
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
                    <Td className="text-foreground">{accessSummary(e.action, e.resourceType)}</Td>
                    <Td>
                      {/* Abrir a ficha por aqui também fica registrado como acesso. */}
                      <Link href={`/clientes/${e.clientId}`} className="block max-w-[220px] truncate text-[12.5px] font-medium text-navy hover:underline underline-offset-2" title={e.clientName ? `Abrir a ficha de ${e.clientName}` : "Abrir ficha"}>
                        {e.clientName ?? "Abrir ficha"}
                      </Link>
                    </Td>
                    <Td className="text-muted">{e.purpose ?? "—"}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
            <Pagination page={page.page} pageSize={ACCESS_LOG_PAGE_SIZE} total={page.total} disabled={pending} onPageChange={(p) => set({ page: p })} noun={{ one: "acesso", many: "acessos" }} />
          </>
        )}
      </div>
    </Panel>
  );
}
