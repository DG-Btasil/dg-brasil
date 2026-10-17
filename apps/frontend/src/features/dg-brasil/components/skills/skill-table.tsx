"use client";

import Link from "next/link";
import { useState } from "react";
import { Plus, Puzzle } from "lucide-react";
import { Can } from "@/components/layout/guards";
import { EmptyState } from "@/components/feedback/states";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/table";
import { SKILL_STATUS_LABEL, SKILL_STATUS_TONE } from "@/lib/constants/status";
import { formatDateTime, pluralize } from "@/lib/formatting";
import type { DgCatalogDTO, SkillListItemDTO } from "@/server/domain/dg/dto";
import { dgRoutes, formatVersion } from "../../utils";
import { SkillFormDrawer } from "./skill-form-drawer";

export function SkillTable({ skills, catalog }: { skills: SkillListItemDTO[]; catalog: DgCatalogDTO }) {
  const [creating, setCreating] = useState(false);
  const agents = new Map(catalog.agents.map((a) => [a.id, a.name]));
  const action = (
    <Can permission="dgbrasil.manage">
      <Button icon={<Plus className="size-4" aria-hidden />} onClick={() => setCreating(true)}>
        Criar skill
      </Button>
    </Can>
  );
  return (
    <Panel>
      <PanelHeader title="Skills" description="Instruções + arquivos que os agentes carregam no ambiente isolado. Cada alteração vira uma versão." actions={action} />
      {skills.length === 0 ? (
        <EmptyState icon={Puzzle} title="Nenhuma skill cadastrada." description="Envie a pasta de uma skill do Claude Code: o SKILL.md e os scripts vêm juntos." />
      ) : (
        <Table caption="Skills">
          <THead>
            <tr>
              <Th>Skill</Th>
              <Th>Usada por</Th>
              <Th className="text-right">Arquivos</Th>
              <Th>Versão</Th>
              <Th>Atualizada</Th>
              <Th>Situação</Th>
            </tr>
          </THead>
          <TBody>
            {skills.map((s) => (
              <Tr key={s.id}>
                <Td>
                  <Link href={dgRoutes.skill(s.id)} className="font-medium text-foreground hover:text-navy hover:underline underline-offset-2">
                    {s.name}
                  </Link>
                  <span className="block font-mono text-[11.5px] text-subtle">{s.slug}</span>
                </Td>
                <Td className="text-[12.5px] text-muted">
                  {s.agentIds.length ? s.agentIds.map((id) => agents.get(id)).filter(Boolean).join(", ") : "—"}
                </Td>
                <Td className="text-right tabular">{s.fileCount}</Td>
                <Td className="tabular">{formatVersion(s.version)}</Td>
                <Td className="tabular text-[12px] text-muted">{formatDateTime(s.updatedAt)}</Td>
                <Td>
                  <StatusBadge status={s.status} labels={SKILL_STATUS_LABEL} tones={SKILL_STATUS_TONE} />
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
      {skills.length > 0 && <p className="border-t border-line px-5 py-2 text-[12px] text-muted">{pluralize(skills.length, "skill", "skills")}</p>}
      {creating && <SkillFormDrawer open onOpenChange={setCreating} />}
    </Panel>
  );
}
