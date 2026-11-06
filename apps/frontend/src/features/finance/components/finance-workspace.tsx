"use client";

import { useRouter } from "next/navigation";
import { useOptimistic, useTransition, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { PageContainer } from "@/components/layout/guards";
import { PageHeader } from "@/components/ui/display";
import { TabPanel, Tabs, type TabItem } from "@/components/ui/tabs";
import { DEFAULT_FINANCE_TAB, FINANCE_TABS, FINANCE_TAB_LABEL, type FinanceTab } from "../list-query";

const TAB_ITEMS: TabItem<FinanceTab>[] = FINANCE_TABS.map((key) => ({ key, label: FINANCE_TAB_LABEL[key] }));

/**
 * Financeiro (ADMIN) em abas, com `?aba=` na URL. Cada aba é lida NO SERVIDOR
 * só quando aberta (a página carrega os dados da aba ativa); trocar de aba
 * navega e limpa os filtros da aba anterior.
 */
export function FinanceWorkspace({ tab, children }: { tab: FinanceTab; children: ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [shown, setShown] = useOptimistic(tab);

  function change(next: FinanceTab) {
    if (next === shown) return;
    startTransition(() => {
      setShown(next);
      router.replace(next === DEFAULT_FINANCE_TAB ? "/financeiro" : `/financeiro?aba=${next}`, { scroll: false });
    });
  }

  return (
    <PageContainer>
      <PageHeader title="Financeiro" description="Tudo ligado ao processo: valor da causa, honorários (escritório × parceiro), contratos, recebimentos e despesas." />
      <Tabs items={TAB_ITEMS} value={shown} onChange={change} label="Seções do financeiro" className="mb-5" />
      <TabPanel tabKey={shown}>
        <div aria-busy={pending || undefined} className={cn("space-y-5 transition-opacity", pending && "pointer-events-none opacity-60")}>
          {children}
          <p className="text-[12px] text-subtle">Valores em reais. Êxito depende do resultado do processo e não representa receita garantida.</p>
        </div>
      </TabPanel>
    </PageContainer>
  );
}
