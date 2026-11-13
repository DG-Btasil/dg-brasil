"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, XCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatDateTime, formatWaitingTime, pluralize } from "@/lib/formatting";
import { callAction, type ActionResult } from "@/lib/actions/result";
import { ActionErrorState } from "@/components/feedback/action-error";
import { EmptyState, SkeletonRows } from "@/components/feedback/states";
import { Button } from "@/components/ui/button";
import { Pagination } from "@/components/ui/pagination";
import type { Page } from "@/server/core/pagination";
import { listReviewsAction } from "@/server/domain/reviews/actions";
import { bulkBlock, bulkBlockMessage, bulkSelectable, MAX_BULK_REVIEWS, type BulkDecision } from "@/server/domain/reviews/bulk-rules";
import type { ReviewGroupDTO, ReviewListItem } from "@/server/domain/reviews/dto";
import { usePermission, useRole } from "@/features/auth/hooks";
import { useDirectoryUserMap } from "@/features/directory/directory-context";
import { REVIEW_GROUP_ITEMS_PAGE_SIZE, reviewGroupItemsInput, type ReviewListQuery } from "../list-query";
import { groupCountsLabel, groupTitle } from "../queue-entries";
import { BulkDecisionDialog } from "./bulk-decision-dialog";
import { PriorityBadge } from "./priority-badge";
import { ReviewTable } from "./review-table";

/**
 * A fila agrupada: um bloco por execução do agente (ou, para o que a equipe
 * enviou, um bloco por caso). O cabeçalho mostra o agente, o caso, o cliente,
 * quando chegou, quantos itens há por tipo e a prioridade mais alta; abrir o
 * bloco carrega os itens do servidor, com os mesmos filtros da fila.
 */
export function ReviewGroupList({ groups, query, onChanged }: { groups: ReviewGroupDTO[]; query: ReviewListQuery; onChanged: () => void }) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const toggle = (key: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  return (
    <div className="overflow-x-auto">
      <ul aria-label="Revisões agrupadas por execução" className="min-w-[1024px] divide-y divide-line">
        {groups.map((group) => (
          <ReviewGroup key={group.key} group={group} query={query} open={open.has(group.key)} onToggle={() => toggle(group.key)} onChanged={onChanged} />
        ))}
      </ul>
    </div>
  );
}

function Responsible({ group }: { group: ReviewGroupDTO }) {
  const users = useDirectoryUserMap();
  if (group.reviewerIds.length === 0) return <span className="text-subtle">Sem responsável</span>;
  if (group.reviewerIds.length > 1 || group.unassigned > 0) return <>Vários responsáveis</>;
  return <>{users.get(group.reviewerIds[0])?.name ?? "—"}</>;
}

function ReviewGroup({ group, query, open, onToggle, onChanged }: { group: ReviewGroupDTO; query: ReviewListQuery; open: boolean; onToggle: () => void; onChanged: () => void }) {
  const panelId = `grupo-${group.key.replace(/[^a-zA-Z0-9-]/g, "-")}`;
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
        className={cn("flex w-full items-center gap-4 px-5 py-3 text-left transition-colors hover:bg-navy-50/40", open && "bg-surface-muted")}
      >
        <Chevron className="size-4 shrink-0 text-subtle" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-semibold text-navy">{groupTitle(group)}</span>
          <span className="mt-0.5 block truncate text-[12.5px] text-muted">
            {[group.caseTitle, group.clientName].filter(Boolean).join(" · ") || "Sem caso (configuração do DG Brasil)"}
          </span>
        </span>
        <span className="w-[230px] shrink-0 text-[12.5px] text-foreground">
          <span className="block font-medium">{pluralize(group.total, "item", "itens")}</span>
          <span className="block truncate text-[12px] text-muted">{groupCountsLabel(group)}</span>
        </span>
        <span className="w-[150px] shrink-0 truncate text-[12.5px]">
          <Responsible group={group} />
        </span>
        <span className="w-[170px] shrink-0 text-[12.5px] text-muted">
          <span className="block">{group.open > 0 ? `Aguardando há ${formatWaitingTime(group.firstCreatedAt)}` : "Tudo decidido"}</span>
          <span className="block text-[11.5px] text-subtle tabular">chegou {formatDateTime(group.firstCreatedAt)}</span>
        </span>
        <span className="w-[100px] shrink-0">
          <PriorityBadge priority={group.topPriority} />
        </span>
      </button>
      {open && (
        <div id={panelId} className="border-t border-line bg-surface">
          <ReviewGroupItems group={group} query={query} onChanged={onChanged} />
        </div>
      )}
    </li>
  );
}

