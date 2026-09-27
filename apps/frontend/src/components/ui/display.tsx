import Link from "next/link";
import type { ReactNode } from "react";
import { AlarmClock, CalendarClock, CheckCircle2, ChevronRight, CircleAlert, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { DEADLINE_URGENCY_LABEL, DEADLINE_URGENCY_TONE, type Tone } from "@/lib/constants/status";
import { deadlineUrgency, formatDeadline, initials } from "@/lib/formatting";
import { TONE_BADGE, TONE_DOT, TONE_TEXT } from "./tone";

/* ------------------------------------------------------------------ */

export function Avatar({ name, size = "md", tone = "navy", className }: { name: string; size?: "xs" | "sm" | "md" | "lg"; tone?: "navy" | "gold" | "neutral"; className?: string }) {
  const dim = { xs: "size-6 text-[10px]", sm: "size-7 text-[11px]", md: "size-8 text-[12px]", lg: "size-11 text-[15px]" }[size];
  const color = {
    navy: "bg-navy-700 text-white",
    gold: "bg-gold text-navy",
    neutral: "bg-surface-sunken text-navy-700 border border-line",
  }[tone];
  return (
    <span aria-hidden className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-semibold tracking-wide", dim, color, className)}>
      {initials(name)}
    </span>
  );
}

/* ------------------------------------------------------------------ */

interface BreadcrumbItem {
  label: string;
  href?: string;
}

export function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav aria-label="Trilha de navegação" className="mb-2">
      <ol className="flex items-center gap-1 text-[12px] text-muted">
        {items.map((item, i) => (
          <li key={`${item.label}-${i}`} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="size-3 text-subtle" aria-hidden />}
            {item.href ? (
              <Link href={item.href} className="hover:text-navy hover:underline underline-offset-2">
                {item.label}
              </Link>
            ) : (
              <span aria-current="page" className="text-foreground">
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Cabeçalho padrão de página: trilha, título, descrição, ações e metadados. */
export function PageHeader({
  title,
  description,
  breadcrumbs,
  actions,
  meta,
  eyebrow,
  serif,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  breadcrumbs?: BreadcrumbItem[];
  actions?: ReactNode;
  meta?: ReactNode;
  eyebrow?: ReactNode;
  /** Serifada só em títulos institucionais. */
  serif?: boolean;
  className?: string;
}) {
  return (
    <header className={cn("mb-6", className)}>
      {breadcrumbs && <Breadcrumbs items={breadcrumbs} />}
      <div className="flex items-end justify-between gap-6">
        <div className="min-w-0">
          {eyebrow && <div className="eyebrow mb-1.5">{eyebrow}</div>}
          <h1 className={cn("text-foreground", serif ? "font-serif text-[30px] font-medium leading-tight tracking-[-0.01em]" : "text-[22px] font-semibold tracking-[-0.01em]")}>
            {title}
          </h1>
          {description && <p className="mt-1 max-w-[720px] text-[13.5px] text-muted">{description}</p>}
          {meta && <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12.5px] text-muted">{meta}</div>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ */

/** Indicador numérico (KPI). */
export function Stat({
  label,
  value,
  hint,
  icon: Icon,
  tone = "neutral",
  href,
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: LucideIcon;
  tone?: Tone;
  href?: string;
  className?: string;
}) {
  const content = (
    <>
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-medium text-muted">{label}</span>
        {Icon && <Icon className={cn("size-4", tone === "neutral" ? "text-subtle" : TONE_TEXT[tone])} aria-hidden />}
      </div>
      <div className="mt-2 font-serif text-[30px] font-medium leading-none tabular text-navy">{value}</div>
      {hint && <div className="mt-2 text-[12px] text-muted">{hint}</div>}
    </>
  );
  const cls = cn("block rounded-lg border border-line bg-surface px-5 py-4 shadow-hairline", href && "transition-colors hover:border-navy-600/40", className);
  return href ? (
    <Link href={href} className={cls}>
      {content}
    </Link>
  ) : (
    <div className={cls}>{content}</div>
  );
}

/* ------------------------------------------------------------------ */

const URGENCY_ICON = { OVERDUE: CircleAlert, TODAY: AlarmClock, TOMORROW: AlarmClock, SOON: CalendarClock, LATER: CalendarClock } as const;

/** Vencimento com ícone + texto + cor (acessível). */
export function DeadlineBadge({ dueDate, done, className }: { dueDate: string; done?: boolean; className?: string }) {
  if (done) {
    return (
      <span className={cn("inline-flex h-[22px] items-center gap-1 rounded-xs border px-1.5 text-[11.5px] font-medium", TONE_BADGE.success, className)}>
        <CheckCircle2 className="size-3" aria-hidden /> Cumprido
      </span>
    );
  }
  const urgency = deadlineUrgency(dueDate);
  const tone = DEADLINE_URGENCY_TONE[urgency];
  const Icon = URGENCY_ICON[urgency];
  return (
    <span
      title={DEADLINE_URGENCY_LABEL[urgency]}
      className={cn("inline-flex h-[22px] items-center gap-1 whitespace-nowrap rounded-xs border px-1.5 text-[11.5px] font-medium", TONE_BADGE[tone], className)}
    >
      <Icon className="size-3" aria-hidden />
      {formatDeadline(dueDate)}
    </span>
  );
}

/* ------------------------------------------------------------------ */

export interface TimelineItem {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  tone?: Tone;
  highlight?: boolean;
}

/** Timeline vertical limpa (movimentações, histórico de análise). */
export function Timeline({ items, className }: { items: TimelineItem[]; className?: string }) {
  return (
    <ol className={cn("relative", className)}>
      {items.map((item, i) => (
        <li key={item.id} className="relative grid grid-cols-[20px_minmax(0,1fr)] gap-3 pb-5 last:pb-0">
          {i < items.length - 1 && <span aria-hidden className="absolute left-[9px] top-4 bottom-0 w-px bg-line" />}
          <span className="relative mt-1 flex size-[19px] items-center justify-center">
            <span
              className={cn(
                "size-2.5 rounded-full ring-4 ring-surface",
                item.highlight ? TONE_DOT[item.tone ?? "gold"] : TONE_DOT[item.tone ?? "neutral"],
              )}
            />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <p className={cn("text-[13px] text-foreground", item.highlight && "font-semibold")}>{item.title}</p>
              {item.meta && <span className="text-[11.5px] text-subtle tabular">{item.meta}</span>}
            </div>
            {item.description && <div className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{item.description}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}

/* ------------------------------------------------------------------ */

export type StepState = "done" | "current" | "pending" | "blocked";

/** Etapas horizontais (wizard, progresso de análise). */
export function Steps({ steps, className }: { steps: { key: string; label: string; state: StepState; description?: string }[]; className?: string }) {
  return (
    <ol className={cn("flex items-start", className)}>
      {steps.map((step, i) => (
        <li key={step.key} className="flex flex-1 items-start last:flex-none">
          <div className="flex flex-col items-start">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold tabular",
                  step.state === "done" && "border-navy bg-navy text-white",
                  step.state === "current" && "border-gold bg-gold-50 text-navy",
                  step.state === "pending" && "border-line-strong bg-surface text-subtle",
                  step.state === "blocked" && "border-orange-line bg-orange-soft text-orange",
                )}
                aria-hidden
              >
                {step.state === "done" ? "✓" : step.state === "blocked" ? "!" : i + 1}
              </span>
              <span className={cn("whitespace-nowrap text-[12.5px]", step.state === "pending" ? "text-muted" : "font-medium text-foreground")}>
                {step.label}
                <span className="sr-only">
                  {" — "}
                  {{ done: "concluída", current: "em andamento", pending: "pendente", blocked: "bloqueada" }[step.state]}
                </span>
              </span>
            </div>
            {step.description && <span className="ml-8 mt-0.5 text-[11.5px] text-muted">{step.description}</span>}
          </div>
          {i < steps.length - 1 && <span aria-hidden className={cn("mx-3 mt-3 h-px flex-1", step.state === "done" ? "bg-navy" : "bg-line")} />}
        </li>
      ))}
    </ol>
  );
}

/** Rótulo "Conteúdo jurídico fictício" padrão. */
export function DemoContentNotice({ children = "Conteúdo jurídico fictício para demonstração da interface.", className }: { children?: ReactNode; className?: string }) {
  return (
    <p className={cn("inline-flex items-center gap-1.5 rounded-xs border border-dashed border-line-strong px-2 py-1 text-[11.5px] text-muted", className)}>
      <CircleAlert className="size-3" aria-hidden />
      {children}
    </p>
  );
}
