import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { Tone } from "@/lib/constants/status";
import { TONE_BADGE, TONE_DOT } from "./tone";

interface BadgeProps {
  tone?: Tone;
  children: ReactNode;
  /** Ponto colorido à esquerda. O texto sempre acompanha — nunca só cor. */
  dot?: boolean;
  icon?: ReactNode;
  className?: string;
  title?: string;
}

export function Badge({ tone = "neutral", children, dot, icon, className, title }: BadgeProps) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-xs border px-1.5 text-[11.5px] font-medium leading-none",
        TONE_BADGE[tone],
        className,
      )}
    >
      {dot && <span aria-hidden className={cn("size-1.5 rounded-full", TONE_DOT[tone])} />}
      {icon}
      {children}
    </span>
  );
}

/** Badge a partir de um valor de status + mapas centralizados de rótulo/tom. */
export function StatusBadge<S extends string>({
  status,
  labels,
  tones,
  className,
}: {
  status: S;
  labels: Record<S, string>;
  tones: Record<S, Tone>;
  className?: string;
}) {
  return (
    <Badge tone={tones[status]} dot className={className}>
      {labels[status]}
    </Badge>
  );
}
