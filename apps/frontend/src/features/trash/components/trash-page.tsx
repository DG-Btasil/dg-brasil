"use client";

import Link from "next/link";
import { useState } from "react";
import { ArchiveRestore, Trash2 } from "lucide-react";
import { ActionErrorState } from "@/components/feedback/action-error";
import { Callout, EmptyState, SkeletonRows } from "@/components/feedback/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { PageHeader } from "@/components/ui/display";
import { SearchInput } from "@/components/ui/form";
import { Pagination } from "@/components/ui/pagination";
import { Panel } from "@/components/ui/panel";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/table";
import { Tabs, type TabItem } from "@/components/ui/tabs";
import { callAction, type ActionResult } from "@/lib/actions/result";
import { useActionFeedback } from "@/lib/actions/use-action-feedback";
import { cn } from "@/lib/cn";
import { CLIENT_KIND_SHORT } from "@/lib/constants/status";
import { formatDateTime } from "@/lib/formatting";
import { formatCNJ, maskDocument } from "@/lib/formatting/masks";
import { useDebouncedCallback, useServerList } from "@/lib/hooks/use-server-list";
import type { Page } from "@/server/core/pagination";
import { listTrashAction, restoreFromTrashAction } from "@/server/domain/trash/actions";
import type { TrashItemDTO } from "@/server/domain/trash/dto";
import { TRASH_KINDS, type TrashKind } from "@/server/domain/trash/schemas";
import { useToast } from "@/store/ui-store";
import { RESTORE_EXPLANATION, TRASH_BLOCK_LABEL, TRASH_HREF, TRASH_KIND_LABEL, TRASH_PAGE_SIZE, restoreNotice } from "../labels";

interface TrashQuery {
  kind: TrashKind;
  search: string;
  page: number;
}

const toInput = (q: TrashQuery) => ({ kind: q.kind, q: q.search.trim() || undefined, page: q.page, pageSize: TRASH_PAGE_SIZE });
const TAB_ITEMS: TabItem<TrashKind>[] = TRASH_KINDS.map((kind) => ({ key: kind, label: TRASH_KIND_LABEL[kind].tab }));

/**
 * Lixeira (só ADMIN): clientes, processos e documentos excluídos, com quem
 * excluiu e quando, busca e páginas no servidor, e "Restaurar". A busca não
 * vai para a URL (pode ser CPF/CNPJ). Não existe exclusão definitiva.
 */
export function TrashPage({ initialResult }: { initialResult: ActionResult<Page<TrashItemDTO>> }) {
  const { query, setQuery, result, resultQuery, pending, retry } = useServerList({
    initialQuery: { kind: "CLIENT", search: "", page: 1 } as TrashQuery,
    initialResult,
    load: (q: TrashQuery) => listTrashAction(toInput(q)),
  });
  const [search, setSearch] = useState("");
  const [restoring, setRestoring] = useState<TrashItemDTO | null>(null);
  const commitSearch = useDebouncedCallback((text: string) => setQuery({ ...query, search: text.trim(), page: 1 }));
  const labels = TRASH_KIND_LABEL[query.kind];
  // Trocou de aba: a lista da aba anterior sai da tela até chegar a da aba certa (colunas e contador são outros).
  const page = result.ok && resultQuery.kind === query.kind ? result.data : undefined;

  function changeKind(kind: TrashKind) {
    setSearch("");
    setQuery({ kind, search: "", page: 1 });
  }

  return (
    <div className="space-y-5">
      <PageHeader
        breadcrumbs={[{ label: "Configurações", href: "/configuracoes?secao=seguranca" }, { label: "Lixeira" }]}
        title="Lixeira"
        description="Clientes, processos e documentos que foram excluídos. Nada é apagado de vez: o administrador pode restaurar, e cada restauração fica na auditoria."
      />
      <Panel>
        <div className="border-b border-line px-5 pt-3">
          <Tabs items={TAB_ITEMS} value={query.kind} onChange={changeKind} label="Tipo de registro excluído" />
        </div>
        <div className="flex items-center gap-3 border-b border-line px-5 py-3" role="search" aria-label="Buscar na Lixeira">
          <SearchInput
            aria-label={labels.search}
            placeholder={labels.search}
            value={search}
            maxLength={120}
            onChange={(e) => {
              setSearch(e.target.value);
              commitSearch(e.target.value);
            }}
            className="w-[380px]"
          />
          {page && (
            <p className="text-[12.5px] text-muted" aria-live="polite">
              {page.total === 1 ? `1 ${labels.one}` : `${page.total} ${labels.many}`}
              {query.search ? " com a busca" : ""}
            </p>
          )}
        </div>
        <div aria-busy={pending || undefined} className={cn("transition-opacity", pending && "opacity-60")}>
          {!result.ok && resultQuery.kind === query.kind ? (
            <ActionErrorState error={result} onRetry={retry} title="Não foi possível abrir a Lixeira." />
          ) : !page ? (
            <SkeletonRows rows={6} />
          ) : page.items.length === 0 ? (
            <EmptyState
              icon={Trash2}
              title={query.search ? "Nada na Lixeira com esta busca." : labels.empty}
              description={query.search ? "Confira o que foi digitado ou limpe a busca." : "O que for excluído aparece aqui, com quem excluiu e quando, e pode ser restaurado."}
            />
          ) : (
            <>
              <TrashTable kind={query.kind} rows={page.items} onRestore={setRestoring} />
              <Pagination
                page={page.page}
                pageSize={TRASH_PAGE_SIZE}
                total={page.total}
                disabled={pending}
                onPageChange={(p) => setQuery({ ...query, page: p })}
                noun={{ one: labels.one, many: labels.many }}
              />
            </>
          )}
        </div>
      </Panel>
      {restoring && <RestoreDialog item={restoring} onClose={() => setRestoring(null)} onRestored={retry} />}
    </div>
  );
}

