"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SearchInput, Select } from "@/components/ui/form";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/table";
import { EmptyState } from "@/components/feedback/states";
import { useAuditEvents } from "@/features/offices/hooks";
import { formatDateTime } from "@/lib/formatting";
import { AUDIT_ACTIONS, AUDIT_ACTION_LABEL, type AuditAction } from "@/types/audit";
import type { ActorType } from "@/types";

const PAGE = 25;
const ACTOR_LABEL: Record<ActorType, string> = { USER: "Pessoa", AGENT: "Agente", SYSTEM: "Sistema" };

export function AuditLog() {
  const events = useAuditEvents();
  const [action, setAction] = useState<AuditAction | "">("");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...events]
      .sort((a, b) => b.at.localeCompare(a.at))
      .filter((e) => (!action || e.action === action) && (!q || e.description.toLowerCase().includes(q) || e.actor.name.toLowerCase().includes(q)));
  }, [events, action, query]);

  return (
    <Panel>
      <PanelHeader
        title="Registro de auditoria"
        description="Ações relevantes feitas por pessoas, agentes e pelo sistema."
        actions={<span className="text-[12px] text-muted tabular">{filtered.length} eventos</span>}
      />
      <div className="flex flex-wrap items-end gap-3 border-b border-line px-5 py-3">
        <label className="w-[280px]">
          <span className="sr-only">Buscar na auditoria</span>
          <SearchInput
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(PAGE);
            }}
            placeholder="Buscar por descrição ou responsável"
          />
        </label>
        <label className="w-[260px]">
          <span className="sr-only">Filtrar por ação</span>
          <Select
            value={action}
            onChange={(e) => {
              setAction(e.target.value as AuditAction | "");
              setLimit(PAGE);
            }}
            placeholder="Todas as ações"
            options={AUDIT_ACTIONS.map((a) => ({ value: a, label: AUDIT_ACTION_LABEL[a] }))}
          />
        </label>
      </div>
      {filtered.length === 0 ? (
        <EmptyState compact title="Nenhum evento encontrado." description="Ajuste a busca ou o filtro de ação." />
      ) : (
        <>
          <Table caption="Registro de auditoria">
            <THead>
              <tr>
                <Th className="w-[160px]">Data</Th>
                <Th className="w-[200px]">Responsável</Th>
                <Th className="w-[220px]">Ação</Th>
                <Th>Descrição</Th>
              </tr>
            </THead>
            <TBody>
              {filtered.slice(0, limit).map((e) => (
                <Tr key={e.id}>
                  <Td className="tabular text-muted">{formatDateTime(e.at)}</Td>
                  <Td>
                    <span className="text-foreground">{e.actor.name}</span>
                    <span className="ml-1.5 text-[11.5px] text-subtle">{ACTOR_LABEL[e.actor.type]}</span>
                  </Td>
                  <Td>
                    <Badge tone="navy">{AUDIT_ACTION_LABEL[e.action]}</Badge>
                  </Td>
                  <Td className="text-muted">{e.description}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
          {filtered.length > limit && (
            <div className="flex justify-center border-t border-line py-3">
              <Button variant="ghost" size="sm" onClick={() => setLimit((l) => l + PAGE)}>
                Mostrar mais {Math.min(PAGE, filtered.length - limit)} eventos
              </Button>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}
