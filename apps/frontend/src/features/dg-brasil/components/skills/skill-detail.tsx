"use client";

import Link from "next/link";
import { MessagesSquare } from "lucide-react";
import { PageContainer } from "@/components/layout/guards";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/display";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { useUserMap } from "@/features/offices/hooks";
import { AGENT_STATUS_LABEL, AGENT_STATUS_TONE, SKILL_STATUS_LABEL, SKILL_STATUS_TONE } from "@/lib/constants/status";
import { formatDateTime } from "@/lib/formatting";
import { useChangeHistory, useSkill, useUsageIndex } from "../../hooks";
import { useTutor } from "../../tutor/use-tutor";
import { dgRoutes, formatVersion } from "../../utils";
import { DgNotFound } from "../shared/not-found";
import { SkillAdvanced } from "./skill-advanced";
import { SkillHistory } from "./skill-history";

export function SkillDetail({ id }: { id: string }) {
  const skill = useSkill(id);
  const history = useChangeHistory(id);
  const { bySkill } = useUsageIndex();
  const users = useUserMap();
  const { openWithSkill } = useTutor();

  if (!skill) return <DgNotFound title="Skill não encontrada" backHref={dgRoutes.section("skills")} backLabel="Voltar para as Skills" />;
  const agents = bySkill.get(skill.id) ?? [];

  return (
    <PageContainer>
      <PageHeader
        serif
        breadcrumbs={[{ label: "DG Brasil", href: dgRoutes.home }, { label: "Skills", href: dgRoutes.section("skills") }, { label: skill.name }]}
        title={skill.name}
        description={skill.description}
        meta={
          <>
            <StatusBadge status={skill.status} labels={SKILL_STATUS_LABEL} tones={SKILL_STATUS_TONE} />
            <span>Versão {formatVersion(skill.version)}</span>
            <span>
              Última alteração: {formatDateTime(skill.updatedAt)} · {users.get(skill.updatedBy)?.name ?? "—"}
            </span>
          </>
        }
        actions={
          <Button variant="secondary" icon={<MessagesSquare className="size-4" aria-hidden />} onClick={() => openWithSkill(skill)}>
            Pedir ajuda ao Tutor DG
          </Button>
        }
      />

      <div className="grid grid-cols-[minmax(0,1fr)_340px] gap-5">
        <div className="space-y-5">
          <Panel>
            <PanelHeader title="Para que serve" />
            <PanelBody>
              <p className="text-[13px] leading-relaxed text-foreground">{skill.purpose}</p>
            </PanelBody>
          </Panel>
          <Panel>
            <PanelHeader
              title="Parâmetros"
              description="Ajustes em linguagem simples que definem como a Skill se comporta. Para alterá-los, peça ao Tutor DG."
            />
            {skill.parameters.length === 0 ? (
              <PanelBody>
                <p className="text-[13px] text-muted">Esta Skill não possui parâmetros ajustáveis.</p>
              </PanelBody>
            ) : (
              <dl className="divide-y divide-line">
                {skill.parameters.map((p) => (
                  <div key={p.key} className="grid grid-cols-[260px_minmax(0,1fr)] gap-4 px-5 py-3">
                    <dt className="text-[12.5px] font-medium text-muted">{p.label}</dt>
                    <dd className="text-[13px] text-foreground">{p.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </Panel>
          <SkillHistory entries={history} />
          <SkillAdvanced skill={skill} />
        </div>
        <div className="space-y-5">
          <Panel>
            <PanelHeader title="Agentes que utilizam" />
            {agents.length === 0 ? (
              <PanelBody>
                <p className="text-[13px] text-muted">Nenhum agente utiliza esta Skill.</p>
              </PanelBody>
            ) : (
              <ul className="divide-y divide-line">
                {agents.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                    <Link href={dgRoutes.agent(a.id)} className="text-[13px] font-medium text-navy-700 hover:underline underline-offset-2">
                      {a.name}
                    </Link>
                    <StatusBadge status={a.status} labels={AGENT_STATUS_LABEL} tones={AGENT_STATUS_TONE} />
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </PageContainer>
  );
}
