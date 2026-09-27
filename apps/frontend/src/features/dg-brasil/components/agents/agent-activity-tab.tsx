import Link from "next/link";
import { Activity } from "lucide-react";
import { EmptyState } from "@/components/feedback/states";
import { StatusBadge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/panel";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/table";
import { AGENT_TASK_STATUS_LABEL, AGENT_TASK_STATUS_TONE } from "@/lib/constants/status";
import { formatDateTime } from "@/lib/formatting";
import type { AgentTask } from "@/types";
import { dgRoutes } from "../../utils";

export function AgentActivityTab({ tasks }: { tasks: AgentTask[] }) {
  if (tasks.length === 0) {
    return (
      <Panel>
        <EmptyState icon={Activity} title="Nenhuma atividade registrada." description="As tarefas executadas por este agente aparecerão aqui." />
      </Panel>
    );
  }
  return (
    <Panel>
      <Table caption="Atividade do agente">
        <THead>
          <tr>
            <Th>Data/hora</Th>
            <Th>Tarefa</Th>
            <Th>Status</Th>
            <Th>Relacionados</Th>
          </tr>
        </THead>
        <TBody>
          {tasks.map((t) => (
            <Tr key={t.id}>
              <Td className="whitespace-nowrap tabular text-muted">{formatDateTime(t.at)}</Td>
              <Td className="text-foreground">{t.title}</Td>
              <Td>
                <StatusBadge status={t.status} labels={AGENT_TASK_STATUS_LABEL} tones={AGENT_TASK_STATUS_TONE} />
              </Td>
              <Td>
                <div className="flex flex-wrap gap-3 text-[12.5px]">
                  {t.reviewId && <RelLink href={dgRoutes.review(t.reviewId)}>Revisão</RelLink>}
                  {t.processId && <RelLink href={dgRoutes.process(t.processId)}>Processo</RelLink>}
                  {t.clientId && <RelLink href={dgRoutes.client(t.clientId)}>Cliente</RelLink>}
                  {!t.reviewId && !t.processId && !t.clientId && <span className="text-subtle">—</span>}
                </div>
              </Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    </Panel>
  );
}

function RelLink({ href, children }: { href: string; children: string }) {
  return (
    <Link href={href} className="font-medium text-navy-700 hover:underline underline-offset-2">
      {children}
    </Link>
  );
}
