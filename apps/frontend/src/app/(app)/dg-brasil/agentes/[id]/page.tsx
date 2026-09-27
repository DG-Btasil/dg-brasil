import { Suspense } from "react";
import { AgentDetail } from "@/features/dg-brasil/components/agents/agent-detail";

export default async function AgentPage({ params }: PageProps<"/dg-brasil/agentes/[id]">) {
  const { id } = await params;
  return (
    <Suspense>
      <AgentDetail id={id} />
    </Suspense>
  );
}
