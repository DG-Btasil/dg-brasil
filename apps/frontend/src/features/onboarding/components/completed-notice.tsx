"use client";

import { CheckCircle2, RotateCcw } from "lucide-react";
import { formatDateLong } from "@/lib/formatting";
import { Button, ButtonLink } from "@/components/ui/button";

/** Aviso exibido quando a implantação já foi concluída (útil para demonstração). */
export function CompletedNotice({ completedAt, onRestart }: { completedAt?: string; onRestart: () => void }) {
  return (
    <div className="mb-6 flex flex-wrap items-start gap-3 rounded-md border border-success-line bg-success-soft px-4 py-3">
      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-success">
          Implantação concluída{completedAt ? ` em ${formatDateLong(completedAt)}` : ""}
        </p>
        <p className="text-[12.5px] text-foreground/80">
          Você pode revisar e editar qualquer etapa. As alterações são salvas etapa por etapa.
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button size="sm" variant="secondary" onClick={onRestart} icon={<RotateCcw className="size-3.5" aria-hidden />}>
          Revisar desde a etapa 1
        </Button>
        <ButtonLink size="sm" href="/home">
          Ir para a Home
        </ButtonLink>
      </div>
    </div>
  );
}
