import type { Metadata } from "next";
import { connection } from "next/server";
import { PageContainer } from "@/components/layout/guards";
import { HistoryView } from "@/features/dg-brasil/components/history/history-view";
import { DgHeader } from "@/features/dg-brasil/components/shared/dg-header";
import { getDgHistoryAction, getDgOverviewAction } from "@/server/domain/dg/actions";

export const metadata: Metadata = { title: "Histórico" };

export default async function DgHistoryRoute() {
  // Página por usuário (lê a sessão): só é montada com a requisição, nunca no build.
  await connection();
  const [overview, history] = await Promise.all([getDgOverviewAction(), getDgHistoryAction({ limit: 60 })]);
  return (
    <PageContainer>
      <DgHeader active="historico" overview={overview.ok ? overview.data : undefined} />
      <HistoryView result={history} />
    </PageContainer>
  );
}