/** Itens de um grupo, lidos do servidor ao abrir; marcar e decidir em conjunto fica aqui. */
function ReviewGroupItems({ group, query, onChanged }: { group: ReviewGroupDTO; query: ReviewListQuery; onChanged: () => void }) {
  const canDecide = usePermission("reviews.decide");
  const isAdmin = useRole() === "ADMIN";
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<ActionResult<Page<ReviewListItem>> | null>(null);
  const [version, setVersion] = useState(0);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [deciding, setDeciding] = useState<BulkDecision | null>(null);
  // Os filtros da fila valem dentro do grupo: mudou o filtro, os itens são lidos de novo.
  const inputKey = JSON.stringify(reviewGroupItemsInput(query, group, page));

  useEffect(() => {
    let alive = true;
    callAction(() => listReviewsAction(JSON.parse(inputKey))).then((r) => {
      if (!alive) return;
      setResult(r);
      // Só fica marcado o que continua na tela e ainda pode ser decidido.
      if (r.ok) setSelected((current) => new Set(r.data.items.filter((i) => current.has(i.id) && bulkSelectable(i, isAdmin)).map((i) => i.id)));
    });
    return () => {
      alive = false;
    };
  }, [inputKey, version, isAdmin]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);

  if (!result) return <SkeletonRows rows={3} />;
  if (!result.ok) return <ActionErrorState error={result} onRetry={reload} title="Não foi possível carregar os itens." />;
  const items = result.data.items;
  if (items.length === 0) return <EmptyState compact title="Nenhum item deste grupo corresponde aos filtros." />;
  const chosen = items.filter((i) => selected.has(i.id));
  const anySelectable = canDecide && items.some((i) => bulkSelectable(i, isAdmin));

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-5 py-2.5 text-[12.5px] text-muted">
        {group.agentRunId && (
          <Link href={`/execucoes/${group.agentRunId}`} className="font-medium text-navy hover:underline underline-offset-2">
            Ver a execução do agente
          </Link>
        )}
        {group.legalCaseId && (
          <Link href={`/casos/${group.legalCaseId}`} className="font-medium text-navy hover:underline underline-offset-2">
            Abrir o caso
          </Link>
        )}
        {anySelectable ? (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <p aria-live="polite">
              {chosen.length === 0 ? "Marque as propostas para decidir em conjunto. Documento e análise são decididos um a um." : `${pluralize(chosen.length, "item marcado", "itens marcados")}`}
            </p>
            <Button size="sm" variant="danger" icon={<XCircle className="size-3.5" aria-hidden />} disabled={chosen.length === 0} onClick={() => setDeciding("REJECTED")}>
              Rejeitar marcados
            </Button>
            <Button size="sm" icon={<CheckCircle2 className="size-3.5" aria-hidden />} disabled={chosen.length === 0} onClick={() => setDeciding("APPROVED")}>
              Aprovar marcados
            </Button>
          </div>
        ) : (
          canDecide && <p className="ml-auto">Estes itens são decididos um a um: abra cada um para ler.</p>
        )}
      </div>
      <ReviewTable
        rows={items}
        showCase={false}
        caption={`Itens: ${groupTitle(group)}`}
        selection={
          canDecide
            ? {
                selected,
                blocked: (review) => {
                  const reason = bulkBlock(review, "REJECTED", isAdmin);
                  return reason ? bulkBlockMessage(reason, review) : undefined;
                },
                onToggle: (id, checked) =>
                  setSelected((current) => {
                    const next = new Set(current);
                    if (checked) next.add(id);
                    else next.delete(id);
                    return next;
                  }),
                onToggleAll: (ids, checked) =>
                  setSelected((current) => {
                    const next = new Set(current);
                    for (const id of ids) {
                      if (checked) next.add(id);
                      else next.delete(id);
                    }
                    return next;
                  }),
              }
            : undefined
        }
      />
      {result.data.total > REVIEW_GROUP_ITEMS_PAGE_SIZE && (
        <Pagination
          page={result.data.page}
          pageSize={REVIEW_GROUP_ITEMS_PAGE_SIZE}
          total={result.data.total}
          onPageChange={(p) => {
            setSelected(new Set());
            setPage(p);
          }}
          noun={{ one: "item", many: "itens" }}
        />
      )}
      {deciding && (
        <BulkDecisionDialog
          decision={deciding}
          items={chosen.slice(0, MAX_BULK_REVIEWS)}
          isAdmin={isAdmin}
          onClose={() => setDeciding(null)}
          onDone={() => {
            setSelected(new Set());
            reload();
            onChanged();
          }}
        />
      )}
    </>
  );
}
