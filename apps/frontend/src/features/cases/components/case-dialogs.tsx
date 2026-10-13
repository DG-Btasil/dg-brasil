"use client";

import { useMemo, useState } from "react";
import { isAccepted } from "@/lib/domain/legal-case";
import { Callout } from "@/components/feedback/states";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import type { CaseCatalogDTO, CaseInternalDTO } from "@/server/domain/cases/dto";
import { useLawyerOptions, useOrganizationName, useOrgDirectory } from "@/features/directory/directory-context";
import { useCaseActions } from "../use-case-actions";
import { LINK_PARTNER_LABEL } from "../utils";

interface DialogBase {
  legalCase: CaseInternalDTO;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const firstError = (fieldErrors: Record<string, string[]> | undefined, key: string) => fieldErrors?.[key]?.[0];

/** Aceite: exige advogado responsável; origem parceiro cria o acordo de parceria (snapshot no banco). */
export function AcceptCaseDialog({ legalCase, open, onOpenChange }: DialogBase) {
  const actions = useCaseActions();
  const lawyers = useLawyerOptions();
  const { owner } = useOrgDirectory();
  const partnerName = useOrganizationName(legalCase.originOrganizationId);
  const partnerOrigin = legalCase.originOrganizationId !== owner.id;
  const [lawyerId, setLawyerId] = useState(legalCase.assignedLawyerId ?? "");
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const needsLawyer = !legalCase.assignedLawyerId;

  async function confirm() {
    if (!lawyerId) {
      setError("Defina o advogado responsável antes de aceitar o caso.");
      return;
    }
    setSaving(true);
    const result = await actions.accept(legalCase.id, lawyerId);
    setSaving(false);
    if (result.ok) onOpenChange(false);
    else setError(firstError(result.error.fieldErrors, "lawyerId"));
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={needsLawyer ? "Definir advogado responsável" : "Aceitar caso"}
      description={needsLawyer ? "Para aceitar o caso, defina o advogado responsável." : `Caso “${legalCase.title}”.`}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={confirm} loading={saving}>
            Aceitar caso
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Advogado responsável" requirement="required" error={error} hint="Advogados internos ou Administrador inscrito na OAB.">
          {(p) => (
            <Select
              {...p}
              value={lawyerId}
              onChange={(e) => {
                setLawyerId(e.target.value);
                setError(undefined);
              }}
              options={lawyers}
              placeholder="Selecione"
            />
          )}
        </Field>
        {partnerOrigin ? (
          <Callout tone="info" title="Acordo de parceria">
            Ao aceitar, será criado o acordo de parceria com a divisão vigente de {partnerName ?? "o escritório parceiro de origem"}. Mudanças futuras na divisão padrão
            não alteram este caso.
          </Callout>
        ) : (
          <p className="text-[12.5px] text-muted">Caso próprio de {owner.name}: sem acordo de parceria.</p>
        )}
      </div>
    </Dialog>
  );
}

/** Rejeição: comunicação ao parceiro (obrigatória) e nota interna (nunca exibida ao parceiro). */
export function RejectCaseDialog({ legalCase, open, onOpenChange }: DialogBase) {
  const actions = useCaseActions();
  const fromPartner = !!legalCase.partnerOrganizationId;
  const [publicReason, setPublicReason] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  async function confirm() {
    if (!publicReason.trim()) {
      setError(fromPartner ? "Informe o motivo que será comunicado ao parceiro." : "Informe o motivo da rejeição.");
      return;
    }
    setSaving(true);
    const result = await actions.reject(legalCase.id, { publicReason, internalNote });
    setSaving(false);
    if (result.ok) onOpenChange(false);
    else setError(firstError(result.error.fieldErrors, "publicReason"));
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Rejeitar caso"
      description={`Caso “${legalCase.title}”.`}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="danger" onClick={confirm} loading={saving}>
            Rejeitar caso
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field
          label={fromPartner ? "Comunicação ao parceiro" : "Motivo da rejeição"}
          requirement="required"
          error={error}
          hint={fromPartner ? "O parceiro verá este texto com o caso marcado como “Não aceito”." : undefined}
        >
          {(p) => (
            <Textarea
              {...p}
              rows={3}
              value={publicReason}
              onChange={(e) => {
                setPublicReason(e.target.value);
                setError(undefined);
              }}
            />
          )}
        </Field>
        <Field label="Nota interna" requirement="optional" hint="Somente para a equipe interna. Nunca é exibida ao parceiro.">
          {(p) => <Textarea {...p} rows={3} value={internalNote} onChange={(e) => setInternalNote(e.target.value)} />}
        </Field>
      </div>
    </Dialog>
  );
}

export const ACCEPTED_ORIGIN_WARNING = "Alterar a origem de um caso aceito pode afetar regras financeiras e de parceria.";

/** Origem do caso. Depois do aceite: somente Administrador, com motivo e confirmação (o banco exige e audita). */
export function ChangeOriginDialog({ legalCase, open, onOpenChange, options }: DialogBase & { options: { value: string; label: string }[] }) {
  const actions = useCaseActions();
  const { owner } = useOrgDirectory();
  const accepted = isAccepted(legalCase.status);
  const [originOrganizationId, setOriginOrganizationId] = useState(legalCase.originOrganizationId);
  const [confirmed, setConfirmed] = useState(false);
  const [linkPartner, setLinkPartner] = useState(false);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const unchanged = originOrganizationId === legalCase.originOrganizationId;
  // A origem não concede acesso: vincular o parceiro a um caso interno é opt-in explícito.
  const canLinkPartner = !unchanged && !legalCase.partnerOrganizationId && originOrganizationId !== owner.id;

  async function confirm() {
    if (accepted && !reason.trim()) {
      setReasonError("Informe o motivo da alteração.");
      return;
    }
    setSaving(true);
    const result = await actions.changeOrigin(legalCase.id, { originOrganizationId, reason: reason.trim() || undefined, linkPartner: canLinkPartner && linkPartner });
    setSaving(false);
    if (result.ok) onOpenChange(false);
    else setReasonError(firstError(result.error.fieldErrors, "reason"));
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Alterar origem do caso"
      description="A origem do caso define a parceria e o financeiro. Ela é independente da origem do cliente."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button variant={accepted ? "danger" : "primary"} onClick={confirm} loading={saving} disabled={unchanged || (accepted && !confirmed)}>
            Alterar origem
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Origem do caso" requirement="required">
          {(p) => (
            <Select
              {...p}
              value={originOrganizationId}
              onChange={(e) => {
                setOriginOrganizationId(e.target.value);
                setLinkPartner(false);
              }}
              options={options}
            />
          )}
        </Field>
        {canLinkPartner && <Checkbox label={LINK_PARTNER_LABEL} checked={linkPartner} onChange={(e) => setLinkPartner(e.target.checked)} />}
        {accepted && (
          <>
            <Callout tone="warning" title="Caso já aceito">
              {ACCEPTED_ORIGIN_WARNING} O acordo de parceria atual será encerrado e, se a nova origem for um parceiro, um novo acordo será criado com a divisão vigente.
            </Callout>
            <Field label="Motivo da alteração" requirement="required" error={reasonError} hint="Fica registrado na auditoria.">
              {(p) => (
                <Textarea
                  {...p}
                  rows={2}
                  value={reason}
                  onChange={(e) => {
                    setReason(e.target.value);
                    setReasonError(undefined);
                  }}
                />
              )}
            </Field>
            <Checkbox label="Entendo o impacto e quero alterar a origem deste caso aceito." checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          </>
        )}
      </div>
    </Dialog>
  );
}

export function AssignLawyerDialog({ legalCase, open, onOpenChange }: DialogBase) {
  const actions = useCaseActions();
  const lawyers = useLawyerOptions();
  const [lawyerId, setLawyerId] = useState(legalCase.assignedLawyerId ?? "");
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  async function confirm() {
    if (!lawyerId) return;
    setSaving(true);
    const result = await actions.assignLawyer(legalCase.id, lawyerId);
    setSaving(false);
    if (result.ok) onOpenChange(false);
    else setError(firstError(result.error.fieldErrors, "lawyerId"));
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Definir advogado responsável"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={confirm} loading={saving} disabled={!lawyerId}>
            Salvar
          </Button>
        </>
      }
    >
      <Field label="Advogado responsável" requirement="required" error={error} hint="Advogados internos ou Administrador inscrito na OAB.">
        {(p) => <Select {...p} value={lawyerId} onChange={(e) => setLawyerId(e.target.value)} options={lawyers} placeholder="Selecione" />}
      </Field>
    </Dialog>
  );
}

