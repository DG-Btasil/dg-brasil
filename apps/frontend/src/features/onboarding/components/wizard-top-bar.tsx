"use client";

import Link from "next/link";
import { Save } from "lucide-react";
import { Wordmark } from "@/components/layout/wordmark";

export function WizardTopBar({
  index,
  total,
  completed,
  formId,
  busy,
  onSaveLater,
}: {
  index: number;
  total: number;
  completed: boolean;
  formId: string;
  busy: boolean;
  onSaveLater: () => void;
}) {
  const percent = Math.round(((index + 1) / total) * 100);
  return (
    <header className="bg-navy text-white">
      <div className="mx-auto flex h-14 max-w-[1480px] items-center gap-5 px-6">
        <Wordmark />
        <span aria-hidden className="h-5 w-px bg-white/20" />
        <span className="hidden text-[13px] text-white/80 sm:inline">Implantação do escritório</span>

        <div className="ml-auto flex items-center gap-5">
          <div className="hidden items-center gap-3 md:flex">
            <span className="text-[12px] tabular text-white/75">
              Etapa {index + 1} de {total}
            </span>
            <div
              role="progressbar"
              aria-label="Progresso da implantação"
              aria-valuemin={1}
              aria-valuemax={total}
              aria-valuenow={index + 1}
              aria-valuetext={`Etapa ${index + 1} de ${total}`}
              className="h-1 w-32 overflow-hidden rounded-full bg-white/15"
            >
              <div className="h-full bg-gold" style={{ width: `${percent}%` }} />
            </div>
          </div>
          {completed && (
            <Link href="/home" className="text-[12.5px] text-white/80 underline-offset-4 hover:text-white hover:underline">
              Ir para a Home
            </Link>
          )}
          <button
            type="submit"
            form={formId}
            disabled={busy}
            onClick={onSaveLater}
            className="inline-flex h-8 items-center gap-2 rounded-md border border-white/25 px-3 text-[12.5px] font-medium text-white transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50 disabled:opacity-50"
          >
            <Save className="size-3.5" aria-hidden />
            Salvar e continuar depois
          </button>
        </div>
      </div>
    </header>
  );
}
