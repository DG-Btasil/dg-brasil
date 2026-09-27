"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookOpen } from "lucide-react";
import { EmptyState } from "@/components/feedback/states";
import { StatusBadge } from "@/components/ui/badge";
import { DemoContentNotice } from "@/components/ui/display";
import { Panel } from "@/components/ui/panel";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/table";
import { LEGAL_AREA_LABEL } from "@/lib/constants/legal";
import { THESIS_STATUS_LABEL, THESIS_STATUS_TONE } from "@/lib/constants/status";
import { formatDate } from "@/lib/formatting";
import { useTheses, useUsageIndex } from "../../hooks";
import { dgRoutes, formatVersion } from "../../utils";

export function ThesisTable() {
  const theses = useTheses();
  const { byThesis } = useUsageIndex();
  const router = useRouter();

  return (
    <section aria-labelledby="dg-theses-title">
      <div className="mb-3 flex items-end justify-between gap-4">
        <div>
          <h2 id="dg-theses-title" className="text-[15px] font-semibold text-foreground">
            Teses
          </h2>
          <p className="mt-0.5 text-[12.5px] text-muted">Conhecimento jurídico do escritório consultado pelos agentes.</p>
        </div>
        <DemoContentNotice />
      </div>
      <Panel>
        {theses.length === 0 ? (
          <EmptyState icon={BookOpen} title="Nenhuma tese cadastrada." description="As teses do escritório aparecerão aqui." />
        ) : (
          <Table caption="Teses do escritório">
            <THead>
              <tr>
                <Th>Nome</Th>
                <Th>Área</Th>
                <Th>Status</Th>
                <Th>Versão</Th>
                <Th>Agentes relacionados</Th>
                <Th>Última atualização</Th>
              </tr>
            </THead>
            <TBody>
              {theses.map((t) => {
                const agents = byThesis.get(t.id) ?? [];
                return (
                  <Tr key={t.id} interactive onClick={() => router.push(dgRoutes.thesis(t.id))}>
                    <Td className="max-w-[360px]">
                      <Link href={dgRoutes.thesis(t.id)} onClick={(e) => e.stopPropagation()} className="font-medium text-navy-700 hover:underline underline-offset-2">
                        {t.name}
                      </Link>
                    </Td>
                    <Td className="whitespace-nowrap text-[12.5px]">{LEGAL_AREA_LABEL[t.area]}</Td>
                    <Td>
                      <StatusBadge status={t.status} labels={THESIS_STATUS_LABEL} tones={THESIS_STATUS_TONE} />
                    </Td>
                    <Td className="tabular">{formatVersion(t.version)}</Td>
                    <Td className="max-w-[240px] text-[12.5px]">
                      {agents.length === 0 ? <span className="text-subtle">Nenhum</span> : agents.map((a) => a.name).join(", ")}
                    </Td>
                    <Td className="whitespace-nowrap tabular text-[12.5px]">{formatDate(t.updatedAt)}</Td>
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
