"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Puzzle } from "lucide-react";
import { EmptyState } from "@/components/feedback/states";
import { StatusBadge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/panel";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/table";
import { useUserMap } from "@/features/offices/hooks";
import { SKILL_STATUS_LABEL, SKILL_STATUS_TONE } from "@/lib/constants/status";
import { formatDate } from "@/lib/formatting";
import { useSkills, useUsageIndex } from "../../hooks";
import { dgRoutes, formatVersion } from "../../utils";

export function SkillTable() {
  const skills = useSkills();
  const { bySkill } = useUsageIndex();
  const users = useUserMap();
  const router = useRouter();

  return (
    <section aria-labelledby="dg-skills-title">
      <div className="mb-3">
        <h2 id="dg-skills-title" className="text-[15px] font-semibold text-foreground">
          Skills
        </h2>
        <p className="mt-0.5 text-[12.5px] text-muted">Capacidades reutilizáveis dos agentes. Os parâmetros podem ser ajustados sem editar arquivos técnicos.</p>
      </div>
      <Panel>
        {skills.length === 0 ? (
          <EmptyState icon={Puzzle} title="Nenhuma Skill cadastrada." />
        ) : (
          <Table caption="Skills do escritório">
            <THead>
              <tr>
                <Th>Nome</Th>
                <Th>Função</Th>
                <Th>Agentes que utilizam</Th>
                <Th>Versão</Th>
                <Th>Status</Th>
                <Th>Última alteração</Th>
              </tr>
            </THead>
            <TBody>
              {skills.map((s) => {
                const agents = bySkill.get(s.id) ?? [];
                return (
                  <Tr key={s.id} interactive onClick={() => router.push(dgRoutes.skill(s.id))}>
                    <Td className="max-w-[280px]">
                      <Link href={dgRoutes.skill(s.id)} onClick={(e) => e.stopPropagation()} className="font-medium text-navy-700 hover:underline underline-offset-2">
                        {s.name}
                      </Link>
                      <p className="mt-0.5 line-clamp-1 text-[12px] text-muted">{s.description}</p>
                    </Td>
                    <Td className="max-w-[300px] text-[12.5px] text-foreground">
                      <span className="line-clamp-2">{s.purpose}</span>
                    </Td>
                    <Td className="max-w-[220px] text-[12.5px]">
                      {agents.length === 0 ? <span className="text-subtle">Nenhum</span> : agents.map((a) => a.name).join(", ")}
                    </Td>
                    <Td className="tabular">{formatVersion(s.version)}</Td>
                    <Td>
                      <StatusBadge status={s.status} labels={SKILL_STATUS_LABEL} tones={SKILL_STATUS_TONE} />
                    </Td>
                    <Td className="whitespace-nowrap text-[12.5px]">
                      <span className="tabular">{formatDate(s.updatedAt)}</span>
                      <span className="block text-muted">{users.get(s.updatedBy)?.name ?? "—"}</span>
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        )}
      </Panel>
    </section>
  );
}
