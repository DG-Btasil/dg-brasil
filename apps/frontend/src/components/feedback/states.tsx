import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, OctagonAlert, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

/** Estado vazio útil: explica e oferece a próxima ação. Nunca "No data". */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  compact,
}: {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center", compact ? "px-6 py-8" : "px-8 py-14", className)}>
      {Icon && (
        <div className="mb-3 flex size-10 items-center justify-center rounded-full border border-line bg-surface-muted text-navy-600">
          <Icon className="size-[18px]" aria-hidden />
        </div>
      )}
      <p className="text-[14px] font-semibold text-foreground">{title}</p>
      {description && <p className="mt-1 max-w-[420px] text-[13px] leading-relaxed text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Skeleton discreto. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse-soft rounded-sm bg-surface-sunken", className)} />;
}

export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3 p-5" role="status" aria-label="Carregando">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4">
          <Skeleton className="h-4 w-1/4" />
          <Skeleton className="h-4 w-1/6" />
          <Skeleton className="h-4 flex-1" />
        </div>
      ))}
    </div>
  );
}

export function ErrorState({ title = "Não foi possível carregar as informações.", description, action }: { title?: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div role="alert" className="flex flex-col items-center px-8 py-12 text-center">
      <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-danger-soft text-danger">
        <OctagonAlert className="size-[18px]" aria-hidden />
      </div>
      <p className="text-[14px] font-semibold text-foreground">{title}</p>
      {description && <p className="mt-1 max-w-[420px] text-[13px] text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

type CalloutTone = "info" | "warning" | "danger" | "success" | "neutral";
const CALLOUT: Record<CalloutTone, { cls: string; Icon: LucideIcon }> = {
  info: { cls: "border-info-line bg-info-soft text-info", Icon: Info },
  warning: { cls: "border-warning-line bg-warning-soft text-warning", Icon: AlertTriangle },
  danger: { cls: "border-danger-line bg-danger-soft text-danger", Icon: OctagonAlert },
  success: { cls: "border-success-line bg-success-soft text-success", Icon: CheckCircle2 },
  neutral: { cls: "border-line bg-surface-muted text-muted", Icon: Info },
};

/** Aviso inline com ícone + texto (prioridade nunca comunicada só por cor). */
export function Callout({ tone = "info", title, children, action, className }: { tone?: CalloutTone; title?: ReactNode; children?: ReactNode; action?: ReactNode; className?: string }) {
  const { cls, Icon } = CALLOUT[tone];
  return (
    <div className={cn("flex items-start gap-3 rounded-md border px-4 py-3", cls, className)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 text-[13px] leading-relaxed">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="text-foreground/80">{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
