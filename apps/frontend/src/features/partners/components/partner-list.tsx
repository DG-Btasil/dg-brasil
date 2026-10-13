"use client";

import Link from "next/link";
import { useState } from "react";
import { Handshake, Plus, SearchX } from "lucide-react";
import { PARTNER_OFFICE_STATUS_LABEL, PARTNER_OFFICE_STATUS_TONE, type PartnerOfficeStatus } from "@/lib/constants/status";
import { cn } from "@/lib/cn";
import { formatCNPJ, pluralize } from "@/lib/formatting";
import type { ActionResult } from "@/lib/actions/result";
import { useDebouncedCallback, useServerList } from "@/lib/hooks/use-server-list";
import { Can, PageContainer } from "@/components/layout/guards";
import { ActionErrorState } from "@/components/feedback/action-error";
import { EmptyState, SkeletonRows } from "@/components/feedback/states";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/display";
import { SearchInput } from "@/components/ui/form";
import { Pagination } from "@/components/ui/pagination";
import { Panel } from "@/components/ui/panel";
import { SortableTh, Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import type { Page } from "@/server/core/pagination";
import { listPartnersAction } from "@/server/domain/organizations/actions";
import type { PartnerListItem } from "@/server/domain/organizations/dto";
import { usePermission } from "@/features/auth/hooks";
import { DEFAULT_PARTNER_QUERY, PARTNER_PAGE_SIZE, partnerQueryToInput, partnerQueryToSearchParams, type PartnerListQuery } from "../list-query";

const STATUS_FILTERS: { key: PartnerOfficeStatus | ""; label: string }[] = [
  { key: "", label: "Todos" },
  { key: "ACTIVE", label: "Ativos" },
  { key: "PENDING_INVITE", label: "Pendentes" },
  { key: "SUSPENDED", label: "Suspensos" },
  { key: "INACTIVE", label: "Inativos" },
];

/** Escritórios parceiros (equipe interna), com busca, situação, ordem e páginas no servidor. */
export function PartnerList({ initialQuery, initialResult }: { initialQuery: PartnerListQuery; initialResult: ActionResult<Page<PartnerListItem>> }) {
  const { query, setQuery, result, pending, retry } = useServerList({
    initialQuery,
    initialResult,
    load: (q: PartnerListQuery) => listPartnersAction(partnerQueryToInput(q)),
    toSearch: partnerQueryToSearchParams,
  });
  const canFinance = usePermission("partners.finance.view");
  const [search, setSearch] = useState(query.search);
  const commitSearch = useDebouncedCallback((text: string) => setQuery({ ...query, search: text.trim(), page: 1 }));
  const page = result.ok ? result.data : undefined;
  const filtered = !!query.search || !!query.status;

  function onSort(key: PartnerListQuery["sort"]) {
    const direction = key === query.sort ? (query.direction === "asc" ? "desc" : "asc") : key === "name" ? "asc" : "desc";
    setQuery({ ...query, sort: key, direction, page: 1 });
  }
  const th = { currentKey: query.sort, direction: query.direction, onSort };

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
        description="Escritórios que originam casos operados pelo escritório. Cada parceiro enxerga apenas os próprios clientes e casos."
        actions={cta}
      />
      {page && page.total === 0 && !filtered ? (
        <Panel>
          <EmptyState icon={Handshake} title="Nenhum parceiro cadastrado." description="Cadastre um escritório parceiro para que ele possa enviar clientes e casos." action={cta} />
        </Panel>
      ) : (
        <Panel>
          <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3" role="search" aria-label="Filtrar parceiros">
            <SearchInput
              aria-label="Buscar parceiros por nome ou CNPJ"
              placeholder="Buscar por nome ou CNPJ"
              value={search}
              maxLength={120}
              onChange={(e) => {
                setSearch(e.target.value);
                commitSearch(e.target.value);
              }}
              className="w-[340px]"
            />
            <div role="group" aria-label="Situação" className="flex rounded-md border border-line p-0.5">
              {STATUS_FILTERS.map((f) => (
                <button
                  key={f.key || "all"}
                  type="button"
                  aria-pressed={query.status === f.key}
                  onClick={() => setQuery({ ...query, status: f.key, page: 1 })}
                  className={cn("rounded-sm px-2.5 py-1 text-[12.5px]", query.status === f.key ? "bg-navy text-white" : "text-muted hover:text-foreground")}
                >
                  {f.label}
                </button>
              ))}
            </div>
            {page && (
              <p className="ml-auto text-[12.5px] text-muted" aria-live="polite">
                {pluralize(page.total, "parceiro", "parceiros")}
              </p>
            )}
          </div>
          <div aria-busy={pending || undefined} className={cn("transition-opacity", pending && "opacity-60")}>
            {!result.ok ? (
              <ActionErrorState error={result} onRetry={retry} title="Não foi possível carregar os parceiros." />
            ) : !page ? (
              <SkeletonRows rows={5} />
            ) : page.items.length === 0 ? (
              <EmptyState
                icon={SearchX}
                title="Nenhum parceiro corresponde aos filtros."
                action={
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setSearch("");
                      setQuery({ ...DEFAULT_PARTNER_QUERY, sort: query.sort, direction: query.direction });
                    }}
                  >
                    Limpar filtros
                  </Button>
                }
              />
            ) : (
              <>
                <Table caption="Escritórios parceiros">
                  <THead>
                    <tr>
                      <SortableTh label="Escritório" sortKey="name" {...th} />
                      <Th>Contato</Th>
                      <SortableTh label="Situação" sortKey="status" {...th} />
                      {canFinance && <Th>Divisão padrão</Th>}
                      <Th className="text-right">Clientes</Th>
                      <Th className="text-right">Casos ativos</Th>
                      <Th className="text-right">Pendências</Th>
                    </tr>
                  </THead>
                  <TBody>
                    {page.items.map((p) => (
                      <Tr key={p.id} className="hover:bg-navy-50/40">
                        <Td>
                          <Link href={`/parceiros/${p.id}`} className="font-medium text-navy hover:underline underline-offset-2">
                            {p.name}
                          </Link>
                          {!!p.stats?.newCases && (
                            <Badge tone="gold" className="ml-2">
                              {pluralize(p.stats.newCases, "caso novo", "casos novos")}
                            </Badge>
                          )}
                          {p.cnpj && <div className="text-[11.5px] text-muted tabular">{formatCNPJ(p.cnpj)}</div>}
                        </Td>
                        <Td className="text-[12.5px] text-muted">{p.email ?? "—"}</Td>
                        <Td>
                          <StatusBadge status={p.status} labels={PARTNER_OFFICE_STATUS_LABEL} tones={PARTNER_OFFICE_STATUS_TONE} />
                        </Td>
                        {canFinance && (
                          <Td className="whitespace-nowrap text-[12.5px] tabular">{p.share ? `${p.share.partnershipPercentage}% / ${p.share.ownerPercentage}%` : "—"}</Td>
                        )}
                        <Td className="text-right tabular">{p.stats?.clients ?? "—"}</Td>
                        <Td className="text-right tabular">{p.stats?.activeCases ?? "—"}</Td>
                        <Td className="text-right tabular">
                          {p.stats?.openRequests ? <span className="font-medium text-warning">{p.stats.openRequests}</span> : <span className="text-subtle">0</span>}
                        </Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
                <Pagination page={page.page} pageSize={PARTNER_PAGE_SIZE} total={page.total} disabled={pending} onPageChange={(n) => setQuery({ ...query, page: n })} noun={{ one: "parceiro", many: "parceiros" }} />
              </>
            )}
          </div>
        </Panel>
      )}
    </PageContainer>
  );
}
