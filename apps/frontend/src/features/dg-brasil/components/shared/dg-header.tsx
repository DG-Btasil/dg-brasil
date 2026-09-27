"use client";

import Link from "next/link";
import { cn } from "@/lib/cn";
import { formatCompact, formatNumber } from "@/lib/formatting";
import { useDgOverview } from "../../hooks";
import { DG_SECTIONS, DG_SECTION_LABEL, dgRoutes, type DgSection } from "../../utils";

/** Cabeçalho institucional da Central DG Brasil + indicadores + navegação. */
export function DgHeader({ active }: { active: DgSection }) {
  return (
    <div className="mb-6">
      <header className="mb-5">
        <div className="eyebrow mb-1.5">Central de IA</div>
        <h1 className="font-serif text-[30px] font-medium leading-tight tracking-[-0.01em] text-foreground">DG Brasil</h1>
        <p className="mt-1 text-[13.5px] text-muted">Equipe digital e conhecimento operacional do escritório.</p>
      </header>
      <OverviewStrip />
      <SectionNav active={active} />
    </div>
  );
}

function OverviewStrip() {
  const o = useDgOverview();
  const items = [
    { label: "Agentes ativos", value: formatNumber(o.activeAgents), hint: `de ${formatNumber(o.totalAgents)}` },
    { label: "Skills ativas", value: formatNumber(o.activeSkills) },
    { label: "Teses vigentes", value: formatNumber(o.activeTheses) },
    { label: "Alterações (30 dias)", value: formatNumber(o.changesLast30Days) },
    { label: "Consumo do mês", value: formatCompact(o.monthTokens), hint: "tokens" },
  ];
  return (
    <dl className="mb-5 grid grid-cols-5 divide-x divide-line rounded-lg border border-line bg-surface shadow-hairline">
      {items.map((item) => (
        <div key={item.label} className="px-5 py-3">
          <dt className="text-[11.5px] font-medium uppercase tracking-[0.06em] text-subtle">{item.label}</dt>
          <dd className="mt-1 flex items-baseline gap-1.5">
            <span className="text-[20px] font-semibold tabular text-navy">{item.value}</span>
            {item.hint && <span className="text-[12px] text-muted">{item.hint}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function SectionNav({ active }: { active: DgSection }) {
  return (
    <nav aria-label="Seções do DG Brasil">
      <ul className="flex gap-6 border-b border-line">
        {DG_SECTIONS.map((section) => {
          const selected = section === active;
          return (
            <li key={section}>
              <Link
                href={dgRoutes.section(section)}
                scroll={false}
                aria-current={selected ? "page" : undefined}
                className={cn(
                  "relative -mb-px flex items-center border-b-2 pb-2.5 pt-1 text-[13px] font-medium transition-colors",
                  selected ? "border-gold text-navy" : "border-transparent text-muted hover:text-foreground",
                )}
              >
                {DG_SECTION_LABEL[section]}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
