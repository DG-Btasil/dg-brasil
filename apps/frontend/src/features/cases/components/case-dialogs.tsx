"use client";

import { useState } from "react";
import { LEGAL_AREA_LABEL, LEGAL_AREAS, type LegalArea } from "@/lib/constants/legal";
import { isAccepted } from "@/lib/domain/legal-case";
import { Callout } from "@/components/feedback/states";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import { usePartnerOffices } from "@/features/partners/hooks";
import { useOffice } from "@/features/offices/hooks";
import type { LegalCase } from "@/types";
import { useCaseActions, useCasePartnerId, useEligibleLawyers } from "../hooks";
import { LINK_PARTNER_LABEL } from "../utils";

interface DialogBase {
  legalCase: LegalCase;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Aceite: exige advogado responsável; origem parceiro cria o acordo de parceria (snapshot). */
export function AcceptCaseDialog({ legalCase, open, onOpenChange }: DialogBase) {
  const actions = useCaseActions();
  const lawyers = useEligibleLawyers();
  const partnerId = useCasePartnerId(legalCase);
  const partner = usePartnerOffices().find((p) => p.id === partnerId);
  const office = useOffice();
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
    const ok = await actions.accept(legalCase.id, lawyerId);
    setSaving(false);
    if (ok !== null) onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={needsLawyer ? "Definir advogado responsável" : "Aceitar caso"}
      description={needsLawyer ? "Para aceitar o caso, defina o advogado responsável." : `Caso “${legalCase.title}”.`}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
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
        {partner ? (
          <Callout tone="info" title="Acordo de parceria">
            Ao aceitar, será criado o acordo de parceria com a divisão vigente de {partner.name}: {partner.partnershipPercentage}% parceiro / {partner.ownerPercentage}%{" "}
            {office.name}. Mudanças futuras na divisão padrão não alteram este caso.
          </Callout>
        ) : (
          <p className="text-[12.5px] text-muted">Caso próprio de {office.name}: sem acordo de parceria.</p>
        )}
      </div>
    </Dialog>
  );
}

/** Rejeição: comunicação ao parceiro (obrigatória) e nota interna (nunca exibida ao parceiro). */
export function RejectCaseDialog({ legalCase, open, onOpenChange }: DialogBase) {
  const actions = useCaseActions();
  const partnerId = useCasePartnerId(legalCase);
  const fromPartner = !!partnerId || !!legalCase.partnerOrganizationId;
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
    const ok = await actions.reject(legalCase.id, { publicReason, internalNote });
    setSaving(false);
    if (ok !== null) onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Rejeitar caso"
      description={`Caso “${legalCase.title}”.`}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
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

/** Origem do caso. Depois do aceite: somente Administrador, com confirmação forte e auditoria. */
export function ChangeOriginDialog({ legalCase, open, onOpenChange, options }: DialogBase & { options: { value: string; label: string }[] }) {
  const actions = useCaseActions();
  const accepted = isAccepted(legalCase.status);
  const [originOrganizationId, setOriginOrganizationId] = useState(legalCase.originOrganizationId);
  const office = useOffice();
  const [confirmed, setConfirmed] = useState(false);
  const [linkPartner, setLinkPartner] = useState(false);
  const [saving, setSaving] = useState(false);
  const unchanged = originOrganizationId === legalCase.originOrganizationId;
  // A origem não concede acesso: vincular o parceiro a um caso interno é opt-in explícito.
  const canLinkPartner = !unchanged && !legalCase.partnerOrganizationId && originOrganizationId !== office.id;

  async function confirm() {
    setSaving(true);
    const ok = await actions.changeOrigin(legalCase.id, originOrganizationId, canLinkPartner && linkPartner);
    setSaving(false);
    if (ok !== null) onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Alterar origem do caso"
      description="A origem do caso define a parceria e o financeiro. Ela é independente da origem do cliente."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
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
            <Checkbox label="Entendo o impacto e quero alterar a origem deste caso aceito." checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          </>
        )}
      </div>
    </Dialog>
  );
}

export function AssignLawyerDialog({ legalCase, open, onOpenChange }: DialogBase) {
  const actions = useCaseActions();
  const lawyers = useEligibleLawyers();
  const [lawyerId, setLawyerId] = useState(legalCase.assignedLawyerId ?? "");
  const [saving, setSaving] = useState(false);

  async function confirm() {
    if (!lawyerId) return;
    setSaving(true);
    const ok = await actions.assignLawyer(legalCase.id, lawyerId);
    setSaving(false);
    if (ok !== null) onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Definir advogado responsável"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={confirm} loading={saving} disabled={!lawyerId}>
            Salvar
          </Button>
        </>
      }
    >
      <Field label="Advogado responsável" requirement="required" hint="Advogados internos ou Administrador inscrito na OAB.">
        {(p) => <Select {...p} value={lawyerId} onChange={(e) => setLawyerId(e.target.value)} options={lawyers} placeholder="Selecione" />}
      </Field>
    </Dialog>
  );
}

const areaOptions = LEGAL_AREAS.map((a) => ({ value: a, label: LEGAL_AREA_LABEL[a] }));

/** Edição manual dos dados do caso. */
export function EditCaseDialog({ legalCase, open, onOpenChange }: DialogBase) {
  const actions = useCaseActions();
  const [title, setTitle] = useState(legalCase.title);
  const [area, setArea] = useState<LegalArea>(legalCase.area);
  const [caseType, setCaseType] = useState(legalCase.caseType);
  const [opposingParty, setOpposingParty] = useState(legalCase.opposingParty ?? "");
  const [summary, setSummary] = useState(legalCase.summary);
  const [saving, setSaving] = useState(false);
  const invalid = !title.trim() || !caseType.trim() || !summary.trim();

  async function confirm() {
    if (invalid) return;
    setSaving(true);
    const ok = await actions.update(legalCase.id, { title: title.trim(), area, caseType: caseType.trim(), opposingParty: opposingParty.trim() || undefined, summary: summary.trim() });
    setSaving(false);
    if (ok !== null) onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="Editar caso"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={confirm} loading={saving} disabled={invalid}>
            Salvar alterações
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-4">
        <Field label="Título" requirement="required" className="col-span-2">
          {(p) => <Input {...p} value={title} onChange={(e) => setTitle(e.target.value)} />}
        </Field>
        <Field label="Área" requirement="required">
          {(p) => <Select {...p} value={area} onChange={(e) => setArea(e.target.value as LegalArea)} options={areaOptions} />}
        </Field>
        <Field label="Tipo" requirement="required">
          {(p) => <Input {...p} value={caseType} onChange={(e) => setCaseType(e.target.value)} />}
        </Field>
        <Field label="Parte contrária" requirement="optional" className="col-span-2">
          {(p) => <Input {...p} value={opposingParty} onChange={(e) => setOpposingParty(e.target.value)} />}
        </Field>
        <Field label="Resumo" requirement="required" className="col-span-2">
          {(p) => <Textarea {...p} rows={4} value={summary} onChange={(e) => setSummary(e.target.value)} />}
        </Field>
      </div>
    </Dialog>
  );
}
