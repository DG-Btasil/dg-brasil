"use client";

import { useCallback, useState } from "react";
import { MessageSquarePlus, MessageSquareText } from "lucide-react";
import { PARTNER_REQUEST_STATUS_LABEL, PARTNER_REQUEST_STATUS_TONE, PARTNER_REQUEST_STATUSES, PARTNER_REQUEST_TYPE_LABEL, PARTNER_REQUEST_TYPES, type PartnerRequestStatus } from "@/lib/constants/status";
import { cn } from "@/lib/cn";
import { formatDate, formatEventTime } from "@/lib/formatting";
import { callAction, type ActionResult } from "@/lib/actions/result";
import { useServerList } from "@/lib/hooks/use-server-list";
import { Can } from "@/components/layout/guards";
import { ActionErrorState } from "@/components/feedback/action-error";
import { EmptyState, SkeletonRows } from "@/components/feedback/states";
import { AsyncPicker, type PickerOption } from "@/components/ui/async-picker";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { DeadlineBadge } from "@/components/ui/display";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Pagination } from "@/components/ui/pagination";
import { Panel, PanelHeader } from "@/components/ui/panel";
import type { Page } from "@/server/core/pagination";
import { listCasesAction } from "@/server/domain/cases/actions";
import { listPartnerRequestsAction } from "@/server/domain/partner-requests/actions";
import type { PartnerRequestListItem } from "@/server/domain/partner-requests/dto";
import { requestListInput, REQUEST_PAGE_SIZE, type RequestScope } from "../query";
import { useRequestActions } from "../use-request-actions";
import { RequestThreadDialog } from "./request-thread-dialog";

interface Query {
  status: PartnerRequestStatus | "";
  page: number;
}

const STATUS_OPTIONS = PARTNER_REQUEST_STATUSES.map((s) => ({ value: s, label: PARTNER_REQUEST_STATUS_LABEL[s] }));

/**
 * Solicitações ao parceiro (equipe interna e Portal do Parceiro): lista do
 * servidor (RLS recorta o parceiro ao próprio escritório), conversa e, para a
 * equipe, nova solicitação. Toda solicitação pertence a um CASO do parceiro.
 */
