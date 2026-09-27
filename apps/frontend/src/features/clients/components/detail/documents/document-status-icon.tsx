import { CheckCircle2, CircleDashed, CircleX, Clock, RefreshCw, ShieldAlert, ShieldCheck, ShieldQuestion, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  DOCUMENT_STATUS_LABEL,
  DOCUMENT_STATUS_TONE,
  DOCUMENT_VERIFICATION_LABEL,
  type DocumentStatus,
  type DocumentVerification,
} from "@/lib/constants/status";
import { TONE_TEXT } from "@/components/ui/tone";

const STATUS_ICON: Record<DocumentStatus, LucideIcon> = {
  RECEIVED: CheckCircle2,
  PENDING: Clock,
  MISSING: CircleDashed,
  NEEDS_UPDATE: RefreshCw,
  REJECTED: CircleX,
};

/** Status do documento com ícone + texto (nunca só cor). */
export function DocumentStatusLabel({ status, className }: { status: DocumentStatus; className?: string }) {
  const Icon = STATUS_ICON[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap text-[12.5px] font-medium", TONE_TEXT[DOCUMENT_STATUS_TONE[status]], className)}>
      <Icon className="size-3.5" aria-hidden />
      {DOCUMENT_STATUS_LABEL[status]}
    </span>
  );
}

const VERIFICATION: Record<DocumentVerification, { Icon: LucideIcon; cls: string }> = {
  VERIFIED: { Icon: ShieldCheck, cls: "text-success" },
  UNVERIFIED: { Icon: ShieldQuestion, cls: "text-muted" },
  FAILED: { Icon: ShieldAlert, cls: "text-danger" },
};

export function VerificationLabel({ verification }: { verification: DocumentVerification }) {
  const { Icon, cls } = VERIFICATION[verification];
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap text-[12.5px]", cls)}>
      <Icon className="size-3.5" aria-hidden />
      {DOCUMENT_VERIFICATION_LABEL[verification]}
    </span>
  );
}
