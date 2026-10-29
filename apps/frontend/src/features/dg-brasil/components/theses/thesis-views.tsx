"use client";

import Link from "next/link";
import { useState } from "react";
import { BookOpen, Pencil, Plus } from "lucide-react";
import { Can } from "@/components/layout/guards";
import { EmptyState } from "@/components/feedback/states";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/display";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/table";
import { THESIS_STATUS_LABEL, THESIS_STATUS_TONE } from "@/lib/constants/status";
import { formatDateTime } from "@/lib/formatting";
import type { DgCatalogDTO, ThesisDetailDTO, ThesisListItemDTO } from "@/server/domain/dg/dto";
import { dgRoutes, formatVersion } from "../../utils";
import { InstructionsView, LinkedNames, VersionsList } from "../shared/bits";
import { ThesisFormDrawer } from "./thesis-form-drawer";

export function ThesisTable({ theses, catalog }: { theses: ThesisListItemDTO[]; catalog: DgCatalogDTO }) {
  const [creating, setCreating] = useState(false);
  const agents = new Map(catalog.agents.map((a) => [a.id, a.name]));
  return (
    <Panel>
      <PanelHeader
        title="Teses"
        description="Teses jurídicas aprovadas pelo escritório. O agente consulta só as ativas e autorizadas para ele."
        actions={
          <Can permission="dgbrasil.manage">
            <Button icon={<Plus className="size-4" aria-hidden />} onClick={() => setCreating(true)}>
              Criar tese
            </Button>
          </Can>
        }
      />
      {theses.length === 0 ? (
        <EmptyState icon={BookOpen} title="Nenhuma tese cadastrada." />
      ) : (
        <Table caption="Teses">
          <THead>
            <tr>
              <Th>Tese</Th>
              <Th>Área</Th>
              <Th>Agentes</Th>
              <Th>Versão</Th>
              <Th>Atualizada</Th>
              <Th>Situação</Th>
            </tr>
          </THead>
          <TBody>
            {theses.map((t) => (
              <Tr key={t.id}>
                <Td>
                  <Link href={dgRoutes.thesis(t.id)} className="font-medium text-foreground hover:text-navy hover:underline underline-offset-2">
                    {t.title}
                  </Link>
                </Td>
                <Td className="text-[12.5px] text-muted">{t.legalAreaName}</Td>
                <Td className="text-[12.5px] text-muted">{t.agentIds.map((id) => agents.get(id)).filter(Boolean).join(", ") || "—"}</Td>
                <Td className="tabular">{formatVersion(t.version)}</Td>
                <Td className="tabular text-[12px] text-muted">{formatDateTime(t.updatedAt)}</Td>
                <Td>
                  <StatusBadge status={t.status} labels={THESIS_STATUS_LABEL} tones={THESIS_STATUS_TONE} />
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
      {creating && <ThesisFormDrawer open onOpenChange={setCreating} catalog={catalog} />}
    </Panel>
  );
}

export function ThesisDetail({ thesis, catalog }: { thesis: ThesisDetailDTO; catalog: DgCatalogDTO }) {
  const [editing, setEditing] = useState(false);
  const section = (title: string, text?: string) => (
    <Panel>
      <PanelHeader title={title} />
      <PanelBody>
        <InstructionsView text={text ?? ""} />
      </PanelBody>
    </Panel>
  );
  return (
    <>
      <PageHeader
        serif
        breadcrumbs={[{ label: "DG Brasil", href: dgRoutes.home }, { label: "Teses", href: dgRoutes.section("teses") }, { label: thesis.title }]}
        title={thesis.title}
        description={thesis.description}
        meta={
          <>
            <StatusBadge status={thesis.status} labels={THESIS_STATUS_LABEL} tones={THESIS_STATUS_TONE} />
            <span>Versão {formatVersion(thesis.version)}</span>
            <span>{thesis.legalAreaName}</span>
          </>
        }
        actions={
          <Can permission="dgbrasil.manage">
            <Button variant="secondary" icon={<Pencil className="size-4" aria-hidden />} onClick={() => setEditing(true)}>
              Editar
            </Button>
          </Can>
        }
      />
      <div className="space-y-5">
        {section("Fundamentos", thesis.foundations)}
        {section("Quando se aplica", thesis.applicationCriteria)}
        {section("Quando não se aplica", thesis.exclusionCriteria)}
        {thesis.notes && section("Observações internas", thesis.notes)}
        <Panel>
          <PanelHeader title="Vínculos" />
          <PanelBody className="space-y-3">
            <div>
              <p className="mb-1.5 text-[12px] font-medium text-subtle">Agentes autorizados</p>
              <LinkedNames ids={thesis.agentIds} catalog={catalog.agents} href={dgRoutes.agent} empty="Nenhum agente." />
            </div>
            <div>
              <p className="mb-1.5 text-[12px] font-medium text-subtle">Referências</p>
              <LinkedNames ids={thesis.referenceIds} catalog={catalog.references} empty="Nenhuma referência." />
            </div>
          </PanelBody>
        </Panel>
        <Panel>
          <PanelHeader title="Versões" />
          <PanelBody>
            <VersionsList versions={thesis.versions} current={thesis.versions[0]?.id} />
          </PanelBody>
        </Panel>
      </div>
      {editing && <ThesisFormDrawer open onOpenChange={setEditing} thesis={thesis} catalog={catalog} />}
    </>
  );
}
