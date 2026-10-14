"use client";

import { Wordmark } from "@/components/layout/wordmark";
import { Button } from "@/components/ui/button";
import { DefinitionGrid, Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { NotAvailable } from "@/components/ui/tooltip";
import { Callout } from "@/components/feedback/states";
import { usePermission } from "@/features/auth/hooks";
import { useCallback, useEffect, useState } from "react";
import { callAction, type ActionResult } from "@/lib/actions/result";
import { ActionErrorState } from "@/components/feedback/action-error";
import { SkeletonRows } from "@/components/feedback/states";
import { getOwnerOfficeAction } from "@/server/domain/organizations/actions";
import type { OwnerOfficeDetailDTO } from "@/server/domain/organizations/dto";
import { officeFromDto } from "../../office-input";
import { maskCNPJ } from "@/lib/formatting";
import type { Office } from "@/types";
import { SectionHeader } from "../section-header";
import { OfficeForm } from "./office-form";

/** Geral: dados do escritório lidos e gravados no servidor (escritório da sessão). */
export function GeneralSection() {
  const [result, setResult] = useState<ActionResult<OwnerOfficeDetailDTO> | null>(null);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    let alive = true;
    callAction(() => getOwnerOfficeAction()).then((r) => {
      if (alive) setResult(r);
    });
    return () => {
      alive = false;
    };
  }, [version]);
  if (!result) return <SkeletonRows rows={6} />;
  if (!result.ok) return <ActionErrorState error={result} onRetry={reload} title="Não foi possível carregar os dados do escritório." />;
  if (result.data.surface !== "INTERNAL") return null;
  return <General office={officeFromDto(result.data.office)} onSaved={reload} />;
}

function General({ office, onSaved }: { office: Office; onSaved: () => void }) {
  const canEdit = usePermission("settings.office.edit");
  return (
    <div className="space-y-6">
      <SectionHeader title="Geral" description="Dados cadastrais do escritório, preferências regionais e identidade." />
      <Panel>
        <PanelHeader title="Dados do escritório" description={canEdit ? "Alterações ficam registradas na auditoria." : undefined} />
        <PanelBody className="px-6 py-0">
          {canEdit ? (
            <OfficeForm key={office.updatedAt} office={office} onSaved={onSaved} />
          ) : (
            <div className="space-y-4 py-5">
              <Callout tone="neutral" title="Somente leitura">
                Apenas administradores podem alterar os dados do escritório.
              </Callout>
              <OfficeReadOnly office={office} />
            </div>
          )}
        </PanelBody>
      </Panel>

      <div className="grid grid-cols-2 gap-6">
        <Panel>
          <PanelHeader
            title="Preferências regionais"
            actions={
              <NotAvailable>
                <Button size="sm" variant="secondary">
                  Alterar
                </Button>
              </NotAvailable>
            }
          />
          <PanelBody>
            <DefinitionGrid
              items={[
                { label: "Formato de data", value: "DD/MM/AAAA" },
                { label: "Fuso horário", value: "Brasília (America/Sao_Paulo)" },
                { label: "Moeda", value: "Real (R$)" },
                { label: "Idioma", value: "Português (Brasil)" },
              ]}
            />
          </PanelBody>
        </Panel>
        <Panel>
          <PanelHeader
            title="Identidade"
            description="Prévia da marca exibida na interface."
            actions={
              <NotAvailable message="Personalização de marca disponível em uma próxima etapa">
                <Button size="sm" variant="secondary">
                  Enviar logotipo
                </Button>
              </NotAvailable>
            }
          />
          <PanelBody className="space-y-3">
            <div className="flex items-center rounded-md bg-navy px-4 py-3.5">
              <Wordmark tone="light" />
            </div>
            <div className="flex items-center rounded-md border border-line bg-surface-muted px-4 py-3.5">
              <Wordmark tone="dark" />
              <span className="ml-auto text-[12px] text-muted">{office.tradeName ?? office.name}</span>
            </div>
          </PanelBody>
        </Panel>
      </div>
    </div>
  );
}

function OfficeReadOnly({ office }: { office: Office }) {
  const a = office.address;
  return (
    <DefinitionGrid
      columns={3}
      items={[
        { label: "Nome", value: office.name },
        { label: "Razão social", value: office.legalName },
        { label: "CNPJ", value: office.cnpj ? <span className="tabular">{maskCNPJ(office.cnpj)}</span> : null },
        { label: "OAB", value: office.oab },
        { label: "Responsável", value: office.principalLawyer },
        { label: "E-mail", value: office.email },
        { label: "Telefone", value: office.phone },
        { label: "Site", value: office.website },
        {
          label: "Endereço",
          value: a ? `${a.street}, ${a.number}${a.complement ? ` — ${a.complement}` : ""} · ${a.district} · ${a.city}/${a.state}` : null,
        },
        { label: "Estados de atuação", value: office.statesOfPractice.join(", ") || null },
        { label: "Unidades", value: office.units.join(" · ") || null },
      ]}
    />
  );
}
