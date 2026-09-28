"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Handshake, Plus, SearchX } from "lucide-react";
import { PARTNER_OFFICE_STATUS_LABEL, PARTNER_OFFICE_STATUS_TONE, type PartnerOfficeStatus } from "@/lib/constants/status";
import { formatEventTime, pluralize } from "@/lib/formatting";
import { Can, PageContainer } from "@/components/layout/guards";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/display";
import { SearchInput } from "@/components/ui/form";
import { Panel } from "@/components/ui/panel";
import { SortableTh, sortBy, Table, TBody, Td, Th, THead, Tr, type SortDirection } from "@/components/ui/table";
import { EmptyState } from "@/components/feedback/states";
import { cn } from "@/lib/cn";
import { usePartnerRows, type PartnerRow } from "../hooks";

type StatusFilter = "ALL" | "ACTIVE" | "INACTIVE" | "PENDING";
const STATUS_FILTERS: { key: StatusFilter; label: string; match: (s: PartnerOfficeStatus) => boolean }[] = [
  { key: "ALL", label: "Todos", match: () => true },
  { key: "ACTIVE", label: "Ativos", match: (s) => s === "ACTIVE" },
  { key: "PENDING", label: "Pendentes", match: (s) => s === "PENDING_INVITE" },
  { key: "INACTIVE", label: "Inativos", match: (s) => s === "INACTIVE" || s === "SUSPENDED" },
];

type SortKey = "name" | "clients" | "processes" | "requests" | "activity";
const GETTERS: Record<SortKey, (r: PartnerRow) => string | number | undefined> = {
  name: (r) => r.partner.name,
  clients: (r) => r.clients,
  processes: (r) => r.activeProcesses,
  requests: (r) => r.openRequests,
  activity: (r) => r.lastActivityAt,
};

function normalize(v: string) {
  return v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Lista de escritórios parceiros (ambiente interno). */
export function PartnerList() {
  const rows = usePartnerRows();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [sortKey, setSortKey] = useState<SortKey>("activity");
  const [direction, setDirection] = useState<SortDirection>("desc");

  const filtered = useMemo(() => {
    const term = normalize(q.trim());
    const matcher = STATUS_FILTERS.find((f) => f.key === status)!.match;
    const list = rows.filter(
      (r) => matcher(r.partner.status) && (!term || normalize(`${r.partner.name} ${r.partner.responsibleName}`).includes(term)),
    );
    return sortBy(list, GETTERS[sortKey], direction);
  }, [rows, q, status, sortKey, direction]);

  function onSort(key: SortKey) {
    if (key === sortKey) setDirection((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setDirection(key === "name" ? "asc" : "desc");
    }
  }
  const th = { currentKey: sortKey, direction, onSort };

  const cta = (
    <Can permission="partners.manage">
      <ButtonLink href="/parceiros/novo" icon={<Plus className="size-4" aria-hidden />}>
        Adicionar parceiro
      </ButtonLink>
    </Can>
  );

  return (
    <PageContainer>
      <PageHeader
        title="Parceiros"
        description="Escritórios que originam casos operados pela Bárbara Cardoso Advocacia. Cada parceiro enxerga apenas os próprios clientes e casos."
        actions={cta}
      />
      {rows.length === 0 ? (
        <Panel>
          <EmptyState icon={Handshake} title="Nenhum parceiro cadastrado." description="Cadastre um escritório parceiro para que ele possa enviar clientes e casos." action={cta} />
        </Panel>
      ) : (
        <Panel>
          <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
            <SearchInput aria-label="Buscar parceiros" placeholder="Buscar por nome ou responsável" value={q} onChange={(e) => setQ(e.target.value)} className="w-[340px]" />
            <div role="group" aria-label="Situação" className="flex rounded-md border border-line p-0.5">
              {STATUS_FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  aria-pressed={status === f.key}
                  onClick={() => setStatus(f.key)}
                  className={cn("rounded-sm px-2.5 py-1 text-[12.5px]", status === f.key ? "bg-navy text-white" : "text-muted hover:text-foreground")}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <p className="ml-auto text-[12.5px] text-muted" aria-live="polite">
              {pluralize(filtered.length, "parceiro", "parceiros")}
            </p>
          </div>
          {filtered.length === 0 ? (
            <EmptyState
              icon={SearchX}
              title="Nenhum parceiro corresponde aos filtros."
              action={
                <Button
                  variant="secondary"
                  onClick={() => {
                    setQ("");
                    setStatus("ALL");
                  }}
                >
                  Limpar filtros
                </Button>
              }
            />
          ) : (
            <Table caption="Escritórios parceiros">
              <THead>
                <tr>
                  <SortableTh label="Escritório" sortKey="name" {...th} />
                  <Th>Responsável</Th>
                  <Th>Situação</Th>
                  <SortableTh label="Clientes" sortKey="clients" {...th} className="text-right" />
                  <SortableTh label="Processos ativos" sortKey="processes" {...th} className="text-right" />
                  <SortableTh label="Pendências" sortKey="requests" {...th} className="text-right" />
                  <SortableTh label="Última atividade" sortKey="activity" {...th} />
                </tr>
              </THead>
              <TBody>
                {filtered.map(({ partner, clients, activeProcesses, openRequests, newCases, lastActivityAt }) => (
                  <Tr key={partner.id} className="hover:bg-navy-50/40">
                    <Td>
                      <Link href={`/parceiros/${partner.id}`} className="font-medium text-navy hover:underline underline-offset-2">
                        {partner.name}
                      </Link>
                      {newCases > 0 && (
                        <Badge tone="gold" className="ml-2">
                          {pluralize(newCases, "caso novo", "casos novos")}
                        </Badge>
                      )}
                    </Td>
                    <Td className="text-[12.5px]">
                      <div className="text-foreground">{partner.responsibleName}</div>
                      <div className="text-[11.5px] text-muted">
                        OAB/{partner.oabState} {partner.responsibleOab}
                      </div>
                    </Td>
                    <Td>
                      <StatusBadge status={partner.status} labels={PARTNER_OFFICE_STATUS_LABEL} tones={PARTNER_OFFICE_STATUS_TONE} />
                    </Td>
                    <Td className="text-right tabular">{clients}</Td>
                    <Td className="text-right tabular">{activeProcesses}</Td>
                    <Td className="text-right tabular">{openRequests ? <span className="font-medium text-warning">{openRequests}</span> : <span className="text-subtle">0</span>}</Td>
                    <Td className="whitespace-nowrap text-[12px] text-muted tabular">{lastActivityAt ? formatEventTime(lastActivityAt) : "—"}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Panel>
      )}
    </PageContainer>
  );
}
