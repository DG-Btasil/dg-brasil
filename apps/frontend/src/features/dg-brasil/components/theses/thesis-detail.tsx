"use client";

import { PageContainer } from "@/components/layout/guards";
import { StatusBadge } from "@/components/ui/badge";
import { DemoContentNotice, PageHeader, Timeline } from "@/components/ui/display";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { useUserMap } from "@/features/offices/hooks";
import { DEMO_LEGAL_DISCLAIMER, DEMO_REFERENCE_LABEL, LEGAL_AREA_LABEL } from "@/lib/constants/legal";
import { THESIS_STATUS_LABEL, THESIS_STATUS_TONE } from "@/lib/constants/status";
import { formatDate } from "@/lib/formatting";
import { useDgMaps, useThesis, useUsageIndex } from "../../hooks";
import { dgRoutes, formatVersion } from "../../utils";
import { DgNotFound } from "../shared/not-found";
import { BulletPanel, LinkListPanel } from "./thesis-panels";

export function ThesisDetail({ id }: { id: string }) {
  const thesis = useThesis(id);
  const maps = useDgMaps();
  const { byThesis } = useUsageIndex();
  const users = useUserMap();

  if (!thesis) return <DgNotFound title="Tese não encontrada" backHref={dgRoutes.section("teses")} backLabel="Voltar para as teses" />;

  const skills = thesis.skillIds.flatMap((sid) => {
    const s = maps.skills.get(sid);
    return s ? [{ id: s.id, label: s.name, href: dgRoutes.skill(s.id) }] : [];
  });
  const agents = (byThesis.get(thesis.id) ?? []).map((a) => ({ id: a.id, label: a.name, href: dgRoutes.agent(a.id) }));
  const versions = [...thesis.versions].sort((a, b) => b.version - a.version);

  return (
    <PageContainer>
      <PageHeader
        serif
        breadcrumbs={[{ label: "DG Brasil", href: dgRoutes.home }, { label: "Teses", href: dgRoutes.section("teses") }, { label: thesis.name }]}
        title={thesis.name}
        meta={
          <>
            <StatusBadge status={thesis.status} labels={THESIS_STATUS_LABEL} tones={THESIS_STATUS_TONE} />
            <span>{LEGAL_AREA_LABEL[thesis.area]}</span>
            <span>Versão {formatVersion(thesis.version)}</span>
            <span>Atualizada em {formatDate(thesis.updatedAt)}</span>
          </>
        }
      />
      <DemoContentNotice className="mb-5">{DEMO_LEGAL_DISCLAIMER} Não utilize como fundamento real.</DemoContentNotice>

      <div className="grid grid-cols-[minmax(0,1fr)_340px] gap-5">
        <div className="space-y-5">
          <Panel>
            <PanelHeader title="Resumo" />
            <PanelBody>
              <p className="text-[13px] leading-relaxed text-foreground">{thesis.summary}</p>
            </PanelBody>
          </Panel>
          <BulletPanel title="Fundamentos" items={thesis.foundations} empty="Nenhum fundamento cadastrado." />
          <BulletPanel title="Critérios de aplicação" items={thesis.applicationCriteria} empty="Nenhum critério cadastrado." />
          <BulletPanel title="Documentos necessários" items={thesis.requiredDocuments} empty="Nenhum documento indicado." />
          <Panel>
            <PanelHeader title="Referências" description="Referências fictícias; nenhuma decisão ou precedente real é citado." />
            {thesis.references.length === 0 ? (
              <PanelBody>
                <p className="text-[13px] text-muted">Nenhuma referência cadastrada.</p>
              </PanelBody>
            ) : (
              <ul className="divide-y divide-line">
                {thesis.references.map((r, i) => (
                  <li key={`${i}-${r.title}`} className="px-5 py-3">
                    <p className="text-[13px] font-medium text-foreground">{r.title}</p>
                    {r.note && <p className="mt-0.5 text-[12.5px] text-muted">{r.note}</p>}
                    <DemoContentNotice className="mt-1.5">{DEMO_REFERENCE_LABEL}</DemoContentNotice>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
        <div className="space-y-5">
          <BulletPanel title="Modelos relacionados" items={thesis.relatedTemplates} empty="Nenhum modelo relacionado." />
          <LinkListPanel title="Skills relacionadas" items={skills} empty="Nenhuma Skill relacionada." />
          <LinkListPanel title="Agentes que utilizam" items={agents} empty="Nenhum agente utiliza esta tese." />
          <Panel>
            <PanelHeader title="Histórico de versões" />
            <PanelBody>
              {versions.length === 0 ? (
                <p className="text-[13px] text-muted">Sem versões registradas.</p>
              ) : (
                <Timeline
                  items={versions.map((v, i) => ({
                    id: `v${v.version}`,
                    title: `${formatVersion(v.version)} · ${v.note}`,
                    meta: formatDate(v.at),
                    description: users.get(v.authorId)?.name,
                    highlight: i === 0,
                    tone: i === 0 ? "gold" : "neutral",
                  }))}
                />
              )}
            </PanelBody>
          </Panel>
        </div>
      </div>
    </PageContainer>
  );
}