function TrashTable({ kind, rows, onRestore }: { kind: TrashKind; rows: TrashItemDTO[]; onRestore: (item: TrashItemDTO) => void }) {
  return (
    <Table caption={`${TRASH_KIND_LABEL[kind].tab} excluídos`}>
      <THead>
        <tr>
          <Th>{kind === "CLIENT" ? "Cliente" : kind === "PROCESS" ? "Processo" : "Documento"}</Th>
          {kind === "CLIENT" && <Th>CPF/CNPJ</Th>}
          {kind === "PROCESS" && <Th>Número CNJ</Th>}
          {kind !== "CLIENT" && <Th>Cliente</Th>}
          <Th>Excluído em</Th>
          <Th>Excluído por</Th>
          <Th className="text-right">
            <span className="sr-only">Ações</span>
          </Th>
        </tr>
      </THead>
      <TBody>
        {rows.map((item) => (
          <Tr key={item.id}>
            <Td className="max-w-[280px]">
              <span className="block truncate font-medium text-foreground">{item.title}</span>
              {item.kind === "CLIENT" && item.clientKind && <span className="block text-[12px] text-muted">{CLIENT_KIND_SHORT[item.clientKind]}</span>}
              {item.kind === "PROCESS" && item.caseTitle && <span className="block truncate text-[12px] text-muted">Caso: {item.caseTitle}</span>}
              {item.kind === "DOCUMENT" && item.categoryLabel && <span className="block truncate text-[12px] text-muted">{item.categoryLabel}</span>}
              {item.blocked && <span className="mt-1 block text-[12px] text-warning">{TRASH_BLOCK_LABEL[item.blocked]}</span>}
            </Td>
            {kind === "CLIENT" && <Td className="tabular whitespace-nowrap">{item.document ? maskDocument(item.document) : "—"}</Td>}
            {kind === "PROCESS" && (
              <Td>
                {/* Número e aviso em linhas separadas: a tabela cabe numa tela de 1366 px sem cortar o "Restaurar". */}
                <span className="block whitespace-nowrap tabular">{item.cnj ? formatCNJ(item.cnj) : "Sem número"}</span>
                {item.cnjReleased && (
                  <Badge tone="warning" className="mt-1" title="Este número foi cadastrado de novo em outro processo depois da exclusão.">
                    número usado em outro cadastro
                  </Badge>
                )}
              </Td>
            )}
            {kind !== "CLIENT" && <Td className="max-w-[200px] truncate">{item.clientName ?? "—"}</Td>}
            <Td className="tabular whitespace-nowrap">{formatDateTime(item.deletedAt)}</Td>
            <Td className="max-w-[160px] truncate">{item.deletedByName ?? "Sistema"}</Td>
            <Td className="text-right">
              <Button
                variant="secondary"
                size="sm"
                icon={<ArchiveRestore className="size-3.5" aria-hidden />}
                disabled={!!item.blocked}
                title={item.blocked ? TRASH_BLOCK_LABEL[item.blocked] : undefined}
                onClick={() => onRestore(item)}
              >
                Restaurar
              </Button>
            </Td>
          </Tr>
        ))}
      </TBody>
    </Table>
  );
}

/** Confirmação: diz o que volta e o que não dá para desfazer; só então restaura. */
function RestoreDialog({ item, onClose, onRestored }: { item: TrashItemDTO; onClose: () => void; onRestored: () => void }) {
  const toast = useToast();
  const failed = useActionFeedback();
  const [saving, setSaving] = useState(false);
  const text = RESTORE_EXPLANATION[item.kind];

  async function confirm() {
    setSaving(true);
    const result = await callAction(() => restoreFromTrashAction({ kind: item.kind, id: item.id }));
    setSaving(false);
    if (!result.ok) {
      failed(result, "Não foi possível restaurar.");
      // O motivo pode ter mudado (ex.: o número CNJ foi cadastrado agora): a lista mostra o estado atual.
      onRestored();
      onClose();
      return;
    }
    toast({ tone: "success", ...restoreNotice(result.data) });
    onRestored();
    onClose();
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !saving && onClose()}
      title={text.title}
      description={`“${item.title}” volta a aparecer no sistema.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button icon={<ArchiveRestore className="size-4" aria-hidden />} loading={saving} onClick={confirm}>
            Restaurar
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-[13px]">
        <ul className="list-disc space-y-1.5 pl-4 text-foreground">
          {text.body.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        {item.kind === "PROCESS" && item.cnjReleased && (
          <Callout tone="info">O número CNJ deste processo foi cadastrado em outro processo, que também está excluído. Ao restaurar, o número volta para este.</Callout>
        )}
        <p className="text-muted">A restauração fica registrada na auditoria.</p>
      </div>
    </Dialog>
  );
}

/** Atalho em Configurações › Segurança e auditoria. */
export function TrashLinkPanel() {
  return (
    <Panel className="flex items-center justify-between gap-6 px-6 py-5">
      <div className="flex items-start gap-3">
        <Trash2 className="mt-0.5 size-4 text-navy-700" aria-hidden />
        <div>
          <h2 className="text-[14px] font-semibold text-foreground">Lixeira</h2>
          <p className="mt-0.5 text-[12.5px] text-muted">Clientes, processos e documentos excluídos, com quem excluiu e quando. Dá para restaurar; nada é apagado de vez.</p>
        </div>
      </div>
      <Link href={TRASH_HREF} className="shrink-0 text-[13px] font-medium text-navy-700 underline-offset-4 hover:underline">
        Abrir a Lixeira
      </Link>
    </Panel>
  );
}
