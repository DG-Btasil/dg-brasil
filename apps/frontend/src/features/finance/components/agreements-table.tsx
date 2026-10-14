"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronRight, FileSignature, Plus } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatCurrency, formatDate, pluralize } from "@/lib/formatting";
import type { ActionResult } from "@/lib/actions/result";
import { useServerList } from "@/lib/hooks/use-server-list";
import { Can } from "@/components/layout/guards";
import { ActionErrorState } from "@/components/feedback/action-error";
import { EmptyState, SkeletonRows } from "@/components/feedback/states";
import { StatusBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { Pagination } from "@/components/ui/pagination";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/table";
import type { Page } from "@/server/core/pagination";
import { listAgreementRowsAction } from "@/server/domain/finance/actions";
import type { AgreementListItemDTO } from "@/server/domain/finance/dto";
import { AGREEMENT_DB_STATUSES } from "@/server/domain/finance/schemas";
import { AGREEMENT_DB_STATUS_LABEL, AGREEMENT_DB_STATUS_TONE } from "../labels";
import { AGREEMENT_PAGE_SIZE, agreementQueryToInput, agreementQueryToSearchParams, type AgreementListQuery } from "../list-query";
import { AgreementDrawer } from "./agreement-drawer";

const STATUS_OPTIONS = AGREEMENT_DB_STATUSES.map((s) => ({ value: s, label: AGREEMENT_DB_STATUS_LABEL[s] }));

/**
 * Acordos de honorários (ADMIN) lidos do servidor: situação e páginas no
 * banco; contratado/recebido/em aberto vêm do ledger, somados no servidor.
 * Clique abre a gaveta com obrigações e lançamentos.
 */
export function AgreementsPanel({
  initialQuery,
  initialResult,
  legalCaseId,
  syncUrl = false,
  title = "Contratos de honorários",
  description = "Clique em um contrato para ver as obrigações e registrar recebimentos.",
}: {
  initialQuery: AgreementListQuery;
  initialResult: ActionResult<Page<AgreementListItemDTO>>;
  /** Escopo de um caso (aba Financeiro do caso). */
  legalCaseId?: string;
  syncUrl?: boolean;
  title?: string;
  description?: string;
}) {
  const scope = legalCaseId ? { legalCaseId } : {};
  const { query, setQuery, result, pending, retry } = useServerList({
    initialQuery,
    initialResult,
    load: (q: AgreementListQuery) => listAgreementRowsAction(agreementQueryToInput(q, scope)),
    toSearch: syncUrl ? agreementQueryToSearchParams : undefined,
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const page = result.ok ? result.data : undefined;
  // Sempre a linha ATUAL da página (recarregada do servidor depois de cada mudança).
  const selected = page?.items.find((r) => r.id === selectedId) ?? null;
  const newHref = legalCaseId ? `/financeiro/contratos/novo?caso=${legalCaseId}` : "/financeiro/contratos/novo";
  const cta = (
    <Can permission="finance.manage">
      <ButtonLink href={newHref} size="sm" icon={<Plus className="size-4" aria-hidden />}>
        Novo contrato de honorários
      </ButtonLink>
    </Can>
  );

  return (
    <Panel>
      <PanelHeader
        title={title}
        description={description}
        actions={
          <div className="flex items-center gap-2">
            <Select
              aria-label="Situação do contrato"
              placeholder="Todas as situações"
              options={STATUS_OPTIONS}
              value={query.status}
              onChange={(e) => setQuery({ status: e.target.value as AgreementListQuery["status"], page: 1 })}
              className="h-8 w-[180px] text-[12.5px]"
            />
            {cta}
          </div>
        }
      />
      <div aria-busy={pending || undefined} className={cn("transition-opacity", pending && "opacity-60")}>
        {!result.ok ? (
          <ActionErrorState error={result} onRetry={retry} title="Não foi possível carregar os contratos." />
        ) : !page ? (
          <SkeletonRows rows={4} />
        ) : page.items.length === 0 ? (
          query.status ? (
            <EmptyState compact title="Nenhum contrato nesta situação." />
          ) : (
            <EmptyState icon={FileSignature} title="Nenhum contrato de honorários registrado." description="Crie o contrato do caso e registre as obrigações." action={cta} />
          )
        ) : (
          <>
            <p className="border-b border-line px-5 py-2 text-[12px] text-muted" aria-live="polite">
              {pluralize(page.total, "contrato", "contratos")}
            </p>
            <Table caption={title}>
              <THead>
                <tr>
                  {!legalCaseId && <Th>Cliente / caso</Th>}
                  <Th>Modelo</Th>
                  <Th className="text-right">Contratado</Th>
                  <Th className="text-right">Recebido</Th>
                  <Th className="text-right">Em aberto</Th>
                  <Th>Próx. vencimento</Th>
                  <Th>Situação</Th>
                  <Th>
                    <span className="sr-only">Abrir</span>
                  </Th>
                </tr>
              </THead>
              <TBody>
                {page.items.map((r) => (
                  <Tr key={r.id} interactive onClick={() => setSelectedId(r.id)}>
                    {!legalCaseId && (
                      <Td className="max-w-[280px]">
                        <span className="block truncate font-medium text-foreground">{r.clientName || "—"}</span>
                        <Link href={`/casos/${r.legalCaseId}`} onClick={(e) => e.stopPropagation()} className="block truncate text-[12px] text-navy hover:underline underline-offset-2">
                          {r.caseTitle || "Abrir caso"}
                        </Link>
                      </Td>
                    )}
                    <Td className="text-[12.5px]">{r.feeModelName ?? <span className="text-subtle">Valores próprios</span>}</Td>
                    <Td className="text-right tabular">{formatCurrency(r.totals.contracted)}</Td>
                    <Td className="text-right tabular">{formatCurrency(r.totals.received)}</Td>
                    <Td className="text-right tabular">
                      {formatCurrency(r.totals.outstanding)}
                      {r.totals.overdue > 0 && <span className="block text-[11.5px] text-danger">{formatCurrency(r.totals.overdue)} em atraso</span>}
                    </Td>
                    <Td className="tabular text-muted">{r.nextDueDate ? formatDate(r.nextDueDate) : "—"}</Td>
                    <Td>
                      <StatusBadge status={r.status} labels={AGREEMENT_DB_STATUS_LABEL} tones={AGREEMENT_DB_STATUS_TONE} />
                    </Td>
                    <Td className="text-right">
                      <ChevronRight className="inline size-4 text-subtle" aria-hidden />
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
            <Pagination page={page.page} pageSize={AGREEMENT_PAGE_SIZE} total={page.total} disabled={pending} onPageChange={(p) => setQuery({ ...query, page: p })} noun={{ one: "contrato", many: "contratos" }} />
          </>
        )}
      </div>
      {selected && <AgreementDrawer agreement={selected} onClose={() => setSelectedId(null)} />}
    </Panel>
  );
}