/** Área e tipo vêm do catálogo do banco (tipo é opcional e depende da área). */
export function useCatalogOptions(catalog: CaseCatalogDTO, areaCode: string) {
  return useMemo(() => {
    const areas = catalog.areas.map((a) => ({ value: a.code, label: a.name }));
    const areaId = catalog.areas.find((a) => a.code === areaCode)?.id;
    const types = catalog.caseTypes.filter((t) => t.legalAreaId === areaId).map((t) => ({ value: t.id, label: t.name }));
    return { areas, types };
  }, [catalog, areaCode]);
}

/** Edição dos dados do caso. */
export function EditCaseDialog({ legalCase, open, onOpenChange, catalog }: DialogBase & { catalog: CaseCatalogDTO }) {
  const actions = useCaseActions();
  const [title, setTitle] = useState(legalCase.title);
  const [area, setArea] = useState<string>(legalCase.area);
  const [caseTypeId, setCaseTypeId] = useState(legalCase.caseTypeId ?? "");
  const [opposingParty, setOpposingParty] = useState(legalCase.opposingParty ?? "");
  const [summary, setSummary] = useState(legalCase.summary);
  const [errors, setErrors] = useState<Record<string, string[]>>();
  const [saving, setSaving] = useState(false);
  const { areas, types } = useCatalogOptions(catalog, area);
  const invalid = !title.trim() || !area || !summary.trim();

  async function confirm() {
    if (invalid) return;
    setSaving(true);
    const result = await actions.update(legalCase.id, {
      title: title.trim(),
      ...(area !== legalCase.area ? { area } : {}),
      caseTypeId: caseTypeId || null,
      opposingParty: opposingParty.trim(),
      summary: summary.trim(),
    });
    setSaving(false);
    if (result.ok) onOpenChange(false);
    else setErrors(Object.fromEntries(Object.entries(result.error.fieldErrors ?? {}).map(([k, v]) => [k.replace(/^patch\./, ""), v])));
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="Editar caso"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={confirm} loading={saving} disabled={invalid}>
            Salvar alterações
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-4">
        <Field label="Título" requirement="required" className="col-span-2" error={errors?.title?.[0]}>
          {(p) => <Input {...p} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />}
        </Field>
        <Field label="Área" requirement="required" error={errors?.area?.[0]}>
          {(p) => (
            <Select
              {...p}
              value={area}
              onChange={(e) => {
                setArea(e.target.value);
                setCaseTypeId("");
              }}
              options={areas}
            />
          )}
        </Field>
        <Field label="Tipo" requirement="optional" error={errors?.caseTypeId?.[0]} hint={types.length ? undefined : "Nenhum tipo cadastrado para esta área."}>
          {(p) => <Select {...p} value={caseTypeId} onChange={(e) => setCaseTypeId(e.target.value)} options={types} placeholder="Sem tipo" disabled={!types.length} />}
        </Field>
        <Field label="Parte contrária" requirement="optional" className="col-span-2" error={errors?.opposingParty?.[0]}>
          {(p) => <Input {...p} value={opposingParty} onChange={(e) => setOpposingParty(e.target.value)} maxLength={300} />}
        </Field>
        <Field label="Resumo" requirement="required" className="col-span-2" error={errors?.summary?.[0]}>
          {(p) => <Textarea {...p} rows={4} value={summary} onChange={(e) => setSummary(e.target.value)} />}
        </Field>
      </div>
    </Dialog>
  );
}
