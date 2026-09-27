"use client";

import { cn } from "@/lib/cn";
import { Can } from "@/components/layout/guards";
import { useCan } from "@/features/auth/hooks";
import { AgentActivity } from "./agent-activity";
import { AttentionPanel } from "./attention-panel";
import { FinanceSnapshot } from "./finance-snapshot";
import { HomeGreeting } from "./home-greeting";
import { HomeKpis } from "./home-kpis";
import { OfficeFeed } from "./office-feed";
import { PendingReviews } from "./pending-reviews";
import { ProcessDistribution } from "./process-distribution";
import { RecentClients } from "./recent-clients";

/**
 * Central de operação do escritório. Cada bloco é montado apenas se o
 * papel atual tiver a permissão correspondente (nada é escondido por CSS).
 */
export function HomeDashboard() {
  const can = useCan();
  const canReviews = can("reviews.view");
  const canActivity = can("dgbrasil.activity.view");

  return (
    <>
      <HomeGreeting />
      <HomeKpis />
      <Can permission="finance.view">
        <FinanceSnapshot />
      </Can>

      <div className="mt-6 grid grid-cols-12 gap-5">
        <div className="col-span-12 xl:col-span-8">
          <AttentionPanel />
        </div>
        <div className="col-span-12 xl:col-span-4">
          <ProcessDistribution />
        </div>

        {canReviews && (
          <div className="col-span-12 xl:col-span-7">
            <PendingReviews />
          </div>
        )}
        <div className={cn("col-span-12", canReviews && "xl:col-span-5")}>
          <RecentClients />
        </div>

        <div className={cn("col-span-12", canActivity && "xl:col-span-7")}>
          <OfficeFeed />
        </div>
        {canActivity && (
          <div className="col-span-12 xl:col-span-5">
            <AgentActivity />
          </div>
        )}
      </div>
    </>
  );
}