export function RequestsPanel({
  scope,
  initial,
  title,
  description,
  newRequest,
  showCase = true,
}: {
  scope: RequestScope;
  initial: ActionResult<Page<PartnerRequestListItem>>;
  title: string;
  description?: string;
  /** Equipe interna: caso fixo (página do caso) ou escolha entre os casos do parceiro. */
  newRequest?: { legalCaseId: string } | { partnerOrganizationId: string };
  showCase?: boolean;
}) {
  const { query, setQuery, result, pending, retry } = useServerList({
    initialQuery: { status: "", page: 1 } as Query,
    initialResult: initial,
    load: (q: Query) => listPartnerRequestsAction(requestListInput(scope, q)),
  });
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const page = result.ok ? result.data : undefined;

  return (
    <Panel>
      <PanelHeader
        title={title}
        description={description}
        actions={
          <div className="flex items-center gap-2">
            <Select
              aria-label="Situação da solicitação"
              placeholder="Todas"
              options={STATUS_OPTIONS}
              value={query.status}
              onChange={(e) => setQuery({ status: e.target.value as Query["status"], page: 1 })}
              className="h-8 w-[160px] text-[12.5px]"
            />
            {newRequest && (
              <Can permission="partnerRequests.manage">
                <Button size="sm" variant="secondary" icon={<MessageSquarePlus className="size-4" aria-hidden />} onClick={() => setCreating(true)}>
                  Nova solicitação
                </Button>
              </Can>
            )}
          </div>
        }
      />
      <div aria-busy={pending || undefined} className={cn("transition-opacity", pending && "opacity-60")}>
        {!result.ok ? (
          <ActionErrorState error={result} onRetry={retry} title="Não foi possível carregar as solicitações." />
        ) : !page ? (
          <SkeletonRows rows={3} />
        ) : page.items.length === 0 ? (
          <EmptyState compact icon={MessageSquareText} title={query.status ? "Nenhuma solicitação nesta situação." : "Nenhuma solicitação."} />
        ) : (
          <>
            <ul className="divide-y divide-line">
              {page.items.map((r) => (
                <li key={r.id} className="px-5 py-3.5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge status={r.status} labels={PARTNER_REQUEST_STATUS_LABEL} tones={PARTNER_REQUEST_STATUS_TONE} />
                        <Badge tone="neutral">{PARTNER_REQUEST_TYPE_LABEL[r.type]}</Badge>
                      </div>
                      <p className="mt-1.5 text-[13.5px] font-semibold text-foreground">{r.title}</p>
                      {r.description && <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-relaxed text-muted">{r.description}</p>}
                      <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-muted">
                        {showCase && r.caseTitle && <span>Caso: {r.caseTitle}</span>}
                        <span>Aberta em {formatDate(r.createdAt)}</span>
                        {r.answeredAt && <span>Respondida {formatEventTime(r.answeredAt)}</span>}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-2">
                      {r.dueDate && r.status === "OPEN" && (
                        <span className="flex items-center gap-1.5 text-[11.5px] text-muted">
                          Prazo recomendado <DeadlineBadge dueDate={r.dueDate} />
                        </span>
                      )}
                      <Button size="sm" variant="secondary" onClick={() => setOpen(r.id)}>
                        Abrir conversa
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <Pagination page={page.page} pageSize={REQUEST_PAGE_SIZE} total={page.total} disabled={pending} onPageChange={(p) => setQuery({ ...query, page: p })} noun={{ one: "solicitação", many: "solicitações" }} />
          </>
        )}
      </div>
      {open && <RequestThreadDialog requestId={open} onClose={() => setOpen(null)} />}
      {creating && newRequest && <NewRequestDialog target={newRequest} onClose={() => setCreating(false)} />}
    </Panel>
  );
}

const TYPE_OPTIONS = PARTNER_REQUEST_TYPES.map((t) => ({ value: t, label: PARTNER_REQUEST_TYPE_LABEL[t] }));

/** Nova solicitação (equipe interna). O parceiro destinatário é o parceiro OPERACIONAL do caso (servidor). */
function NewRequestDialog({ target, onClose }: { target: { legalCaseId: string } | { partnerOrganizationId: string }; onClose: () => void }) {
  const actions = useRequestActions();
  const fixedCase = "legalCaseId" in target ? target.legalCaseId : undefined;
  const [caseOption, setCaseOption] = useState<PickerOption | null>(null);
  const [type, setType] = useState("DOCUMENT_REQUEST");
  const [titleText, setTitleText] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [saving, setSaving] = useState(false);

  const searchCases = useCallback(
    async (q: string): Promise<{ ok: true; options: PickerOption[] } | { ok: false; message: string }> => {
      if (!("partnerOrganizationId" in target)) return { ok: true, options: [] };
      const r = await callAction(() => listCasesAction({ q: q.trim() || undefined, partnerOrganizationId: target.partnerOrganizationId, pageSize: 10 }));
      if (!r.ok) return { ok: false, message: r.error.message };
      return { ok: true, options: r.data.items.map((c) => ({ id: c.id, label: c.title, description: c.clientName })) };
    },
    [target],
  );

  async function save() {
    const legalCaseId = fixedCase ?? caseOption?.id;
    const found = {
      legalCaseId: legalCaseId ? undefined : "Escolha o caso do parceiro.",
      title: titleText.trim() ? undefined : "Informe o título.",
    };
    setErrors(found);
    if (found.legalCaseId || found.title || !legalCaseId) return;
    setSaving(true);
    const r = await actions.create({ legalCaseId, type, title: titleText.trim(), description: description.trim(), dueDate: dueDate || undefined });
    setSaving(false);
    if (r.ok) onClose();
    else setErrors(Object.fromEntries(Object.entries(r.error.fieldErrors ?? {}).map(([k, v]) => [k, v[0]])));
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !saving && onClose()}
      title="Nova solicitação ao parceiro"
      description="O parceiro responde pelo portal, em Pendências. A solicitação fica ligada ao caso."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={save} loading={saving}>
            Enviar solicitação
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-x-5 gap-y-4">
        {!fixedCase && (
          <Field label="Caso" requirement="required" className="col-span-full" error={errors.legalCaseId} hint="Casos com acesso operacional deste parceiro.">
            {(p) => <AsyncPicker {...p} value={caseOption} onChange={setCaseOption} search={searchCases} placeholder="Buscar caso pelo título" />}
          </Field>
        )}
        <Field label="Tipo" requirement="required" error={errors.type}>
          {(p) => <Select {...p} options={TYPE_OPTIONS} value={type} onChange={(e) => setType(e.target.value)} />}
        </Field>
        <Field label="Prazo recomendado" requirement="optional" error={errors.dueDate}>
          {(p) => <Input {...p} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />}
        </Field>
        <Field label="Título" requirement="required" error={errors.title} className="col-span-full">
          {(p) => <Input {...p} maxLength={200} placeholder="Ex.: Extrato bancário dos últimos 12 meses" value={titleText} onChange={(e) => setTitleText(e.target.value)} />}
        </Field>
        <Field label="Solicitação" requirement="optional" error={errors.description} className="col-span-full">
          {(p) => <Textarea {...p} rows={3} maxLength={5000} placeholder="Descreva o que é necessário e por quê." value={description} onChange={(e) => setDescription(e.target.value)} />}
        </Field>
      </div>
    </Dialog>
  );
}
