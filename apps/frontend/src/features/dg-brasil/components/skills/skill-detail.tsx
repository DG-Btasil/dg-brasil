"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { Can } from "@/components/layout/guards";
import { Callout } from "@/components/feedback/states";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/display";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/table";
import { SKILL_STATUS_LABEL, SKILL_STATUS_TONE } from "@/lib/constants/status";
import { formatFileSize } from "@/lib/formatting";
import type { DgCatalogDTO, SkillDetailDTO } from "@/server/domain/dg/dto";
import { dgRoutes, formatVersion } from "../../utils";
import { InstructionsView, LinkedNames, VersionsList } from "../shared/bits";
import { SkillFormDrawer } from "./skill-form-drawer";

export function SkillDetail({ skill, catalog }: { skill: SkillDetailDTO; catalog: DgCatalogDTO }) {
  const [editing, setEditing] = useState(false);
  return (
    <>
      <PageHeader
        serif
        breadcrumbs={[{ label: "DG Brasil", href: dgRoutes.home }, { label: "Skills", href: dgRoutes.section("skills") }, { label: skill.name }]}
        title={skill.name}
        description={skill.description}
        meta={
          <>
            <StatusBadge status={skill.status} labels={SKILL_STATUS_LABEL} tones={SKILL_STATUS_TONE} />
            <span>Versão {formatVersion(skill.version)}</span>
            <span className="font-mono">{skill.slug}</span>
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
        {skill.status !== "ACTIVE" && <Callout tone="warning">Esta skill não está ativa: os agentes não a carregam.</Callout>}
        <Panel>
          <PanelHeader title="Usada pelos agentes" />
          <PanelBody>
            <LinkedNames ids={skill.agentIds} catalog={catalog.agents} href={dgRoutes.agent} empty="Nenhum agente usa esta skill. Vincule na tela do agente." />
          </PanelBody>
        </Panel>
        <Panel>
          <PanelHeader title="Instruções (SKILL.md)" description={skill.providerRegistered ? "Esta versão já foi carregada no ambiente do provedor por uma execução." : "Esta versão ainda não foi usada por nenhuma execução."} />
          <PanelBody>
            <InstructionsView text={skill.instructions} />
          </PanelBody>
        </Panel>
        <Panel>
          <PanelHeader title="Arquivos" description="Ficam disponíveis no ambiente isolado, na pasta da skill." />
          {skill.files.length === 0 ? (
            <PanelBody>
              <p className="text-[13px] text-muted">Skill só com instruções.</p>
            </PanelBody>
          ) : (
            <Table caption="Arquivos da skill">
              <THead>
                <tr>
                  <Th>Caminho</Th>
                  <Th>Tipo</Th>
                  <Th className="text-right">Tamanho</Th>
                  <Th>SHA-256</Th>
                </tr>
              </THead>
              <TBody>
                {skill.files.map((f) => (
                  <Tr key={f.path}>
                    <Td className="font-mono text-[12.5px]">{f.path}</Td>
                    <Td className="text-[12px] text-muted">{f.mimeType}</Td>
                    <Td className="text-right tabular text-[12px]">{formatFileSize(f.size)}</Td>
                    <Td className="font-mono text-[11px] text-subtle">{f.sha256.slice(0, 12)}…</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Panel>
        <Panel>
          <PanelHeader title="Versões" description="Append-only. Cada execução registra a versão que carregou." />
          <PanelBody>
            <VersionsList versions={skill.versions} current={skill.versionId} />
          </PanelBody>
        </Panel>
      </div>
      {editing && <SkillFormDrawer open onOpenChange={setEditing} skill={skill} />}
    </>
  );
}
