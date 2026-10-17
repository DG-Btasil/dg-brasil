import { PageContainer } from "@/components/layout/guards";
import { HistoryView } from "@/features/dg-brasil/components/history/history-view";
import { DgHeader } from "@/features/dg-brasil/components/shared/dg-header";
import { getDgHistoryAction, getDgOverviewAction } from "@/server/domain/dg/actions";

export default async function DgHistoryRoute() {
  const [overview, history] = await Promise.all([getDgOverviewAction(), getDgHistoryAction({ limit: 60 })]);
  return (
    <PageContainer>
      <DgHeader active="historico" overview={overview.ok ? overview.data : undefined} />
      <HistoryView result={history} />
    </PageContainer>
  );
}
