import type { Tone } from "@/lib/constants/status";

/** Classes por tom semântico. Fonte única para badges, alertas e marcadores. */
export const TONE_BADGE: Record<Tone, string> = {
  neutral: "bg-surface-sunken text-muted border-line",
  navy: "bg-navy-50 text-navy-800 border-navy-100",
  gold: "bg-gold-50 text-[#7a5f0e] border-gold-100",
  info: "bg-info-soft text-info border-info-line",
  success: "bg-success-soft text-success border-success-line",
  warning: "bg-warning-soft text-warning border-warning-line",
  orange: "bg-orange-soft text-orange border-orange-line",
  danger: "bg-danger-soft text-danger border-danger-line",
};

export const TONE_DOT: Record<Tone, string> = {
  neutral: "bg-subtle",
  navy: "bg-navy-700",
  gold: "bg-gold-500",
  info: "bg-info",
  success: "bg-success",
  warning: "bg-warning",
  orange: "bg-orange",
  danger: "bg-danger",
};

export const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-muted",
  navy: "text-navy-800",
  gold: "text-[#7a5f0e]",
  info: "text-info",
  success: "text-success",
  warning: "text-warning",
  orange: "text-orange",
  danger: "text-danger",
};

export const TONE_BORDER_LEFT: Record<Tone, string> = {
  neutral: "border-l-line-strong",
  navy: "border-l-navy-700",
  gold: "border-l-gold-500",
  info: "border-l-info",
  success: "border-l-success",
  warning: "border-l-warning",
  orange: "border-l-orange",
  danger: "border-l-danger",
};
